import Skeleton from './Skeleton';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Check, Code2, Download, FileText, Link2, ListPlus, ListTree, Plus, RefreshCw, Save, Settings2, Trash2, Upload, X } from 'lucide-react';
import { useBeforeUnload, useConfirmation } from './Confirmation';
import { readText, saveText } from './files';
import { fileShareRequest, publishedShares, todoRequest } from './planning-share-api';
import type { FileShareState, TodoDocument } from './planning-share-api';
import { Modal, ModalCancel } from './project-components';
import { SharingButton } from './Sharing';
import type { TodoEditorHandle } from './TodoTextEditor';
import TodoOutline, { needsTodoFollowUp } from './TodoOutline';
import TodoSyntaxActions from './TodoSyntaxActions';
import { RelatedLink, useRelatedCreation, useWorkspaceFeedback, useWorkspaceGuard } from './related-workspaces';
import { openWorkspaceLink, ResourceLink, useWorkspaceResource } from './workspace-links';
import { workspaceModules } from './catalog';
import { tools } from './tools';
import type { ToolId } from './tools';
import { parseTodo, todoDateKey, todoReferences, todoStorageLimit, todoTaskTitle } from '../shared/todo-text.mjs';
import type { TodoReference } from '../shared/todo-text.mjs';
import './todo-lists.css';

