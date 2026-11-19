import { useEffect, useRef, useState } from 'react';
import { ScrollText, RefreshCw, Search, Pause, Play, Download, Copy, X, Eraser, ArrowDown } from 'lucide-react';
import { logsRequest, canExportLogs, canReadRawLogs, eachRemoteLogCatalog } from './logs-api';
import type { LogCatalog, LogCursor, LogSource, LogRead } from './logs-api';
import { copyText } from './motion-primitives';
import { saveText } from './files';
import { SharingButton } from './Sharing';
import { usePerformanceMode } from './DisplayMode';
import { missingResourceLink, ResourceLink, useWorkspaceResource } from './workspace-links';
import './logs.css';

type Stream = LogRead & { text: string; notice?: string };
function mask(text: string) { return text.replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[已隐藏]').replace(/((?:password|passwd|secret|token|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s,"'}&]+/gi, '$1[已隐藏]'); }

export default function LogCenter({ active = true }: { active?: boolean }) {
  const refreshSeconds = usePerformanceMode() ? 6 : 2;
  const [catalog, setCatalog] = useState<LogCatalog>({ sources: [], warnings: [] }), [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [sourceStatus, setSourceStatus] = useState<Record<string, 'pending' | 'ready' | 'failed'>>({});
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [regex, setRegex] = useState(false), [level, setLevel] = useState('all'), [raw, setRaw] = useState(false), [paused, setPaused] = useState(false), [loading, setLoading] = useState(false);
  const [hostFilter, setHostFilter] = useState(''), [focusedSource, setFocusedSource] = useState('');
  const rawAllowed = raw && canReadRawLogs();
  const linked = useWorkspaceResource('logs');
  const handledLink = useRef('');
  const alive = useRef(true), sourceVersion = useRef(0);
  const rawPermission = canReadRawLogs();
  useEffect(() => { if (!rawPermission && raw) setRaw(false); }, [rawPermission, raw]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sourceVersion.current++; }; }, []);
  async function refresh() {
    const generation = ++sourceVersion.current; setLoading(true); setSourceStatus({ '': 'pending' });
    const live = () => generation === sourceVersion.current && alive.current;
    try {
      const next = await logsRequest<LogCatalog>('sources', { scope: 'inventory-local' });
      if (!live()) return;
      setCatalog(next); setError('');
      setSourceStatus(Object.fromEntries([['', 'ready'], ...(next.hosts || []).map(host => [host.id, 'pending'])]));
      await eachRemoteLogCatalog(next.hosts, live,
        (host, result) => {
          setCatalog(current => ({ ...current, sources: [...current.sources, ...result.sources], warnings: [...current.warnings, ...result.warnings.map(warning => `${host.name}：${warning}`)] }));
          setSourceStatus(current => ({ ...current, [host.id]: 'ready' }));
        },
        (host, failure) => {
          setCatalog(current => ({ ...current, warnings: [...current.warnings, `${host.name}：${failure.message}`] }));
          setSourceStatus(current => ({ ...current, [host.id]: 'failed' }));
        },
      );
    }
    catch (failure) { if (generation === sourceVersion.current && alive.current) setError((failure as Error).message); }
    finally { if (generation === sourceVersion.current && alive.current) setLoading(false); }
  }
  useEffect(() => { if (active) void refresh(); }, [active]);
  useEffect(() => {
    if (!linked || !active) { handledLink.current = ''; return; }
    if (handledLink.current === linked) return;
    if (linked.startsWith('host:')) {
      handledLink.current = linked;
      setHostFilter(linked.slice(5)); setSearch('');
      return;
    }
    const matched = catalog.sources.filter(item => item.id === linked || `instance:${item.instanceId}` === linked).slice(0, 4);
    if (!matched.length) return;
    handledLink.current = linked;
    setSearch(''); setHostFilter(''); setSelected(matched.map(item => item.id)); setFocusedSource(matched[0].id); setPaused(false);
  }, [linked, active, catalog.sources]);
  function toggle(id: string) {
    setSelected(values => values.includes(id) ? values.filter(value => value !== id) : values.length < 4 ? [...values, id] : values);
  }
  const paneId = selected.includes(focusedSource) ? focusedSource : selected[0];
  const panes = selected.map(id => catalog.sources.find(item => item.id === id)
    || { id, name: '来源已移除或不再授权', path: '', kind: 'jar' as const, instanceId: '', mode: 'file' as const });
  async function exportLog(source: LogSource) {
    setMessage('');
    try {
      const result = (await logsRequest<{ results: LogRead[] }>('export', { raw: rawAllowed, sources: [{ id: source.id }] })).results[0];
      if (result.error) throw new Error(result.error);
      setMessage(await saveText(rawAllowed ? result.text || '' : mask(result.text || ''), `devkit-log-${source.id.slice(-12)}.txt`));
    } catch (failure) { setError((failure as Error).message); }
  }
  const matching = catalog.sources.filter(item => (!hostFilter || (item.hostId || 'local') === hostFilter) && `${item.name} ${item.path} ${item.hostName || ''}`.toLowerCase().includes(search.toLowerCase()));
  const groups = [...new Set(matching.map(item => item.hostId || ''))];
  const localName = window.devkitLogs ? '本机' : '共享主机';
  const missingHost = hostFilter && hostFilter !== 'local' && !catalog.hosts?.some(host => host.id === hostFilter);
  const hostLoad = sourceStatus[hostFilter === 'local' ? '' : hostFilter];
  const linkTarget = linked?.replace(/^instance:/, '') || '';
  const linkHost = linkTarget.includes(':') ? linkTarget.split(':')[0] : '';
  const linkStatus = linked && !linked.startsWith('host:') && sourceStatus[''] === 'ready' && !catalog.sources.some(item => item.id === linked || `instance:${item.instanceId}` === linked) ? sourceStatus[linkHost] || 'ready' : undefined;
  return <section className="log-center">
    <header className="log-heading workspace-banner"><div><ScrollText size={27} /><div><h1>日志中心</h1><p>在同一视图中追踪应用与网关日志。</p></div></div><div className="log-actions"><SharingButton /><button className="secondary-button" disabled={loading} onClick={() => void refresh()}><RefreshCw size={14} />刷新来源</button><button className="secondary-button" onClick={() => setPaused(!paused)}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? '继续追踪' : '暂停接收'}</button></div></header>
    {error && <p className="pc-error" role="alert">{error}</p>}{message && <p className="pc-message" role="status">{message}</p>}
    {linkStatus === 'ready' && <p className="pc-notice" role="status">{missingResourceLink('日志来源')}</p>}
    {linkStatus === 'failed' && <p className="pc-notice" role="status">无法读取链接中的日志来源，请刷新来源重试。</p>}
    <div className="log-toolbar"><label className="log-query"><Search size={14} /><input aria-label="筛选日志内容" placeholder="筛选当前已载入的日志行…" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} /></label><label><input type="checkbox" checked={regex} onChange={event => setRegex(event.target.checked)} />正则</label><select aria-label="日志级别" value={level} onChange={event => setLevel(event.target.value)}><option value="all">全部级别</option><option value="error">ERROR / FATAL</option><option value="warn">WARN</option><option value="info">INFO</option><option value="debug">DEBUG</option></select><label><input type="checkbox" checked={!rawAllowed} disabled={!canReadRawLogs()} onChange={event => setRaw(!event.target.checked)} />主机脱敏</label><span className="log-live"><i data-paused={paused} />{paused ? '已暂停接收' : `每 ${refreshSeconds} 秒增量读取`}</span></div>
    <div className="log-layout">
      <aside className="log-sources" aria-label="日志来源"><header><strong>日志来源</strong><small>{selected.length} / 4 已选择</small></header><input aria-label="搜索日志来源" placeholder="搜索来源或文件路径" value={search} onChange={event => setSearch(event.target.value)} />
        <select aria-label="按主机筛选日志来源" value={hostFilter} onChange={event => setHostFilter(event.target.value)}><option value="">全部主机</option><option value="local">{localName}</option>{catalog.hosts?.map(host => <option key={host.id} value={host.id}>{host.name}</option>)}{missingHost && <option value={hostFilter}>{loading ? '正在读取目标主机…' : '目标主机不可用'}</option>}</select>
        <div className="log-source-list">{groups.map(id => <section key={id}><h3>{id ? `目标主机 · ${matching.find(item => item.hostId === id)?.hostName}` : localName}</h3>{matching.filter(item => (item.hostId || '') === id).map(item => <label key={item.id} className={selected.includes(item.id) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(item.id)} disabled={!selected.includes(item.id) && selected.length >= 4} onChange={() => toggle(item.id)} /><span><strong>{item.name}</strong><small>{item.kind === 'jar' ? 'JAR' : 'Nginx'} · {item.mode === 'console' ? '标准输出 / 错误' : item.path}</small></span></label>)}</section>)}{!matching.length && <p>{hostLoad === 'failed' ? '读取目标主机的日志来源失败，请查看来源提示。' : hostLoad === 'pending' || loading && !hostLoad ? '正在读取来源…' : missingHost ? '目标主机已移除或当前访客无权查看其日志。' : '暂无匹配的日志来源。'}</p>}</div>
        {!!catalog.warnings.length && <details className="log-warnings"><summary>来源提示（{catalog.warnings.length}）</summary>{catalog.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
      </aside>
      {!selected.length ? <div className="log-empty"><ScrollText size={36} /><h2>选择日志，开始对照</h2><p>从左侧选择最多 4 个来源。读取、筛选和清空显示均不修改原日志。</p><small>文件首屏最多 128 KiB；导出读取最近 1 MiB。控制台输出来自现有内存缓冲。</small></div> : <div className="log-streams">
        {panes.length > 1 && <div className="log-switcher" role="group" aria-label="切换日志流">
          {panes.map(source => <button key={source.id} type="button" aria-pressed={paneId === source.id}
            title={source.hostName ? `${source.hostName} / ${source.name}` : source.name}
            onClick={() => setFocusedSource(source.id)}>{source.name}</button>)}
        </div>}
        <div className={`log-panels log-panels-${panes.length}`}>{panes.map(source =>
          <LogPane key={`${source.id}:${rawAllowed}`} source={source} focused={source.id === paneId} tracking={active && !paused}
            refreshSeconds={refreshSeconds} query={query} regex={regex} level={level} redact={!rawAllowed}
            exportLog={() => void exportLog(source)} close={() => toggle(source.id)} />)}
        </div>
      </div>}
    </div>
  </section>;
}

function LogPane({ source, focused, tracking, refreshSeconds, query, regex, level, redact, exportLog, close }: { source: LogSource; focused: boolean; tracking: boolean; refreshSeconds: number; query: string; regex: boolean; level: string; redact: boolean; exportLog: () => void; close: () => void }) {
  const [stream, setStream] = useState<Stream>();
  const [filtered, setFiltered] = useState(''), [filterError, setFilterError] = useState(''), [follow, setFollow] = useState(true), [notice, setNotice] = useState('');
  const output = useRef<HTMLPreElement>(null);
  const cursor = useRef<LogCursor | null>(null);
  useEffect(() => {
    if (!tracking) return;
    const controller = new AbortController(), id = source.id;
    let timer: ReturnType<typeof setTimeout>;
    function update(item: LogRead) {
      if (controller.signal.aborted) return;
      if (!item.error) cursor.current = item.cursor ?? null;
      setStream(old => {
        if (item.error) return { ...old, ...item, text: old?.text || '' };
        const content = (item.reset ? '' : old?.text || '') + (item.text || ''), clipped = content.length > 262144;
        return { ...item, text: content.slice(-262144), notice: clipped ? '本页最多保留 256 Ki 字符，较早内容已丢弃。' : item.reset && old?.cursor ? '文件被替换、截断或应用已重启，已开始新的输出段。' : item.truncated ? '仅加载来源最近的有界日志，较早内容未载入。' : item.available === false ? '控制台尚未运行，等待主机输出。' : old?.notice };
      });
    }
    async function read() {
      try {
        if (document.hidden) return;
        const { results } = await logsRequest<{ results: LogRead[] }>('read', { raw: !redact, sources: [{ id, cursor: cursor.current }] }, controller.signal);
        update(results[0] || { id, error: '主机未返回日志来源。' });
      } catch (failure) { update({ id, error: (failure as Error).message }); }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void read(), refreshSeconds * 1000); }
    }
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [tracking, source.id, redact, refreshSeconds]);
  const clear = () => setStream(old => ({ id: source.id, ...old, text: '', notice: '仅清空本页显示，接收游标保留。' }));
  useEffect(() => {
    const worker = new Worker(new URL('./logs-filter.worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => { worker.terminate(); setFilterError('筛选运行超时，请简化正则表达式。'); }, 750);
    worker.onmessage = ({ data }: MessageEvent<{ text?: string; error?: string }>) => { clearTimeout(timer); worker.terminate(); setFilterError(data.error ? `筛选表达式无效：${data.error}` : ''); if (!data.error) setFiltered(data.text || ''); };
    worker.onerror = () => { clearTimeout(timer); worker.terminate(); setFilterError('筛选器未能启动，请刷新页面重试。'); };
    worker.postMessage({ text: stream?.text || '', query, regex, level, redact });
    return () => { clearTimeout(timer); worker.terminate(); };
  }, [stream?.text, query, regex, level, redact]);
  useEffect(() => { if (follow && output.current) output.current.scrollTop = output.current.scrollHeight; }, [filtered, follow]);
  return <section className="log-pane" aria-label={source.name} data-focused={focused}><header><div><strong>{source.name}</strong><small title={source.path}>{source.path || '应用内存输出'}</small></div><button aria-label={`关闭 ${source.name}`} onClick={close}><X size={15} /></button></header>
    <div className="log-pane-tools"><label><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} />自动滚动</label><div><button title="回到底部" aria-label={`回到底部 ${source.name}`} onClick={() => { setFollow(true); if (output.current) output.current.scrollTop = output.current.scrollHeight; }}><ArrowDown size={14} /></button><button title="清空本页显示" aria-label={`清空 ${source.name}`} onClick={clear}><Eraser size={14} /></button><button title="复制已筛选显示内容" aria-label={`复制 ${source.name}`} disabled={!!filterError} onClick={() => { void copyText(filtered).then(() => setNotice('已复制当前筛选内容。')).catch(error => setNotice(error.message)); }}><Copy size={14} /></button>{canExportLogs() && <button title="导出来源最近的有界内容（不应用筛选）" aria-label={`导出 ${source.name}`} onClick={exportLog}><Download size={14} /></button>}</div></div>
    {(stream?.error || filterError) && <p className="log-pane-error" role="alert">{stream?.error || filterError}{stream?.error && stream?.text && ' 当前保留上次内容，状态可能已过期。'}</p>}
    <pre ref={output} tabIndex={0} aria-label={`${source.name} 日志内容`}>{filterError ? '' : filtered || (stream ? '暂无匹配的日志行。' : '正在连接来源…')}</pre>
    <footer><span>{notice || stream?.notice || '只读追踪 · 不修改原文件'}</span><ResourceLink page="logs" id={source.id} /><small>{stream?.checkedAt ? new Date(stream.checkedAt).toLocaleTimeString() : '等待读取'}</small></footer>
  </section>;
}
