import { useEffect, useId, useRef, useState } from 'react';
import { Coffee, Plus, RefreshCw, Play, Square, Settings2, Trash2, FileText, FolderOpen, X, Search } from 'lucide-react';
import { MotionButton } from './Motion';
import { useBeforeUnload, useConfirmation } from './Confirmation';
import { jarRequest } from './jar-api';
import JarRuntimeSettings, { runtimeDraft, runtimePayload } from './JarRuntimeSettings';
import JarStartupDialog from './JarStartupDialog';
import type { JarInstance, JarState, JarStatus, JavaDetection, JarLog, JarCommand } from './jar-api';
import './jar.css';

const basename = (value: string) => value.split(/[\\/]/).pop() || value;
const bytes = (value?: number) => value === undefined ? '—' : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
const duration = (value?: number) => value === undefined ? '—' : `${Math.floor(value / 3600)}时 ${Math.floor(value % 3600 / 60)}分 ${Math.floor(value % 60)}秒`;
const labels = { running: '运行中', stopped: '已停止', exited: '已退出', unknown: '待核实' };
const healthLabels = { disabled: '未检测', unknown: '待检测', starting: '启动宽限中', stopped: '未运行', healthy: '健康', degraded: '检测波动', unhealthy: '不健康' };
const supervisionLabels: Record<string, string> = { starting: '正在启动', running: '独立守护中', backoff: '等待重试', exhausted: '重试已达上限', exited: '进程已退出', blocked: '需要处理', stopping: '正在停止' };

