import Skeleton from './Skeleton';
import { useEffect, useId, useRef, useState } from 'react';
import { Coffee, Plus, RefreshCw, Play, Square, Settings2, Trash2, FileText, FolderOpen, X, Search } from 'lucide-react';
import { MotionButton } from './Motion';
import { useBeforeUnload, useConfirmation } from './Confirmation';
import { jarRequest } from './jar-api';
import JarRuntimeSettings, { runtimeDraft, runtimePayload } from './JarRuntimeSettings';
import JarStartupDialog from './JarStartupDialog';
import JarConsole from './JarConsole';
import ConfigFilesDialog from './ConfigFilesDialog';
import HostPathPicker, { HostSelect } from './HostPathPicker';
import LegacySshImport from './LegacySshImport';
import { groupInstances, targetGroup, hostAccessLabel, hostRole } from './lan-api';
import type { RemoteDirectory } from './lan-api';
import { usePerformanceMode } from './DisplayMode';
import { HostProgress, useHostInventory } from './HostInventory';
import { CreateRelated, RelatedLink, useRelatedCreation, useWorkspaceGuard } from './related-workspaces';
import { inventoryLinkStatus, missingResourceLink, openWorkspaceLink, ResourceLink, useWorkspaceResource } from './workspace-links';
import { canWriteWorkspace, canOperateJar, canReadWorkspaceLogs, remoteAccess } from './workspace-remote';
import type { JarInstance, JarState, JarStatus, JavaDetection, JarLog, JarCommand } from './jar-api';
import './jar.css';

const basename = (value: string) => value.split(/[\\/]/).pop() || value;
const bytes = (value?: number) => value === undefined ? '—' : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
const duration = (value?: number) => value === undefined ? '—' : `${Math.floor(value / 3600)}时 ${Math.floor(value % 3600 / 60)}分 ${Math.floor(value % 60)}秒`;
const labels = { running: '运行中', stopped: '已停止', exited: '已退出', unknown: '待核实' };
const healthLabels = { disabled: '未检测', unknown: '待检测', starting: '启动宽限中', stopped: '未运行', healthy: '健康', degraded: '检测波动', unhealthy: '不健康' };
const supervisionLabels: Record<string, string> = { starting: '正在启动', running: '独立守护中', backoff: '等待重试', exhausted: '重试已达上限', exited: '进程已退出', blocked: '需要处理', stopping: '正在停止' };

