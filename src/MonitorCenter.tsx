import { useEffect, useRef, useState } from 'react';
import { Activity, Plus, RefreshCw, Search, Pencil, Trash2, Play, Pause, ShieldCheck, Clock3 } from 'lucide-react';
import { monitorRequest } from './monitor-api';
import type { Monitor, MonitorConfig, MonitorSource, MonitorState } from './monitor-api';
import { canOperateMonitor, canWriteWorkspace } from './workspace-remote';
import { Modal, ModalCancel, Field } from './project-components';
import { MotionButton, MotionPresence } from './Motion';
import { SharingButton } from './Sharing';
import './monitor.css';

const labels: Record<string, string> = { up: '正常', down: '故障', pending: '待确认', unknown: '待检测 / 已过期', paused: '已暂停', maintenance: '维护中' };
const time = (at?: string | null) => at ? new Date(at).toLocaleString() : '尚无记录';
const localDate = (at?: string) => at ? new Date(Date.parse(at) - new Date(at).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
const empty = (): MonitorConfig => ({ id: '', name: '', type: 'http', url: '', host: '', port: 80, status: 200, interval: 60, timeout: 5, failures: 2, enabled: false, source: null, maintenance: null });

export default function MonitorCenter({ active = true }: { active?: boolean }) {
  const [data, setData] = useState<MonitorState | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [selected, setSelected] = useState('');
  const [draft, setDraft] = useState<MonitorConfig | null>(null), [revision, setRevision] = useState(0), [remove, setRemove] = useState<Monitor | null>(null);
  const [sources, setSources] = useState<{ label: string; source: MonitorSource }[]>([]), [sourceError, setSourceError] = useState('');
  const [start, setStart] = useState(''), [end, setEnd] = useState('');
  const generation = useRef(0), working = useRef(false);
  const edit = canWriteWorkspace('monitor'), operate = canOperateMonitor();
  async function refresh() {
    const request = ++generation.current;
    try { const next = await monitorRequest<MonitorState>('get'); if (request === generation.current) { setData(next); setError(''); } }
    catch (failure) { if (request === generation.current) setError((failure as Error).message); }
  }
  useEffect(() => {
    if (!active) return;
    void refresh(); const timer = setInterval(() => { if (!working.current && !document.hidden) void refresh(); }, 5000);
    return () => { generation.current++; clearInterval(timer); };
  }, [active]);
  async function action(action: 'upsert' | 'remove' | 'toggle' | 'check', payload: unknown, success?: () => void) {
    if (working.current) return;
    generation.current++; working.current = true; setBusy(true); setError('');
    try { const next = await monitorRequest<MonitorState>(action, payload); setData(next); success?.(); }
    catch (failure) { setError((failure as Error).message); }
    finally { working.current = false; setBusy(false); }
  }
  function open(item?: Monitor) {
    const config = item ? structuredClone(item) : empty();
    setDraft(config); setRevision(data?.revision || 0); setStart(localDate(config.maintenance?.start)); setEnd(localDate(config.maintenance?.end)); setError('');
    setSources([]); setSourceError('');
    void monitorRequest<typeof sources>('sources').then(setSources).catch(error => setSourceError(error.message));
  }
  const visible = data?.monitors.filter(item => (!search || `${item.name} ${item.url} ${item.host}`.toLowerCase().includes(search.toLowerCase())) && (filter === 'all' || filter === item.state)) || [];
  const current = visible.find(item => item.id === selected) || visible[0];
  const frozen = !operate && !!draft?.enabled;
  return <section className="monitor-center">
    <header className="monitor-heading"><div className="monitor-brand"><Activity size={28} /><div><h1>监控中心</h1><p>持续检测服务，把故障与恢复留在时间线上。</p></div></div><div className="monitor-actions"><SharingButton /><button className="secondary-button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} />刷新</button>{edit && <button className="run-button" onClick={() => open()}><Plus size={15} />添加监控</button>}</div></header>
    <div className="monitor-note"><ShieldCheck size={15} /><span>检测从主机发起，切换页面后继续。退出主机应用或独立服务后停止；状态每 5 秒刷新。</span></div>
    {error && !draft && !remove && <p className="pc-error" role="alert">{error}</p>}
    {data?.storageError && <p className="pc-error" role="alert">监控记录保存失败：{data.storageError}。请检查主机配置目录权限与磁盘空间。</p>}
    <div className="monitor-metrics">{[['全部监控', data?.monitors.length || 0], ['正常', data?.monitors.filter(item => item.state === 'up').length || 0], ['故障 / 待确认', data?.monitors.filter(item => ['down', 'pending'].includes(item.state)).length || 0], ['暂停 / 维护', data?.monitors.filter(item => ['paused', 'maintenance'].includes(item.state)).length || 0]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="monitor-toolbar"><label><Search size={15} /><input aria-label="搜索监控" placeholder="搜索名称或地址…" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="监控状态筛选" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部状态</option>{Object.entries(labels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><small>最近 24 小时的已保存检测样本；最多保留 1,440 次 / 7 天</small></div>
    {!data ? <div className="monitor-empty">{error ? '监控数据暂不可用，请刷新重试。' : '正在读取主机监控…'}</div> : !visible.length ? <div className="monitor-empty"><Activity size={32} /><h2>{data.monitors.length ? '没有匹配的监控' : '开始关注你的服务'}</h2><p>{data.monitors.length ? '调整关键词或状态筛选。' : '添加 HTTP 或 TCP 检测，也可关联已有项目入口和 JAR 健康地址。'}</p>{edit && !data.monitors.length && <button className="run-button" onClick={() => open()}>添加第一个监控</button>}</div> : <div className="monitor-layout">
      <div className="monitor-list" aria-label="监控列表">{visible.map(item => <article key={item.id} className={`monitor-card ${current?.id === item.id ? 'selected' : ''}`}>
        <button className="monitor-card-select" aria-pressed={current?.id === item.id} onClick={() => setSelected(item.id)}><span className={`monitor-status ${item.state}`}>{labels[item.state]}</span><h2>{item.name}</h2><p>{item.source ? item.source.type === 'project' ? '关联项目入口 · 随档案配置更新' : '关联 JAR · 使用健康检查配置' : item.type === 'http' ? item.url : `${item.host}:${item.port}`}</p><div className="monitor-beats" aria-label="最近60次检测">{item.samples.slice(-60).map((sample, index) => <i key={index} className={sample.ok ? 'up' : 'down'} title={`${time(sample.at)} · ${sample.elapsed} ms · ${sample.detail}`} />)}</div><div className="monitor-card-stats"><span>样本可用率 <strong>{item.availability === null ? '—' : `${item.availability}%`}</strong></span><span>平均 <strong>{item.average === null ? '—' : `${item.average} ms`}</strong></span></div></button>
        <footer><span>{item.checking ? '正在检测…' : `${item.interval} 秒 / 次`}</span><div>{operate && <button title={item.enabled ? '暂停监控' : '启用监控'} aria-label={`${item.enabled ? '暂停' : '启用'} ${item.name}`} disabled={busy} onClick={() => void action('toggle', { id: item.id, revision: data.revision, enabled: !item.enabled })}>{item.enabled ? <Pause size={15} /> : <Play size={15} />}</button>}{edit && <><button aria-label={`编辑 ${item.name}`} disabled={busy} onClick={() => open(item)}><Pencil size={15} /></button><button aria-label={`删除 ${item.name}`} disabled={busy || (!operate && item.enabled)} onClick={() => { setRemove(item); setRevision(data.revision); setError(''); }}><Trash2 size={15} /></button></>}</div></footer>
      </article>)}</div>
      {current && <aside className="monitor-detail"><div className="monitor-detail-heading"><h2>{current.name}</h2><span className={`monitor-status ${current.state}`}>{labels[current.state]}</span></div><p>{current.detail || '启用后将由主机自动检测。'}</p><dl><div><dt>最近检测</dt><dd>{time(current.checkedAt)}</dd></div><div><dt>24 小时已保存样本</dt><dd>{current.sampleCount} 次</dd></div><div><dt>故障确认</dt><dd>连续失败 {current.failures} 次</dd></div><div><dt>超时</dt><dd>{current.timeout} 秒</dd></div></dl>{current.maintenance && <p className="monitor-maintenance"><Clock3 size={15} />维护窗口：{time(current.maintenance.start)} 至 {time(current.maintenance.end)}</p>}{operate && <button className="secondary-button" disabled={busy || current.checking || !current.enabled || current.state === 'maintenance'} onClick={() => void action('check', { id: current.id })}><RefreshCw size={14} />立即检测</button>}
        <h3>响应耗时</h3>{current.samples.length ? <Latency monitor={current} /> : <p>首个检测完成后显示趋势。</p>}
        <h3>故障与恢复</h3>{!current.incidents.length && <p>暂无已确认故障。</p>}<ol className="monitor-incidents">{current.incidents.map(item => <li key={item.id}><strong>{item.end ? '已结束' : '故障未恢复'}</strong><p>{item.detail}</p><small>{time(item.start)} → {item.end ? time(item.end) : '持续中'}{item.reason && ` · ${item.reason}`}</small></li>)}</ol>
        <details className="monitor-samples"><summary>最近检测记录</summary><ul>{current.samples.slice(-30).reverse().map((sample, index) => <li key={index}><span>{sample.ok ? '正常' : '失败'} · {sample.elapsed} ms</span><small>{time(sample.at)} · {sample.detail}</small></li>)}</ul></details>
      </aside>}
    </div>}
    <MotionPresence kind="dialog" present={!!draft}>{draft && <Modal title={draft.id ? '编辑监控' : '添加监控'} close={() => setDraft(null)} draft={{ ...draft, start, end }} busy={busy}>
      <form className="monitor-form" onSubmit={event => { event.preventDefault(); if (!!start !== !!end) { setError('请同时填写维护开始与结束时间。'); return; } void action('upsert', { revision, monitor: { ...draft, maintenance: start && end ? { start: new Date(start).toISOString(), end: new Date(end).toISOString() } : null } }, () => setDraft(null)); }}>
        {error && <p className="pc-error" role="alert">{error}</p>}{frozen && <p className="pc-notice">编辑运行中的监控需要运行权限，请联系主机管理者。</p>}
        <Field label="监控名称"><input required maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></Field>
        <Field label="检测来源"><select value={draft.source ? JSON.stringify(draft.source) : ''} onChange={event => setDraft({ ...draft, source: event.target.value ? JSON.parse(event.target.value) : null })}><option value="">自定义地址</option>{draft.source && !sources.some(item => JSON.stringify(item.source) === JSON.stringify(draft.source)) && <option value={JSON.stringify(draft.source)}>当前关联（来源未开放或已删除）</option>}{sources.map(item => <option key={JSON.stringify(item.source)} value={JSON.stringify(item.source)}>{item.label}</option>)}</select></Field>
        {sourceError && <p role="alert">关联来源读取失败：{sourceError}。仍可填写自定义地址。</p>}
        {!draft.source && <><Field label="检测类型"><select value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value as 'http' | 'tcp' })}><option value="http">HTTP / HTTPS</option><option value="tcp">TCP 端口</option></select></Field>{draft.type === 'http' ? <Field label="检测地址"><input required type="url" placeholder="https://example.com/health" value={draft.url} onChange={event => setDraft({ ...draft, url: event.target.value })} /></Field> : <div className="monitor-form-row"><Field label="主机名 / IP"><input required value={draft.host} onChange={event => setDraft({ ...draft, host: event.target.value })} /></Field><Field label="端口"><input required type="number" min={1} max={65535} value={draft.port} onChange={event => setDraft({ ...draft, port: Number(event.target.value) })} /></Field></div>}</>}
        {draft.source?.type !== 'jar' && (draft.source || draft.type === 'http') && <Field label="预期 HTTP 状态码"><input required type="number" min={100} max={599} value={draft.status} onChange={event => setDraft({ ...draft, status: Number(event.target.value) })} /></Field>}
        <div className="monitor-form-row">{([{ key: 'interval', label: '检测间隔（秒）', min: 10, max: 86400 }, { key: 'timeout', label: '超时（秒）', min: 1, max: 60 }, { key: 'failures', label: '连续失败确认次数', min: 1, max: 10 }] as const).map(field => <Field label={field.label} key={field.key}><input required type="number" min={field.min} max={field.max} value={draft[field.key]} onChange={event => setDraft({ ...draft, [field.key]: Number(event.target.value) })} /></Field>)}</div>
        <fieldset><legend>维护窗口（可选，期间暂停检测）</legend><div className="monitor-form-row"><Field label="开始时间"><input type="datetime-local" value={start} onChange={event => setStart(event.target.value)} /></Field><Field label="结束时间"><input type="datetime-local" value={end} onChange={event => setEnd(event.target.value)} /></Field></div></fieldset>
        <label className="monitor-enabled"><input type="checkbox" checked={draft.enabled} disabled={!operate} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />保存后启用定时检测</label><p className="monitor-form-hint">修改配置会开始新的检测序列，旧故障记录保留。暂停和维护期间不产生样本。</p>
        <footer className="pc-form-footer"><ModalCancel /><MotionButton className="run-button" busy={busy} disabled={busy || frozen}>保存监控</MotionButton></footer>
      </form>
    </Modal>}</MotionPresence>
    <MotionPresence kind="dialog" present={!!remove}>{remove && <Modal title="删除监控" close={() => setRemove(null)} busy={busy}>{error && <p className="pc-error" role="alert">{error}</p>}<p>删除“{remove.name}”及其检测历史、故障记录？此操作无法撤销。</p><div className="pc-form-footer"><button className="secondary-button" onClick={() => setRemove(null)}>取消</button><button className="run-button" disabled={busy} onClick={() => void action('remove', { id: remove.id, revision }, () => setRemove(null))}>确认删除</button></div></Modal>}</MotionPresence>
  </section>;
}

function Latency({ monitor }: { monitor: Monitor }) {
  const samples = monitor.samples.slice(-60), max = Math.max(1, ...samples.map(item => item.elapsed));
  const points = samples.map((item, index) => `${8 + index / Math.max(1, samples.length - 1) * 284},${76 - item.elapsed / max * 64}`);
  return <figure className="monitor-chart"><svg viewBox="0 0 300 88" role="img" aria-label={`最近 ${samples.length} 次检测耗时，最高 ${max} 毫秒`}><path d="M8 76H292" stroke="var(--line)" /><polyline points={points.join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" />{samples.map((item, index) => <circle key={index} cx={8 + index / Math.max(1, samples.length - 1) * 284} cy={76 - item.elapsed / max * 64} r="2" fill={item.ok ? 'var(--accent)' : 'var(--danger, #d66a77)'}><title>{time(item.at)} · {item.elapsed} ms</title></circle>)}</svg><figcaption>最近 {samples.length} 次 · 最高 {max} ms</figcaption></figure>;
}
