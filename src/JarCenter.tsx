import FloatingDetails from './FloatingDetails';
import { TextArea, TextInput } from './TextControl';
import type { ServiceDraft } from './detection';
import Skeleton from './Skeleton';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ServerCog, Plus, RefreshCw, Play, Square, Settings2, Trash2, FileText, FolderOpen, Upload, X, Search } from 'lucide-react';
import { MotionButton } from './Motion';
import { useBeforeUnload, useConfirmation } from './Confirmation';
import SegmentedControl from './SegmentedControl';
import { jarRequest, serviceLocation, type BackendKind } from './jar-api';
import JarRuntimeSettings, { npmSearchPath, runtimeDraft, runtimePayload } from './JarRuntimeSettings';
import ServiceProjects from './ServiceProjects';
import JarReplaceDialog from './JarReplaceDialog';
import JarStartupDialog from './JarStartupDialog';
import JarConsole from './JarConsole';
import ResultPager from './ResultPager';
import { Modal } from './project-components';
import HostPathPicker, { HostSelect } from './HostPathPicker';
import LegacySshImport from './LegacySshImport';
import { groupInstances, targetGroup, hostAccessLabel, hostRole } from './lan-api';
import type { RemoteDirectory } from './lan-api';
import { usePerformanceMode } from './DisplayMode';
import { HostProgress, useHostInventory } from './HostInventory';
import { RelatedLink, useRelatedCreation, useWorkspaceGuard } from './related-workspaces';
import { inventoryLinkStatus, missingResourceLink, openWorkspaceLink, ResourceLink, useWorkspaceResource } from './workspace-links';
import { canWriteWorkspace, canOperateJar, canReadWorkspaceLogs, remoteAccess } from './workspace-remote';
import type { JarInstance, JarState, JarStatus, JavaDetection, RuntimeList, ProbeLine, JarLog, JarCommand } from './jar-api';
import './jar.css';

const basename = (value: string) => value.split(/[\\/]/).pop() || value;
const bytes = (value?: number) => value === undefined ? '—' : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
const duration = (value?: number) => value === undefined ? '—' : `${Math.floor(value / 3600)}时 ${Math.floor(value % 3600 / 60)}分 ${Math.floor(value % 60)}秒`;
const labels = { running: '运行中', stopped: '已停止', exited: '已退出', unknown: '待核实' };
const healthLabels = { disabled: '未检测', unknown: '待检测', starting: '启动宽限中', stopped: '未运行', healthy: '健康', degraded: '检测波动', unhealthy: '不健康' };
const supervisionLabels: Record<string, string> = { starting: '正在启动', running: '独立守护中', backoff: '等待重试', exhausted: '重试已达上限', exited: '进程已退出', blocked: '需要处理', stopping: '正在停止' };

