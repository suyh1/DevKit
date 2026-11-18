import { useCallback, useEffect, useState } from 'react';
import { Check, ClipboardList, Columns3, List, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useConfirmation } from './Confirmation';
import { Modal, ModalCancel } from './project-components';
import { todoRequest } from './planning-share-api';
import type { TodoPriority, TodoProject, TodoState, TodoStatus, TodoTask } from './planning-share-api';
import { SharingButton } from './Sharing';
import './planning-share.css';

const statuses: Record<TodoStatus, string> = { todo: '待开始', doing: '进行中', done: '已完成' };
const statusOrder = Object.keys(statuses) as TodoStatus[];
const priorities: Record<TodoPriority, string> = { low: '低优先级', normal: '普通优先级', high: '高优先级' };
const emptyTask: Omit<TodoTask, 'id'> = { title: '', description: '', assignee: '', due: '', status: 'todo', priority: 'normal' };
type ProjectDraft = Pick<TodoProject, 'name' | 'description' | 'published'>;
type TaskDraft = Omit<TodoTask, 'id'>;
type Editor = { type: 'project'; project?: TodoProject; draft: ProjectDraft }
  | { type: 'task'; project: TodoProject; taskId?: string; draft: TaskDraft };

export default function ProjectTodos({ active, portal = false, canEdit = !portal }: { active: boolean; portal?: boolean; canEdit?: boolean }) {
  const [state, setState] = useState<TodoState | null>(null), [activeId, setActiveId] = useState('');
  const [layout, setLayout] = useState<'list' | 'board'>('list'), [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TodoStatus | ''>('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState(''), [editorError, setEditorError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const confirm = useConfirmation();
  const refresh = useCallback(() => {
    setError('');
    void todoRequest(portal, 'get').then(setState, failure => setError(failure.message));
  }, [portal]);
  useEffect(() => { if (active) refresh(); }, [active, refresh]);

  const project = state?.projects.find(item => item.id === activeId) ?? state?.projects[0];
  const tasks = project?.tasks ?? [];
  const completed = tasks.filter(task => task.status === 'done').length;
  const needle = query.trim().toLowerCase();
  const visible = tasks.filter(task => (!filter || task.status === filter) &&
    [task.title, task.description, task.assignee].some(value => value.toLowerCase().includes(needle)));

  async function mutate(action: string, value: unknown, message: string, inEditor = false) {
    const report = inEditor ? setEditorError : setError;
    report(''); setNotice(''); setBusy(true);
    try {
      const result = await todoRequest(portal, action, value);
      setState(result);
      if (result.selectedId) setActiveId(result.selectedId);
      if (inEditor) setEditor(null);
      setNotice(message);
    } catch (failure) {
      report((failure as Error).message);
      if (!inEditor) void todoRequest(portal, 'get').then(setState, () => {});
    } finally { setBusy(false); }
  }
  function editProject(item?: TodoProject) {
    setEditorError('');
    setEditor({ type: 'project', project: item, draft: {
      name: item?.name ?? '', description: item?.description ?? '', published: item?.published ?? portal,
    } });
  }
  function editTask(item: TodoProject, task?: TodoTask) {
    setEditorError('');
    setEditor({ type: 'task', project: item, taskId: task?.id, draft: task ?? emptyTask });
  }
  async function remove(item: TodoProject, task?: TodoTask) {
    const accepted = await confirm(task
      ? { title: '删除待办？', detail: `将删除“${task.title}”。`, confirm: '删除待办', cancel: '取消' }
      : { title: '删除项目？', detail: `将删除“${item.name}”及其 ${item.tasks.length} 项待办。`, confirm: '删除项目', cancel: '取消' });
    if (!accepted) return;
    await mutate(task ? 'delete-task' : 'delete-project', { projectId: item.id, revision: item.revision, taskId: task?.id }, task ? '待办已删除' : '项目已删除');
  }
  function renderTask(item: TodoProject, task: TodoTask) {
    return <article className="todo-task" key={task.id}>
      <div className="todo-task-main">
        {canEdit && <button type="button" className="todo-complete icon-button" aria-label={`${task.status === 'done' ? '重新打开' : '完成'}待办 ${task.title}`}
          aria-pressed={task.status === 'done'} disabled={busy} onClick={() => void mutate('save-task', {
            projectId: item.id, revision: item.revision, taskId: task.id, value: { ...task, status: task.status === 'done' ? 'todo' : 'done' },
          }, task.status === 'done' ? '待办已重新打开' : '待办已完成')}><Check size={16} /></button>}
        <div><h3>{task.title}</h3>{task.description && <p>{task.description}</p>}
          <div className="todo-task-meta">
            <span className="planning-badge" data-kind={task.status}>{statuses[task.status]}</span>
            <span className="planning-badge" data-kind={task.priority}>{priorities[task.priority]}</span>
            {task.assignee && <span>{task.assignee}</span>}
            {task.due && <time dateTime={task.due}>截止 {task.due}</time>}
          </div>
        </div>
      </div>
      {canEdit && <div className="planning-actions todo-task-actions">
        <select className="planning-select" aria-label={`待办状态 ${task.title}`} disabled={busy} value={task.status} onChange={event => void mutate('save-task', {
          projectId: item.id, revision: item.revision, taskId: task.id, value: { ...task, status: event.target.value },
        }, '状态已更新')}>{statusOrder.map(status => <option key={status} value={status}>{statuses[status]}</option>)}</select>
        <button className="icon-button" title="编辑待办" aria-label={`编辑待办 ${task.title}`} disabled={busy} onClick={() => editTask(item, task)}><Pencil size={15} /></button>
        <button className="icon-button" title="删除待办" aria-label={`删除待办 ${task.title}`} disabled={busy} onClick={() => void remove(item, task)}><Trash2 size={15} /></button>
      </div>}
    </article>;
  }
  return <section className="planning-workspace">
    <header className="planning-heading"><div><h1>项目与待办</h1><p>按项目跟踪任务、截止日期和完成进度。</p></div>
      <div className="planning-actions">
        {!portal && <SharingButton />}
        <button className="secondary-button" disabled={busy} onClick={refresh}><RefreshCw size={15} />刷新</button>
        {canEdit && <button className="run-button" disabled={busy || !state} onClick={() => editProject()}><Plus size={16} />新建项目</button>}
      </div>
    </header>
    {error && <p className="pc-error" role="alert">{error}</p>}
    {notice && <p className="planning-notice" role="status">{notice}</p>}
    {!error && !state && <p role="status">正在读取项目…</p>}
    {state?.projects.length === 0 && <p className="planning-empty">{canEdit ? '新建一个项目，开始添加待办。' : '当前没有已共享的项目。'}</p>}
    {project && <div className="todo-workspace">
      <aside className="planning-card todo-projects">
        <h2><ClipboardList size={17} />项目列表</h2>
        <nav aria-label="待办项目">{state?.projects.map(item => <button type="button" key={item.id} aria-current={project.id === item.id ? 'page' : undefined}
          onClick={() => { setActiveId(item.id); setQuery(''); setFilter(''); }}><span>{item.name}</span><small>{item.tasks.filter(task => task.status === 'done').length}/{item.tasks.length}</small></button>)}</nav>
      </aside>
      <div className="todo-content">
        <section className="planning-card todo-project-detail">
          <div className="planning-heading"><div><h2>{project.name}</h2>
            {!portal && <span className="planning-badge" data-kind={project.published ? 'doing' : 'idle'}>{project.published ? '发布到共享工作台' : '仅本机'}</span>}
          </div>
            {canEdit && <div className="planning-actions">
              <button className="secondary-button" disabled={busy} onClick={() => editProject(project)}><Pencil size={14} />编辑项目</button>
              <button className="icon-button" title="删除项目" aria-label="删除项目" disabled={busy} onClick={() => void remove(project)}><Trash2 size={15} /></button>
              <button className="run-button" disabled={busy} onClick={() => editTask(project)}><Plus size={16} />添加待办</button>
            </div>}
          </div>
          {project.description && <p className="todo-description">{project.description}</p>}
          <div className="todo-progress"><label>完成进度 <strong>{completed} / {tasks.length}</strong></label>
            <progress aria-label="项目完成进度" value={completed} max={Math.max(1, tasks.length)} />
          </div>
        </section>
        <div className="todo-toolbar">
          <label className="todo-search"><Search size={16} /><input type="search" aria-label="搜索待办" placeholder="搜索标题、说明或负责人" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <select className="planning-select" aria-label="按状态筛选" value={filter} onChange={event => setFilter(event.target.value as TodoStatus | '')}>
            <option value="">全部状态</option>{statusOrder.map(status => <option key={status} value={status}>{statuses[status]}</option>)}
          </select>
          <div className="todo-layout" role="group" aria-label="待办视图">
            <button className="secondary-button" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><List size={15} />清单</button>
            <button className="secondary-button" aria-pressed={layout === 'board'} onClick={() => setLayout('board')}><Columns3 size={15} />看板</button>
          </div>
        </div>
        {layout === 'list' ? <div className="todo-task-list">
          {visible.map(task => renderTask(project, task))}
          {!visible.length && <p className="planning-empty">{tasks.length ? '没有匹配的待办。' : '此项目暂无待办。'}</p>}
        </div> : <div className="todo-board">{statusOrder.filter(status => !filter || status === filter).map(status => {
          const column = visible.filter(task => task.status === status);
          return <section className="todo-board-column" key={status}><h3>{statuses[status]} <small>{column.length}</small></h3>
            {column.map(task => renderTask(project, task))}{!column.length && <p className="planning-meta">暂无待办</p>}
          </section>;
        })}</div>}
      </div>
    </div>}
    {editor && <Modal title={editor.type === 'project' ? editor.project ? '编辑项目' : '新建项目' : editor.taskId ? '编辑待办' : '添加待办'}
      closeLabel="关闭项目与待办编辑" close={() => setEditor(null)} draft={editor.draft} busy={busy}>
      <form className="planning-form" onSubmit={event => {
        event.preventDefault();
        void mutate(editor.type === 'project' ? 'save-project' : 'save-task', {
          projectId: editor.project?.id, revision: editor.project?.revision,
          taskId: editor.type === 'task' ? editor.taskId : undefined, value: editor.draft,
        }, editor.type === 'project' ? '项目已保存' : '待办已保存', true);
      }}>
        {editor.type === 'project' ? <ProjectFields draft={editor.draft} portal={portal} onChange={draft => setEditor({ ...editor, draft })} />
          : <TaskFields draft={editor.draft} onChange={draft => setEditor({ ...editor, draft })} />}
        {editorError && <p className="pc-error" role="alert">{editorError}</p>}
        <div className="planning-actions planning-form-footer"><ModalCancel /><button className="run-button">保存</button></div>
      </form>
    </Modal>}
  </section>;
}

function ProjectFields({ draft, portal, onChange }: { draft: ProjectDraft; portal: boolean; onChange: (draft: ProjectDraft) => void }) {
  return <>
    <label>项目名称<input required maxLength={120} value={draft.name} onChange={event => onChange({ ...draft, name: event.target.value })} /></label>
    <label>项目说明<textarea rows={4} maxLength={4000} value={draft.description} onChange={event => onChange({ ...draft, description: event.target.value })} /></label>
    {!portal && <label className="planning-check"><input type="checkbox" checked={draft.published} onChange={event => onChange({ ...draft, published: event.target.checked })} />发布此项目到共享工作台</label>}
  </>;
}

function TaskFields({ draft, onChange }: { draft: TaskDraft; onChange: (draft: TaskDraft) => void }) {
  return <>
    <label>待办标题<input required maxLength={180} value={draft.title} onChange={event => onChange({ ...draft, title: event.target.value })} /></label>
    <label>待办说明<textarea rows={3} maxLength={4000} value={draft.description} onChange={event => onChange({ ...draft, description: event.target.value })} /></label>
    <div className="planning-form-grid">
      <label>负责人<input maxLength={80} value={draft.assignee} onChange={event => onChange({ ...draft, assignee: event.target.value })} /></label>
      <label>截止日期<input type="date" max="9999-12-31" value={draft.due} onChange={event => onChange({ ...draft, due: event.target.value })} /></label>
      <label>状态<select value={draft.status} onChange={event => onChange({ ...draft, status: event.target.value as TodoStatus })}>{statusOrder.map(status => <option key={status} value={status}>{statuses[status]}</option>)}</select></label>
      <label>优先级<select value={draft.priority} onChange={event => onChange({ ...draft, priority: event.target.value as TodoPriority })}>{(Object.keys(priorities) as TodoPriority[]).map(priority => <option key={priority} value={priority}>{priorities[priority]}</option>)}</select></label>
    </div>
  </>;
}
