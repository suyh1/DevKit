import { MotionButton, MotionGroup, MotionDetails, MotionPresence } from './Motion';
import { buttonFeedback } from './motion-primitives';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FileCode2, FolderOpen, Plus, RefreshCw, Save, Play, Square, CheckCircle2, Settings2, Trash2, ChevronRight, Search, X, History, Server } from 'lucide-react';
import CodeEditor from './CodeEditor';
import { editNginxArgs, insertNginx, nginxFields, parseNginx } from '../shared/nginx.mjs';
import type { NginxNode } from '../shared/nginx.mjs';
import { nginxRequest } from './nginx-api';
import type { NginxBackup, NginxCommand, NginxCreation, NginxDetection, NginxDocument, NginxFiles, NginxInstance, NginxState, NginxStatus } from './nginx-api';
import './nginx.css';
import { useBeforeUnload, useConfirmation } from './Confirmation';
import { directiveHint, instanceHints } from './nginx-help';
import NginxHelpTip from './NginxHelpTip';
import { NginxControlDock, NginxCommandOutput } from './NginxControls';
import NginxLogs from './NginxLogs';
import ChangePreview from './ChangePreview';
import { saveText } from './files';
import type { NginxReview } from './nginx-api';
import './features.css';

const basename = (file: string) => file.split(/[\\/]/).at(-1) || file;
const dirname = (file: string) => file.replace(/[\\/][^\\/]*$/, '');
const statusNames = { running: '运行中', stopped: '已停止', unknown: '待确认', platform: '其他系统' };

type Confirmation = { title: string; detail: string; confirm: string; cancel?: string; action: () => void };
function Modal({ title, children, close, description, className = '', busy = false }: { title: string; children: React.ReactNode; close: () => void; description?: string; className?: string; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => { ref.current?.showModal(); if (className === 'ng-form-modal') ref.current?.querySelector<HTMLInputElement>('input')?.focus(); }, []);
  return <dialog className={`ng-modal ${className}`} aria-labelledby={heading} ref={ref} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); } }} onCancel={event => { event.preventDefault(); close(); }}><header>{description && <span className="ng-dialog-icon"><Server size={21} /></span>}<div><h2 id={heading}>{title}</h2>{description && <p>{description}</p>}</div><MotionButton busy={busy} type="button" className="icon-button"  aria-label="关闭对话框" disabled={busy} onClick={close}><X size={18} /></MotionButton></header><div className="ng-modal-content">{children}</div></dialog>;
}