function RuntimeProbe({ label, disabled, check }: { label: string; disabled: boolean; check: () => Promise<ProbeLine[]> }) {
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<ProbeLine[]>([]);
  const [error, setError] = useState('');
  async function detect() {
    setBusy(true); setLines([]); setError('');
    try { setLines(await check()); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="jar-runtime-probe">
    <MotionButton type="button" className="text-button" disabled={disabled || busy} busy={busy} onClick={() => void detect()}>{label}</MotionButton>
    {lines.length > 0 && <div role="status">{lines.map(line => <p key={line.text} className={line.ok ? 'jar-help' : 'jar-error'}>{line.text}</p>)}</div>}
    {error && <p role="alert" className="jar-error">{error}</p>}
  </div>;
}

function RuntimePathField({ kind, hostId, available, allowControl, value, change, browse }: {
  kind: 'java' | 'node'; hostId: string; available: boolean; allowControl: boolean; value: string; change: (path: string) => void; browse: () => void;
}) {
  const name = kind === 'node' ? 'Node.js' : 'Java';
  const [list, setList] = useState<RuntimeList | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const id = useId(), input = useRef<HTMLInputElement>(null);
  async function discover() {
    setBusy(true); setList(null); setError('');
    try { setList(await jarRequest<RuntimeList>('list-runtimes', { kind, hostId })); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="jar-runtime-field">
    <label htmlFor={id}>{name} 程序路径（可选）</label>
    <div className="jar-path-input">
      <TextInput id={id} ref={input} value={value} onChange={event => change(event.target.value)} placeholder={kind === 'java' ? '留空：检测 JAVA_HOME 和 PATH' : '留空使用服务环境的 PATH'} />
      {available && <button type="button" className="secondary-button" disabled={busy || !allowControl} onClick={() => void discover()}>查找已安装版本</button>}
      <button type="button" className="file-pick-button" onClick={browse}><FolderOpen size={15} />手动选文件</button>
    </div>
    {busy && <Skeleton kind="list" label={'正在目标主机查找 ' + name + ' 版本'} />}
    {error && <p role="alert" className="jar-error">{error}</p>}
    {list && <>
      {list.installations.length > 0 ? <ul aria-label={'目标主机上的 ' + name + ' 版本'}>{list.installations.map(item =>
        <li key={item.executable}><button type="button" aria-pressed={value === item.executable} onClick={() => { change(item.executable); setList(null); input.current?.focus(); }}>
          <strong>{name} {item.version}</strong><span>{item.executable}</span>
        </button></li>)}</ul> : <p role="status" className="jar-help">常用安装目录中未找到可用的 {name}，可手动选择程序文件。</p>}
      {list.truncated && <p className="jar-help">已达到本次查找上限，其他安装可手动选择。</p>}
    </>}
  </div>;
}

function JavaProbe({ hostId, executable, disabled }: { hostId: string; executable: string; disabled: boolean }) {
  return <RuntimeProbe label="检测 Java" disabled={disabled} check={async () => {
    const result = await jarRequest<JavaDetection>('detect', { hostId, executable });
    return [{ ok: result.found, text: result.found ? result.version + ' · ' + result.executable : result.output }];
  }} />;
}

function JarForm({ active, instance, seed, state, close, saved }: { seed?: ServiceDraft; active: boolean; instance?: JarInstance; state: JarState; close: () => void; saved: () => void }) {
  const initial = { kind: instance?.kind || 'jar' as BackendKind, workDir: instance?.workDir || '', program: instance?.program || '', script: instance?.script || '', nodePath: instance?.nodePath || '', name: instance?.name || '', jar: instance?.jar || '', executable: instance?.executable || '', jvm: instance?.jvmArgs.join('\n') || '', args: instance?.appArgs.join('\n') || '', pidName: instance?.pidName || '', logName: instance?.logName || '', logMode: instance?.logMode || 'file', stopTimeout: instance?.stopTimeout || 15, ...seed };
  const [scripts, setScripts] = useState<string[]>(initial.kind === 'npm' && initial.script ? [initial.script] : []);
  const initialRuntime = useRef(runtimeDraft(instance));
  const [runtime, setRuntime] = useState(initialRuntime.current);
  const [draft, setDraft] = useState(initial), baseline = useRef(JSON.stringify([initial, initialRuntime.current]));
  const [hostId, setHostId] = useState(instance?.hostId || ''), [picker, setPicker] = useState<'jar' | 'executable' | 'directory' | 'program' | 'script' | null>(null);
  const group = targetGroup(state.groups, hostId), allowControl = group?.control ?? canOperateJar();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const searchPath = draft.kind === 'npm' ? npmSearchPath(runtime, group?.platform || state.platform) : undefined;
  const supportsNodePath = hostId ? group?.supportsNodePath : state.supportsNodePath;
  const discoveryAvailable = !!(hostId ? group?.runtimeDiscovery : state.runtimeDiscovery);
  const checksAvailable = hostId ? group?.backendChecks : state.backendChecks;
  const dialog = useRef<HTMLDialogElement>(null), heading = useId(), confirm = useConfirmation();
  const dirty = JSON.stringify([draft, runtime]) !== baseline.current;
  useBeforeUnload(dirty);
  useEffect(() => {
    const surface = dialog.current;
    if (!active || !surface) return;
    const previous = document.activeElement;
    surface.showModal();
    surface.querySelector('input')?.focus();
    return () => { surface.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [active]);
  const patch = (values: Partial<typeof draft>) => setDraft(current => ({ ...current, ...values }));
  async function task(action: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); try { await action(); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } }
  async function cancel() {
    if (busy) return;
    if (!dirty || await confirm({ title: '放弃服务设置修改？', detail: '尚未保存的显示名称、路径和启动参数将被放弃。', confirm: '放弃修改' })) close();
  }
  async function readScripts(directory: string) {
    const names = await jarRequest<string[]>('npm-scripts', { hostId, directory });
    setScripts(names);
    patch({ script: names.includes(draft.script) ? draft.script : names.includes('start') ? 'start' : names.length === 1 ? names[0] : '' });
    if (!names.length) throw new Error('package.json 中没有可选的启动脚本。');
  }
  async function pickFile(kind: 'jar' | 'executable' | 'directory' | 'program' | 'script', filename: string) {
    if (kind === 'jar') {
      const stem = basename(filename).replace(/\.jar$/i, '');
      patch({ jar: filename, ...(!draft.name ? { name: stem } : {}) });
    } else if (kind === 'directory') {
      patch({ workDir: filename, ...(draft.kind === 'npm' && !draft.name ? { name: basename(filename) } : {}) });
      if (draft.kind === 'npm') { setScripts([]); patch({ script: '' }); await readScripts(filename); }
    } else if (kind === 'script') {
      patch({ script: filename, ...(!draft.name ? { name: basename(filename) } : {}) });
    } else if (kind === 'program') {
      patch({ program: filename, ...(!draft.name && draft.kind !== 'script' ? { name: basename(filename) } : {}) });
    } else if (draft.kind === 'npm') patch({ nodePath: filename });
    else patch({ executable: filename });
  }
  function pickSystem(kind: 'jar' | 'executable' | 'directory' | 'program' | 'script') {
    setPicker(null);
    void task(async () => { const files = await jarRequest<string[]>('pick', { kind: kind === 'program' ? 'executable' : kind }); if (files[0]) await pickFile(kind, files[0]); });
  }
  return <dialog ref={dialog} className="jar-dialog jar-instance-editor" aria-labelledby={heading} onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); void cancel(); }} onKeyDown={event => { if (event.key === 'Escape' && event.target instanceof Element && event.target.closest('dialog') === event.currentTarget && !(event.target instanceof HTMLOptionElement)) { event.preventDefault(); event.stopPropagation(); void cancel(); } }}>
    <header><h2 id={heading}>{instance ? '编辑服务' : '添加服务'}</h2><button className="icon-button" aria-label="关闭服务设置" disabled={busy} onClick={() => void cancel()}><X size={18} /></button></header>
    <form onSubmit={event => { event.preventDefault(); void task(async () => {
      if (draft.kind === 'npm' && draft.nodePath && !supportsNodePath) throw new Error('请刷新主机信息，确认目标主机支持指定 Node.js 路径后再保存。');
      await jarRequest<JarState>('upsert', { hostId, revision: group?.revision ?? state.revision, instance: { ...instance, ...runtimePayload(runtime), kind: draft.kind, workDir: draft.workDir, program: draft.program, script: draft.script, nodePath: draft.kind === 'npm' && supportsNodePath ? draft.nodePath : undefined, name: draft.name, jar: draft.jar, executable: draft.executable, jvmArgs: draft.jvm.split(/\r?\n/).filter(Boolean), appArgs: draft.args.split(/\r?\n/).filter(Boolean), pidName: draft.pidName, logName: draft.logName, logMode: draft.logMode, stopTimeout: Number(draft.stopTimeout) } });
      baseline.current = JSON.stringify([draft, runtime]); saved();
    }); }}>
      <div className="jar-form-body"><fieldset disabled={busy}>
        <HostSelect module="jar" groups={state.groups} id={hostId} locked={!!instance} change={id => { setHostId(id); setScripts([]); patch({ kind: 'jar', jar: '', executable: '', nodePath: '', workDir: '', program: '', script: '' }); }} />
        <div className="choice-field"><span>启动方式</span><SegmentedControl label="启动方式" value={draft.kind} disabled={!!instance} options={[
          { value: 'jar', label: 'Java JAR' },
          { value: 'npm', label: 'npm 项目', disabled: !(hostId ? group?.backendTypes : state.backendTypes) },
          { value: 'script', label: '解释器脚本', disabled: !(hostId ? group?.supportsScripts : state.supportsScripts) },
          { value: 'program', label: '可执行程序', disabled: !(hostId ? group?.backendTypes : state.backendTypes) },
        ]} onChange={kind => { patch({ kind, workDir: '', program: '', script: '' }); setScripts([]); setError(''); }} /></div>
        <label>显示名称<TextInput required maxLength={120} value={draft.name} onChange={event => patch({ name: event.target.value })} placeholder="例如：订单服务 · 测试环境" /></label>
        {draft.kind === 'jar' && <><label>JAR 文件绝对路径<span className="jar-path-input"><TextInput required value={draft.jar} onChange={event => patch({ jar: event.target.value })} onBlur={() => { if (!draft.name && draft.jar) patch({ name: basename(draft.jar).replace(/\.jar$/i, '') }); }} placeholder={hostId || !window.devkitJar ? '填写目标主机上的绝对路径' : '选择已有 .jar 文件'} /><button className="file-pick-button" type="button" onClick={() => setPicker('jar')}><FolderOpen size={15} />选择文件</button></span></label>
        <p className="jar-help">自动获取目录和文件名；工作目录、日志与 PID 都在 JAR 同级。每个文件仅登记一次。</p>
        <RuntimePathField key={hostId} kind="java" hostId={hostId} available={discoveryAvailable} allowControl={allowControl} value={draft.executable} change={executable => patch({ executable })} browse={() => setPicker('executable')} />
        <JavaProbe key={JSON.stringify([hostId, draft.executable])} hostId={hostId} executable={draft.executable} disabled={!allowControl} />
        </>}
        {draft.kind === 'script' && <label>入口脚本<span className="jar-path-input"><TextInput required value={draft.script} placeholder="例如 /srv/web/server.py" onChange={e => patch({ script: e.target.value })} /><button type="button" className="file-pick-button" onClick={() => setPicker('script')}><FolderOpen size={15} />选择脚本</button></span></label>}
        {(draft.kind === 'program' || draft.kind === 'script') && <label>{draft.kind === 'script' ? '解释器路径（如 Python 或 Node.js）' : '可执行程序绝对路径'}<span className="jar-path-input"><TextInput required value={draft.program} onChange={e => patch({ program: e.target.value })} /><button type="button" className="file-pick-button" onClick={() => setPicker('program')}><FolderOpen size={15} />选择程序</button></span></label>}
        {(draft.kind === 'program' || draft.kind === 'script') && checksAvailable && <RuntimeProbe key={JSON.stringify([hostId, draft.program])} label="检查可执行文件" disabled={!draft.program.trim()} check={() => jarRequest<ProbeLine[]>('check-program', { hostId, program: draft.program })} />}
        {draft.kind !== 'jar' && <label>{draft.kind === 'npm' ? '项目目录' : draft.kind === 'script' ? '工作目录（默认脚本所在目录）' : '工作目录（默认程序所在目录）'}<span className="jar-path-input"><TextInput required={draft.kind === 'npm'} value={draft.workDir} onChange={e => { patch({ workDir: e.target.value, ...(draft.kind === 'npm' && { script: '' }) }); setScripts([]); }} /><button type="button" className="file-pick-button" onClick={() => setPicker('directory')}><FolderOpen size={15} />选择目录</button></span></label>}
        {draft.kind === 'npm' && supportsNodePath && <RuntimePathField key={hostId} kind="node" hostId={hostId} available={discoveryAvailable} allowControl={allowControl} value={draft.nodePath} change={nodePath => patch({ nodePath })} browse={() => setPicker('executable')} />}
        {draft.kind === 'npm' && checksAvailable && !supportsNodePath && <p className="jar-help">此主机按 PATH 选择 Node.js，升级目标主机的 DevKit 后可指定路径。</p>}
        {draft.kind === 'npm' && checksAvailable && <RuntimeProbe key={JSON.stringify([hostId, searchPath, draft.nodePath])} label="检测 Node.js 和 npm" disabled={!allowControl} check={() => jarRequest<ProbeLine[]>('detect-npm', { hostId, searchPath, nodePath: supportsNodePath ? draft.nodePath : undefined })} />}
        {draft.kind !== 'jar' && !checksAvailable && <p className="jar-help">升级目标主机的 DevKit 后即可在此表单检测。</p>}
        {draft.kind === 'npm' && <label>npm 启动脚本<span className="jar-path-input"><select required value={draft.script} onChange={e => patch({ script: e.target.value })}><option value="">选择脚本</option>{scripts.map(name => <option key={name}>{name}</option>)}</select><button type="button" className="secondary-button" disabled={!draft.workDir} onClick={() => void task(() => readScripts(draft.workDir))}>读取脚本</button></span></label>}
        {draft.kind === 'npm' && draft.script && <p className="jar-help">启动命令 <code>{draft.script === 'start' ? 'npm start' : 'npm run ' + draft.script}</code></p>}
        <div className="jar-form-grid">{draft.kind === 'jar' && <label>JVM 参数（每行一个）<TextArea rows={4} value={draft.jvm} onChange={event => patch({ jvm: event.target.value })} placeholder={'-Xms256m\n-Xmx1024m\n-Dfile.encoding=UTF-8'} /></label>}<label>应用参数（每行一个）<TextArea rows={4} value={draft.args} onChange={event => patch({ args: event.target.value })} placeholder={draft.kind === 'jar' ? '--spring.profiles.active=test\n--server.port=8080' : '--port=8080'} /></label></div>
        <p className="jar-help">每行作为一个原样参数，含空格无需额外引号。</p>
        <div className="jar-form-grid"><label>启动模式<select value={draft.logMode} onChange={event => patch({ logMode: event.target.value as JarInstance['logMode'] })}><option value="file">file · 文件日志（追加，保留历史）</option><option value="console">console · 工具内交互控制台</option><option value="silent">silent · 静默（丢弃标准输出与错误）</option></select></label><label>停止等待（秒）<input type="number" min={1} max={120} required value={draft.stopTimeout} onChange={event => patch({ stopTimeout: Number(event.target.value) })} /></label><label>PID 文件名（可选）<TextInput value={draft.pidName} onChange={event => patch({ pidName: event.target.value })} placeholder="默认：自动生成.pid" /></label><label>日志文件名（可选）<TextInput value={draft.logName} onChange={event => patch({ logName: event.target.value })} placeholder="默认：自动生成.log" /></label></div>
        <p className="jar-help">console 的标准输出仅在工具内显示，支持行输入；关闭视图不会停止应用。共享网页中的全部路径均指向主机，不是当前电脑。</p>
        <p className="jar-help">可填 app.pid / app.log 延续脚本文件名。旧脚本启动的进程请先由原脚本停止，再通过工具启动。</p>
        <JarRuntimeSettings value={runtime} onChange={setRuntime} />
      </fieldset></div>
      {error && <p className="jar-error" role="alert">{error}</p>}
      <footer><button className="text-button" type="button" disabled={busy} onClick={() => void cancel()}>取消</button><MotionButton busy={busy} className="run-button" disabled={busy} type="submit">保存服务</MotionButton></footer>
    </form>
    {picker && <HostPathPicker name={group?.name || (remoteAccess() ? '共享主机' : '本机')} systemPicker={!hostId && window.devkitJar ? () => pickSystem(picker) : undefined} kind={picker === 'directory' ? 'directory' : picker === 'jar' ? 'jar' : 'file'} request={directory => jarRequest<RemoteDirectory>('browse', { hostId, directory, kind: picker === 'directory' ? 'directory' : picker === 'jar' ? 'jar' : 'file' })} close={() => setPicker(null)} select={filename => { setPicker(null); void task(() => pickFile(picker, filename)); }} />}
  </dialog>;
}

const servicesPerPage = 20;

function JarFileLog({ service, active, auto, interval }: { service: JarInstance; active: boolean; auto: boolean; interval: number }) {
  const [log, setLog] = useState<JarLog | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const output = useRef<HTMLPreElement>(null);
  const followEnd = useRef(true);
  useLayoutEffect(() => {
    if (output.current && followEnd.current) output.current.scrollTop = output.current.scrollHeight;
  }, [log]);
  useEffect(() => {
    if (!active) return;
    let disposed = false, reading = false;
    async function load() {
      if (reading || document.hidden) return;
      reading = true;
      try {
        const result = await jarRequest<JarLog>('log-tail', { id: service.id });
        if (!disposed) { setLog(result); setError(''); }
      } catch (failure) { if (!disposed) setError((failure as Error).message); }
      finally { reading = false; }
    }
    void load();
    const timer = auto ? setInterval(() => void load(), interval * 1000) : undefined;
    return () => { disposed = true; clearInterval(timer); };
  }, [service.id, active, auto, interval, refresh]);
  return <section className="jar-log">
    <div className="jar-log-tools"><small>{service.logMode === 'silent' ? '静默模式，查看已有日志文件。' : `最近 128 KB · ${auto ? '每 ' + interval + ' 秒刷新' : '手动刷新'}`}{log?.truncated && ' · 前部已截断'}</small>
      <div className="jar-actions"><button type="button" className="text-button" onClick={() => {
        followEnd.current = true;
        if (output.current) output.current.scrollTop = output.current.scrollHeight;
      }}>回到底部</button><button type="button" className="text-button" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} />刷新日志</button></div>
    </div>
    {log?.path && <p className="jar-help">{log.path}</p>}
    {error && <p className="jar-error" role="alert">{error}</p>}
    <pre ref={output} tabIndex={0} data-modal-focus aria-label="服务日志内容" onScroll={event => {
      const el = event.currentTarget;
      followEnd.current = el.scrollHeight - el.clientHeight - el.scrollTop < 3;
    }}>{log ? log.text || '暂无日志。' : error ? '' : '正在读取日志…'}</pre>
  </section>;
}

export default function JarCenter({ active, seed, consumeSeed }: { active: boolean; seed?: ServiceDraft; consumeSeed?: () => void }) {
  const performanceMode = usePerformanceMode();
  const statusSeconds = performanceMode ? 15 : 5;
  const logSeconds = performanceMode ? 9 : 3;
  const [state, setState] = useState<JarState | null>(null), [statuses, setStatuses] = useState<JarStatus[]>([]);
  const [form, setForm] = useState<JarInstance | 'new' | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [query, setQuery] = useState('');
  const [listHost, setListHost] = useState<string | null>(null);
  const [monitorError, setMonitorError] = useState('');
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 920px)').matches);
  const workspace = useRef<HTMLElement>(null);
  const [projectService, setProjectService] = useState<JarInstance | null>(null);
  const [replacement, setReplacement] = useState<JarInstance | null>(null);
  const [startup, setStartup] = useState<JarInstance | null>(null);
  const [viewerId, setViewerId] = useState('');
  const viewerTrigger = useRef<HTMLButtonElement | null>(null);
  const [auto, setAuto] = useState(true);
  const [requestedPage, setPage] = useState(0);
  const summary = useRef<HTMLDivElement>(null);
  const polling = useRef(false), operating = useRef(false), confirm = useConfirmation();
  const operationVersion = useRef(0);
  const desktop = !!window.devkitJar, available = desktop || !!remoteAccess(), write = canWriteWorkspace('jar'), control = canOperateJar();
  const guard = useWorkspaceGuard();
  const finishCreation = useRelatedCreation('jar', active && !!state && write && !busy, () => setForm('new'));
  const [formSeed, setFormSeed] = useState<ServiceDraft>();
  useEffect(() => {
    if (active && seed && state && !form && write) {
      setFormSeed(seed);
      setForm('new');
      consumeSeed?.();
    }
  }, [active, seed, state, form, write, consumeSeed]);
  function closeForm() { setForm(null); setFormSeed(undefined); finishCreation(); }
  const readLogs = canReadWorkspaceLogs('jar');
  useEffect(() => {
    if (!workspace.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width > 0) setNarrow(width < 850);
    });
    observer.observe(workspace.current);
    return () => observer.disconnect();
  }, []);
  const resource = useWorkspaceResource('jar');
  const hostLink = resource?.startsWith('host:') ? resource.slice(5) : undefined;
  const linked = hostLink ? undefined : resource;
  useEffect(() => { if (active && hostLink) { setListHost(hostLink); setQuery(''); setPage(0); } }, [active, hostLink]);
  const linkStatus = linked && state ? inventoryLinkStatus(linked, state.instances, state.groups) : undefined;
  const linkedRow = useRef<HTMLTableRowElement>(null);
  const hosts = useHostInventory('jar', jarRequest, state, setState, setStatuses);
  async function refresh() { await hosts.inventory(); await hosts.poll(); }
  const supported = (item: JarInstance) => !item.kind || item.kind === 'jar' || (item.hostId ? targetGroup(state?.groups, item.hostId)?.backendTypes : state?.backendTypes);
  const canEdit = (item: JarInstance) => supported(item) === true && write && (targetGroup(state?.groups, item.hostId)?.edit ?? true);
  const canControl = (item: JarInstance) => supported(item) === true && control && (targetGroup(state?.groups, item.hostId)?.control ?? true);
  async function task(action: () => Promise<void>) {
    if (operating.current) return; operating.current = true; operationVersion.current++; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (failure) { setError((failure as Error).message); } finally { operating.current = false; setBusy(false); }
  }
  useEffect(() => { if (active && available) void task(refresh); }, [active, available]);
  useEffect(() => {
    if (!active || !auto || !available) return;
    let disposed = false;
    async function poll() {
      if (polling.current || operating.current || document.hidden) return;
      polling.current = true;
      const version = operationVersion.current;
      try { await hosts.poll(); if (!disposed && version === operationVersion.current) setMonitorError(''); }
      catch (failure) { if (!disposed && version === operationVersion.current) setMonitorError((failure as Error).message); }
      finally { polling.current = false; }
    }
    const timer = setInterval(() => void poll(), statusSeconds * 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [active, auto, available, statusSeconds]);
  async function command(item: JarInstance, command: JarCommand) {
    if (command !== 'start' && !await confirm({ title: `${command === 'restart' ? '重启' : command === 'force-stop' ? '强制终止' : '停止'} ${item.name}？`, slide: command === 'force-stop', detail: command === 'force-stop' ? `目标主机 ${targetGroup(state?.groups, item.hostId)?.name || (remoteAccess() ? '共享主机' : '本机')}。将强制结束进程，未完成的请求或数据可能无法保存。` : (targetGroup(state?.groups, item.hostId)?.platform ?? state?.platform) === 'win32' ? 'Windows 将终止服务进程，可能中断进行中的请求。重启会在确认进程退出后启动。' : `先发送 TERM，最多等待 ${item.stopTimeout} 秒。超时保留进程，之后可单独强制终止。`, confirm: command === 'restart' ? '重启服务' : command === 'force-stop' ? '强制终止' : '停止服务' })) return;
    await task(async () => {
      try {
        const result = await jarRequest<{ output: string; status: JarStatus }>('command', { id: item.id, command });
        setStatuses(current => [...current.filter(status => status.id !== item.id), result.status]);
        setNotice(result.output);
        if (readLogs && item.logMode === 'console' && ['start', 'restart'].includes(command)) openViewer(item.id);
      } catch (failure) {
        await refresh().catch(() => {});
        throw failure;
      }
    });
  }
  const hostOptions = state?.groups || [];
  const selectedListHost = listHost === hostLink || hostOptions.some(group => group.id === listHost) ? listHost : null;
  const filtered = state?.instances.filter(item => (selectedListHost === null || (item.hostId || '') === selectedListHost)
    && `${item.name} ${serviceLocation(item)} ${targetGroup(state.groups, item.hostId)?.name || ''}`.toLowerCase().includes(query.toLowerCase())) || [];
  const grouped = groupInstances(filtered, state?.groups).flatMap(group => group.items);
  const pages = Math.max(1, Math.ceil(grouped.length / servicesPerPage));
  const page = Math.min(requestedPage, pages - 1);
  const pageGroups = groupInstances(grouped.slice(page * servicesPerPage, (page + 1) * servicesPerPage), state?.groups);
  const viewer = state?.instances.find(item => item.id === viewerId);
  const statusById = new Map(statuses.map(status => [status.id, status]));
  const handledLink = useRef('');
  useLayoutEffect(() => {
    if (!active || !linked) { handledLink.current = ''; return; }
    if (linkStatus !== 'found' || !state || handledLink.current === linked) return;
    const index = groupInstances(state.instances, state.groups).flatMap(group => group.items).findIndex(item => item.id === linked);
    const targetPage = Math.floor(index / servicesPerPage);
    if (query || listHost !== null || page !== targetPage) {
      setQuery(''); setListHost(null); setPage(targetPage);
      return;
    }
    if (linkedRow.current) {
      const target = linkedRow.current.querySelector('[data-service-output]') ?? linkedRow.current;
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
      handledLink.current = linked;
    }
  }, [active, linked, linkStatus, state, query, listHost, page]);
  function openViewer(id: string) {
    viewerTrigger.current = workspace.current?.querySelector<HTMLButtonElement>(`[data-service-output="${CSS.escape(id)}"]`) ?? null;
    setViewerId(id);
  }
  function closeViewer() {
    setViewerId('');
    requestAnimationFrame(() => {
      const target = viewerTrigger.current;
      (target?.isConnected ? target : workspace.current?.querySelector<HTMLInputElement>('.jar-search input'))?.focus({ preventScroll: true });
    });
  }
  return <section ref={workspace} className={`jar-center${narrow ? ' jar-compact' : ''}`}>
    <header className="jar-heading workspace-banner">
      <div><h1>服务管理</h1></div>
      <button className="run-button" disabled={busy || !state || !write} onClick={() => setForm('new')}><Plus size={15} />添加服务</button>
    </header>
    {!available && <p className="jar-warning">请在桌面端或已授权的共享网页使用服务管理。</p>}
    <div className="jar-toolbar">{hostOptions.length > 1 && <label className="jar-host-filter">实例主机<select value={selectedListHost ?? "all"} onChange={event => { setListHost(event.target.value === "all" ? null : event.target.value); setPage(0); }}>
      <option value="all">全部主机</option>{hostOptions.map(host => <option key={host.id} value={host.id}>{hostRole(host)}</option>)}
    </select></label>}<label className="jar-search"><Search size={16} /><TextInput embedded aria-label="搜索服务" placeholder="搜索名称或路径" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label><div className="jar-actions"><label className="jar-auto"><input role="switch" className="liquid-toggle" type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)} />自动刷新</label><MotionButton busy={busy} className="text-button" disabled={busy || !available} onClick={() => void task(refresh)}><RefreshCw size={15} />刷新</MotionButton></div></div>
    {error && <p className="jar-error" role="alert">{error}</p>}{notice && <p className="jar-notice" role="status">{notice}</p>}
    {monitorError && <p className="jar-warning" role="alert">状态刷新失败，以下显示上次结果：{monitorError}</p>}
    <HostProgress groups={state?.groups} retry={id => void hosts.retry(id)} />
    {hostLink && state && !hostOptions.some(host => host.id === hostLink) && <p className="pc-notice" role="status">{missingResourceLink('主机')}</p>}
    {linkStatus === 'missing' && <p className="pc-notice" role="status">{missingResourceLink('应用服务')}</p>}
    {linkStatus === 'failed' && <p className="pc-notice" role="status">无法读取链接中的应用服务，请重试连接目标主机。</p>}
    {desktop && state && <LegacySshImport module="jar" groups={state.groups} disabled={busy} refresh={() => void task(refresh)} />}
    <div className="jar-summary" ref={summary}><strong>{state?.instances.length || 0}</strong> 个应用<span>运行中 {statuses.filter(item => item.state === 'running').length}</span><span>已退出 {statuses.filter(item => item.state === 'exited').length}</span><small>{auto ? `状态每 ${statusSeconds} 秒刷新` : '自动刷新已关闭'} · CPU 为采样间隔占用，可超过 100%</small></div>
    {!state && available && !error && <Skeleton kind="list" label="正在读取服务列表…" />}
    {state && !state.instances.length && <div className="jar-empty"><ServerCog size={35} /><h2>添加第一个应用服务</h2><p>选择主机和启动方式，登记服务后即可启动并查看状态。</p><button className="secondary-button" disabled={!write} onClick={() => setForm('new')}><Plus size={15} />登记服务</button></div>}
    {!!state?.instances.length && !filtered.length && <p className="jar-help">没有匹配的服务。</p>}
    <ResultPager label="服务列表分页" page={page} pages={pages} onPage={next => {
      setPage(next);
      summary.current?.scrollIntoView({ block: 'nearest' });
    }} />
    {!!filtered.length && <div className="jar-table-scroll"><table className="jar-table" aria-label="应用服务"><thead><tr><th>应用 / 文件</th><th>健康与运行</th><th>运行时间 / PID</th><th>内存 / CPU</th><th>操作</th></tr></thead>{pageGroups.filter(group => group.items.length).map(group => <tbody key={group.id}><tr className="jar-host-group"><th colSpan={5} scope="rowgroup">{group.id ? <RelatedLink page="lan-hosts" id={group.id}>{hostRole(group)}</RelatedLink> : hostRole(group)}<small> · {hostAccessLabel(group)}</small></th></tr>{group.items.map(item => {
      const write = canEdit(item), control = canControl(item);
      const status = statusById.get(item.id), running = status?.state === 'running', stopped = status && ['stopped', 'exited'].includes(status.state), supervised = status?.supervision?.active;
      const hostName = targetGroup(state?.groups, item.hostId)?.name || (remoteAccess() ? '共享主机' : '本机');
      const extraActions = <>
          {(!remoteAccess() || remoteAccess()?.services?.projects.enabled) && <button className="text-button" onClick={() => setProjectService(item)}>关联项目</button>}
          <RelatedLink page="monitor" id={`source:jar:${item.id}`}>关联监控</RelatedLink>
          <button className="text-button" disabled={busy || !control || (!running && !supervised)} onClick={() => void command(item, 'restart')}><RefreshCw size={14} />重启</button>
          <button className="text-button" disabled={busy || !write} onClick={() => setForm(item)}><Settings2 size={14} />设置</button>
          <button className="text-button" disabled={busy} onClick={() => setStartup(item)}><Play size={14} />系统自启</button>
          <button className="text-button jar-danger" disabled={busy || !write || !stopped || supervised} onClick={() => void (async () => { if (await confirm({ title: `移除 ${item.name}？`, detail: `目标主机 ${hostName}。只移除列表记录，保留服务文件、日志与运行文件。移除前需关闭系统自启。`, confirm: '移除记录' })) await task(async () => { await jarRequest<JarState>('remove', { id: item.id, revision: targetGroup(state?.groups, item.hostId)?.revision ?? state?.revision }); if (viewerId === item.id) setViewerId(''); await refresh(); }); })()}><Trash2 size={14} />移除</button>
      </>;
      return <tr key={item.id} ref={linked === item.id ? linkedRow : undefined} data-linked={linked === item.id || undefined} className="jar-instance">
        <td><div className="jar-instance-title"><strong>{item.name}</strong><span className={`jar-status ${status?.state || ''}`}>{status ? labels[status.state] : '待检测'}</span></div><small className="jar-target">目标主机 {hostName}</small><span title={serviceLocation(item)}>{item.kind === 'npm' ? 'npm · ' + item.script : item.kind === 'script' ? '解释器脚本' : item.kind === 'program' ? '可执行程序' : 'Java JAR'} · {basename(serviceLocation(item))}</span><small className="jar-full-path">{serviceLocation(item)}</small><small>{bytes(status?.size)} · {item.logMode === 'file' ? '文件日志' : item.logMode === 'console' ? '控制台模式' : '静默模式'}{status?.fileMissing ? ' · 服务入口缺失' : ''}</small><small>环境：{item.profiles.find(profile => profile.id === item.profile)?.name || '公共变量'}</small></td>
        <td>
          {status?.health && <small className={`jar-health ${status.health.state}`} title={status.health.detail}>业务：{healthLabels[status.health.state]}{status.health.latency !== undefined ? ` · ${status.health.latency} ms` : ''}</small>}
          {supervised && <small>{supervisionLabels[status.supervision!.state] || status.supervision!.state} · 重试 {status.supervision!.attempts}/{item.restart.maxRetries}</small>}
          {status?.supervision?.nextRetryAt && <small>下次：{new Date(status.supervision.nextRetryAt).toLocaleTimeString()}</small>}
          <small className="jar-status-detail">{status?.detail}</small><small>{status ? `检测于 ${new Date(status.checkedAt).toLocaleTimeString()}` : ''}</small>
        </td>
        <td><span>{duration(status?.uptime)}</span><small>{running ? `PID ${status.pid}` : '—'}</small></td>
        <td><span>{bytes(status?.memory)}</span><small>CPU {status?.cpu === undefined ? '—' : `${status.cpu.toFixed(1)}%`}</small></td>
        <td><div className="jar-row-actions">
          <button className="text-button" disabled={busy || !control || !stopped || status.fileMissing} onClick={() => void command(item, 'start')}><Play size={14} />启动</button>
          <button className="text-button" disabled={busy || !control || (!running && !supervised && !status?.canStopGroup)} onClick={() => void command(item, 'stop')}><Square size={14} />停止</button>
          {item.kind !== 'npm' && (item.hostId ? group.fileReplacement : state?.fileReplacement) && <button className="text-button" disabled={busy || !write || !control} onClick={() => setReplacement(item)}><Upload size={14} />替换服务文件</button>}
          {readLogs && <button className="text-button" disabled={busy} data-service-output={item.id} aria-haspopup="dialog" onClick={() => openViewer(item.id)}><FileText size={14} />{item.logMode === 'console' ? '控制台' : '日志'}</button>}
          {item.logMode !== 'silent' && <button className="text-button" onClick={() => guard('logs', 'jar') && openWorkspaceLink('logs', `instance:${item.id}`)}>日志中心</button>}
        </div><FloatingDetails className="jar-advanced"><summary>更多操作与运行详情</summary>{narrow && <><p>{serviceLocation(item)}</p><p>运行 {duration(status?.uptime)} · PID {status?.pid ?? '—'} · 内存 {bytes(status?.memory)} · CPU {status?.cpu === undefined ? '—' : `${status.cpu.toFixed(1)}%`}</p></>}<div className="jar-row-actions">{extraActions}</div><p>启动程序：{item.kind === 'npm' ? (item.nodePath ? 'npm · ' + item.nodePath : 'npm · 按 PATH 选择 Node.js') : item.program || status?.executable || item.executable || '自动检测'}</p>{item.kind && status?.businessPid && <p>入口进程 PID：{status.businessPid} · 资源统计取自此进程</p>}<p>PID 文件：{status?.pidPath}</p><p>日志：{status?.logPath}</p><p>健康：{status?.health?.detail || '未配置'}{status?.health?.checkedAt ? ` · ${new Date(status.health.checkedAt).toLocaleTimeString()}` : ''}</p>
          {!write && control && (!item.kind || item.kind === 'jar') && <JavaProbe key={item.executable} hostId={item.hostId || ''} executable={item.executable} disabled={busy} />}
          {status?.supervision?.lastError && <p className="jar-error">{status.supervision.lastError}</p>}{status?.supervision?.logError && <p className="jar-error">日志写入失败：{status.supervision.logError}</p>}
          <button className="text-button" disabled={busy || !control || !running || item.health.type === 'none'} onClick={() => void task(async () => { await jarRequest('health-check', { id: item.id }); await refresh(); })}>立即检查健康</button>
          <button className="text-button jar-danger" disabled={busy || !control || (!running && !supervised && !status?.canStopGroup)} onClick={() => void command(item, 'force-stop')}>强制终止</button>
          <RelatedLink page="knowledge" id={`related:jar:${item.id}`}>关联手册</RelatedLink>
          <ResourceLink page="jar" id={item.id} />
        </FloatingDetails></td>
      </tr>;
    })}</tbody>)}</table></div>}
    {readLogs && viewer && <Modal key={viewer.id} active={active} wide className="jar-output-dialog"
      title={viewer.name + (viewer.logMode === 'console' ? ' · 控制台' : ' · 日志')}
      description={targetGroup(state?.groups, viewer.hostId)?.name || (remoteAccess() ? '共享主机' : '本机')}
      closeLabel={viewer.logMode === 'console' ? '关闭控制台' : '关闭日志'} close={closeViewer}>
      {viewer.logMode === 'console' ? <>
        {error && <p className="jar-error" role="alert">{error}</p>}
        <JarConsole id={viewer.id} name={viewer.name} control={canControl(viewer)} active={active} stop={() => void command(viewer, 'stop')} />
      </> : <JarFileLog service={viewer} active={active} auto={auto} interval={logSeconds} />}
    </Modal>}
    <p className="jar-help jar-footer">路径、进程和文件均属于各应用登记的主机。关闭控制台或网页后，服务会继续运行。只读访客无法查看环境变量值和启动参数。</p>
    {form && state && <JarForm active={active} seed={formSeed} instance={form === 'new' ? undefined : form} state={state} close={closeForm} saved={() => { closeForm(); void task(refresh); }} />}
    {projectService && <ServiceProjects service={projectService} close={() => setProjectService(null)} />}
    {replacement && <JarReplaceDialog item={replacement} canRestore={!!(replacement.hostId ? targetGroup(state?.groups, replacement.hostId)?.backupRestore : state?.backupRestore)} host={targetGroup(state?.groups, replacement.hostId)?.name || (remoteAccess() ? '共享主机' : '本机')} close={() => { setReplacement(null); void task(refresh); }} />}
    {startup && <JarStartupDialog item={startup} control={canControl(startup)} platform={targetGroup(state?.groups, startup.hostId)?.platform ?? state?.platform ?? ''} close={() => setStartup(null)} />}
  </section>;
}