function JarForm({ instance, revision, close, saved }: { instance?: JarInstance; revision: number; close: () => void; saved: (state: JarState) => void }) {
  const initial = { name: instance?.name || '', jar: instance?.jar || '', executable: instance?.executable || '', jvm: instance?.jvmArgs.join('\n') || '', args: instance?.appArgs.join('\n') || '', pidName: instance?.pidName || '', logName: instance?.logName || '', logMode: instance?.logMode || 'file', stopTimeout: instance?.stopTimeout || 15 };
  const initialRuntime = useRef(runtimeDraft(instance));
  const [runtime, setRuntime] = useState(initialRuntime.current);
  const [draft, setDraft] = useState(initial), baseline = useRef(JSON.stringify([initial, initialRuntime.current]));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [java, setJava] = useState<JavaDetection | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), heading = useId(), confirm = useConfirmation();
  const dirty = JSON.stringify([draft, runtime]) !== baseline.current;
  useBeforeUnload(dirty);
  useEffect(() => { const previous = document.activeElement; dialog.current?.showModal(); dialog.current?.querySelector('input')?.focus(); return () => { dialog.current?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  const patch = (values: Partial<typeof draft>) => setDraft(current => ({ ...current, ...values }));
  async function task(action: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); try { await action(); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } }
  async function cancel() {
    if (busy) return;
    if (!dirty || await confirm({ title: '放弃 JAR 设置修改？', detail: '尚未保存的显示名称、路径和启动参数将被放弃。', confirm: '放弃修改' })) close();
  }
  async function pick(kind: 'jar' | 'executable') {
    const files = await jarRequest<string[]>('pick', { kind });
    if (!files[0]) return;
    if (kind === 'jar') {
      const stem = basename(files[0]).replace(/\.jar$/i, '');
      patch({ jar: files[0], ...(!draft.name ? { name: stem } : {}) });
    } else { patch({ executable: files[0] }); setJava(null); }
  }
  return <dialog ref={dialog} className="jar-dialog" aria-labelledby={heading} onCancel={event => { event.preventDefault(); void cancel(); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void cancel(); } }}>
    <header><h2 id={heading}>{instance ? '编辑 JAR' : '添加 JAR'}</h2><button className="icon-button" aria-label="关闭 JAR 设置" disabled={busy} onClick={() => void cancel()}><X size={18} /></button></header>
    <form onSubmit={event => { event.preventDefault(); void task(async () => {
      const result = await jarRequest<JarState>('upsert', { revision, instance: { ...instance, ...runtimePayload(runtime), name: draft.name, jar: draft.jar, executable: draft.executable, jvmArgs: draft.jvm.split(/\r?\n/).filter(Boolean), appArgs: draft.args.split(/\r?\n/).filter(Boolean), pidName: draft.pidName, logName: draft.logName, logMode: draft.logMode, stopTimeout: Number(draft.stopTimeout) } });
      baseline.current = JSON.stringify([draft, runtime]); saved(result);
    }); }}>
      <fieldset disabled={busy}>
        <label>显示名称<input required maxLength={120} value={draft.name} onChange={event => patch({ name: event.target.value })} placeholder="例如：订单服务 · 测试环境" /></label>
        <label>JAR 文件绝对路径<span className="jar-path-input"><input required value={draft.jar} onChange={event => patch({ jar: event.target.value })} placeholder="选择已有 .jar 文件" /><button className="secondary-button" type="button" onClick={() => void task(() => pick('jar'))}><FolderOpen size={15} />选择文件</button></span></label>
        <p className="jar-help">自动获取目录和文件名；工作目录、日志与 PID 都在 JAR 同级。每个文件仅登记一次。</p>
        <label>Java 程序路径（可选）<span className="jar-path-input"><input value={draft.executable} onChange={event => { patch({ executable: event.target.value }); setJava(null); }} placeholder="留空：检测 JAVA_HOME 和 PATH" /><button className="secondary-button" type="button" onClick={() => void task(() => pick('executable'))}>选择 Java</button></span></label>
        <button className="text-button" type="button" onClick={() => void task(async () => setJava(await jarRequest<JavaDetection>('detect', { executable: draft.executable })))}>检测此 Java</button>
        {java && <p className={java.found ? 'jar-help' : 'jar-error'}>{java.found ? `${java.version} · ${java.executable}` : java.output}</p>}
        <div className="jar-form-grid"><label>JVM 参数（每行一个）<textarea rows={4} value={draft.jvm} onChange={event => patch({ jvm: event.target.value })} placeholder={'-Xms256m\n-Xmx1024m\n-Dfile.encoding=UTF-8'} /></label><label>应用参数（每行一个）<textarea rows={4} value={draft.args} onChange={event => patch({ args: event.target.value })} placeholder={'--spring.profiles.active=test\n--server.port=8080'} /></label></div>
        <p className="jar-help">每行作为一个原样参数，含空格无需额外引号。不填 java、-jar 或 JAR 文件名。</p>
        <div className="jar-form-grid"><label>日志模式<select value={draft.logMode} onChange={event => patch({ logMode: event.target.value as 'file' | 'silent' })}><option value="file">文件日志（追加，保留历史）</option><option value="silent">静默（丢弃标准输出与错误）</option></select></label><label>停止等待（秒）<input type="number" min={1} max={120} required value={draft.stopTimeout} onChange={event => patch({ stopTimeout: Number(event.target.value) })} /></label><label>PID 文件名（可选）<input value={draft.pidName} onChange={event => patch({ pidName: event.target.value })} placeholder="默认：JAR 名.pid" /></label><label>日志文件名（可选）<input value={draft.logName} onChange={event => patch({ logName: event.target.value })} placeholder="默认：JAR 名.log" /></label></div>
        <p className="jar-help">可填 app.pid / app.log 延续脚本文件名。旧脚本启动的进程请先由原脚本停止，再通过工具启动。</p>
        <JarRuntimeSettings value={runtime} onChange={setRuntime} />
      </fieldset>
      {error && <p className="jar-error" role="alert">{error}</p>}
      <footer><button className="text-button" type="button" disabled={busy} onClick={() => void cancel()}>取消</button><MotionButton busy={busy} className="run-button" disabled={busy} type="submit">保存 JAR</MotionButton></footer>
    </form>
  </dialog>;
}

