import SegmentedControl from './SegmentedControl';
import { useId, useMemo, useState } from 'react';
import { CalendarDays, GitBranch, Layers, LayoutList, Link2, ListChecks, Play, Repeat2 } from 'lucide-react';
import { todoGroupAt, todoTaskTitle } from '../shared/todo-text.mjs';
import type { TodoModel } from '../shared/todo-text.mjs';
import { workspaceModules } from './catalog';
import { RelatedLink, useWorkspaceGuard } from './related-workspaces';
import { fileShareRequest, publishedShares, type FileShareState } from './planning-share-api';
import { Modal, ModalCancel, ModalForm } from './project-components';
import type { TodoEditorHandle } from './TodoTextEditor';
import { planTodoSyntax, todoRepeatRules, todoSyntaxFields, todoViewStates } from './todo-syntax-actions';
import type { TodoSyntaxAction, TodoSyntaxFields } from './todo-syntax-actions';

const actions = [
  ['check', '验收条件', ListChecks], ['resume', '续做点', Play], ['view', '自定义视图', LayoutList], ['reference', '添加引用', Link2],
  ['wait', '等待回访', CalendarDays], ['dependency', '前置任务', GitBranch], ['repeat', '周期任务', Repeat2], ['defaults', '分组默认', Layers],
] as const;

type Props = { active: boolean; model: TodoModel; editor: TodoEditorHandle | null; line: number; locked: boolean; portal: boolean };