const TodoTextEditor = lazy(() => import('./TodoTextEditor'));
type Draft = { base: TodoDocument; body: string };
type SettingsDraft = { current?: TodoDocument; name: string; published: boolean; reference?: string; imported?: string };
export default function TodoLists({ active, portal = false, canEdit = !portal, onOpenTool }: {
  active: boolean; portal?: boolean; canEdit?: boolean; onOpenTool?: (tool: ToolId) => void;
}) {
  const guard = useWorkspaceGuard();
  const feedback = useWorkspaceFeedback();
  const [documents, setDocuments] = useState<TodoDocument[] | null>(null), [selectedId, setSelected] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null), [settings, setSettings] = useState<SettingsDraft | null>(null);
  const [error, setError] = useState(''), [formError, setFormError] = useState(''), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false), [outline, setOutline] = useState(false), [line, setLine] = useState(1);
  const [jumpTo, setJumpTo] = useState(0);
  const [sourceMode, setSourceMode] = useState(false);
  const [today, setToday] = useState(() => todoDateKey());
  const [editor, setEditor] = useState<TodoEditorHandle | null>(null);
  const importInput = useRef<HTMLInputElement>(null), sequence = useRef(0);
  const referenceSequence = useRef(0);
  const applied = useRef(''), resource = useWorkspaceResource('project-todos');
  const confirm = useConfirmation();
  const saved = selectedId ? documents?.find(item => item.id === selectedId) : documents?.[0];
  const sheet = saved ?? draft?.base ?? documents?.[0];
  const text = draft?.body ?? sheet?.body ?? '';
  const dirty = !!(draft && draft.body !== draft.base.body);
  const outdated = dirty && saved?.revision !== draft.base.revision;
  const model = useMemo(() => parseTodo(text), [text]);
  useBeforeUnload(dirty);

  const refresh = useCallback(() => {
    setError('');
    const request = ++sequence.current;
    void todoRequest(portal, 'get').then(result => {
      if (request === sequence.current) setDocuments(result.documents);
    }, failure => { if (request === sequence.current) setError(failure.message); });
  }, [portal]);
  useEffect(() => { if (active) refresh(); }, [active, refresh]);
  useEffect(() => {
    if (!active) return;
    setToday(todoDateKey());
    const timer = setInterval(() => setToday(todoDateKey()), 60_000);
    return () => { clearInterval(timer); ++referenceSequence.current; };
  }, [active]);

  async function discard(title = '切换清单？') {
    if (!dirty) return true;
    return confirm({ title, detail: '当前清单有未保存的编辑。放弃后将载入已保存的文本。', confirm: '放弃编辑', cancel: '继续编辑' });
  }
  async function select(id: string, target = 0) {
    if (sheet?.id !== id) {
      if (!await discard()) return;
      setDraft(null); setSelected(id); setLine(1); setError(''); setMessage('');
    }
    setJumpTo(target);
  }
  const selectRef = useRef(select);
  selectRef.current = select;
  useEffect(() => {
    if (!resource) { applied.current = ''; return; }
    if (!active || !documents || resource === applied.current) return;
    applied.current = resource;
    const [id, number] = resource.split(':');
    if (documents.some(item => item.id === id)) void selectRef.current(id, /^\d+$/.test(number || '') ? Number(number) : 0);
    else setError('链接中的清单已移除，或当前访客无权访问。');
  }, [active, documents, resource]);
  useEffect(() => {
    if (jumpTo && editor) { editor.jump(jumpTo); setJumpTo(0); }
  }, [jumpTo, editor, sheet?.id]);

  async function request(action: string, value: unknown, success: string, closeSettings = false) {
    if (!canEdit || busy) return;
    ++sequence.current;
    setBusy(true); setMessage(''); setError(''); setFormError('');
    try {
      const result = await todoRequest(portal, action, value);
      ++sequence.current;
      setDocuments(result.documents);
      const updated = result.documents.find(item => item.id === result.selectedId);
      if (action === 'create' && updated) { setSelected(updated.id); setDraft(null); setLine(1); }
      else if (action === 'remove') {
        setSelected(''); setDraft(null); setLine(1); setJumpTo(0);
      } else if (action === 'save') setDraft(null);
      else if (action === 'settings' && updated) setDraft(current => current && { ...current, base: updated });
      if (closeSettings) closeSettingsForm();
      setMessage(success);
    } catch (failure) {
      (closeSettings ? setFormError : setError)((failure as Error).message);
    } finally { setBusy(false); }
  }
  function save() {
    if (!draft || !dirty || outdated) return;
    void request('save', { id: draft.base.id, revision: draft.base.revision, body: draft.body }, '已保存');
  }
  function edit(body: string) {
    if (!sheet || !canEdit) return;
    if (selectedId !== sheet.id) setSelected(sheet.id);
    setDraft(current => {
      const base = current?.base ?? sheet;
      return body === base.body ? null : { base, body };
    });
    setMessage('');
  }
  const finishCreation = useRelatedCreation('project-todos', active && !!documents && canEdit && !busy, (_from, share) => {
    if (share) void newList(`[[共享:${share}]]`);
  });
  function closeSettingsForm() { setSettings(null); finishCreation(); }
  async function newList(reference?: string) {
    if (!await discard('新建清单？')) { if (reference) finishCreation(); return; }
    setFormError('');
    setSettings({ name: '', published: portal, reference });
  }
  async function importList(file?: File) {
    if (!file || !canEdit || busy) return;
    setBusy(true);
    try {
      const { text } = await readText(file, { maxBytes: todoStorageLimit, maxCharacters: todoStorageLimit });
      if (!await discard('导入其他清单？')) return;
      setError('');
      setFormError('');
      setSettings({
        name: file.name.replace(/\.(?:todos?|tasks?|taskpaper|txt|md)$/i, '').slice(0, 120) || '导入清单',
        published: portal, imported: text,
      });
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  async function exportList() {
    if (!sheet) return;
    const name = sheet.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 120) || 'TODO';
    try { setMessage(await saveText(text, `${name}.todo`)); }
    catch (failure) { setError((failure as Error).message); }
  }
  async function clearDraft() {
    if (!await discard('载入主机版本？')) return;
    setDraft(null); setSettings(null); refresh();
  }
  async function remove(current: TodoDocument) {
    const detail = `“${current.name}”的全文和归档会被永久删除。${dirty ? '未保存的编辑也会丢失。' : ''}`;
    if (!await confirm({ title: '删除清单？', detail, confirm: '删除清单', cancel: '保留清单' })) return;
    await request('remove', { id: current.id, revision: current.revision }, '已删除清单');
  }

  async function openReference(reference: Pick<TodoReference, 'kind' | 'name'>) {
    const request = ++referenceSequence.current;
    if (reference.kind === 'tool') {
      const query = reference.name.toLowerCase();
      const module = workspaceModules.find(item => item.id === query || item.name.toLowerCase() === query);
      if (module) { if (guard(module.id)) openWorkspaceLink(module.id); return; }
      const tool = tools.find(item => item.id === query || item.name.toLowerCase() === query);
      if (!onOpenTool) feedback('此工具可在 DevKit 桌面端打开。');
      else if (tool) onOpenTool(tool.id);
      else setMessage(`找不到工具“${reference.name}”。`);
      return;
    }
    if (!guard('file-shares')) return;
    try {
      const { shares } = await (portal ? publishedShares() : fileShareRequest<FileShareState>('get'));
      if (request !== referenceSequence.current) return;
      const exact = shares.find(item => item.id === reference.name);
      const matches = exact ? [exact] : shares.filter(item => item.name === reference.name);
      if (matches.length === 1) openWorkspaceLink('file-shares', matches[0].id);
      else (portal ? feedback : setMessage)(matches.length ? '存在同名共享，请在引用中填写共享 ID。' : '共享不存在，或当前访客无权访问。');
    } catch (failure) {
      if (request === referenceSequence.current) setMessage((failure as Error).message);
    }
  }

  const tasks = useMemo(() => model.tasks.filter(task => todoTaskTitle(task)), [model]);
  const open = tasks.filter(task => task.status === 'open' && !task.archived).length;
  const done = tasks.filter(task => task.status !== 'open' && !task.archived).length;
  const archived = tasks.filter(task => task.archived).length;
  const followUps = tasks.filter(task => needsTodoFollowUp(task, today)).length;
  const checks = model.tasksByLine.get(model.checks.get(line)?.taskLine ?? line)?.checks ?? [];
  const canAddChild = model.tasksByLine.has(line) || model.resumesByLine.has(line);
  const locked = busy || !canEdit;
  return <section className="td-workspace">
    <header className="td-heading workspace-banner"><h1>待办清单</h1><div className="td-actions">
      {!portal && <SharingButton />}
      <button className="td-icon" type="button" aria-label="刷新清单" title="刷新清单" onClick={refresh} disabled={busy}><RefreshCw size={16} /></button>
      {canEdit && <button className="td-secondary" type="button" disabled={!documents || busy} onClick={() => importInput.current?.click()}><Upload size={16} />导入清单</button>}
      {canEdit && <button className="td-primary" type="button" disabled={!documents || busy} onClick={() => void newList()}><Plus size={16} />新建清单</button>}
    </div></header>
    {canEdit && <input ref={importInput} type="file" hidden aria-label="选择清单文件" accept=".todo,.todos,.task,.tasks,.taskpaper,.txt,.md,text/plain" onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void importList(file);
    }} />}
    {!documents && !error && <Skeleton kind="list" label="正在读取清单…" />}
    {error && <p className="td-alert" role="alert">{error}{dirty && <button type="button" onClick={() => void clearDraft()} disabled={busy}>载入主机版本</button>}</p>}
    {outdated && !error && <p className="td-alert" role="status">主机上的清单已变更。可先导出当前草稿，再载入主机版本。<button type="button" onClick={() => void clearDraft()} disabled={busy}>载入主机版本</button></p>}
    {documents && <div className="td-shell">
      <aside className="td-documents" aria-label="清单文档">
        <header><h2>清单</h2></header>
        {documents.length > 0 && <label className="td-document-picker"><span className="sr-only">切换清单</span>
          <select value={sheet?.id ?? ''} disabled={busy} onChange={event => void select(event.target.value)}>
            {sheet && !documents.some(item => item.id === sheet.id) && <option value={sheet.id}>{sheet.name}（草稿）</option>}
            {documents.map(item => <option key={item.id} value={item.id}>{item.name}{item.id === sheet?.id && dirty ? '（未保存）' : ''}</option>)}
          </select>
        </label>}
        {documents.length > 0 ? <nav aria-label="已保存的清单">{documents.map(item => <button key={item.id} type="button" aria-current={item.id === sheet?.id ? 'page' : undefined} disabled={busy}
          onClick={() => void select(item.id)}><FileText size={15} /><span title={item.name}>{item.name}</span>{item.id === sheet?.id && dirty && <i title="未保存" />}</button>)}</nav>
          : <p>暂无清单</p>}
      </aside>
      {sheet ? <div className="td-sheet">
        <header className="td-sheet-head">
          <div><h2>{sheet.name}</h2><small>{portal ? canEdit ? '可编辑' : '只读' : sheet.published ? '已发布到共享工作台' : '仅本机'}</small></div>
          <div className="td-actions">
            <button className="td-secondary" type="button" title="导出当前文本为 .todo 文件" onClick={() => void exportList()}><Download size={16} />导出清单</button>
            {canEdit && <button className="td-icon" type="button" aria-label="清单设置" title="清单设置" disabled={busy || outdated} onClick={() => {
              setFormError(''); setSettings({ current: sheet, name: sheet.name, published: sheet.published });
            }}><Settings2 size={16} /></button>}
            {canEdit && <button className="td-delete" type="button" disabled={busy || outdated} onClick={() => void remove(sheet)}><Trash2 size={16} />删除清单</button>}
            {canEdit && <button className="td-primary" type="button" disabled={!dirty || busy || outdated} onClick={save}><Save size={16} />保存</button>}
          </div>
        </header>
        <div className="td-toolbar" role="group" aria-label="任务操作">
          {canEdit && <>
            <button type="button" disabled={locked || !editor} onClick={() => editor?.run('new')}><Plus size={15} />新任务</button>
            <button type="button" title="在光标所在的任务或续做点下添加" disabled={locked || !editor || !canAddChild} onClick={() => editor?.run('child')}><ListPlus size={15} />添加子任务</button>
            <button type="button" title="Alt+D" disabled={locked || !editor} onClick={() => editor?.run('done')}><Check size={15} />完成</button>
          </>}
          <button type="button" aria-pressed={outline} onClick={() => setOutline(value => !value)}><ListTree size={15} />大纲</button>
          <details className="td-more"><summary>更多操作</summary><div>
            {canEdit && <>
              <button type="button" title="Alt+C" disabled={locked || !editor} onClick={() => editor?.run('cancelled')}><X size={15} />取消</button>
              <button type="button" title="Ctrl/⌘+Shift+A" disabled={locked || !editor} onClick={() => editor?.run('archive')}><Archive size={15} />归档</button>
            </>}
            <button type="button" title="Alt+O" disabled={!editor || !todoReferences(model.lines[line - 1] ?? '').length} onClick={() => editor?.run('open-reference')}><Link2 size={15} />打开引用</button>
            <button type="button" title="查看原始语法" aria-pressed={sourceMode} onClick={() => setSourceMode(value => !value)}><Code2 size={15} />源码</button>
          </div></details>
          <details className="td-shortcuts"><summary aria-label="语法与快捷键">语法</summary><div>
            <dl>
              <dt>任务与日期</dt><dd><code>☐ 待办 @today @due(2026-12-01)</code></dd>
              <dt>子任务</dt><dd>在任务或续做点下缩进写 <code>☐ 子任务</code>，可逐层拆分、单独完成</dd>
              <dt>验收条件</dt><dd>任务下缩进 <code>? ZIP 能解压</code>。方框可点击勾选</dd>
              <dt>续做点</dt><dd>记录停在哪里或回来从哪接上，例如 <code>:: 续做 已测管理员，下次从只读账号开始</code></dd>
              <dt>自定义视图</dt><dd><code>:: 视图 待验收 @tag(验收) @state(open)</code></dd>
              <dt>工作台引用</dt><dd><code>[[共享:发布材料]]</code> 、<code>[[工具:日志中心]]</code> 或 <code>[[工具:JSON 格式化]]</code>。<RelatedLink page="file-shares">查找文件共享</RelatedLink></dd>
              <dt>等待回访</dt><dd><code>@wait(小周) @review(2026-12-04)</code></dd>
              <dt>前置任务</dt><dd>前置任务写 <code>@id(build)</code>，当前任务写 <code>@after(build)</code></dd>
              <dt>周期任务</dt><dd><code>@repeat(每周一)</code>。支持每天、每周、每周几、每月和每月几日</dd>
              <dt>分组默认</dt><dd>分组下缩进 <code>:: 分组默认 @验收 @owner(小周)</code></dd>
            </dl>
            <p><kbd>Ctrl/⌘+Enter</kbd> 切换任务符号　<kbd>Alt+D</kbd> 完成或勾选验收　<kbd>Alt+C</kbd> 取消</p>
            <p><kbd>Alt+S</kbd> 开始　<kbd>Alt+O</kbd> 打开引用　<kbd>Ctrl/⌘+Shift+A</kbd> 归档　<kbd>Ctrl/⌘+S</kbd> 保存</p>
          </div></details>
        </div>
        {canEdit && <TodoSyntaxActions active={active} key={sheet.id} model={model} editor={editor} line={line} locked={locked} portal={portal} />}
        <div className="td-editor-layout" data-outline={outline}>
          <Suspense fallback={<Skeleton kind="editor" label="正在加载编辑器…" />}>
            <TodoTextEditor key={sheet.id} editorRef={setEditor} body={text} readOnly={locked} sourceMode={sourceMode} onChange={edit} onSave={save} onLine={setLine}
              onOpenReference={reference => void openReference(reference)} onNotice={setMessage}
              onConfirmCompletion={count => confirm({ title: '有验收条件尚未勾选', detail: `仍有 ${count} 项验收条件未勾选。可以继续验收，也可以将任务标为完成。`, confirm: '仍然完成', cancel: '继续验收' })}
              onArchive={count => setMessage(count ? `已移入归档 ${count} 项，保存后生效。` : '没有可归档的任务。')} />
          </Suspense>
          {outline && <TodoOutline key={sheet.id} model={model} today={today} jump={number => editor?.jump(number)} />}
        </div>
        <footer className="td-status">
          <span>{open} 待办</span><span>{done} 已结束</span><span>{archived} 已归档</span>
          {checks.length > 0 && <span>验收 {checks.filter(check => check.checked).length}/{checks.length}</span>}
          {followUps > 0 && <span className="td-follow-up">{followUps} 项回访到期</span>}
          <span className="td-line-number">第 {line} 行</span>
          <span role="status">{message || (dirty ? '未保存' : portal && !canEdit ? '只读' : '已保存')}</span>
        </footer>
      </div> : <div className="td-empty"><FileText size={22} /><h2>{portal ? '暂无已发布的清单' : '从一份清单开始'}</h2>
        {canEdit && <p>新建清单，或导入已有的 <code>.todo</code> 文件。</p>}
        {message && <p role="status">{message}</p>}</div>}
    </div>}
    {settings && <Modal title={settings.current ? '清单设置' : settings.imported !== undefined ? '导入清单' : '新建清单'} closeLabel="关闭清单设置"
      description={settings.imported === undefined ? undefined : portal ? '文件将作为一份新清单发布到共享工作台。' : '文件将保存为一份新清单。'}
      active={active} close={closeSettingsForm} draft={{ name: settings.name, published: settings.published }} busy={busy} className="td-settings-dialog">
      <form className="td-settings" onSubmit={event => {
        event.preventDefault();
        void request(settings.current ? 'settings' : 'create', {
          id: settings.current?.id, revision: settings.current?.revision, name: settings.name, published: settings.published, body: settings.imported ?? (settings.reference ? `待办:\n- 查看共享资料 ${settings.reference}\n` : undefined),
        }, settings.current ? '清单设置已保存' : settings.imported !== undefined ? '清单已导入' : '清单已创建', true);
      }}>
        {settings.reference && <p>清单将包含引用 <code>{settings.reference}</code></p>}
        <label className="pc-field">清单名称<input required maxLength={120} value={settings.name} onChange={event => setSettings({ ...settings, name: event.target.value })} /></label>
        {!portal && <label className="pc-check"><input type="checkbox" checked={settings.published} onChange={event => setSettings({ ...settings, published: event.target.checked })} />发布到共享工作台</label>}
        {settings.current?.published && <ResourceLink page="project-todos" id={settings.current.id} />}
        {formError && <p className="td-alert" role="alert">{formError}</p>}
        <footer><ModalCancel /><button className="run-button" disabled={busy}>{settings.imported !== undefined ? '导入' : '保存'}</button></footer>
      </form>
    </Modal>}
  </section>;
}