function JarForm({ active, instance, state, close, saved }: { active: boolean; instance?: JarInstance; state: JarState; close: () => void; saved: () => void }) {
  const initial = { name: instance?.name || '', jar: instance?.jar || '', executable: instance?.executable || '', jvm: instance?.jvmArgs.join('\n') || '', args: instance?.appArgs.join('\n') || '', pidName: instance?.pidName || '', logName: instance?.logName || '', logMode: instance?.logMode || 'file', stopTimeout: instance?.stopTimeout || 15 };
  const initialRuntime = useRef(runtimeDraft(instance));
  const [runtime, setRuntime] = useState(initialRuntime.current);
  const [draft, setDraft] = useState(initial), baseline = useRef(JSON.stringify([initial, initialRuntime.current]));
  const [hostId, setHostId] = useState(instance?.hostId || ''), [picker, setPicker] = useState<'jar' | 'executable' | null>(null);
  const group = targetGroup(state.groups, hostId), allowControl = group?.control ?? canOperateJar();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [java, setJava] = useState<JavaDetection | null>(null);
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
    if (!dirty || await confirm({ title: '放弃 JAR 设置修改？', detail: '尚未保存的显示名称、路径和启动参数将被放弃。', confirm: '放弃修改' })) close();
  }
  function pickFile(kind: 'jar' | 'executable', filename: string) {
    if (kind === 'jar') {
      const stem = basename(filename).replace(/\.jar$/i, '');
      patch({ jar: filename, ...(!draft.name ? { name: stem } : {}) });
    } else { patch({ executable: filename }); setJava(null); }
  }
  function pick(kind: 'jar' | 'executable') {
    if (hostId) { setPicker(kind); return; }
    void task(async () => { const files = await jarRequest<string[]>('pick', { kind }); if (files[0]) pickFile(kind, files[0]); });
  }
  return <dialog ref={dialog} className="jar-dialog" aria-labelledby={heading} onCancel={event => { event.preventDefault(); void cancel(); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void cancel(); } }}>
    <header><h2 id={heading}>{instance ? '编辑 JAR' : '添加 JAR'}</h2><button className="icon-button" aria-label="关闭 JAR 设置" disabled={busy} onClick={() => void cancel()}><X size={18} /></button></header>
    <form onSubmit={event => { event.preventDefault(); void task(async () => {
      await jarRequest<JarState>('upsert', { hostId, revision: group?.revision ?? state.revision, instance: { ...instance, ...runtimePayload(runtime), name: draft.name, jar: draft.jar, executable: draft.executable, jvmArgs: draft.jvm.split(/\r?\n/).filter(Boolean), appArgs: draft.args.split(/\r?\n/).filter(Boolean), pidName: draft.pidName, logName: draft.logName, logMode: draft.logMode, stopTimeout: Number(draft.stopTimeout) } });
      baseline.current = JSON.stringify([draft, runtime]); saved();
    }); }}>
      <fieldset disabled={busy}>
        <HostSelect module="jar" groups={state.groups} id={hostId} locked={!!instance} change={id => { setHostId(id); patch({ jar: '', executable: '' }); setJava(null); }} />
        <label>显示名称<input required maxLength={120} value={draft.name} onChange={event => patch({ name: event.target.value })} placeholder="例如：订单服务 · 测试环境" /></label>
        <label>JAR 文件绝对路径<span className="jar-path-input"><input required value={draft.jar} onChange={event => patch({ jar: event.target.value })} onBlur={() => { if (!draft.name && draft.jar) patch({ name: basename(draft.jar).replace(/\.jar$/i, '') }); }} placeholder={hostId || !window.devkitJar ? '填写目标主机上的绝对路径' : '选择已有 .jar 文件'} /><button className="secondary-button" type="button" disabled={!hostId && !window.devkitJar} onClick={() => pick('jar')}><FolderOpen size={15} />选择文件</button></span></label>
        <p className="jar-help">自动获取目录和文件名；工作目录、日志与 PID 都在 JAR 同级。每个文件仅登记一次。</p>
        <label>Java 程序路径（可选）<span className="jar-path-input"><input value={draft.executable} onChange={event => { patch({ executable: event.target.value }); setJava(null); }} placeholder="留空：检测 JAVA_HOME 和 PATH" /><button className="secondary-button" type="button" disabled={!hostId && !window.devkitJar} onClick={() => pick('executable')}>选择 Java</button></span></label>
        <button className="text-button" type="button" disabled={!allowControl} onClick={() => void task(async () => setJava(await jarRequest<JavaDetection>('detect', { hostId, executable: draft.executable })))}>检测此 Java</button>
        {java && <p className={java.found ? 'jar-help' : 'jar-error'}>{java.found ? `${java.version} · ${java.executable}` : java.output}</p>}
        <div className="jar-form-grid"><label>JVM 参数（每行一个）<textarea rows={4} value={draft.jvm} onChange={event => patch({ jvm: event.target.value })} placeholder={'-Xms256m\n-Xmx1024m\n-Dfile.encoding=UTF-8'} /></label><label>应用参数（每行一个）<textarea rows={4} value={draft.args} onChange={event => patch({ args: event.target.value })} placeholder={'--spring.profiles.active=test\n--server.port=8080'} /></label></div>
        <p className="jar-help">每行作为一个原样参数，含空格无需额外引号。不填 java、-jar 或 JAR 文件名。</p>
        <div className="jar-form-grid"><label>启动模式<select value={draft.logMode} onChange={event => patch({ logMode: event.target.value as JarInstance['logMode'] })}><option value="file">file · 文件日志（追加，保留历史）</option><option value="console">console · 工具内交互控制台</option><option value="silent">silent · 静默（丢弃标准输出与错误）</option></select></label><label>停止等待（秒）<input type="number" min={1} max={120} required value={draft.stopTimeout} onChange={event => patch({ stopTimeout: Number(event.target.value) })} /></label><label>PID 文件名（可选）<input value={draft.pidName} onChange={event => patch({ pidName: event.target.value })} placeholder="默认：JAR 名.pid" /></label><label>日志文件名（可选）<input value={draft.logName} onChange={event => patch({ logName: event.target.value })} placeholder="默认：JAR 名.log" /></label></div>
        <p className="jar-help">console 的标准输出仅在工具内显示，支持行输入；关闭视图不会停止应用。共享网页中的全部路径均指向主机，不是当前电脑。</p>
        <p className="jar-help">可填 app.pid / app.log 延续脚本文件名。旧脚本启动的进程请先由原脚本停止，再通过工具启动。</p>
        <JarRuntimeSettings value={runtime} onChange={setRuntime} />
      </fieldset>
      {error && <p className="jar-error" role="alert">{error}</p>}
      <footer><button className="text-button" type="button" disabled={busy} onClick={() => void cancel()}>取消</button><MotionButton busy={busy} className="run-button" disabled={busy} type="submit">保存 JAR</MotionButton></footer>
    </form>
    {picker && <HostPathPicker name={group?.name || ''} kind={picker === 'jar' ? 'jar' : 'file'} request={directory => jarRequest<RemoteDirectory>('browse', { hostId, directory, kind: picker === 'jar' ? 'jar' : 'file' })} close={() => setPicker(null)} select={filename => { pickFile(picker, filename); setPicker(null); }} />}
  </dialog>;
}

