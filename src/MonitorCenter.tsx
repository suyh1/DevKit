import Skeleton from './Skeleton';
import SegmentedControl from './SegmentedControl';
import { useEffect, useRef, useState } from 'react';
import { Activity, Plus, RefreshCw, Search, Pencil, Trash2, Play, Pause, ShieldCheck } from 'lucide-react';
import { monitorRequest, monitorSourceKey, monitorSourceLink } from './monitor-api';
import type { Monitor, MonitorConfig, MonitorSource, MonitorState } from './monitor-api';
import { canOperateMonitor, canWriteWorkspace } from './workspace-remote';
import { Modal, ModalForm, ModalCancel, Field } from './project-components';
import { MotionButton, MotionPresence } from './Motion';
import { SharingButton } from './Sharing';
import { usePerformanceMode } from './DisplayMode';
import { createSpring } from './motion-primitives';
import './monitor.css';
import { CreateRelated, RelatedLink, useWorkspaceGuard } from './related-workspaces';
import { missingResourceLink, ResourceLink, useWorkspaceResource } from './workspace-links';

const labels: Record<string, string> = { up: '正常', down: '故障', pending: '待确认', unknown: '待检测 / 已过期', paused: '已暂停', maintenance: '维护中' };
const sourceLabels = { project: '关联项目入口', jar: '关联 JAR 健康检查', lan: '关联局域网主机端口' };
const time = (at?: string | null) => at ? new Date(at).toLocaleString() : '尚无记录';
const localDate = (at?: string) => at ? new Date(Date.parse(at) - new Date(at).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
const empty = (): MonitorConfig => ({ id: '', name: '', type: 'http', url: '', host: '', port: 80, status: 200, interval: 60, timeout: 5, failures: 2, enabled: false, source: null, maintenance: null });

export default function MonitorCenter({ active = true, focus }: { active?: boolean; focus?: { id: string } }) {
  const statusSeconds = usePerformanceMode() ? 15 : 5;
  const [data, setData] = useState<MonitorState | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [selected, setSelected] = useState('');
  const [draft, setDraft] = useState<MonitorConfig | null>(null), [revision, setRevision] = useState(0), [remove, setRemove] = useState<Monitor | null>(null);
  const [sources, setSources] = useState<{ label: string; source: MonitorSource }[]>([]), [sourceError, setSourceError] = useState('');
  const [start, setStart] = useState(''), [end, setEnd] = useState('');
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => { if (!draft) setSubmitted(false); }, [!!draft]);
  const issues: Record<string,string> = {};
  if (draft && !draft.source && draft.type === 'http') {
    try { const target = new URL(draft.url); if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error(); }
    catch { issues.url = '请输入不含用户名和密码的完整 HTTP(S) 地址。'; }
  }
  if (draft && !draft.source && draft.type === 'tcp') {
    if (!draft.host.trim() || /[\s/\\?#@]/.test(draft.host.trim())) issues.host = '请输入主机名或 IP，不含协议和路径。';
    if (!Number.isInteger(draft.port) || draft.port < 1 || draft.port > 65535) issues.port = '端口应为 1–65535 之间的整数。';
  }
  if (draft && (draft.source?.type === 'project' || !draft.source && draft.type === 'http') && (!Number.isInteger(draft.status) || draft.status < 100 || draft.status > 599)) issues.status = '预期状态码应为 100–599 之间的整数。';
  const generation = useRef(0), working = useRef(false);
  const detailRef = useRef<HTMLElement>(null), listRef = useRef<HTMLDivElement>(null);
  function selectMonitor(id: string) {
    setSelected(id);
    if (matchMedia('(max-width: 1100px)').matches) requestAnimationFrame(() => {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({ block: 'start' });
    });
  }
  function returnToCard() {
    const card = listRef.current?.querySelector<HTMLButtonElement>('.monitor-card-select[aria-pressed="true"]');
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: 'center' });
  }
  const edit = canWriteWorkspace('monitor'), operate = canOperateMonitor();
  async function refresh() {
    const request = ++generation.current;
    try { const next = await monitorRequest<MonitorState>('get'); if (request === generation.current) { setData(next); setError(''); } }
    catch (failure) { if (request === generation.current) setError((failure as Error).message); }
  }
  useEffect(() => {
    if (!active) return;
    if (!working.current) void refresh();
    const timer = setInterval(() => { if (!working.current && !document.hidden) void refresh(); }, statusSeconds * 1000);
    return () => { generation.current++; clearInterval(timer); };
  }, [active, statusSeconds]);
  const linked = useWorkspaceResource('monitor');
  const sourceFilter = linked?.startsWith('source:') ? linked : undefined;
  const guard = useWorkspaceGuard();
  useEffect(() => {
    const id = linked || focus?.id;
    if (active && id) { setSelected(id); setSearch(''); setFilter('all'); }
  }, [active, focus, linked]);
  async function action(action: 'upsert' | 'remove' | 'toggle' | 'check', payload: unknown, success?: () => void) {
    if (working.current) return;
    generation.current++; working.current = true; setBusy(true); setError('');
    try { const next = await monitorRequest<MonitorState>(action, payload); setData(next); success?.(); }
    catch (failure) { setError((failure as Error).message); }
    finally { working.current = false; setBusy(false); }
  }
  function open(item?: Monitor, source?: MonitorSource) {
    const config = item ? structuredClone(item) : empty();
    if (source) config.source = source;
    setDraft(config); setRevision(data?.revision || 0); setStart(localDate(config.maintenance?.start)); setEnd(localDate(config.maintenance?.end)); setError('');
    setSources([]); setSourceError('');
  }
  const editing = !!draft;
  useEffect(() => {
    if (!active || !editing) return;
    let current = true;
    void monitorRequest<typeof sources>('sources').then(items => {
      if (current) { setSources(items); setSourceError(''); }
    }).catch(error => { if (current) setSourceError(error.message); });
    return () => { current = false; };
  }, [active, editing]);
  const related = sourceFilter ? data?.monitors.filter(item => item.source && monitorSourceKey(item.source) === sourceFilter) : data?.monitors;
  const visible = related?.filter(item => (!search || [item.name, item.url, item.host, item.sourceHost, item.executionHost].join(' ').toLowerCase().includes(search.toLowerCase())) && (filter === 'all' || filter === item.state)) || [];
  function addMonitor() {
    if (!guard('monitor', 'edit')) return;
    if (sourceFilter?.startsWith('source:projects:')) {
      if (!guard('projects')) return;
      const [profileId, projectId] = sourceFilter.slice('source:projects:'.length).split(':');
      if (profileId && projectId) return open(undefined, { type: 'project', profileId, projectId });
    }
    if (sourceFilter?.startsWith('source:jar:')) {
      const id = sourceFilter.slice('source:jar:'.length);
      if (!(id.includes(':') ? guard('jar', 'control') : guard('jar'))) return;
      return open(undefined, { type: 'jar', id });
    }
    open();
  }
  const current = visible.find(item => item.id === selected) || visible[0];
  const timeline = current ? [
    ...current.incidents.flatMap(item => [
      { key: `${item.id}-down`, at: item.start, state: 'down', label: item.end ? '确认故障' : '故障未恢复', detail: item.detail, logJar: item.jarId ?? (item.jarId === undefined && current.source?.type === 'jar' ? current.source.id : '') },
      ...(item.end ? [{ key: `${item.id}-end`, at: item.end, state: item.reason ? 'paused' : 'up', label: item.reason ? '结束故障记录' : '恢复正常', detail: item.reason || '' }] : []),
    ]),
    ...(current.maintenance ? [
      { key: 'maintenance-start', at: current.maintenance.start, state: 'maintenance', label: '维护窗口开始', detail: '' },
      { key: 'maintenance-end', at: current.maintenance.end, state: 'maintenance', label: '维护窗口结束', detail: '' },
    ] : []),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)) : [];
  const restrictedSource = draft?.source && data?.monitors.find(item => item.id === draft.id && JSON.stringify(item.source) === JSON.stringify(draft.source))?.runRestriction;
  const frozen = !!draft?.enabled && (!operate || !!restrictedSource);
  return <section className="monitor-center">
    <header className="monitor-heading workspace-banner"><div className="monitor-brand"><Activity size={28} /><div><h1>监控中心</h1><p>持续检测服务，把故障与恢复留在时间线上。</p></div></div><div className="monitor-actions"><SharingButton /><button className="secondary-button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} />刷新</button>{(edit || sourceFilter) && !!related?.length && <button className="run-button" onClick={addMonitor}><Plus size={15} />添加监控</button>}</div></header>
    <div className="monitor-note"><ShieldCheck size={15} /><span>检测从主机发起，切换页面后继续。退出主机应用或独立服务后停止。状态每 {statusSeconds} 秒刷新。</span></div>
    {error && !draft && !remove && <p className="pc-error" role="alert">{error}</p>}
    {sourceFilter && <div className="monitor-note"><span>正在查看此来源的关联监控</span><RelatedLink page="monitor">查看全部监控</RelatedLink></div>}
    {linked && !sourceFilter && data && !data.monitors.some(item => item.id === linked) && <p className="pc-notice" role="status">{missingResourceLink('监控')}</p>}
    {data?.storageError && <p className="pc-error" role="alert">监控记录保存失败：{data.storageError}。请检查主机配置目录权限与磁盘空间。</p>}
    {!!data?.monitors.length && <div className="monitor-metrics">{[['全部监控', data?.monitors.length || 0], ['正常', data?.monitors.filter(item => item.state === 'up').length || 0], ['故障 / 待确认', data?.monitors.filter(item => ['down', 'pending'].includes(item.state)).length || 0], ['暂停 / 维护', data?.monitors.filter(item => ['paused', 'maintenance'].includes(item.state)).length || 0]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>}
    {!!data?.monitors.length && <div className="monitor-toolbar"><label><Search size={15} /><input aria-label="搜索监控" placeholder="搜索名称或地址…" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="监控状态筛选" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部状态</option>{Object.entries(labels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><small>最近 24 小时的已保存检测样本；最多保留 1,440 次 / 7 天</small></div>}
    {!data ? error ? <div className="monitor-empty">监控数据暂不可用，请刷新重试。</div> : <Skeleton kind="list" label="正在读取主机监控…" /> : !visible.length ? <div className="monitor-empty"><Activity size={32} /><h2>{sourceFilter && !related?.length ? '此来源尚无关联监控' : data.monitors.length ? '没有匹配的监控' : '暂无监控'}</h2><p>{sourceFilter && !related?.length ? '添加监控时将自动选中当前来源。' : data.monitors.length ? '调整关键词或状态筛选。' : '添加 HTTP 或 TCP 检测，也可关联已有项目入口和 JAR 健康地址。'}</p>{(edit || sourceFilter) && !related?.length && <button className="run-button" onClick={addMonitor}><Plus size={15} />添加监控</button>}</div> : <div className="monitor-layout">
      <div className="monitor-list" ref={listRef} aria-label="监控列表">{visible.map(item => <article key={item.id} className={`monitor-card ${current?.id === item.id ? 'selected' : ''}`}>
        <button className="monitor-card-select" aria-pressed={current?.id === item.id} onClick={() => selectMonitor(item.id)}><span className={`monitor-status ${item.state}`}>{labels[item.state]}</span><h2>{item.name}</h2><p>{item.source ? [sourceLabels[item.source.type], item.sourceHost || item.executionHost].filter(Boolean).join(' · ') : item.type === 'http' ? item.url : `${item.host}:${item.port}`}</p><div className="monitor-beats" aria-label="最近60次检测">{item.samples.slice(-60).map((sample, index) => <i key={index} className={sample.ok ? 'up' : 'down'} title={`${time(sample.at)} · ${sample.elapsed} ms · ${sample.detail}`} />)}</div><div className="monitor-card-stats"><span>样本可用率 <strong>{item.availability === null ? '—' : `${item.availability}%`}</strong></span><span>平均 <strong>{item.average === null ? '—' : `${item.average} ms`}</strong></span></div></button>
        <footer><span>{item.checking ? '正在检测…' : `${item.interval} 秒 / 次`}</span><div>{operate && <button title={item.enabled ? '暂停监控' : item.runRestriction || '启用监控'} aria-label={`${item.enabled ? '暂停' : '启用'} ${item.name}`} disabled={busy || (!item.enabled && !!item.runRestriction)} onClick={() => void action('toggle', { id: item.id, revision: data.revision, enabled: !item.enabled })}>{item.enabled ? <Pause size={15} /> : <Play size={15} />}</button>}{edit && <><button aria-label={`编辑 ${item.name}`} disabled={busy} onClick={() => open(item)}><Pencil size={15} /></button><button aria-label={`删除 ${item.name}`} disabled={busy || (!operate && item.enabled)} onClick={() => { setRemove(item); setRevision(data.revision); setError(''); }}><Trash2 size={15} /></button></>}</div></footer>
      </article>)}</div>
      {current && <aside className="monitor-detail" ref={detailRef} tabIndex={-1} aria-label={`${current.name}监控详情`}><button type="button" className="text-button monitor-return" onClick={returnToCard}>返回所选监控</button><div className="monitor-detail-heading"><h2>{current.name}</h2><span className={`monitor-status ${current.state}`}>{labels[current.state]}</span></div><p>{current.detail || '启用后将由主机自动检测。'}</p><dl><div><dt>最近检测</dt><dd>{time(current.checkedAt)}</dd></div><div><dt>24 小时已保存样本</dt><dd>{current.sampleCount} 次</dd></div><div><dt>故障确认</dt><dd>连续失败 {current.failures} 次</dd></div><div><dt>超时</dt><dd>{current.timeout} 秒</dd></div></dl>{operate && (current.runRestriction ? <p>{current.runRestriction}</p> : <button className="secondary-button" disabled={busy || current.checking || !current.enabled || current.state === 'maintenance'} onClick={() => void action('check', { id: current.id })}><RefreshCw size={14} />立即检测</button>)}
        {current.certificate && <p>HTTPS 证书 · {current.certificate.host} · {time(current.certificate.expires)} 到期 · 剩余 {Math.ceil((Date.parse(current.certificate.expires) - Date.now()) / 86400000)} 天（采集于 {time(current.certificate.checkedAt)}）</p>}
        {current.executionHost && <p>检测从目标主机 {current.executionHost} 发起</p>}{current.notification && <p role="status">{current.notification.event === 'certificate' ? '证书到期提醒' : current.notification.event === 'down' ? '故障' : '恢复'} · {current.notification.detail} · {time(current.notification.at)}</p>}{current.source && <RelatedLink {...monitorSourceLink(current.source)}>{current.source.type === 'project' ? '查看来源项目' : current.source.type === 'jar' ? '查看来源 JAR' : '查看来源主机'}</RelatedLink>}<ResourceLink page="monitor" id={current.id} />
        <SampleBars monitor={current} /><h3>响应耗时</h3>{current.samples.length ? <Latency key={current.id} monitor={current} /> : <p>首个检测完成后显示趋势。</p>}
        <h3>事件时间线</h3>
        {timeline.length ? <ol className="monitor-incidents">{timeline.map(item => <li key={item.key}>
          <span className={`monitor-status ${item.state}`}>{item.label}</span>
          <time dateTime={item.at}>{time(item.at)}</time>{'logJar' in item && item.logJar && <RelatedLink page="logs" id={'incident:' + Date.parse(item.at) + ':' + item.logJar}>查看故障前后 5 分钟日志</RelatedLink>}{item.detail && <p>{item.detail}</p>}
        </li>)}</ol> : <p>暂无故障、恢复或维护记录。</p>}
        <details className="monitor-samples"><summary>最近检测记录</summary><ul>{current.samples.slice(-30).reverse().map((sample, index) => <li key={index}><span>{sample.ok ? '正常' : '失败'} · {sample.elapsed} ms</span><small>{time(sample.at)} · {sample.detail}</small></li>)}</ul></details>
      </aside>}
    </div>}
    <MotionPresence kind="dialog" present={!!draft}>{draft && <Modal active={active} title={draft.id ? '编辑监控' : '添加监控'} close={() => setDraft(null)} draft={{ ...draft, start, end }} busy={busy}>
      <ModalForm
        footer={<footer className="pc-form-footer"><ModalCancel /><MotionButton className="run-button" busy={busy} disabled={busy || frozen}>保存监控</MotionButton></footer>}
        className="monitor-form" noValidate onSubmit={event => { event.preventDefault(); setSubmitted(true);
        const form = event.currentTarget;
        for (const control of Array.from(form.elements)) {
          if (!(control instanceof HTMLInputElement) || control.disabled) continue;
          if (issues[control.name] || !control.validity.valid) { control.focus(); if (!issues[control.name]) control.reportValidity(); return; }
        } if (!!start !== !!end) { setError('请同时填写维护开始与结束时间。'); return; } void action('upsert', { revision, monitor: { ...draft, maintenance: start && end ? { start: new Date(start).toISOString(), end: new Date(end).toISOString() } : null } }, () => setDraft(null)); }}>
        {error && <p className="pc-error" role="alert">{error}</p>}{restrictedSource ? <p className="pc-notice">{restrictedSource}</p> : frozen && <p className="pc-notice">编辑运行中的监控需要运行权限，请联系主机管理者。</p>}
        <Field label="监控名称"><input required maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></Field>
        <Field label="检测来源"><select value={draft.source ? JSON.stringify(draft.source) : ''} onChange={event => setDraft({ ...draft, source: event.target.value ? JSON.parse(event.target.value) : null })}><option value="">自定义地址</option>{draft.source && !sources.some(item => JSON.stringify(item.source) === JSON.stringify(draft.source)) && <option value={JSON.stringify(draft.source)}>当前关联（来源未开放或已删除）</option>}{sources.map(item => <option key={JSON.stringify(item.source)} value={JSON.stringify(item.source)}>{item.label}</option>)}</select></Field>
        <div className="monitor-actions" aria-label="新建检测来源">
          {draft.source && <RelatedLink {...monitorSourceLink(draft.source)}>查看所选来源</RelatedLink>}
          <CreateRelated from="monitor" page="projects">添加项目</CreateRelated>
          <CreateRelated from="monitor" page="jar">添加 JAR</CreateRelated>
          <CreateRelated from="monitor" page="lan-hosts">新建主机</CreateRelated>
        </div>
        {sourceError && <p role="alert">关联来源读取失败：{sourceError}。仍可填写自定义地址。</p>}
        {!draft.source && <><div className="pc-field choice-field"><span>检测类型</span><SegmentedControl label="检测类型" value={draft.type} options={[{ value: 'http', label: 'HTTP / HTTPS' }, { value: 'tcp', label: 'TCP 端口' }]} onChange={type => setDraft({ ...draft, type })} /></div>{draft.type === 'http' ? <Field label="检测地址"><input name="url" aria-invalid={submitted && !!issues.url} aria-describedby={submitted && issues.url ? "monitor-error-url" : undefined} required type="url" placeholder="https://example.com/health" value={draft.url} onChange={event => setDraft({ ...draft, url: event.target.value })} />{submitted && issues.url && <small id="monitor-error-url" className="pc-error">{issues.url}</small>}</Field> : <div className="monitor-form-row"><Field label="主机名 / IP"><input name="host" aria-invalid={submitted && !!issues.host} aria-describedby={submitted && issues.host ? "monitor-error-host" : undefined} required value={draft.host} onChange={event => setDraft({ ...draft, host: event.target.value })} />{submitted && issues.host && <small id="monitor-error-host" className="pc-error">{issues.host}</small>}</Field><Field label="端口"><input name="port" aria-invalid={submitted && !!issues.port} aria-describedby={submitted && issues.port ? "monitor-error-port" : undefined} required type="number" min={1} max={65535} value={draft.port} onChange={event => setDraft({ ...draft, port: Number(event.target.value) })} />{submitted && issues.port && <small id="monitor-error-port" className="pc-error">{issues.port}</small>}</Field></div>}</>}
        {(draft.source?.type === 'project' || !draft.source && draft.type === 'http') && <Field label="预期 HTTP 状态码"><input name="status" aria-invalid={submitted && !!issues.status} aria-describedby={submitted && issues.status ? "monitor-error-status" : undefined} required type="number" min={100} max={599} value={draft.status} onChange={event => setDraft({ ...draft, status: Number(event.target.value) })} />{submitted && issues.status && <small id="monitor-error-status" className="pc-error">{issues.status}</small>}</Field>}
        <div className="monitor-form-row">{([{ key: 'interval', label: '检测间隔（秒）', min: 10, max: 86400 }, { key: 'timeout', label: '超时（秒）', min: 1, max: 60 }, { key: 'failures', label: '连续失败确认次数', min: 1, max: 10 }] as const).map(field => <Field label={field.label} key={field.key}><input required type="number" min={field.min} max={field.max} value={draft[field.key]} onChange={event => setDraft({ ...draft, [field.key]: Number(event.target.value) })} /></Field>)}</div>
        <fieldset><legend>维护窗口（可选，期间暂停检测）</legend><div className="monitor-form-row"><Field label="开始时间"><input type="datetime-local" value={start} onChange={event => setStart(event.target.value)} /></Field><Field label="结束时间"><input type="datetime-local" value={end} onChange={event => setEnd(event.target.value)} /></Field></div></fieldset>
        {operate && <fieldset><legend>Webhook 通知</legend>
          <label className="monitor-enabled"><input type="checkbox" checked={!!draft.webhook} onChange={event => setDraft({ ...draft, webhook: event.target.checked ? { url: '', down: true, up: true } : null })} />启用通知</label>
          {draft.webhook && <><Field label="Webhook 地址"><input required type="url" value={draft.webhook.url} onChange={event => setDraft({ ...draft, webhook: { ...draft.webhook!, url: event.target.value } })} placeholder="https://example.com/webhook" /></Field><div className="monitor-form-row">{([{ key: 'down', label: '确认故障时发送' }, { key: 'up', label: '恢复时发送' }, { key: 'certificate', label: 'HTTPS 证书剩余 30 / 7 天时提醒' }] as const).map(item => <label key={item.key}><input type="checkbox" checked={draft.webhook![item.key]} onChange={event => setDraft({ ...draft, webhook: { ...draft.webhook!, [item.key]: event.target.checked } })} />{item.label}</label>)}</div><p className="monitor-form-hint">从监控主机发送 JSON POST。暂时性失败最多再试两次。</p></>}
        </fieldset>}
        <label className="monitor-enabled"><input type="checkbox" checked={draft.enabled} disabled={!operate || (!!restrictedSource && !draft.enabled)} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />保存后启用定时检测</label><p className="monitor-form-hint">修改配置会开始新的检测序列，旧故障记录保留。暂停和维护期间不产生样本。</p>
      </ModalForm>
    </Modal>}</MotionPresence>
    <MotionPresence kind="dialog" present={!!remove}>{remove && <Modal title="删除监控" close={() => setRemove(null)} busy={busy}>{error && <p className="pc-error" role="alert">{error}</p>}<p>删除“{remove.name}”及其检测历史、故障记录？此操作无法撤销。</p><div className="pc-form-footer"><button className="secondary-button" onClick={() => setRemove(null)}>取消</button><button className="run-button" disabled={busy} onClick={() => void action('remove', { id: remove.id, revision }, () => setRemove(null))}>确认删除</button></div></Modal>}</MotionPresence>
  </section>;
}

function Latency({ monitor }: { monitor: Monitor }) {
  const samples = monitor.samples.slice(-60);
  const last = samples.length - 1;
  const [selectedAt, select] = useState<string | null>(null);
  const selected = samples.findIndex(item => item.at === selectedAt);
  const index = selected < 0 ? last : selected;
  const sample = samples[index];
  const max = Math.max(...samples.map(item => item.elapsed));
  const x = (i: number) => 8 + i / Math.max(1, last) * 284;
  const y = (elapsed: number) => 76 - elapsed / Math.max(1, max) * 64;
  return <figure className="monitor-chart">
    <div className="monitor-chart-reading"><strong><RollingMilliseconds value={sample.elapsed} /> ms</strong><time dateTime={sample.at}>{time(sample.at)}</time></div>
    <div className="monitor-chart-plot"><svg viewBox="0 0 300 88" role="img" aria-label={`最近 ${samples.length} 次检测耗时，最高 ${max} 毫秒`}>
      <path d="M8 76H292" stroke="var(--line)" />
      <polyline points={samples.map((item, i) => `${x(i)},${y(item.elapsed)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" />
      <path d={`M${x(index)} 5V78`} stroke="var(--muted)" strokeDasharray="2 3" />
      {samples.map((item, i) => <circle key={i} cx={x(i)} cy={y(item.elapsed)} r={i === index ? 4 : 2} fill={item.ok ? 'var(--accent)' : 'var(--danger, #d66a77)'}><title>{time(item.at)} · {item.elapsed} ms</title></circle>)}
    </svg>{last > 0 && <input type="range" min={0} max={last} step={1} value={index} aria-label="选择检测样本" aria-valuetext={`${time(sample.at)}，${sample.elapsed} 毫秒`}
      onChange={event => { const i = event.currentTarget.valueAsNumber; select(i === last ? null : samples[i].at); }} />}</div>
    <figcaption>最近 {samples.length} 次 · 最高 {max} ms</figcaption>
  </figure>;
}

function RollingMilliseconds({ value }: { value: number }) {
  const [spring] = useState(() => createSpring(value, { stiffness: 370, damping: 38 }));
  const [reading, setReading] = useState(value);
  useEffect(() => {
    spring.subscribe(next => setReading(next));
    return () => spring.stop();
  }, [spring]);
  useEffect(() => spring.set(value), [spring, value]);
  const whole = Math.floor(Math.max(0, reading));
  const digits = String(whole);
  return <><span className="sr-only">{value}</span><span className="monitor-odometer" aria-hidden="true">
    {Array.from(digits, (char, i) => {
      const place = 10 ** (digits.length - i - 1);
      // Carry the next wheel only as the lower places roll through their last unit.
      const fraction = Math.max(0, reading % place - (place - 1));
      return <span className="monitor-digit" key={place}><span style={{ transform: `translateY(-${fraction}em)` }}>{char}<br />{(Number(char) + 1) % 10}</span></span>;
    })}
  </span></>;
}

function SampleBars({ monitor }: { monitor: Monitor }) {
  const samples = monitor.samples.slice(-60);
  if (!samples.length) return <p>暂无检测分布样本。</p>;
  const last = Date.parse(samples[samples.length - 1].at), first = Date.parse(samples[0].at);
  const width = Math.max(60000, Math.ceil((last - first + 1) / 8));
  const buckets = Array.from({length:8}, (_,index) => ({ from:last + 1 - (8-index)*width, ok:0, fail:0 }));
  for (const sample of samples) {
    const index = Math.floor((Date.parse(sample.at) - buckets[0].from) / width);
    if (buckets[index]) buckets[index][sample.ok ? 'ok' : 'fail']++;
  }
  const max = Math.max(1,...buckets.map(bucket => bucket.ok + bucket.fail));
  return <figure className="sample-bars"><figcaption>检测次数 · 最近 {samples.length} 个样本</figcaption><div>{buckets.map(bucket => {
    const label = time(new Date(bucket.from).toISOString()) + ' 起 · ' + (bucket.ok + bucket.fail ? `成功 ${bucket.ok}，失败 ${bucket.fail}` : '无样本');
    return <span key={bucket.from} tabIndex={0} aria-label={label} title={label}><i style={{height:bucket.ok / max * 48}} /><b style={{height:bucket.fail / max * 48}} /><small>{bucket.ok + bucket.fail || '—'}</small><em>{label}</em></span>;
  })}</div></figure>;
}