export default function JarCenter({ active }: { active: boolean }) {
  const [state, setState] = useState<JarState | null>(null), [statuses, setStatuses] = useState<JarStatus[]>([]);
  const [form, setForm] = useState<JarInstance | 'new' | null>(null), [java, setJava] = useState<JavaDetection | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [query, setQuery] = useState('');
  const [monitorError, setMonitorError] = useState('');
  const [startup, setStartup] = useState<JarInstance | null>(null);
  const [auto, setAuto] = useState(true), [logId, setLogId] = useState(''), [log, setLog] = useState<JarLog | null>(null), [logError, setLogError] = useState('');
  const polling = useRef(false), operating = useRef(false), confirm = useConfirmation();
  const desktop = !!window.devkitJar;
  async function refresh() { const next = await jarRequest<JarState>('get'); setState(next); setStatuses(await jarRequest<JarStatus[]>('statuses')); }
  async function task(action: () => Promise<void>) {
    if (operating.current) return; operating.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (failure) { setError((failure as Error).message); } finally { operating.current = false; setBusy(false); }
  }
  useEffect(() => { if (active && desktop) void task(refresh); }, [active, desktop]);
  useEffect(() => {
    if (!active || !auto || !desktop) return;
    let disposed = false;
    async function poll() {
      if (polling.current || operating.current || document.hidden) return;
      polling.current = true;
      try { const result = await jarRequest<JarStatus[]>('statuses'); if (!disposed) { setStatuses(result); setMonitorError(''); } }
      catch (failure) { if (!disposed) setMonitorError((failure as Error).message); }
      finally { polling.current = false; }
    }
    const timer = setInterval(() => void poll(), 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, [active, auto, desktop]);
  useEffect(() => {
    if (!logId || !active || !desktop) return;
    let disposed = false, reading = false;
    async function load() {
      if (reading || document.hidden) return; reading = true;
      try { const result = await jarRequest<JarLog>('log-tail', { id: logId }); if (!disposed) { setLog(result); setLogError(''); } }
      catch (failure) { if (!disposed) setLogError((failure as Error).message); }
      finally { reading = false; }
    }
    void load(); const timer = auto ? setInterval(() => void load(), 3000) : undefined;
    return () => { disposed = true; clearInterval(timer); };
  }, [logId, active, auto, desktop]);
  async function command(item: JarInstance, command: JarCommand) {
    if (command !== 'start' && !await confirm({ title: `${command === 'restart' ? '重启' : command === 'force-stop' ? '强制终止' : '停止'} ${item.name}？`, detail: command === 'force-stop' ? '将强制结束进程，未完成的请求或数据可能无法保存。' : state?.platform === 'win32' ? 'Windows 将终止 Java 进程，无法保证 JVM 关闭钩子执行。重启会在确认进程退出后启动。' : `先发送 TERM，最多等待 ${item.stopTimeout} 秒。超时保留进程，之后可单独强制终止。`, confirm: command === 'restart' ? '重启 JAR' : command === 'force-stop' ? '强制终止' : '停止 JAR' })) return;
    await task(async () => { try { const result = await jarRequest<{ output: string }>('command', { id: item.id, command }); setNotice(result.output); } finally { await refresh(); } });
  }
  const filtered = state?.instances.filter(item => `${item.name} ${item.jar}`.toLowerCase().includes(query.toLowerCase())) || [];
  return <section className="jar-center">
    <header className="jar-heading"><div><span className="jar-eyebrow"><Coffee size={17} />本机服务</span><h1>JAR 管理</h1><p>集中管理 Java 应用，随时查看进程、资源与运行日志。</p></div><div className="jar-actions"><MotionButton busy={busy} className="secondary-button" disabled={busy || !desktop} onClick={() => void task(async () => setJava(await jarRequest<JavaDetection>('detect')))}><Coffee size={15} />检测 Java</MotionButton><button className="run-button" disabled={busy || !state} onClick={() => setForm('new')}><Plus size={15} />添加 JAR</button></div></header>
    {!desktop && <p className="jar-warning">请在 Windows / Linux 桌面端使用 JAR 管理；浏览器预览不具备本机进程权限。</p>}
    {java && <div className={java.found ? 'jar-java' : 'jar-warning'}><strong>{java.found ? java.version : '未检测到 Java'}</strong><p>{java.found ? java.executable : java.output}</p></div>}
    <div className="jar-toolbar"><label className="jar-search"><Search size={16} /><input aria-label="搜索 JAR" placeholder="搜索名称或路径" value={query} onChange={event => setQuery(event.target.value)} /></label><div className="jar-actions"><label className="jar-auto"><input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)} />自动刷新</label><MotionButton busy={busy} className="text-button" disabled={busy || !desktop} onClick={() => void task(async () => { await refresh(); if (logId) setLog(await jarRequest<JarLog>('log-tail', { id: logId })); })}><RefreshCw size={15} />刷新</MotionButton></div></div>
    {error && <p className="jar-error" role="alert">{error}</p>}{notice && <p className="jar-notice" role="status">{notice}</p>}
    {monitorError && <p className="jar-warning" role="alert">状态刷新失败，以下显示上次结果：{monitorError}</p>}
    <div className="jar-summary"><strong>{state?.instances.length || 0}</strong> 个应用<span>运行中 {statuses.filter(item => item.state === 'running').length}</span><span>已退出 {statuses.filter(item => item.state === 'exited').length}</span><small>状态每 5 秒刷新 · CPU 为采样间隔占用，可超过 100%</small></div>
    {!state && desktop && !error && <p className="jar-help">正在读取 JAR 列表…</p>}
    {state && !state.instances.length && <div className="jar-empty"><Coffee size={35} /><h2>添加第一个 Java 应用</h2><p>选择 JAR 文件，起一个方便辨认的名字，即可启动并查看状态。</p><button className="secondary-button" onClick={() => setForm('new')}><Plus size={15} />选择 JAR 文件</button></div>}
    {!!state?.instances.length && !filtered.length && <p className="jar-help">没有匹配的 JAR。</p>}
    {!!filtered.length && <div className="jar-table-scroll"><table className="jar-table"><thead><tr><th>应用 / 文件</th><th>进程状态</th><th>运行时间 / PID</th><th>内存 / CPU</th><th>操作</th></tr></thead><tbody>{filtered.map(item => {
      const status = statuses.find(status => status.id === item.id), running = status?.state === 'running', stopped = status && ['stopped', 'exited'].includes(status.state), supervised = status?.supervision?.active;
      return <tr key={item.id}>
        <td><strong>{item.name}</strong><span title={item.jar}>{basename(item.jar)}</span><small className="jar-full-path">{item.jar}</small><small>{bytes(status?.size)} · {item.logMode === 'file' ? '文件日志' : '静默模式'}{status?.fileMissing ? ' · JAR 文件缺失' : ''}</small><small>环境：{item.profiles.find(profile => profile.id === item.profile)?.name || '公共变量'}</small></td>
        <td><span className={`jar-status ${status?.state || ''}`}>{status ? labels[status.state] : '待检测'}</span>
          {status?.health && <small className={`jar-health ${status.health.state}`} title={status.health.detail}>业务：{healthLabels[status.health.state]}{status.health.latency !== undefined ? ` · ${status.health.latency} ms` : ''}</small>}
          {supervised && <small>{supervisionLabels[status.supervision!.state] || status.supervision!.state} · 重试 {status.supervision!.attempts}/{item.restart.maxRetries}</small>}
          {status?.supervision?.nextRetryAt && <small>下次：{new Date(status.supervision.nextRetryAt).toLocaleTimeString()}</small>}
          <small className="jar-status-detail">{status?.detail}</small><small>{status ? `检测于 ${new Date(status.checkedAt).toLocaleTimeString()}` : ''}</small>
        </td>
        <td><span>{duration(status?.uptime)}</span><small>{running ? `PID ${status.pid}` : '—'}</small></td>
        <td><span>{bytes(status?.memory)}</span><small>CPU {status?.cpu === undefined ? '—' : `${status.cpu.toFixed(1)}%`}</small></td>
        <td><div className="jar-row-actions">
          <button className="text-button" disabled={busy || !stopped || status.fileMissing} onClick={() => void command(item, 'start')}><Play size={14} />启动</button>
          <button className="text-button" disabled={busy || (!running && !supervised)} onClick={() => void command(item, 'stop')}><Square size={14} />停止</button>
          <button className="text-button" disabled={busy || (!running && !supervised)} onClick={() => void command(item, 'restart')}><RefreshCw size={14} />重启</button>
          <button className="text-button" disabled={busy} onClick={() => { setLog(null); setLogError(''); setLogId(logId === item.id ? '' : item.id); }}><FileText size={14} />日志</button>
          <button className="text-button" disabled={busy} onClick={() => setForm(item)}><Settings2 size={14} />设置</button>
          <button className="text-button" disabled={busy} onClick={() => setStartup(item)}><Play size={14} />系统自启</button>
          <button className="text-button jar-danger" disabled={busy || !stopped || supervised} onClick={() => void (async () => { if (await confirm({ title: `移除 ${item.name}？`, detail: '只移除列表记录，保留 JAR、日志与运行文件。移除前需关闭系统自启。', confirm: '移除记录' })) await task(async () => { setState(await jarRequest<JarState>('remove', { id: item.id, revision: state?.revision })); if (logId === item.id) setLogId(''); await refresh(); }); })()}><Trash2 size={14} />移除</button>
        </div><details className="jar-advanced"><summary>更多运行信息</summary><p>Java：{status?.executable || item.executable || '自动检测'}</p><p>PID：{status?.pidPath}</p><p>日志：{status?.logPath}</p><p>健康：{status?.health?.detail || '未配置'}{status?.health?.checkedAt ? ` · ${new Date(status.health.checkedAt).toLocaleTimeString()}` : ''}</p>
          {status?.supervision?.lastError && <p className="jar-error">{status.supervision.lastError}</p>}{status?.supervision?.logError && <p className="jar-error">日志写入失败：{status.supervision.logError}</p>}
          <button className="text-button" disabled={busy || !running || item.health.type === 'none'} onClick={() => void task(async () => { await jarRequest('health-check', { id: item.id }); await refresh(); })}>立即检查健康</button>
          <button className="text-button jar-danger" disabled={busy || (!running && !supervised)} onClick={() => void command(item, 'force-stop')}>强制终止</button>
        </details></td>
      </tr>;
    })}</tbody></table></div>}
    {logId && <section className="jar-log"><header><div><h2>{state?.instances.find(item => item.id === logId)?.name} · 日志</h2><p>{log?.path}</p></div><button className="icon-button" aria-label="关闭日志" onClick={() => setLogId('')}><X size={17} /></button></header><p className="jar-help">{state?.instances.find(item => item.id === logId)?.logMode === 'silent' ? '静默模式不会写入标准输出；已有文件可能是历史日志。' : '显示最近 128 KB，自动刷新开启时每 3 秒重新读取。'} {log?.truncated ? '前部内容已截断。' : ''}</p>{logError && <p className="jar-error" role="alert">{logError}</p>}<pre tabIndex={0} aria-label="JAR 日志内容">{log ? log.text || '暂无日志。' : '正在读取日志…'}</pre></section>}
    <p className="jar-help jar-footer">进程运行不等于业务健康。退出 DevKit 后 JAR 继续运行；重新打开可恢复监视。启动参数和记录保存在本机，请勿填入敏感凭据。</p>
    {form && state && <JarForm instance={form === 'new' ? undefined : form} revision={state.revision} close={() => setForm(null)} saved={next => { setState(next); setForm(null); void task(refresh); }} />}
    {startup && <JarStartupDialog item={startup} platform={state?.platform || ''} close={() => setStartup(null)} />}
  </section>;
}
