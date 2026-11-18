import { isTodoDate, isTodoDefaultTag, replaceTodoTags, todoTags } from '../shared/todo-text.mjs';
import type { TodoModel, TodoTask } from '../shared/todo-text.mjs';

export type TodoSyntaxAction = 'check' | 'resume' | 'view' | 'reference' | 'wait' | 'dependency' | 'repeat' | 'defaults';
export type TodoSyntaxFields = { target: number; related: number; primary: string; secondary: string; option: string };
export type TodoSyntaxPlan = { edits: [line: number, text: string][]; focus: number };

const monthlyRules = Array.from({ length: 31 }, (_, index) => `每月${index + 1}日`);
export const todoRepeatRules = ['每天', '每周', ...Array.from('一二三四五六日', day => `每周${day}`), '每月', ...monthlyRules];
export const todoViewStates = [
  ['open', '待办'], ['done', '已完成'], ['cancelled', '已取消'], ['closed', '已结束'], ['today', '今日与逾期'],
  ['waiting', '等待回访'], ['follow-up', '到期回访'], ['ready', '可开始'], ['blocked', '等待前置'],
] as const;

const tagValue = (task: TodoTask, name: string) => task.tags.find(tag => tag.name === name)?.value.trim() ?? '';

export function todoSyntaxFields(action: TodoSyntaxAction, model: TodoModel, target: number, portal: boolean): TodoSyntaxFields {
  const fields = { target, related: 0, primary: '', secondary: '', option: '' };
  const task = model.tasksByLine.get(target);
  if (action === 'reference') fields.option = portal ? '共享' : '工具';
  if (action === 'view') fields.option = 'open';
  if (action === 'defaults') fields.primary = [...(model.sectionsByLine.get(target)?.defaults.values() ?? [])].join(' ');
  if (task && action === 'resume') fields.primary = task.resume?.text ?? '';
  if (task && action === 'wait') {
    fields.primary = task.waiting?.person ?? '';
    fields.secondary = task.waiting?.review ?? '';
  }
  if (task && action === 'repeat') {
    const rule = (tagValue(task, 'repeat') || '每天').replace(/^每周天$/, '每周日').replace(/号$/, '日');
    fields.option = todoRepeatRules.includes(rule) ? rule : '';
    fields.secondary = tagValue(task, 'due');
  }
  return fields;
}

function required(text: string, error: string) {
  const value = text.trim();
  if (!value || /[\r\n\0]/.test(value)) throw new Error(error);
  return value;
}

function defaultTags(text: string) {
  const source = required(text, '请填写至少一个默认标签。');
  const tags = todoTags(source);
  const explicit = tags.map(tag => source.slice(tag.from, tag.to));
  const plain = replaceTodoTags(source, tags.map(tag => tag.name), []).split(/[\s,，、]+/u).filter(Boolean);
  if (tags.some(tag => !isTodoDefaultTag(tag.name)) || plain.some(name => !/^[\p{L}\p{N}_-]+$/u.test(name) || !isTodoDefaultTag(name.toLowerCase()))) {
    throw new Error('请输入用空格分隔的标签，如「验收 运维」或「@验收 @owner(小周)」。');
  }
  const values = [...new Set([...explicit, ...plain.map(name => `@${name}`)])];
  if (!values.length) throw new Error('请填写至少一个默认标签。');
  return values.join(' ');
}

