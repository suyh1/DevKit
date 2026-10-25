import { useEffect, useMemo, useRef, useState } from 'react';
import { FileCode2, FolderOpen, Plus, RefreshCw, Save, Play, Square, CheckCircle2, Settings2, Trash2, ChevronRight, Search, X, History, Server } from 'lucide-react';
import CodeEditor from './CodeEditor';
import { editNginxArgs, insertNginx, nginxFields, parseNginx } from '../shared/nginx.mjs';
import type { NginxNode } from '../shared/nginx.mjs';
import { nginxRequest } from './nginx-api';
import type { NginxBackup, NginxCommand, NginxDetection, NginxDocument, NginxFiles, NginxInstance, NginxState, NginxStatus } from './nginx-api';
import './nginx.css';

const basename = (file: string) => file.split(/[\\/]/).at(-1) || file;
const dirname = (file: string) => file.replace(/[\\/][^\\/]*$/, '');
const statusNames = { running: '运行中', stopped: '已停止', unknown: '待确认', platform: '其他系统' };
type Confirmation = { title: string; detail: string; confirm: string; action: () => void };
function Modal({ title, children, close }: { title: string; children: React.ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog className="ng-modal" ref={ref} onCancel={event => { event.preventDefault(); close(); }}><header><h2>{title}</h2><button type="button" className="icon-button" aria-label="关闭对话框" onClick={close}><X size={18} /></button></header>{children}</dialog>;
}

function InstanceForm({ instance, platform, busy, error, submit, close, task }: {
  instance?: NginxInstance; platform: string; busy: boolean; error: string; submit: (instance: Partial<NginxInstance>) => Promise<void>; close: () => void;
  task: (action: () => Promise<void>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<NginxInstance>>(instance ? { ...instance } : { name: '', main: '', prefix: '', executable: '', files: [], platform: platform === 'win32' ? 'win32' : 'linux' });
  const [warnings, setWarnings] = useState<string[]>([]), [detection, setDetection] = useState('');
  const [manualFiles, setManualFiles] = useState(instance?.files.join('\n') || '');
  const [changed, setChanged] = useState(false), [discard, setDiscard] = useState(false);
  const patch = (values: Partial<NginxInstance>) => { setChanged(true); setDraft(current => ({ ...current, ...values })); };
  const closeForm = () => { if (busy) return; if (changed) setDiscard(true); else close(); };
  async function scan(main = draft.main) {
    if (!main) throw new Error('请先选择或填写主配置文件。');
    const result = await nginxRequest<{ main: string; files: string[]; warnings: string[] }>('discover', { main });
    const files = [...new Set([...manualFiles.split(/\r?\n/).map(item => item.trim()).filter(Boolean), ...result.files])];
    setManualFiles(files.join('\n')); patch({ main: result.main, files }); setWarnings(result.warnings);
  }
  async function pick(kind: 'main' | 'files' | 'prefix' | 'executable') {
    const files = await nginxRequest<string[]>('pick', { kind });
    if (!files.length) return;
    if (kind === 'files') { setChanged(true); setManualFiles(current => [...new Set([...current.split('\n').filter(Boolean), ...files])].join('\n')); }
    else if (kind === 'main') { patch({ main: files[0], name: draft.name || basename(files[0]), prefix: draft.prefix || dirname(files[0]) }); await scan(files[0]); }
    else patch({ [kind]: files[0] });
  }
  return <Modal title={instance ? '实例设置' : '添加 Nginx 实例'} close={closeForm}><form onSubmit={event => { event.preventDefault(); void task(() => submit({ ...draft, files: manualFiles.split(/\r?\n/).map(file => file.trim()).filter(Boolean) })); }}>
    <fieldset disabled={busy}>
      {error && <p className="ng-error" role="alert">{error}</p>}
      <div className="ng-form-grid"><label>实例名称<input required maxLength={100} value={draft.name} onChange={event => patch({ name: event.target.value })} /></label><label>目标系统<select value={draft.platform} onChange={event => patch({ platform: event.target.value as NginxInstance['platform'] })}><option value="win32">Windows</option><option value="linux">Linux</option><option value="any">跟随本机</option></select></label></div>
      {(['main', 'prefix', 'executable'] as const).map(key => <label key={key}>{({ main: '主配置文件', prefix: '运行目录（-p prefix）', executable: 'nginx 程序路径（留空自动检测）' })[key]}<div className="ng-path-input"><input required={key !== 'executable'} spellCheck={false} value={draft[key]} onChange={event => patch({ [key]: event.target.value })} placeholder={key === 'main' ? (platform === 'win32' ? 'D:\\workspace\\nginx\\nginx-win.conf' : '/etc/nginx/nginx.conf') : key === 'prefix' ? 'nginx 安装目录或自定义运行前缀' : '自动检测 PATH 与常见安装位置'} /><button type="button" className="text-button" onClick={() => void task(() => pick(key))}><FolderOpen size={15} />选择</button></div></label>)}
      <p className="ng-help">include 相对主配置所在目录解析；日志、PID、静态文件等相对路径基于运行目录。运行期间请保持主文件、程序、运行目录与 PID 路径不变。</p>
      <div className="ng-actions"><button type="button" className="text-button" onClick={() => void task(() => scan())}><Search size={14} />解析附属文件</button><button type="button" className="text-button" onClick={() => void task(async () => {
        const found = await nginxRequest<NginxDetection>('detect', draft); setDetection(found.output);
        if (found.found) patch({ executable: found.executable, prefix: found.prefix });
      })}><Search size={14} />检测 nginx 并填入运行目录</button></div>
      {detection && <pre className="ng-detection">{detection}</pre>}
      <label>附属文件（每行一个绝对路径）<textarea rows={4} value={manualFiles} onChange={event => { setChanged(true); setManualFiles(event.target.value); }} placeholder="可自动解析 include，也可手动添加未引用的配置文件" /></label>
      <button type="button" className="text-button" onClick={() => void task(() => pick('files'))}><Plus size={14} />选择附属文件</button>
      <p className="ng-help">登记附属文件不会自动插入 include；在字段或全文编辑中维护实际引用关系。可登记 Linux 配置并在 Windows 编辑，但只能在匹配的系统上执行命令。</p>
      {warnings.length > 0 && <div className="ng-warning">{warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
      <footer><button type="button" className="text-button" onClick={closeForm}>取消</button><button className="run-button" type="submit">保存实例</button></footer>
    </fieldset>
  </form>{discard && <div className="ng-warning" role="alert"><p>实例设置尚未保存，确定放弃？</p><div className="ng-actions"><button className="text-button" onClick={() => setDiscard(false)}>继续编辑</button><button className="text-button" onClick={close}>放弃设置</button></div></div>}</Modal>;
}

function ArgumentField({ node, source, apply, pending }: { node: NginxNode; source: string; apply: (source: string) => void; pending: (key: number, value: boolean) => void }) {
  const [value, setValue] = useState(node.args), [error, setError] = useState('');
  useEffect(() => { setValue(node.args); setError(''); }, [node.args, node.id]);
  useEffect(() => () => pending(node.id, false), [node.id]); // Clear a removed field's pending flag.
  function commit() {
    try { if (value !== node.args) apply(editNginxArgs(source, node, value)); setError(''); pending(node.id, false); }
    catch (failure) { setError((failure as Error).message); pending(node.id, true); }
  }
  return <label className="ng-argument"><span>{nginxFields[node.name]?.[0] || (node.block ? '匹配参数' : '指令参数')} <small>第 {node.line} 行</small></span>
    <input aria-label={`${node.name} 第${node.line}行`} title={nginxFields[node.name]?.[1] || '保留原始 Nginx 参数语法，支持引号、变量与重复指令'} value={value} spellCheck={false} onChange={event => { setValue(event.target.value); pending(node.id, event.target.value !== node.args); }} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } if (event.key === 'Escape') { setValue(node.args); setError(''); pending(node.id, false); } }} aria-invalid={!!error} />
    {error && <small className="ng-error">{error}（Esc 恢复此字段）</small>}</label>;
}

function ConfigTree({ nodes, source, apply, add, remove, pending, query, depth = 0 }: {
  nodes: NginxNode[]; source: string; apply: (source: string) => void; add: (parent: NginxNode) => void; remove: (node: NginxNode) => void;
  pending: (key: number, value: boolean) => void; query: string; depth?: number;
}) {
  return <div className="ng-tree">{nodes.map((node, index) => {
    if (query && !source.slice(node.start, node.end).toLowerCase().includes(query)) return null;
    if (node.block) {
      const title = node.name === 'server' ? node.children.filter(item => ['listen', 'server_name'].includes(item.name)).map(item => item.args).join(' · ') : node.args;
      return <details className="ng-block" key={index} open={query ? true : depth < 2}><summary><ChevronRight size={14} /><strong>{node.name}</strong><span>{title || '配置块'}</span><small>{node.children.length} 项</small></summary><div className="ng-block-body">
        {!['http', 'events', 'stream', 'types'].includes(node.name) && <ArgumentField node={node} source={source} apply={apply} pending={pending} />}
        <ConfigTree nodes={node.children} source={source} apply={apply} add={add} remove={remove} pending={pending} query={query} depth={depth + 1} />
        <div className="ng-actions"><button className="text-button" onClick={() => add(node)}><Plus size={13} />添加指令 / 子块</button><button className="text-button" onClick={() => remove(node)}><Trash2 size={13} />删除配置块</button></div>
      </div></details>;
    }
    return <div className="ng-directive" key={index}><code>{node.name}</code><ArgumentField node={node} source={source} apply={apply} pending={pending} /><button className="icon-button" aria-label={`删除 ${node.name} 第${node.line}行`} onClick={() => remove(node)}><Trash2 size={13} /></button></div>;
  })}</div>;
}

export default function NginxCenter({ active }: { active: boolean }) {
  const [state, setState] = useState<NginxState | null>(null), [statuses, setStatuses] = useState<NginxStatus[]>([]);
  const [selected, setSelected] = useState(''), [documents, setDocuments] = useState<NginxDocument[]>([]), [drafts, setDrafts] = useState<Record<string, string>>({});
  const [file, setFile] = useState(''), [warnings, setWarnings] = useState<string[]>([]), [mode, setMode] = useState<'fields' | 'source'>('fields');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [query, setQuery] = useState('');
  const [instanceForm, setInstanceForm] = useState<'new' | NginxInstance | null>(null), [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [snippet, setSnippet] = useState<{ parent: NginxNode | null; value: string } | null>(null), [backups, setBackups] = useState<NginxBackup[] | null>(null);
  const [fieldPending, setFieldPending] = useState<Record<number, boolean>>({}), [epoch, setEpoch] = useState(0);
  const [output, setOutput] = useState<{ ok: boolean; command: string; output: string } | null>(null);
  const locked = useRef(false), initialized = useRef(false), polling = useRef(false);
  const current = state?.instances.find(instance => instance.id === selected), status = statuses.find(item => item.id === selected);
  const content = drafts[file] ?? '', dirtyFiles = documents.filter(doc => drafts[doc.path] !== doc.content), pendingFields = Object.values(fieldPending).some(Boolean);
  const dirty = dirtyFiles.length > 0 || pendingFields;
  const parsed = useMemo(() => { try { return { nodes: parseNginx(content), error: '' }; } catch (failure) { return { nodes: [], error: (failure as Error).message }; } }, [content]);
  async function task(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (failure) { setError((failure as Error).message); }
    finally { locked.current = false; setBusy(false); }
  }
  async function refreshStatuses() { setStatuses(await nginxRequest<NginxStatus[]>('statuses')); }
  async function load(id: string) {
    const result = await nginxRequest<NginxFiles>('documents', { id });
    setSelected(id); setDocuments(result.files); setDrafts(Object.fromEntries(result.files.map(doc => [doc.path, doc.content])));
    setFile(id === selected && result.files.some(doc => doc.path === file) ? file : result.files[0]?.path || ''); setWarnings(result.warnings); setFieldPending({}); setEpoch(value => value + 1); setOutput(null); setQuery('');
  }
  async function refresh(preferred = selected) {
    const next = await nginxRequest<NginxState>('get'); setState(next);
    const id = next.instances.some(item => item.id === preferred) ? preferred : next.instances[0]?.id;
    if (id) await load(id); else { setSelected(''); setDocuments([]); setDrafts({}); setFile(''); }
    await refreshStatuses();
  }
  function discardThen(action: () => void) {
    if (dirty) setConfirmation({ title: '放弃未保存的配置？', detail: '当前修改仅保留在草稿中。放弃后将重新读取磁盘文件。', confirm: '放弃草稿并继续', action });
    else action();
  }
  useEffect(() => { if (!active || initialized.current || !window.devkitNginx) return; initialized.current = true; void task(() => refresh()); }, [active]);
  useEffect(() => {
    if (!active || !state) return;
    const timer = setInterval(() => {
      if (locked.current || polling.current) return;
      polling.current = true; void refreshStatuses().catch(() => {}).finally(() => { polling.current = false; });
    }, 15000);
    return () => clearInterval(timer);
  }, [active, !!state]);
  useEffect(() => {
    if (!dirty && !instanceForm) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, !!instanceForm]);
  function changeContent(value: string) { setDrafts(values => ({ ...values, [file]: value })); setOutput(null); }
  const pending = (key: number, value: boolean) => setFieldPending(values => values[key] === value ? values : { ...values, [key]: value });
  async function save() {
    if (!current || pendingFields) throw new Error('请先完成字段编辑，按 Enter 或移出输入框提交；无效字段可按 Esc 恢复。');
    const result = await nginxRequest<NginxFiles>('save-files', { id: current.id, files: dirtyFiles.map(doc => ({ ...doc, content: drafts[doc.path] })) });
    setDocuments(result.files); setDrafts(Object.fromEntries(result.files.map(doc => [doc.path, doc.content]))); setWarnings(result.warnings);
    setFieldPending({}); setEpoch(value => value + 1); setNotice(`已保存 ${dirtyFiles.length} 个文件。原文件备份：${result.backup}`); setOutput(null); await refreshStatuses();
  }
  async function command(action: NginxCommand) {
    if (!current) return;
    if (dirty) throw new Error('请先保存配置或重新读取以放弃草稿，再执行命令。');
    const result = await nginxRequest<{ ok: boolean; command: string; output: string; status: NginxStatus }>('command', { id: current.id, command: action });
    setOutput(result); if (result.status) setStatuses(values => [...values.filter(item => item.id !== result.status.id), result.status]);
  }
  if (!window.devkitNginx) return <section className="ng-center"><header className="ng-heading"><Server /><div><h1>Nginx 配置</h1><p>可视化编辑配置文件，按主配置管理本机 Nginx 实例。</p></div></header><p className="ng-warning">请使用 DevKit Windows / Linux 桌面端打开此功能。</p></section>;
  return <section className="ng-center" aria-label="Nginx 配置工作区">
    <header className="ng-heading"><span className="ng-heading-icon"><Server size={25} /></span><div><h1>Nginx 配置</h1><p>配置文件与运行实例，在一个工作区维护。</p></div><div className="ng-actions"><button className="text-button" disabled={busy} onClick={() => discardThen(() => void task(() => refresh()))}><RefreshCw size={15} />刷新</button><button className="run-button" disabled={busy || dirty} onClick={() => setInstanceForm('new')}><Plus size={16} />添加实例</button></div></header>
    {error && <p className="ng-error ng-message" role="alert">{error}</p>}{notice && <p className="ng-notice ng-message" role="status">{notice}</p>}
    {busy && <p className="ng-busy" role="status">正在处理…</p>}
    {!state?.instances.length ? <div className="ng-empty"><FileCode2 size={38} /><h2>从主配置文件开始</h2><p>添加 nginx-win.conf 和它引用的公共配置，或管理一份独立的 nginx-linux.conf。</p><p>默认显示可编辑字段，也可随时切换到完整源码。</p></div> : <div className="ng-layout"><aside className="ng-instances" aria-label="Nginx 实例列表">{state.instances.map(instance => {
      const itemStatus = statuses.find(item => item.id === instance.id);
      return <button className={`ng-instance ${selected === instance.id ? 'selected' : ''}`} disabled={busy} key={instance.id} onClick={() => { if (selected !== instance.id) discardThen(() => void task(() => load(instance.id))); }}><span><strong>{instance.name}</strong><small className={`ng-status ${itemStatus?.state || 'unknown'}`}>{itemStatus ? statusNames[itemStatus.state] : '待检测'}</small></span><code title={instance.main}>{basename(instance.main)}</code><small>{instance.platform === 'any' ? '本机' : instance.platform === 'win32' ? 'Windows' : 'Linux'} · {instance.files.length + 1} 个文件</small></button>;
    })}<p className="ng-help">实例与备份保存在 {state.directory}。配置文件在原路径编辑。</p></aside>
    {current && <div className="ng-detail"><header className="ng-instance-heading"><div><h2>{current.name}<span className={`ng-status ${status?.state || 'unknown'}`}>{status ? statusNames[status.state] : '待检测'}{status?.pid ? ` · PID ${status.pid}` : ''}</span></h2><p title={current.main}>{current.main}</p></div><div className="ng-actions"><button className="text-button" disabled={busy || dirty} onClick={() => setInstanceForm(current)}><Settings2 size={15} />实例设置</button><button className="icon-button" aria-label="取消登记实例" disabled={busy || dirty} onClick={() => setConfirmation({ title: '仅取消登记此实例？', detail: '这会移除 DevKit 中的实例记录；配置文件、备份和 Nginx 进程保持原状。', confirm: '取消登记', action: () => void task(async () => { await nginxRequest('remove', { id: current.id, revision: state.revision, forgetOnly: true }); await refresh(''); }) })}><Trash2 size={15} /></button></div></header>
      <p className="ng-runtime">运行目录：<code>{current.prefix}</code><br />{status?.detail}{status?.pidPath && <> · PID 文件：<code>{status.pidPath}</code></>}</p>
      <div className="ng-toolbar"><div className="ng-actions">
        <button className="text-button" disabled={busy || dirty || status?.state === 'platform'} onClick={() => void task(() => command('test'))}><CheckCircle2 size={15} />检查配置</button>
        <button className="text-button" disabled={busy || dirty || status?.state !== 'stopped'} onClick={() => void task(() => command('start'))}><Play size={15} />启动</button>
        <button className="text-button" disabled={busy || dirty || status?.state !== 'running'} onClick={() => void task(() => command('reload'))}><RefreshCw size={15} />重载</button>
        <button className="text-button" disabled={busy || dirty || status?.state !== 'running'} onClick={() => setConfirmation({ title: `优雅停止 ${current.name}？`, detail: '向此主配置对应的 Nginx 主进程发送 quit，等待现有连接完成。', confirm: '停止 Nginx', action: () => void task(() => command('stop')) })}><Square size={15} />停止</button>
      </div><div className="ng-actions"><button className="text-button" disabled={busy || dirty} onClick={() => void task(async () => setBackups(await nginxRequest<NginxBackup[]>('backups', { id: current.id })))}><History size={15} />备份</button><button className="text-button" disabled={busy} onClick={() => discardThen(() => void task(() => load(current.id)))}>重新读取</button><button className="run-button" disabled={busy || !dirty} onClick={() => void task(save)}><Save size={15} />保存文件{dirtyFiles.length ? ` (${dirtyFiles.length})` : ''}</button></div></div>
      {dirty && <p className="ng-warning ng-message">有未保存的修改。保存后才能检查、启动或重载；保存本身不会重载 Nginx。{pendingFields && '请移出字段或按 Enter 完成编辑。'}</p>}
      {warnings.length > 0 && <div className="ng-warning">{warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
      {output && <details open className={`ng-output ${output.ok ? 'success' : 'failure'}`}><summary>{output.ok ? '命令执行成功' : '命令未完成'}</summary><code>{output.command}</code><pre>{output.output || '无输出'}</pre></details>}
      <div className="ng-file-tabs" role="tablist" aria-label="配置文件">{documents.map(doc => <button key={doc.path} title={doc.path} role="tab" aria-selected={file === doc.path} disabled={busy || pendingFields} onClick={() => { setFile(doc.path); setFieldPending({}); setQuery(''); }}><FileCode2 size={14} /><span>{basename(doc.path)}</span><small>{doc.path === current.main ? '主' : '附属'}{drafts[doc.path] !== doc.content ? ' ●' : ''}</small></button>)}</div>
      {file && <><div className="ng-editor-heading"><code title={file}>{file}</code><div className="ng-actions" role="group" aria-label="配置编辑方式">{content.startsWith('\uFEFF') && <button className="text-button" disabled={busy || pendingFields} title="Nginx 可能将 BOM 识别为未知指令；点击只修改草稿，保存前会备份原文件。" onClick={() => changeContent(content.slice(1))}>移除 UTF-8 BOM</button>}<button className={`text-button ${mode === 'fields' ? 'selected' : ''}`} disabled={pendingFields} aria-pressed={mode === 'fields'} onClick={() => setMode('fields')}>字段配置</button><button className={`text-button ${mode === 'source' ? 'selected' : ''}`} disabled={pendingFields} aria-pressed={mode === 'source'} onClick={() => setMode('source')}>全文编辑</button></div></div>
      <fieldset className="ng-editor-fieldset" disabled={busy}>
        {mode === 'source' ? <div className="ng-source"><CodeEditor key={file + epoch} label="Nginx 配置源码" value={content} onChange={changeContent} readOnly={busy} language="text" wrap /></div> : <><div className="ng-field-tools"><label><Search size={14} /><input aria-label="搜索配置字段" placeholder="搜索指令、端口、域名或路径" value={query} onChange={event => setQuery(event.target.value)} /></label><button className="text-button" disabled={!!parsed.error || pendingFields} onClick={() => setSnippet({ parent: null, value: 'worker_processes auto;' })}><Plus size={14} />添加指令 / 配置块</button></div>
        {parsed.error ? <p className="ng-error" role="alert">{parsed.error}。切换全文编辑修复后即可恢复字段视图。</p> : <ConfigTree key={file + epoch} nodes={parsed.nodes} source={content} apply={changeContent} pending={pending} query={query.trim().toLowerCase()} add={parent => setSnippet({ parent, value: parent.name === 'http' ? 'server {\n    listen 8080;\n    server_name localhost;\n    location / {\n        root html;\n        index index.html;\n    }\n}' : parent.name === 'server' ? 'location /api/ {\n    proxy_pass http://127.0.0.1:9000;\n}' : 'include common_proxy.conf;' })} remove={node => setConfirmation({ title: `删除 ${node.name} ${node.args}？`, detail: '仅从当前草稿删除这条指令或整个配置块。保存文件后才会写入磁盘。', confirm: '从草稿删除', action: () => changeContent(content.slice(0, node.start) + content.slice(node.end)) })} />}
        <p className="ng-help">保留注释、重复指令及未知模块。参数遵循 Nginx 语法；含空格的路径使用引号。指令是否合法及资源能否读取，以 nginx -t 结果为准。</p></>}
      </fieldset></>}
    </div>}</div>}
    {instanceForm && <InstanceForm instance={instanceForm === 'new' ? undefined : instanceForm} platform={state?.platform || 'win32'} busy={busy} error={error} task={task} close={() => setInstanceForm(null)} submit={async instance => {
      const result = await nginxRequest<NginxState>('upsert', { revision: state?.revision, instance });
      const id = instance.id || result.instances.at(-1)?.id; setInstanceForm(null); await refresh(id);
    }} />}
    {confirmation && <Modal title={confirmation.title} close={() => setConfirmation(null)}><p>{confirmation.detail}</p><footer><button className="text-button" onClick={() => setConfirmation(null)}>取消</button><button className="run-button" onClick={() => { const action = confirmation.action; setConfirmation(null); action(); }}>{confirmation.confirm}</button></footer></Modal>}
    {snippet && <Modal title={`添加到 ${snippet.parent?.name || '主层级'}`} close={() => setSnippet(null)}><form onSubmit={event => { event.preventDefault(); try { changeContent(insertNginx(content, snippet.parent, snippet.value)); setSnippet(null); setError(''); } catch (failure) { setError((failure as Error).message); } }}><label>指令或配置块<textarea required rows={10} aria-label="新增 Nginx 指令" value={snippet.value} onChange={event => setSnippet({ ...snippet, value: event.target.value })} /></label><p className="ng-help">可填写 server、location、upstream 或自定义指令。请检查是否适用于当前层级。</p>{error && <p className="ng-error" role="alert">{error}</p>}<footer><button className="text-button" type="button" onClick={() => setSnippet(null)}>取消</button><button className="run-button" type="submit">加入草稿</button></footer></form></Modal>}
    {backups && <Modal title="配置文件备份" close={() => setBackups(null)}><p className="ng-help">每次保存前备份原文件。载入只替换草稿；检查后保存才会写入原路径。备份保存在 configs/nginx/backups，可手动归档。</p>{error && <p className="ng-error" role="alert">{error}</p>}{!backups.length && <p>尚无备份。</p>}<div className="ng-backups">{backups.map(backup => <div key={backup.id}><div><strong>{new Date(backup.createdAt).toLocaleString()}</strong><small>{backup.files.map(item => basename(item.path)).join('、')}</small></div><button className="text-button" disabled={busy} onClick={() => void task(async () => {
      const result = await nginxRequest<{ files: { path: string; content: string }[] }>('backup-files', { id: selected, backupId: backup.id });
      const allowed = new Set(documents.map(doc => doc.path));
      if (result.files.some(doc => !allowed.has(doc.path))) throw new Error('此备份包含已取消登记的文件，请先在实例设置中重新添加对应路径。');
      setDrafts(values => ({ ...values, ...Object.fromEntries(result.files.map(doc => [doc.path, doc.content])) })); setEpoch(value => value + 1); setBackups(null); setNotice('备份已载入草稿，请核对内容后保存。');
    })}>载入草稿</button></div>)}</div><footer><button className="text-button" onClick={() => setBackups(null)}>关闭</button></footer></Modal>}
  </section>;
}