function InstanceForm({ instance, platform, busy, error, submit, create, close, task, initialSetup = 'existing' }: {
  instance?: NginxInstance; platform: string; busy: boolean; error: string; submit: (instance: Partial<NginxInstance>) => Promise<void>; create: (settings: NginxCreation) => Promise<void>; close: () => void;
  initialSetup?: 'existing' | 'create';
  task: (action: () => Promise<void>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<NginxInstance>>(instance ? { ...instance } : { name: '', main: '', prefix: '', executable: '', files: [], platform: platform === 'win32' ? 'win32' : 'linux' });
  const [warnings, setWarnings] = useState<string[]>([]), [detection, setDetection] = useState('');
  const [manualFiles, setManualFiles] = useState(instance?.files.join('\n') || '');
  const [setup, setSetup] = useState<'existing' | 'create'>(initialSetup);
  const [directory, setDirectory] = useState(''), [mainName, setMainName] = useState('nginx.conf'), [commonName, setCommonName] = useState('common_proxy.conf'), [port, setPort] = useState('8080');
  const helpId = useId();
  const hintId = (key: keyof typeof instanceHints) => `${helpId}-${key}`;
  const hint = (key: keyof typeof instanceHints) => <NginxHelpTip id={hintId(key)} label={({ name: '实例名称', platform: '目标系统', directory: '配置目录', mainName: '主文件名', commonName: '附属文件名', port: '监听端口', main: '主配置文件', prefix: '运行目录', executable: 'nginx 程序路径', files: '附属文件' })[key]}>{instanceHints[key]}</NginxHelpTip>;
  const baseline = useRef(JSON.stringify([draft.name, draft.main, draft.prefix, draft.executable, draft.platform, manualFiles, directory, mainName, commonName, port]));
  const changed = baseline.current !== JSON.stringify([draft.name, draft.main, draft.prefix, draft.executable, draft.platform, manualFiles, directory, mainName, commonName, port]);
  const confirm = useConfirmation();
  useBeforeUnload(changed);
  const patch = (values: Partial<NginxInstance>) => setDraft(current => ({ ...current, ...values }));
  const closeForm = async () => {
    if (busy) return;
    if (!changed || await confirm({ context: instance ? '实例设置' : '添加实例', title: '放弃当前编辑？', detail: '当前设置尚未保存。继续编辑可保留已填写的内容，放弃后本次修改不会保存。', confirm: '放弃更改' })) close();
  };
  async function scan(main = draft.main) {
    if (!main) throw new Error('请先选择或填写主配置文件。');
    const result = await nginxRequest<{ main: string; files: string[]; warnings: string[] }>('discover', { main });
    const files = [...new Set([...manualFiles.split(/\r?\n/).map(item => item.trim()).filter(Boolean), ...result.files])];
    setManualFiles(files.join('\n')); patch({ main: result.main, files }); setWarnings(result.warnings);
  }
  async function pick(kind: 'main' | 'files' | 'prefix' | 'executable' | 'directory') {
    const files = await nginxRequest<string[]>('pick', { kind });
    if (!files.length) return;
    if (kind === 'files') { setManualFiles(current => [...new Set([...current.split('\n').filter(Boolean), ...files])].join('\n')); }
    else if (kind === 'main') { patch({ main: files[0], name: draft.name || basename(files[0]), prefix: draft.prefix || dirname(files[0]) }); await scan(files[0]); }
    else if (kind === 'directory') { setDirectory(files[0]); }
    else patch({ [kind]: files[0] });
  }
  return <Modal title={instance ? '实例设置' : '添加 Nginx 实例'} description={instance ? '管理此实例的配置文件与运行环境。' : '新建一套配置，或将已有配置加入工作区。'} className="ng-form-modal" busy={busy} close={() => void closeForm()}><form className="ng-instance-form" onSubmit={event => { event.preventDefault(); void task(() => setup === 'create' ? create({ name: draft.name || '', platform: draft.platform!, executable: draft.executable || '', directory, mainName, commonName, port: Number(port) }) : submit({ ...draft, files: manualFiles.split(/\r?\n/).map(file => file.trim()).filter(Boolean) })); }}><div className="ng-form-scroll">
    <fieldset disabled={busy}>
      {error && <p className="ng-error" role="alert">{error}</p>}
      {!instance && <MotionGroup className="ng-setup-tabs" role="group" aria-label="配置来源"><button type="button" aria-pressed={setup === 'existing'} className="text-button"  onClick={() => setSetup('existing')}>使用已有文件</button><button type="button" aria-pressed={setup === 'create'} className="text-button"  onClick={() => setSetup('create')}>新建配置</button></MotionGroup>}
      <h3 className="ng-form-section">基本信息</h3><div className="ng-form-grid"><label>实例名称<input required maxLength={100} aria-describedby={hintId('name')} value={draft.name} onChange={event => patch({ name: event.target.value })} />{hint('name')}</label><label>目标系统<select aria-describedby={hintId('platform')} value={draft.platform} onChange={event => patch({ platform: event.target.value as NginxInstance['platform'] })}><option value="win32">Windows</option><option value="linux">Linux</option><option value="any">跟随本机</option></select>{hint('platform')}</label></div><h3 className="ng-form-section">配置文件与运行目录</h3>
      {setup === 'create' && <><label>配置目录<div className="ng-path-input"><input required aria-describedby={hintId('directory')} spellCheck={false} value={directory} placeholder="选择存放新配置的已有目录" onChange={event => { setDirectory(event.target.value); }} /><button type="button"  className="text-button" onClick={() => void task(() => pick('directory'))}><FolderOpen size={15} />选择目录</button></div>{hint('directory')}</label>
        <div className="ng-form-grid"><label>主文件名<input required aria-describedby={hintId('mainName')} maxLength={100} value={mainName} onChange={event => { setMainName(event.target.value); }} />{hint('mainName')}</label><label>附属文件名<input required aria-describedby={hintId('commonName')} maxLength={100} value={commonName} onChange={event => { setCommonName(event.target.value); }} />{hint('commonName')}</label></div>
        <label>监听端口<input required aria-describedby={hintId('port')} type="number" min={1} max={65535} step={1} value={port} onChange={event => { setPort(event.target.value); }} />{hint('port')}</label>
        <div className="ng-create-preview"><strong>将创建并登记</strong><pre>{`${mainName}  → include ${commonName}\n${commonName}  → /api/ 公共代理规则\nhtml/index.html  → 默认首页\nlogs/  → 日志与 PID\ntemp/  → 请求与代理临时目录`}</pre></div></>}
      {(setup === 'create' ? ['executable'] as const : ['main', 'prefix', 'executable'] as const).map(key => <label key={key}>{({ main: '主配置文件', prefix: '运行目录（-p prefix）', executable: 'nginx 程序路径（留空自动检测）' })[key]}<div className="ng-path-input"><input required={key !== 'executable'} aria-describedby={hintId(key)} spellCheck={false} value={draft[key]} onChange={event => patch({ [key]: event.target.value })} placeholder={key === 'main' ? (platform === 'win32' ? 'D:\\workspace\\nginx\\nginx-win.conf' : '/etc/nginx/nginx.conf') : key === 'prefix' ? 'nginx 安装目录或自定义运行前缀' : '自动检测 PATH 与常见安装位置'} /><button type="button"  className="text-button" onClick={() => void task(() => pick(key))}><FolderOpen size={15} />选择</button></div>{hint(key)}</label>)}
      <div className="ng-actions">{setup === 'existing' && <button type="button" className="text-button"  onClick={() => void task(() => scan())}><Search size={14} />解析附属文件</button>}<button type="button" className="text-button"  onClick={() => void task(async () => {
        const found = await nginxRequest<NginxDetection>('detect', draft); setDetection(found.output);
        if (found.found) patch({ executable: found.executable, ...(setup === 'existing' ? { prefix: found.prefix } : {}) });
      })}><Search size={14} />{setup === 'create' ? '检测 nginx' : '检测 nginx 并填入运行目录'}</button></div>
      {detection && <MotionDetails className="ng-detection-panel"><summary>{detection.split(/\r?\n/)[0]}<small>查看详情</small></summary><pre className="ng-detection">{detection}</pre></MotionDetails>}
      {setup === 'existing' && <><label>附属文件（每行一个绝对路径）<textarea rows={4} aria-describedby={hintId('files')} value={manualFiles} onChange={event => setManualFiles(event.target.value)} placeholder="可自动解析 include，也可手动添加未引用的配置文件" />{hint('files')}</label>
      <button type="button" className="text-button"  onClick={() => void task(() => pick('files'))}><Plus size={14} />选择附属文件</button>
      {warnings.length > 0 && <div className="ng-warning">{warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}</>}
    </fieldset>
  </div><footer className="ng-form-footer"><span>配置保存在本机</span><MotionButton busy={busy} type="button" className="secondary-button"  disabled={busy} onClick={() => void closeForm()}>取消</MotionButton><MotionButton busy={busy} className="run-button"  disabled={busy} type="submit">{setup === 'create' ? '创建文件并添加实例' : '保存实例'}</MotionButton></footer></form></Modal>;
}

function ArgumentField({ node, source, apply, pending, parent = '', paths }: { node: NginxNode; source: string; apply: (source: string) => void; pending: (key: number, value: boolean) => void; parent?: string; paths: { prefix: string; main: string } }) {
  const [value, setValue] = useState(node.args), [error, setError] = useState('');
  const hintId = useId(), help = directiveHint(node, parent);
  useEffect(() => { setValue(node.args); setError(''); }, [node.args, node.id]);
  useEffect(() => () => pending(node.id, false), [node.id]); // Clear a removed field's pending flag.
  function commit() {
    try { if (value !== node.args) apply(editNginxArgs(source, node, value)); setError(''); pending(node.id, false); }
    catch (failure) { setError((failure as Error).message); pending(node.id, true); }
  }
  return <label className="ng-argument"><span>{node.name === 'server' && !node.block && parent.split('/').at(-1) === 'upstream' ? '后端节点地址' : nginxFields[node.name]?.[0] || (node.block ? '匹配参数' : '指令参数')} <span className="ng-argument-tools"><small>第 {node.line} 行</small><NginxHelpTip id={hintId} label={`${node.name} 填写提示`}>{help.detail}{help.example && <p>示例参数：<code>{help.example}</code></p>}{help.base && <p>可填绝对路径；相对路径基于{help.base === 'prefix' ? '运行目录' : '主配置所在目录'}：<code>{help.base === 'prefix' ? paths.prefix : dirname(paths.main)}</code>。</p>}</NginxHelpTip></span></span>
    <input aria-label={`${node.name} 第${node.line}行`} aria-describedby={hintId} title={help.detail} placeholder={help.example || (node.block && node.name === 'server' ? '通常留空，在子项中配置服务' : '填写参数，保留原始 Nginx 语法')} value={value} spellCheck={false} onChange={event => { setValue(event.target.value); pending(node.id, event.target.value !== node.args); }} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } if (event.key === 'Escape') { setValue(node.args); setError(''); pending(node.id, false); } }} aria-invalid={!!error} />
    {error && <small className="ng-error">{error}（Esc 恢复此字段）</small>}</label>;
}

