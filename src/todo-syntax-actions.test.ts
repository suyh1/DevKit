import { describe, expect, it } from 'vitest';
import { parseTodo, todoReferences } from '../shared/todo-text.mjs';
import { planTodoSyntax, todoSyntaxFields } from './todo-syntax-actions';
import type { TodoSyntaxAction, TodoSyntaxFields } from './todo-syntax-actions';

const source = [
  '发布:', '  :: 默认 @旧标签 @owner(小周)', '  :: 默认 @临时', '  ☐ 验证下载 @due(2026-12-01) @wait(小林)',
  '    ? [x] 能找到下载按钮', '    :: 接着 核对旧地址', '  ✔ 打包', '  ☐ 另一项 @after(task-1)',
].join('\n');

function apply(action: TodoSyntaxAction, values: Partial<TodoSyntaxFields>, target = 4) {
  const model = parseTodo(source);
  const plan = planTodoSyntax(model, action, { ...todoSyntaxFields(action, model, target, false), ...values });
  const replacements = new Map(plan.edits);
  const body = model.lines.map((line, index) => replacements.get(index + 1) ?? line).join('\n');
  return { model: parseTodo(body), body, focus: plan.focus };
}

describe('Todo syntax toolbar edits', () => {
  it('inserts a check, updates the current resume point and keeps subsequent tasks', () => {
    const check = apply('check', { primary: 'ZIP 解压后目录完整' });
    expect(check.model.tasksByLine.get(4)?.checks.map(item => [item.checked, item.text])).toEqual([
      [true, '能找到下载按钮'], [false, 'ZIP 解压后目录完整'],
    ]);
    expect(check.focus).toBe(7);
    expect(check.model.tasksByLine.get(8)?.text).toBe('打包');
    const resume = apply('resume', { primary: '用只读访客验证' });
    expect(resume.model.tasksByLine.get(4)?.resume?.text).toBe('用只读访客验证');
    expect(resume.body).not.toContain('核对旧地址');
  });

  it('writes views, references, reviews and recurrence as native document syntax', () => {
    expect(apply('view', { primary: '待验收', secondary: '验收' }).model.views[0].name).toBe('待验收');
    const { model } = apply('reference', { primary: '发布材料', option: '共享' });
    expect(todoReferences(model.lines[3])).toMatchObject([{ kind: 'share', name: '发布材料' }]);
    expect(apply('wait', { primary: '小周', secondary: '2026-12-04' }).model.tasksByLine.get(4)?.waiting).toEqual({ person: '小周', review: '2026-12-04' });
    const repeat = apply('repeat', { option: '每月31日' });
    expect(repeat.model.lines[3]).toContain('@due(2026-12-01) @repeat(每月31日)');
    expect(() => apply('repeat', { option: '每月31日', secondary: '2026-02-30' })).toThrow('到期日期');
  });

  it('assigns a stable dependency ID without capturing a missing reference and replaces group defaults', () => {
    const dependency = apply('dependency', { related: 7 });
    expect(dependency.model.tasksByLine.get(4)?.dependencies).toEqual([{ id: 'task-2', line: 7, state: 'done' }]);
    expect(dependency.model.tasksByLine.get(8)?.dependencies[0].state).toBe('missing');
    const defaults = apply('defaults', { primary: '验收 运维 @owner(陈)' }, 1);
    expect([...defaults.model.sections[0].defaults.values()]).toEqual(['@owner(陈)', '@验收', '@运维']);
    expect(defaults.body).not.toContain('@旧标签');
  });
});