export default function JarCenter({ active }: { active: boolean }) {
  const performanceMode = usePerformanceMode();
  const statusSeconds = performanceMode ? 15 : 5;
  const logSeconds = performanceMode ? 9 : 3;
  const [state, setState] = useState<JarState | null>(null), [statuses, setStatuses] = useState<JarStatus[]>([]);
  const [form, setForm] = useState<JarInstance | 'new' | null>(null), [java, setJava] = useState<JavaDetection | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [query, setQuery] = useState('');
  const [listHost, setListHost] = useState<string | null>(null);
  const [monitorError, setMonitorError] = useState('');
  const [javaHost, setJavaHost] = useState('');
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 920px)').matches);
  const workspace = useRef<HTMLElement>(null);
  const [startup, setStartup] = useState<JarInstance | null>(null);
  const [config, setConfig] = useState<JarInstance | null>(null);
  const [consoleId, setConsoleId] = useState('');
  const [auto, setAuto] = useState(true), [logId, setLogId] = useState(''), [log, setLog] = useState<JarLog | null>(null), [logError, setLogError] = useState('');
  const polling = useRef(false), operating = useRef(false), confirm = useConfirmation();
  const operationVersion = useRef(0);
  const desktop = !!window.devkitJar, available = desktop || !!remoteAccess(), write = canWriteWorkspace('jar'), control = canOperateJar();
  const guard = useWorkspaceGuard();
  const finishCreation = useRelatedCreation('jar', active && !!state && write && !busy, () => setForm('new'));
  function closeForm() { setForm(null); finishCreation(); }
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
  const javaTarget = targetGroup(state?.groups, javaHost);
  const resource = useWorkspaceResource('jar');
  const hostLink = resource?.startsWith('host:') ? resource.slice(5) : undefined;
  const linked = hostLink ? undefined : resource;
  useEffect(() => { if (active && hostLink) { setListHost(hostLink); setQuery(''); } }, [active, hostLink]);
  const linkStatus = linked && state ? inventoryLinkStatus(linked, state.instances, state.groups) : undefined;
  const linkedRow = useRef<HTMLTableRowElement>(null);
  useEffect(() => { if (active && linkStatus === 'found') { setQuery(''); setListHost(null); } }, [active, linked, linkStatus]);
  useEffect(() => { if (active && linkStatus === 'found' && !query) linkedRow.current?.scrollIntoView({ block: 'center' }); }, [active, linked, linkStatus, query]);
  const hosts = useHostInventory('jar', jarRequest, state, setState, setStatuses);
  async function refresh() { await hosts.inventory(); await hosts.poll(); }
  const canEdit = (item: JarInstance) => write && (targetGroup(state?.groups, item.hostId)?.edit ?? true);
  const canControl = (item: JarInstance) => control && (targetGroup(state?.groups, item.hostId)?.control ?? true);
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
  useEffect(() => {
    if (!logId || !active || !available || !readLogs) return;
    let disposed = false, reading = false;
    async function load() {
      if (reading || document.hidden) return; reading = true;
      try { const result = await jarRequest<JarLog>('log-tail', { id: logId }); if (!disposed) { setLog(result); setLogError(''); } }
      catch (failure) { if (!disposed) setLogError((failure as Error).message); }
      finally { reading = false; }
    }
    void load(); const timer = auto ? setInterval(() => void load(), logSeconds * 1000) : undefined;
    return () => { disposed = true; clearInterval(timer); };
  }, [logId, active, auto, available, readLogs, logSeconds]);
  async function command(item: JarInstance, command: JarCommand) {
    if (command !== 'start' && !await confirm({ title: `${command === 'restart' ? '重启' : command === 'force-stop' ? '强制终止' : '停止'} ${item.name}？`, slide: command === 'force-stop', detail: command === 'force-stop' ? `目标主机 ${targetGroup(state?.groups, item.hostId)?.name || (remoteAccess() ? '共享主机' : '本机')}。将强制结束进程，未完成的请求或数据可能无法保存。` : (targetGroup(state?.groups, item.hostId)?.platform ?? state?.platform) === 'win32' ? 'Windows 将终止 Java 进程，无法保证 JVM 关闭钩子执行。重启会在确认进程退出后启动。' : `先发送 TERM，最多等待 ${item.stopTimeout} 秒。超时保留进程，之后可单独强制终止。`, confirm: command === 'restart' ? '重启 JAR' : command === 'force-stop' ? '强制终止' : '停止 JAR' })) return;
    await task(async () => {
      try {
        const result = await jarRequest<{ output: string; status: JarStatus }>('command', { id: item.id, command });
        setStatuses(current => [...current.filter(status => status.id !== item.id), result.status]);
        setNotice(result.output);
        if (readLogs && item.logMode === 'console' && ['start', 'restart'].includes(command)) setConsoleId(item.id);
      } catch (failure) {
        await refresh().catch(() => {});
        throw failure;
      }
    });
  }
  const hostOptions = state?.groups || [];
  const selectedListHost = listHost === hostLink || hostOptions.some(group => group.id === listHost) ? listHost : null;
  const filtered = state?.instances.filter(item => (selectedListHost === null || (item.hostId || '') === selectedListHost)
    && `${item.name} ${item.jar} ${targetGroup(state.groups, item.hostId)?.name || ''}`.toLowerCase().includes(query.toLowerCase())) || [];
  const consoleItem = state?.instances.find(item => item.id === consoleId);
  return <section ref={workspace} className={`jar-center${narrow ? ' jar-compact' : ''}`}>
    <header className="jar-heading workspace-banner"><div><span className="jar-eyebrow"><Coffee size={17} />Java 应用</span><h1>JAR 管理</h1><p>按主机管理 Java 应用，随时查看进程、资源、日志与控制台。</p></div><div className="jar-actions"><label className="jar-java-target">Java 检测主机<select disabled={busy || !state} value={javaHost} onChange={event => { setJavaHost(event.target.value); setJava(null); }}>{(state?.groups || []).map(group => <option key={group.id} value={group.id}>{hostRole(group)}{!group.control ? `（${group.error ? '连接不可用' : '无运行权限'}）` : ''}</option>)}</select></label>{javaHost && <RelatedLink page="lan-hosts" id={javaHost}>查看检测主机</RelatedLink>}<CreateRelated from="jar" page="lan-hosts">登记检测主机</CreateRelated><MotionButton busy={busy} className="secondary-button" disabled={busy || !available || !control || !javaTarget?.control} onClick={() => void task(async () => setJava(await jarRequest<JavaDetection>('detect', { hostId: javaHost })))}><Coffee size={15} />检测 Java</MotionButton><button className="run-button" disabled={busy || !state || !write} onClick={() => setForm('new')}><Plus size={15} />添加 JAR</button></div></header>
    {!available && <p className="jar-warning">请在桌面端或已授权的共享网页使用 JAR 管理。</p>}
    {java && <div className={java.found ? 'jar-java' : 'jar-warning'}><strong>{javaTarget ? hostRole(javaTarget) + ' · ' : ''}{java.found ? java.version : '未检测到 Java'}</strong><p>{java.found ? java.executable : java.output}</p></div>}
    <div className="jar-toolbar">{hostOptions.length > 1 && <label className="jar-java-target">实例主机<select value={selectedListHost ?? "all"} onChange={event => setListHost(event.target.value === "all" ? null : event.target.value)}>
      <option value="all">全部主机</option>{hostOptions.map(host => <option key={host.id} value={host.id}>{hostRole(host)}</option>)}
    </select></label>}<label className="jar-search"><Search size={16} /><input aria-label="搜索 JAR" placeholder="搜索名称或路径" value={query} onChange={event => setQuery(event.target.value)} /></label><div className="jar-actions"><label className="jar-auto"><input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)} />自动刷新</label><MotionButton busy={busy} className="text-button" disabled={busy || !available} onClick={() => void task(async () => { await refresh(); if (readLogs && logId) setLog(await jarRequest<JarLog>('log-tail', { id: logId })); })}><RefreshCw size={15} />刷新</MotionButton></div></div>
    {error && <p className="jar-error" role="alert">{error}</p>}{notice && <p className="jar-notice" role="status">{notice}</p>}
    {monitorError && <p className="jar-warning" role="alert">状态刷新失败，以下显示上次结果：{monitorError}</p>}
    <HostProgress groups={state?.groups} retry={id => void hosts.retry(id)} />
    {hostLink && state && !hostOptions.some(host => host.id === hostLink) && <p className="pc-notice" role="status">{missingResourceLink('主机')}</p>}
    {linkStatus === 'missing' && <p className="pc-notice" role="status">{missingResourceLink(' JAR 实例')}</p>}
    {linkStatus === 'failed' && <p className="pc-notice" role="status">无法读取链接中的 JAR 实例，请重试连接目标主机。</p>}
    {desktop && state && <LegacySshImport module="jar" groups={state.groups} disabled={busy} refresh={() => void task(refresh)} />}
    <div className="jar-summary"><strong>{state?.instances.length || 0}</strong> 个应用<span>运行中 {statuses.filter(item => item.state === 'running').length}</span><span>已退出 {statuses.filter(item => item.state === 'exited').length}</span><small>{auto ? `状态每 ${statusSeconds} 秒刷新` : '自动刷新已关闭'} · CPU 为采样间隔占用，可超过 100%</small></div>
    {!state && available && !error && <Skeleton kind="list" label="正在读取 JAR 列表…" />}
    {state && !state.instances.length && <div className="jar-empty"><Coffee size={35} /><h2>添加第一个 Java 应用</h2><p>选择 JAR 文件，起一个方便辨认的名字，即可启动并查看状态。</p><button className="secondary-button" disabled={!write} onClick={() => setForm('new')}><Plus size={15} />选择 JAR 文件</button></div>}
    {!!state?.instances.length && !filtered.length && <p className="jar-help">没有匹配的 JAR。</p>}
    {!!filtered.length && <div className="jar-table-scroll"><table className="jar-table" aria-label="JAR 应用"><thead><tr><th>应用 / 文件</th><th>健康与运行</th><th>运行时间 / PID</th><th>内存 / CPU</th><th>操作</th></tr></thead>{groupInstances(filtered, state?.groups).filter(group => group.items.length).map(group => <tbody key={group.id}><tr className="jar-host-group"><th colSpan={5} scope="rowgroup">{group.id ? <RelatedLink page="lan-hosts" id={group.id}>{hostRole(group)}</RelatedLink> : hostRole(group)}<small> · {hostAccessLabel(group)}</small></th></tr>{group.items.map(item => {
      const write = canEdit(item), control = canControl(item);
      const status = statuses.find(status => status.id === item.id), running = status?.state === 'running', stopped = status && ['stopped', 'exited'].includes(status.state), supervised = status?.supervision?.active;
      const hostName = targetGroup(state?.groups, item.hostId)?.name || (remoteAccess() ? '共享主机' : '本机');
      const extraActions = <>
          <RelatedLink page="monitor" id={`source:jar:${item.id}`}>关联监控</RelatedLink>
          <button className="text-button" disabled={busy || !control || (!running && !supervised)} onClick={() => void command(item, 'restart')}><RefreshCw size={14} />重启</button>
          <button className="text-button" disabled={busy || !write} onClick={() => setForm(item)}><Settings2 size={14} />设置</button>
          {write && <button className="text-button" disabled={busy} onClick={() => setConfig(item)}><FileText size={14} />配置文件</button>}
          <button className="text-button" disabled={busy} onClick={() => setStartup(item)}><Play size={14} />系统自启</button>
          <button className="text-button jar-danger" disabled={busy || !write || !stopped || supervised} onClick={() => void (async () => { if (await confirm({ title: `移除 ${item.name}？`, detail: `目标主机 ${hostName}。只移除列表记录，保留 JAR、日志与运行文件。移除前需关闭系统自启。`, confirm: '移除记录' })) await task(async () => { await jarRequest<JarState>('remove', { id: item.id, revision: targetGroup(state?.groups, item.hostId)?.revision ?? state?.revision }); if (logId === item.id) setLogId(''); await refresh(); }); })()}><Trash2 size={14} />移除</button>
      </>;
      return <tr key={item.id} ref={linked === item.id ? linkedRow : undefined} data-linked={linked === item.id || undefined} className="jar-instance">
        <td><div className="jar-instance-title"><strong>{item.name}</strong><span className={`jar-status ${status?.state || ''}`}>{status ? labels[status.state] : '待检测'}</span></div><small className="jar-target">目标主机 {hostName}</small><span title={item.jar}>{basename(item.jar)}</span><small className="jar-full-path">{item.jar}</small><small>{bytes(status?.size)} · {item.logMode === 'file' ? '文件日志' : item.logMode === 'console' ? '控制台模式' : '静默模式'}{status?.fileMissing ? ' · JAR 文件缺失' : ''}</small><small>环境：{item.profiles.find(profile => profile.id === item.profile)?.name || '公共变量'}</small></td>
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
          <button className="text-button" disabled={busy || !control || (!running && !supervised)} onClick={() => void command(item, 'stop')}><Square size={14} />停止</button>
          {readLogs && <button className="text-button" disabled={busy} onClick={() => { if (item.logMode === 'console') setConsoleId(consoleId === item.id ? '' : item.id); else { setLog(null); setLogError(''); setLogId(logId === item.id ? '' : item.id); } }}><FileText size={14} />{item.logMode === 'console' ? '控制台' : '日志'}</button>}
          {item.logMode !== 'silent' && <button className="text-button" onClick={() => guard('logs', 'jar') && openWorkspaceLink('logs', `instance:${item.id}`)}>日志中心</button>}
        </div><details className="jar-advanced"><summary>更多操作与运行详情</summary>{narrow && <><p>{item.jar}</p><p>运行 {duration(status?.uptime)} · PID {status?.pid ?? '—'} · 内存 {bytes(status?.memory)} · CPU {status?.cpu === undefined ? '—' : `${status.cpu.toFixed(1)}%`}</p></>}<div className="jar-row-actions">{extraActions}</div><p>Java：{status?.executable || item.executable || '自动检测'}</p><p>PID 文件：{status?.pidPath}</p><p>日志：{status?.logPath}</p><p>健康：{status?.health?.detail || '未配置'}{status?.health?.checkedAt ? ` · ${new Date(status.health.checkedAt).toLocaleTimeString()}` : ''}</p>
          {status?.supervision?.lastError && <p className="jar-error">{status.supervision.lastError}</p>}{status?.supervision?.logError && <p className="jar-error">日志写入失败：{status.supervision.logError}</p>}
          <button className="text-button" disabled={busy || !control || !running || item.health.type === 'none'} onClick={() => void task(async () => { await jarRequest('health-check', { id: item.id }); await refresh(); })}>立即检查健康</button>
          <button className="text-button jar-danger" disabled={busy || !control || (!running && !supervised)} onClick={() => void command(item, 'force-stop')}>强制终止</button>
          <ResourceLink page="jar" id={item.id} />
        </details></td>
      </tr>;
    })}</tbody>)}</table></div>}
    {readLogs && logId && <section className="jar-log"><header><div><h2>{state?.instances.find(item => item.id === logId)?.name} · 日志</h2><p>{log?.path}</p></div><button className="icon-button" aria-label="关闭日志" onClick={() => setLogId('')}><X size={17} /></button></header><p className="jar-help">{state?.instances.find(item => item.id === logId)?.logMode === 'silent' ? '静默模式不会写入标准输出；已有文件可能是历史日志。' : `显示最近 128 KB，自动刷新开启时每 ${logSeconds} 秒重新读取。`} {log?.truncated ? '前部内容已截断。' : ''}</p>{logError && <p className="jar-error" role="alert">{logError}</p>}<pre tabIndex={0} aria-label="JAR 日志内容">{log ? log.text || '暂无日志。' : '正在读取日志…'}</pre></section>}
    {readLogs && consoleItem && <JarConsole key={consoleId} id={consoleId} name={consoleItem.name} control={canControl(consoleItem)} active={active} close={() => setConsoleId('')} stop={() => void command(consoleItem, 'stop')} />}
    <p className="jar-help jar-footer">路径、进程和文件均属于各应用登记的主机。关闭控制台或网页后，JAR 会继续运行。只读访客无法查看环境变量值和启动参数。</p>
    {form && state && <JarForm active={active} instance={form === 'new' ? undefined : form} state={state} close={closeForm} saved={() => { closeForm(); void task(refresh); }} />}
    {startup && <JarStartupDialog item={startup} control={canControl(startup)} platform={targetGroup(state?.groups, startup.hostId)?.platform ?? state?.platform ?? ''} close={() => setStartup(null)} />}
    {config && <ConfigFilesDialog item={{ ...config, path: config.jar }} editable={write} close={() => setConfig(null)} />}
  </section>;
}