function ConfigTree({ nodes, source, apply, add, remove, pending, query, paths, parent = '', depth = 0 }: {
  nodes: NginxNode[]; source: string; apply: (source: string) => void; add: (parent: NginxNode) => void; remove: (node: NginxNode) => void;
  pending: (key: number, value: boolean) => void; query: string; paths: { prefix: string; main: string }; parent?: string; depth?: number;
}) {
  return <div className="ng-tree">{nodes.map((node, index) => {
    if (query && !source.slice(node.start, node.end).toLowerCase().includes(query)) return null;
    if (node.block) {
      const title = node.name === 'server' ? node.children.filter(item => ['listen', 'server_name'].includes(item.name)).map(item => item.args).join(' · ') : node.args;
      return <MotionDetails className="ng-block" key={index} open={query ? true : depth < 2}><summary><ChevronRight size={14} /><strong>{node.name}</strong><span>{title || '配置块'}</span><small>{node.children.length} 项</small></summary><div className="ng-block-body">
        {!['http', 'events', 'stream', 'types'].includes(node.name) && <ArgumentField node={node} source={source} apply={apply} pending={pending} paths={paths} parent={parent} />}
        <ConfigTree nodes={node.children} source={source} apply={apply} add={add} remove={remove} pending={pending} query={query} paths={paths} parent={[parent, node.name].filter(Boolean).join('/')} depth={depth + 1} />
        <div className="ng-actions"><button className="text-button"  onClick={() => add(node)}><Plus size={13} />添加指令 / 子块</button><button className="text-button"  onClick={() => remove(node)}><Trash2 size={13} />删除配置块</button></div>
      </div></MotionDetails>;
    }
    return <div className="ng-directive" key={index}><code>{node.name}</code><ArgumentField node={node} source={source} apply={apply} pending={pending} paths={paths} parent={parent} /><button className="icon-button"  aria-label={`删除 ${node.name} 第${node.line}行`} onClick={() => remove(node)}><Trash2 size={13} /></button></div>;
  })}</div>;
}