export function planTodoSyntax(model: TodoModel, action: TodoSyntaxAction, fields: TodoSyntaxFields): TodoSyntaxPlan {
  const { target, related, primary, secondary, option } = fields;
  const replace = (line: number, text: string): TodoSyntaxPlan => ({ edits: [[line, text]], focus: line });
  const addBelow = (line: number, text: string): TodoSyntaxPlan => ({ edits: [[line, `${model.lines[line - 1]}\n${text}`]], focus: line + 1 });

  if (action === 'view') {
    const name = required(primary, '请填写视图名称。');
    const label = secondary.trim().replace(/^@/, '');
    if (todoTags(name).length || /[\r\n)\0]/.test(label)) throw new Error('请检查视图名称和标签。');
    if (option && !todoViewStates.some(([value]) => value === option)) throw new Error('请选择有效的任务状态。');
    if (!label && !option) throw new Error('请至少设置标签或任务状态。');
    const text = [`:: 视图 ${name}`, label && `@tag(${label})`, option && `@state(${option})`].filter(Boolean).join(' ');
    const existing = model.views.find(view => view.name === name);
    return replace(existing?.line ?? 1, existing ? text : model.lines[0] ? `${text}\n${model.lines[0]}` : text);
  }
  if (action === 'defaults') {
    const section = model.sectionsByLine.get(target);
    if (!section || section.archived) throw new Error('请选择一个分组。');
    const text = `${section.indent}  :: 分组默认 ${defaultTags(primary)}`;
    const existing = section.defaultLines.at(-1);
    return existing ? { edits: [...section.defaultLines.slice(0, -1).map(line => [line, ''] as [number, string]), [existing, text]], focus: existing }
      : addBelow(section.line, text);
  }

  const task = model.tasksByLine.get(target);
  if (!task || task.archived) throw new Error('请选择一项任务。');
  const source = model.lines[task.line - 1];
  const tagsOnTask = (names: string[], tags: string[]) => replace(task.line, replaceTodoTags(source, names, tags));

  switch (action) {
    case 'check':
      return addBelow(task.endLine, `${task.indent}  ? [ ] ${required(primary, '请填写验收条件。')}`);
    case 'resume': {
      const text = `${task.indent}  :: 续做 ${required(primary, '请填写接下来要做的事。')}`;
      return task.resume ? replace(task.resume.line, text) : addBelow(task.endLine, text);
    }
    case 'reference': {
      const name = required(primary, '请填写引用名称或 ID。');
      if (/[\[\]]/.test(name)) throw new Error('引用名称不能包含方括号。');
      if (!['共享', '工具'].includes(option)) throw new Error('请选择引用类型。');
      const reference = `[[${option}:${name}]]`;
      return source.includes(reference) ? { edits: [], focus: task.line } : tagsOnTask([], [reference]);
    }
    case 'wait': {
      const person = primary.trim();
      if (!person && !secondary) throw new Error('请填写等待对象或回访日期。');
      if (/[\r\n)\0]/.test(person) || (secondary && !isTodoDate(secondary))) throw new Error('请检查等待对象和回访日期。');
      return tagsOnTask(['wait', 'review'], [person && `@wait(${person})`, secondary && `@review(${secondary})`].filter(Boolean));
    }
    case 'repeat': {
      if (!todoRepeatRules.includes(option) || (secondary && !isTodoDate(secondary))) throw new Error('请检查重复周期和到期日期。');
      return tagsOnTask(['repeat', 'due'], [secondary && `@due(${secondary})`, `@repeat(${option})`].filter(Boolean));
    }
    case 'dependency': {
      const predecessor = model.tasksByLine.get(related);
      if (!predecessor || predecessor.line === task.line) throw new Error('请选择另一项任务作为前置。');
      const allIds = model.tasks.map(item => tagValue(item, 'id').toLowerCase());
      let id = tagValue(predecessor, 'id');
      const needsId = !id;
      if (id && (/[,)\r\n\0]/.test(id) || allIds.filter(value => value === id.toLowerCase()).length > 1)) {
        throw new Error('所选前置任务的 ID 重复或格式无效，请先修改。');
      }
      if (needsId) {
        const used = new Set([...allIds, ...model.tasks.flatMap(item => item.dependencies.map(dependency => dependency.id))]);
        let counter = 1;
        while (used.has(`task-${counter}`)) counter++;
        id = `task-${counter}`;
      }
      const dependencies = task.dependencies.map(item => item.id);
      if (dependencies.includes(id.toLowerCase()) && !needsId) return { edits: [], focus: task.line };
      const plan = tagsOnTask(['after'], [`@after(${[...dependencies, id].join(',')})`]);
      if (needsId) plan.edits.push([predecessor.line, replaceTodoTags(model.lines[predecessor.line - 1], ['id'], [`@id(${id})`])]);
      return plan;
    }
  }
}