export default function TodoSyntaxActions({ active, model, editor, line, locked, portal }: Props) {
  const [draft, setDraft] = useState<{ action: TodoSyntaxAction; fields: TodoSyntaxFields; model: TodoModel } | null>(null);
  const [error, setError] = useState('');
  const [shares, setShares] = useState<{ id: string; name: string }[]>();
  const peopleList = useId();
  const guard = useWorkspaceGuard();
  async function loadShares() {
    if (!guard('file-shares')) return;
    try {
      const result = portal ? await publishedShares() : await fileShareRequest<FileShareState>('get');
      setShares(result.shares);
    } catch (failure) { setError((failure as Error).message); }
  }
  const tasks = useMemo(() => model.tasks.map(task => ({ task, title: todoTaskTitle(task) })).filter(item => item.title), [model]);
  const editable = useMemo(() => tasks.filter(item => !item.task.archived), [tasks]);
  const groups = useMemo(() => model.sections.filter(section => !section.archived), [model]);

  function begin(action: TodoSyntaxAction) {
    setShares(undefined);
    const task = editable.filter(item => item.task.line <= line && item.task.endLine >= line).at(-1)?.task ?? editable[0]?.task;
    const group = todoGroupAt(model, line);
    const target = action === 'defaults' ? (group && !group.archived ? group.line : groups[0]?.line) : task?.line;
    setError('');
    setDraft({ action, model, fields: todoSyntaxFields(action, model, target ?? 0, portal) });
  }

  function update(values: Partial<TodoSyntaxFields>) {
    setDraft(current => current && ({ ...current, fields: { ...current.fields, ...values } }));
    setError('');
  }

  function submit() {
    if (!draft || !editor || locked) return;
    try {
      const plan = planTodoSyntax(draft.model, draft.action, draft.fields);
      if (!editor.applySyntax(draft.model.lines.join('\n'), plan.edits)) throw new Error('清单已变更，请关闭窗口后重试。');
      setDraft(null);
      requestAnimationFrame(() => editor.jump(plan.focus));
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  const action = draft?.action;
  const fields = draft?.fields;
  const label = actions.find(([name]) => name === action)?.[1];
  const input = (name: string, placeholder: string, required = true) => fields && <label className="pc-field">{name}
    <input required={required} maxLength={240} placeholder={placeholder} value={fields.primary} onChange={event => update({ primary: event.target.value })} />
  </label>;

  const inTask = editable.some(({ task }) => task.line <= line && task.endLine >= line);
  const group = todoGroupAt(model, line);
  const primary = inTask ? ['check', 'resume'] : group && !group.archived ? ['defaults'] : ['view'];
  const actionButton = ([name, text, Icon]: typeof actions[number]) => {
    const unavailable = name === 'defaults' && !groups.length ? '先添加分组'
      : name !== 'defaults' && name !== 'view' && !editable.length ? '先添加任务'
        : name === 'dependency' && tasks.length < 2 ? '至少需要两项任务' : '';
    return <button key={name} type="button" aria-haspopup="dialog" title={unavailable || text} disabled={locked || !editor || !!unavailable} onClick={() => begin(name)}>
      <Icon size={14} />{text}
    </button>;
  };
  return <>
    <div className="td-toolbar td-syntax-toolbar" role="group" aria-label="待办扩展操作">
      {actions.filter(([name]) => primary.includes(name)).map(actionButton)}
      <details className="td-more"><summary>扩展语法</summary><div>{([['任务进展', ['check','resume','dependency','wait','repeat']], ['组织清单', ['view','reference','defaults']]] as const).map(([label, names]) => {
        const items = actions.filter(([name]) => (names as readonly string[]).includes(name) && !primary.includes(name));
        return items.length > 0 && <fieldset key={label}><legend>{label}</legend>{items.map(actionButton)}</fieldset>;
      })}</div></details>
    </div>
    {draft && fields && <Modal active={active} title={label!} closeLabel="关闭待办扩展操作" close={() => setDraft(null)} draft={fields} className="td-settings-dialog">
      <ModalForm footer={<footer className="pc-form-footer"><ModalCancel /><button className="run-button" disabled={locked}>写入清单</button></footer>} className="td-settings td-syntax-form" onSubmit={event => { event.preventDefault(); submit(); }}>
        {action !== 'view' && <label className="pc-field">{action === 'defaults' ? '分组' : '应用到任务'}
          <select value={fields.target} required onChange={event => {
            setDraft({ ...draft, fields: todoSyntaxFields(draft.action, draft.model, Number(event.target.value), portal) });
            setError('');
          }}>
            {action === 'defaults' ? groups.map(group => <option key={group.line} value={group.line}>{group.path}</option>)
              : editable.map(({ task, title }) => <option key={task.line} value={task.line}>{title} · 第 {task.line} 行</option>)}
          </select>
        </label>}
        {action === 'check' && input('验收内容', '例如 ZIP 解压后目录完整')}
        {action === 'resume' && input('做到哪里或回来从哪接上', '例如 已测管理员，下次从只读账号开始')}
        {action === 'defaults' && input('默认标签', '用空格分隔，例如 验收 运维')}
        {action === 'view' && <>
          {input('视图名称', '例如 待验收')}
          <label className="pc-field">标签<input maxLength={80} value={fields.secondary} placeholder="例如 验收" onChange={event => update({ secondary: event.target.value })} /></label>
          <label className="pc-field">任务状态<select value={fields.option} onChange={event => update({ option: event.target.value })}>
            <option value="">全部状态</option>{todoViewStates.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select></label>
        </>}
        {action === 'reference' && <>
          <div className="pc-field choice-field"><span>引用类型</span><SegmentedControl label="引用类型" value={fields.option}
            options={[{ value: '共享', label: '文件共享' }, { value: '工具', label: '工作台栏目或桌面工具' }]} onChange={option => update({ option })} /></div>
          {fields.option === '共享' ? <>
            <button type="button" className="text-button" onClick={() => void loadShares()}>选择文件共享</button>
            {shares && (shares.length ? <label className="pc-field">可引用的共享<select value={shares.some(item => item.id === fields.primary) ? fields.primary : ''} onChange={event => update({ primary: event.target.value })}>
              <option value="">选择共享</option>{shares.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label> : <p>暂无可引用的共享。</p>)}
            <RelatedLink page="file-shares">查看文件共享</RelatedLink>
          </> : <label className="pc-field">工作台栏目<select value={workspaceModules.some(item => item.id === fields.primary) ? fields.primary : ''} onChange={event => update({ primary: event.target.value })}>
            <option value="">选择栏目</option>{workspaceModules.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>}
          {input('引用名称或 ID', fields.option === '共享' ? '例如 发布材料' : '例如 JSON 格式化')}
        </>}
        {action === 'wait' && <label className="pc-field">等待对象<input maxLength={240} list={peopleList} value={fields.primary} onChange={e => update({ primary: e.target.value })} /><datalist id={peopleList}>{[...new Set(tasks.map(({task}) => task.waiting?.person).filter(Boolean))].map(person => <option key={person} value={person} />)}</datalist></label>}
        {action === 'repeat' && <label className="pc-field">重复周期<select required value={fields.option} onChange={event => update({ option: event.target.value })}>
          <option value="">选择周期</option>{todoRepeatRules.map(rule => <option key={rule} value={rule}>{rule}</option>)}
        </select></label>}
        {(action === 'wait' || action === 'repeat') && <label className="pc-field">{action === 'wait' ? '回访日期' : '本期到期日'}
          <input type="date" value={fields.secondary} onChange={event => update({ secondary: event.target.value })} />
        </label>}
        {action === 'dependency' && <label className="pc-field">前置任务<select required value={fields.related || ''} onChange={event => update({ related: Number(event.target.value) })}>
          <option value="">选择任务</option>{tasks.filter(item => item.task.line !== fields.target).map(({ task, title }) =>
            <option key={task.line} value={task.line}>{title} · 第 {task.line} 行</option>)}
        </select></label>}
        {error && <p className="td-alert" role="alert">{error}</p>}
      </ModalForm>
    </Modal>}
  </>;
}