export default function NginxCenter({ active }: { active: boolean }) {
  const editorHelpId = useId(), searchHelpId = useId(), snippetHelpId = useId();
  useEffect(() => {
    if (!active) document.querySelectorAll<HTMLElement>('.ng-help-popover:popover-open').forEach(popup => popup.hidePopover());
  }, [active]);
  const [state, setState] = useState<NginxState | null>(null), [statuses, setStatuses] = useState<NginxStatus[]>([]);
  const [selected, setSelected] = useState(''), [documents, setDocuments] = useState<NginxDocument[]>([]), [drafts, setDrafts] = useState<Record<string, string>>({});
  const [file, setFile] = useState(''), [warnings, setWarnings] = useState<string[]>([]), [mode, setMode] = useState<'fields' | 'source'>('fields');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [query, setQuery] = useState('');
  const [instanceForm, setInstanceForm] = useState<'new' | 'create' | NginxInstance | null>(null);
  const requestConfirmation = useConfirmation();
  function setConfirmation(options: Confirmation) {
    void requestConfirmation({ ...options, context: 'Nginx 配置', cancel: options.cancel || '取消' }).then(allow => { if (allow) options.action(); });
  }
  const [snippet, setSnippet] = useState<{ parent: NginxNode | null; value: string } | null>(null), [backups, setBackups] = useState<NginxBackup[] | null>(null);
  const [fieldPending, setFieldPending] = useState<Record<number, boolean>>({}), [epoch, setEpoch] = useState(0);
  const [output, setOutput] = useState<{ ok: boolean; command: string; output: string } | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [review, setReview] = useState<{ title: string; data: NginxReview; files: { path: string; before: string; after: string; conflict: boolean }[] } | null>(null);
  const locked = useRef(false), initialized = useRef(false), polling = useRef(false);
  const current = state?.instances.find(instance => instance.id === selected), status = statuses.find(item => item.id === selected);
  const content = drafts[file] ?? '', dirtyFiles = documents.filter(doc => drafts[doc.path] !== doc.content), pendingFields = Object.values(fieldPending).some(Boolean);
  const dirty = dirtyFiles.length > 0 || pendingFields;
  const parsed = useMemo(() => { try { return { nodes: parseNginx(content), error: '' }; } catch (failure) { return { nodes: [], error: (failure as Error).message }; } }, [content]);
  async function task(action: () => Promise<unknown>) {
    if (locked.current) return;
    const feedback = buttonFeedback();
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try { const result = await action(); feedback(!(result && typeof result === 'object' && 'ok' in result && result.ok === false)); } catch (failure) { setError((failure as Error).message); feedback(false); }
    finally { locked.current = false; setBusy(false); }
  }
  async function refreshStatuses() { setStatuses(await nginxRequest<NginxStatus[]>('statuses')); }
  async function load(id: string) {
    setLogsOpen(false); setReview(null);
    const result = await nginxRequest<NginxFiles>('documents', { id });
    setSelected(id); setDocuments(result.files); setDrafts(Object.fromEntries(result.files.map(doc => [doc.path, doc.content])));
    setFile(id === selected && result.files.some(doc => doc.path === file) ? file : result.files[0]?.path || ''); setWarnings(result.warnings); setFieldPending({}); setEpoch(value => value + 1); setOutput(null); setQuery('');
    return result;
  }
  async function refresh(preferred = selected) {
    const next = await nginxRequest<NginxState>('get'); setState(next);
    const id = next.instances.some(item => item.id === preferred) ? preferred : next.instances[0]?.id;
    if (id) await load(id); else { setSelected(''); setDocuments([]); setDrafts({}); setFile(''); }
    await refreshStatuses();
  }
  function deleteInstance(instance: NginxInstance) {
    if (busy || !state) return;
    const deletingCurrent = instance.id === selected;
    setConfirmation({
      title: `删除实例“${instance.name}”？`,
      detail: `将从工作区删除此实例记录，配置文件和备份会保留。已经启动的 Nginx 会继续运行；需要停止时，请先取消并停止实例。${deletingCurrent && dirty ? '当前实例有未保存的修改，确认删除会一并放弃这些草稿。' : ''}`,
      confirm: '删除实例', cancel: '取消',
      action: () => void task(async () => {
        const index = state.instances.findIndex(item => item.id === instance.id);
        const next = await nginxRequest<NginxState>('remove', { id: instance.id, revision: state.revision, forgetOnly: true });
        setState(previous => previous ? { ...previous, ...next } : next); setStatuses(values => values.filter(item => item.id !== instance.id));
        if (deletingCurrent) {
          const neighbor = next.instances[Math.min(index, next.instances.length - 1)];
          if (neighbor) await load(neighbor.id);
          else { setSelected(''); setDocuments([]); setDrafts({}); setFile(''); setWarnings([]); setFieldPending({}); setOutput(null); setQuery(''); }
        }
        setNotice(`已删除实例“${instance.name}”，配置文件和备份已保留。`);
      }),
    });
  }
  function discardThen(action: () => void) {
    if (dirty) setConfirmation({ title: '放弃未保存的配置？', detail: '当前修改仅保留在草稿中。放弃后将重新读取磁盘文件。', confirm: '放弃草稿并继续', cancel: '继续编辑', action });
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
  useBeforeUnload(dirty);
  function changeContent(value: string) { setDrafts(values => ({ ...values, [file]: value })); setOutput(null); }
  const pending = (key: number, value: boolean) => setFieldPending(values => values[key] === value ? values : { ...values, [key]: value });
  async function save() {
    if (!current || pendingFields) throw new Error('请先完成字段编辑，按 Enter 或移出输入框提交；无效字段可按 Esc 恢复。');
    const result = await nginxRequest<NginxFiles>('save-files', { id: current.id, files: dirtyFiles.map(doc => ({ ...doc, content: drafts[doc.path] })) });
    setDocuments(result.files); setDrafts(Object.fromEntries(result.files.map(doc => [doc.path, doc.content]))); setWarnings(result.warnings);
    setFieldPending({}); setEpoch(value => value + 1); setNotice(`已保存 ${dirtyFiles.length} 个文件。原文件备份：${result.backup}`); setOutput(null); await refreshStatuses();
  }
  async function previewChanges(backupId?: string) {
    if (!current || pendingFields) throw new Error('请先完成当前字段编辑。');
    const data = await nginxRequest<NginxReview>('review', { id: current.id });
    const backup = backupId ? await nginxRequest<{ files: { path: string; content: string }[] }>('backup-files', { id: current.id, backupId }) : null;
    const files = (backup?.files || dirtyFiles).map(doc => {
      const disk = data.files.find(item => item.path === doc.path);
      return { path: doc.path, before: backup ? doc.content : disk?.content ?? '', after: backup ? disk?.content ?? '' : drafts[doc.path], conflict: !disk || !backup && disk.hash !== documents.find(item => item.path === doc.path)?.hash };
    });
    setBackups(null); setReview({ title: backup ? '备份与当前磁盘对比' : '草稿变更预览', data, files });
  }
  async function command(action: NginxCommand) {
    if (!current) return;
    if (dirty) throw new Error('请先保存配置或重新读取以放弃草稿，再执行命令。');
    const result = await nginxRequest<{ ok: boolean; command: string; output: string; status: NginxStatus }>('command', { id: current.id, command: action });
    setOutput(result); if (result.status) setStatuses(values => [...values.filter(item => item.id !== result.status.id), result.status]);
    return result;
  }
  if (!window.devkitNginx) return <section className="ng-center"><header className="ng-heading"><Server /><div><h1>Nginx 配置</h1><p>可视化编辑配置文件，按主配置管理本机 Nginx 实例。</p></div></header><p className="ng-warning">请使用 DevKit Windows / Linux 桌面端打开此功能。</p></section>;
  return <section className="ng-center" aria-label="Nginx 配置工作区">
    <header className="ng-heading"><span className="ng-heading-icon"><Server size={25} /></span><div><h1>Nginx 配置</h1><p>配置文件与运行实例，在一个工作区维护。</p></div><div className="ng-actions"><MotionButton busy={busy} className="text-button"  disabled={busy} onClick={() => discardThen(() => void task(() => refresh()))}><RefreshCw size={15} />刷新</MotionButton><MotionButton busy={busy} className="run-button"  disabled={busy || dirty} onClick={() => setInstanceForm('new')}><Plus size={16} />添加实例</MotionButton></div></header>
    {error && <p className="ng-error ng-message" role="alert">{error}</p>}{notice && <p className="ng-notice ng-message" role="status">{notice}</p>}
    {busy && <p className="ng-busy" role="status">正在处理…</p>}
    {!state ? <div className="ng-empty-loading" role="status">{busy ? '正在读取实例…' : '请刷新以读取实例列表。'}</div> : !state.instances.length ? <div className="ng-empty"><span className="ng-empty-icon"><Server size={28} /></span><h2>尚未添加 Nginx 实例</h2><p>每个实例使用一份主配置，可关联多份附属文件。<br />Windows 和 Linux 均支持相同的多文件配置。</p><div className="ng-empty-actions"><MotionButton busy={busy} className="run-button"  disabled={busy} onClick={() => setInstanceForm('create')}><Plus size={16} />新建配置</MotionButton><MotionButton busy={busy} className="secondary-button"  disabled={busy} onClick={() => setInstanceForm('new')}><FolderOpen size={16} />导入已有文件</MotionButton></div><small>可选择目录生成一套配置，或将已有配置加入工作区。</small></div> : <div className="ng-layout"><aside className="ng-instances" aria-label="Nginx 实例列表">{state.instances.map(instance => {
      const itemStatus = statuses.find(item => item.id === instance.id);
      return <div className={`ng-instance ${selected === instance.id ? 'selected' : ''}`} data-instance-id={instance.id} key={instance.id}><MotionButton busy={busy} type="button" className="ng-instance-select" aria-pressed={selected === instance.id} disabled={busy} onClick={() => { if (selected !== instance.id) discardThen(() => void task(() => load(instance.id))); }}><span><strong>{instance.name}</strong><small className={`ng-status ${itemStatus?.state || 'unknown'}`}>{itemStatus ? statusNames[itemStatus.state] : '待检测'}</small></span><code>{basename(instance.main)}</code></MotionButton><div className="ng-instance-footer"><small>{instance.platform === 'any' ? '本机' : instance.platform === 'win32' ? 'Windows' : 'Linux'} · {instance.files.length + 1} 个文件</small><MotionButton busy={busy} type="button" className="text-button ng-instance-delete" disabled={busy} aria-label={`删除实例：${instance.name}`} onClick={() => deleteInstance(instance)}><Trash2 size={13} />删除</MotionButton></div></div>;
    })}<p className="ng-help">实例与备份保存在 {state.directory}。配置文件在原路径编辑。</p></aside>
    {current && <div className="ng-detail"><NginxControlDock active={active}>{({ stuck, compact, toggle }) => <><header className="ng-instance-heading"><div><h2>{current.name}<span className={`ng-status ${status?.state || 'unknown'}`}>{status ? statusNames[status.state] : '待检测'}{status?.pid ? ` · PID ${status.pid}` : ''}</span></h2><p className="ng-dock-main-path" title={current.main}>{current.main}</p></div><div className="ng-actions"><button className="text-button ng-dock-toggle" hidden={!stuck} onClick={toggle} aria-expanded={!compact} ><ChevronRight size={13} />{compact ? '展开详情' : '收起详情'}</button><MotionButton busy={busy} className="text-button"  disabled={busy || dirty} onClick={() => setInstanceForm(current)}><Settings2 size={15} />实例设置</MotionButton><MotionButton busy={busy} type="button" className="text-button ng-instance-delete" disabled={busy} onClick={() => deleteInstance(current)}><Trash2 size={15} />删除实例</MotionButton></div></header>
      <div className="ng-dock-metadata" inert={compact}><div><p className="ng-runtime">运行目录：<code>{current.prefix}</code><br />{status?.detail}{status?.pidPath && <> · PID 文件：<code>{status.pidPath}</code></>}</p>
      </div></div>
      <div className="ng-toolbar"><div className="ng-actions">
        <MotionButton busy={busy} className="text-button"  disabled={busy || dirty || status?.state === 'platform'} onClick={() => void task(() => command('test'))}><CheckCircle2 size={15} />检查配置</MotionButton>
        <MotionButton busy={busy} className="text-button"  disabled={busy || dirty || status?.state !== 'stopped'} onClick={() => void task(() => command('start'))}><Play size={15} />启动</MotionButton>
        <MotionButton busy={busy} className="text-button"  disabled={busy || dirty || status?.state !== 'running'} onClick={() => void task(() => command('reload'))}><RefreshCw size={15} />重载</MotionButton>
        <MotionButton busy={busy} className="text-button"  disabled={busy || dirty || status?.state !== 'running'} onClick={() => setConfirmation({ title: `优雅停止 ${current.name}？`, detail: '向此主配置对应的 Nginx 主进程发送 quit，等待现有连接完成。', confirm: '停止 Nginx', action: () => void task(() => command('stop')) })}><Square size={15} />停止</MotionButton>
      </div><div className="ng-actions"><MotionButton busy={busy} className="text-button"  disabled={busy || dirty} onClick={() => void task(async () => setBackups(await nginxRequest<NginxBackup[]>('backups', { id: current.id })))}><History size={15} />备份</MotionButton><MotionButton busy={busy} className="text-button"  disabled={busy} onClick={() => discardThen(() => void task(() => load(current.id)))}>重新读取</MotionButton><MotionButton busy={busy} className="run-button"  disabled={busy || !dirty} onClick={() => void task(save)}><Save size={15} />保存文件{dirtyFiles.length ? ` (${dirtyFiles.length})` : ''}</MotionButton></div></div>
      {dirty && <p className="ng-warning ng-message">有未保存的修改。保存后才能检查、启动或重载；保存本身不会重载 Nginx。{pendingFields && '请移出字段或按 Enter 完成编辑。'}</p>}
      {output && <NginxCommandOutput output={output} compact={compact} />}</>}</NginxControlDock>
      {warnings.length > 0 && <div className="ng-warning">{warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
      <div className="feature-toolbar"><MotionButton busy={busy} className="secondary-button" disabled={busy || pendingFields} onClick={() => void task(() => previewChanges())}>变更与引用预览</MotionButton><button className="secondary-button" aria-expanded={logsOpen} onClick={() => setLogsOpen(value => !value)}>{logsOpen ? '收起日志' : '查看日志'}</button></div><MotionPresence kind="panel" present={!!(logsOpen)}>{logsOpen && <NginxLogs key={current.id} id={current.id} active={active} />}</MotionPresence>
      <MotionGroup className="ng-file-tabs" role="tablist" aria-label="配置文件">{documents.map(doc => <button key={doc.path}  role="tab" aria-selected={file === doc.path} disabled={busy || pendingFields} onClick={() => { setFile(doc.path); setFieldPending({}); setQuery(''); }}><FileCode2 size={14} /><span>{basename(doc.path)}</span><small>{doc.path === current.main ? '主' : '附属'}{drafts[doc.path] !== doc.content ? ' ●' : ''}</small></button>)}</MotionGroup>
      {file && <><div className="ng-editor-heading"><code title={file}>{file}</code><NginxHelpTip id={editorHelpId} label="当前文件的填写规则">{mode === 'source' ? '全文编辑保留完整指令、分号与花括号，保存后检查并重载。' : '只填参数，不加指令名或分号；Enter 或离开输入框提交草稿，Esc恢复字段。'}{file !== current.main && <p>当前为附属文件，实际生效取决于 include；修改公共规则会影响所有引用它的服务。</p>}</NginxHelpTip><MotionGroup className="ng-actions" role="group" aria-label="配置编辑方式">{content.startsWith('\uFEFF') && <MotionButton busy={busy} className="text-button" disabled={busy || pendingFields}  onClick={() => changeContent(content.slice(1))}>移除 UTF-8 BOM</MotionButton>}<button className={`text-button ${mode === 'fields' ? 'selected' : ''}`} disabled={pendingFields}  aria-pressed={mode === 'fields'} onClick={() => setMode('fields')}>字段配置</button><button className={`text-button ${mode === 'source' ? 'selected' : ''}`} disabled={pendingFields}  aria-pressed={mode === 'source'} onClick={() => setMode('source')}>全文编辑</button></MotionGroup></div>
      <fieldset className="ng-editor-fieldset" aria-describedby={editorHelpId} disabled={busy}>
        <div hidden={mode !== 'source'} inert={mode !== 'source'} className="ng-source motion-mode" role="group" aria-label="全文配置编辑" aria-describedby={editorHelpId}><CodeEditor key={file + epoch} label="Nginx 配置源码" value={content} onChange={changeContent} readOnly={busy} language="nginx" wrap /></div><div hidden={mode !== "fields"} inert={mode !== "fields"} className="ng-fields motion-mode"><div className="ng-field-tools"><label><Search size={14} /><input aria-label="搜索配置字段" aria-describedby={searchHelpId} placeholder="搜索指令、端口、域名或路径" value={query} onChange={event => setQuery(event.target.value)} /><NginxHelpTip id={searchHelpId} label="搜索配置字段">仅筛选当前文件的显示内容，不修改配置；可输入指令、端口、域名或路径，清空关键词可查看全部字段。</NginxHelpTip></label><button className="text-button"  disabled={!!parsed.error || pendingFields} onClick={() => setSnippet({ parent: null, value: 'worker_processes auto;' })}><Plus size={14} />添加指令 / 配置块</button></div>
        {parsed.error ? <p className="ng-error" role="alert">{parsed.error}。切换全文编辑修复后即可恢复字段视图。</p> : <ConfigTree key={file + epoch} paths={{ prefix: current.prefix, main: current.main }} nodes={parsed.nodes} source={content} apply={changeContent} pending={pending} query={query.trim().toLowerCase()} add={parent => setSnippet({ parent, value: parent.name === 'http' ? 'server {\n    listen 8080;\n    server_name localhost;\n    location / {\n        root html;\n        index index.html;\n    }\n}' : parent.name === 'server' ? 'location /api/ {\n    proxy_pass http://127.0.0.1:9000;\n}' : 'include common_proxy.conf;' })} remove={node => setConfirmation({ title: `删除 ${node.name} ${node.args}？`, detail: '仅从当前草稿删除这条指令或整个配置块。保存文件后才会写入磁盘。', confirm: '从草稿删除', action: () => changeContent(content.slice(0, node.start) + content.slice(node.end)) })} />}
        </div>
      </fieldset></>}
    </div>}</div>}
    <MotionPresence kind="dialog" present={!!(instanceForm)}>{instanceForm && <InstanceForm instance={typeof instanceForm === 'string' ? undefined : instanceForm} initialSetup={instanceForm === 'create' ? 'create' : 'existing'} platform={state?.platform || 'win32'} busy={busy} error={error} task={task} close={() => setInstanceForm(null)} create={async settings => {
      const result = await nginxRequest<NginxState>('create', { ...settings, revision: state?.revision });
      setInstanceForm(null); await refresh(result.instances.at(-1)?.id); setNotice('主文件、附属文件和运行目录已创建，可直接编辑，检查后启动。');
    }} submit={async instance => {
      const result = await nginxRequest<NginxState>('upsert', { revision: state?.revision, instance });
      const id = instance.id || result.instances.at(-1)?.id; setInstanceForm(null); await refresh(id);
    }} />}</MotionPresence>
    <MotionPresence kind="dialog" present={!!(snippet)}>{snippet && <Modal title={`添加到 ${snippet.parent?.name || '主层级'}`} close={() => setSnippet(null)}><form onSubmit={event => { event.preventDefault(); try { changeContent(insertNginx(content, snippet.parent, snippet.value)); setSnippet(null); setError(''); } catch (failure) { setError((failure as Error).message); } }}><label>指令或配置块<NginxHelpTip label="新增指令的填写规则" id={snippetHelpId}>这里填写完整语法，例如 <code>include common_proxy.conf;</code>，普通指令以分号结束，配置块使用花括号。当前层级为 {snippet.parent?.name || '主层级'}；http 下可加 server，server 下可加 location，location 内可加 proxy_pass。示例需按实际情况调整；“加入草稿”不写入磁盘，之后还需保存并检查配置。</NginxHelpTip><textarea required rows={10} aria-label="新增 Nginx 指令" aria-describedby={snippetHelpId} value={snippet.value} onChange={event => setSnippet({ ...snippet, value: event.target.value })} /></label>{error && <p className="ng-error" role="alert">{error}</p>}<footer><button className="text-button"  type="button" onClick={() => setSnippet(null)}>取消</button><MotionButton className="run-button"  type="submit">加入草稿</MotionButton></footer></form></Modal>}</MotionPresence>
    <MotionPresence kind="dialog" present={!!(review)}>{review && <Modal title={review.title} close={() => setReview(null)} className="ng-review-modal"><p className="ng-help">草稿对比以当前磁盘为基准；仅扫描已登记实例的实际 include，动态引用或扫描失败会列出提示。保存仍会再次检查文件版本。</p>{review.data.warnings.map((warning, i) => <p key={i} className="ng-warning">{warning}</p>)}{!review.files.length && <p>尚无草稿修改。以下展示当前文件的引用关系。</p>}{review.files.map(item => <section key={item.path}><h3>{item.path}</h3>{item.conflict && <p className="ng-error">文件已被外部修改或当前不可读取，请先合并，不能直接保存。</p>}<ChangePreview before={item.before} after={item.after} /></section>)}<h3>配置引用与影响范围</h3>{review.data.impacts.map(item => <section className="ng-impact" key={item.id}><strong>{item.name}</strong>{item.files.filter(path => !review.files.length || review.files.some(file => file.path === path)).map(path => <div key={path}><button className="text-button" onClick={() => { setReview(null); if (item.id === selected && documents.some(doc => doc.path === path)) { setFile(path); setQuery(''); } else discardThen(() => void task(async () => { const loaded = await load(item.id); if (loaded.files.some(doc => doc.path === path)) setFile(path); else setNotice('引用目标未登记为可编辑文件，请先在实例设置中添加：' + path); })); }}>{path}</button>{item.references.filter(ref => ref.to === path).map((ref, i) => <small key={i}>{ref.context} · {ref.from}:{ref.line}</small>)}</div>)}</section>)}<footer><button className="text-button" onClick={() => void saveText(JSON.stringify(review, null, 2), 'nginx-change-review.json').catch(error => setError(String(error)))}>导出审阅报告</button><button className="secondary-button" onClick={() => setReview(null)}>返回编辑</button></footer></Modal>}</MotionPresence>
    <MotionPresence kind="dialog" present={!!(backups)}>{backups && <Modal title="配置文件备份" close={() => setBackups(null)}><p className="ng-help">每次保存前备份原文件。载入只替换草稿；检查后保存才会写入原路径。备份保存在 configs/nginx/backups，可手动归档。</p>{error && <p className="ng-error" role="alert">{error}</p>}{!backups.length && <p>尚无备份。</p>}<div className="ng-backups">{backups.map(backup => <div key={backup.id}><div><strong>{new Date(backup.createdAt).toLocaleString()}</strong><small>{backup.files.map(item => basename(item.path)).join('、')}</small></div><MotionButton busy={busy} className="text-button" disabled={busy} onClick={() => void task(() => previewChanges(backup.id))}>对比当前</MotionButton><MotionButton busy={busy} className="text-button"  disabled={busy} onClick={() => void task(async () => {
      const result = await nginxRequest<{ files: { path: string; content: string }[] }>('backup-files', { id: selected, backupId: backup.id });
      const allowed = new Set(documents.map(doc => doc.path));
      if (result.files.some(doc => !allowed.has(doc.path))) throw new Error('此备份包含已取消登记的文件，请先在实例设置中重新添加对应路径。');
      setDrafts(values => ({ ...values, ...Object.fromEntries(result.files.map(doc => [doc.path, doc.content])) })); setEpoch(value => value + 1); setBackups(null); setNotice('备份已载入草稿，请核对内容后保存。');
    })}>载入草稿</MotionButton></div>)}</div><footer><button className="text-button" onClick={() => setBackups(null)}>关闭</button></footer></Modal>}</MotionPresence>
  </section>;
}
