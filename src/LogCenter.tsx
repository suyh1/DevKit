import { useEffect, useRef, useState } from 'react';
import { ScrollText, RefreshCw, Search, Pause, Play, Download, Copy, X, Eraser, ArrowDown } from 'lucide-react';
import { logsRequest, canExportLogs } from './logs-api';
import type { LogCatalog, LogSource, LogRead } from './logs-api';
import { copyText } from './motion-primitives';
import { saveText } from './files';
import { SharingButton } from './Sharing';
import './logs.css';

type Stream = LogRead & { text: string; notice?: string };
function mask(text: string) { return text.replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[已隐藏]').replace(/((?:password|passwd|secret|token|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s,"'}&]+/gi, '$1[已隐藏]'); }

export default function LogCenter({ active = true }: { active?: boolean }) {
  const [catalog, setCatalog] = useState<LogCatalog>({ sources: [], warnings: [] }), [selected, setSelected] = useState<string[]>([]);
  const [streams, setStreams] = useState<Record<string, Stream>>({}), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [regex, setRegex] = useState(false), [level, setLevel] = useState('all'), [redact, setRedact] = useState(true), [paused, setPaused] = useState(false), [loading, setLoading] = useState(false);
  const values = useRef(streams), alive = useRef(true), sourceVersion = useRef(0);
  useEffect(() => { values.current = streams; }, [streams]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sourceVersion.current++; }; }, []);
  async function refresh() {
    const generation = ++sourceVersion.current; setLoading(true);
    try { const next = await logsRequest<LogCatalog>('sources'); if (generation === sourceVersion.current && alive.current) { setCatalog(next); setError(''); } }
    catch (failure) { if (generation === sourceVersion.current && alive.current) setError((failure as Error).message); }
    finally { if (generation === sourceVersion.current && alive.current) setLoading(false); }
  }
  useEffect(() => { if (active) void refresh(); }, [active]);
  const selectedKey = selected.join('|');
  useEffect(() => {
    if (!active || paused || !selected.length) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const next = await logsRequest<{ results: LogRead[] }>('read', { sources: selected.map(id => ({ id, cursor: values.current[id]?.cursor })) });
        if (disposed) return;
        setStreams(previous => {
          const result = { ...previous };
          for (const item of next.results) {
            const old = previous[item.id];
            if (item.error) { result[item.id] = { ...old, ...item, text: old?.text || '' }; continue; }
            const content = (item.reset ? '' : old?.text || '') + (item.text || ''), clipped = content.length > 262144;
            result[item.id] = { ...item, text: content.slice(-262144), notice: clipped ? '本页最多保留 256 Ki 字符，较早内容已丢弃。' : item.reset && old?.cursor ? '文件被替换、截断或应用已重启，已开始新的输出段。' : item.truncated ? '仅加载来源最近的有界日志，较早内容未载入。' : item.available === false ? '控制台尚未运行，等待主机输出。' : old?.notice };
          }
          values.current = result; return result;
        });
        setError('');
      } catch (failure) { if (!disposed) setError((failure as Error).message); }
      finally { if (!disposed) timer = setTimeout(() => void read(), 2000); }
    }
    void read(); return () => { disposed = true; clearTimeout(timer); };
  }, [active, paused, selectedKey]);
  function toggle(id: string) {
    if (selected.includes(id)) {
      setSelected(selected.filter(value => value !== id));
      setStreams(previous => { const next = { ...previous }; delete next[id]; values.current = next; return next; });
    } else if (selected.length < 4) setSelected([...selected, id]);
  }
  async function exportLog(source: LogSource) {
    setMessage('');
    try {
      const result = (await logsRequest<{ results: LogRead[] }>('export', { sources: [{ id: source.id }] })).results[0];
      if (result.error) throw new Error(result.error);
      setMessage(await saveText(redact ? mask(result.text || '') : result.text || '', `devkit-log-${source.id.slice(0, 12)}.txt`));
    } catch (failure) { setError((failure as Error).message); }
  }
  return <section className="log-center">
    <header className="log-heading"><div><ScrollText size={27} /><div><h1>日志中心</h1><p>在同一视图中追踪应用与网关日志。</p></div></div><div className="log-actions"><SharingButton /><button className="secondary-button" disabled={loading} onClick={() => void refresh()}><RefreshCw size={14} />刷新来源</button><button className="secondary-button" onClick={() => setPaused(!paused)}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? '继续追踪' : '暂停接收'}</button></div></header>
    {error && <p className="pc-error" role="alert">{error}</p>}{message && <p className="pc-message" role="status">{message}</p>}
    <div className="log-toolbar"><label className="log-query"><Search size={14} /><input aria-label="筛选日志内容" placeholder="筛选当前已载入的日志行…" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} /></label><label><input type="checkbox" checked={regex} onChange={event => setRegex(event.target.checked)} />正则</label><select aria-label="日志级别" value={level} onChange={event => setLevel(event.target.value)}><option value="all">全部级别</option><option value="error">ERROR / FATAL</option><option value="warn">WARN</option><option value="info">INFO</option><option value="debug">DEBUG</option></select><label><input type="checkbox" checked={redact} onChange={event => setRedact(event.target.checked)} />显示脱敏</label><span className="log-live"><i data-paused={paused} />{paused ? '已暂停接收' : '每 2 秒增量读取'}</span></div>
    <div className="log-layout">
      <aside className="log-sources" aria-label="日志来源"><header><strong>日志来源</strong><small>{selected.length} / 4 已选择</small></header><input aria-label="搜索日志来源" placeholder="搜索来源或文件路径" value={search} onChange={event => setSearch(event.target.value)} />
        <div className="log-source-list">{catalog.sources.filter(item => `${item.name} ${item.path}`.toLowerCase().includes(search.toLowerCase())).map(item => <label key={item.id} className={selected.includes(item.id) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(item.id)} disabled={!selected.includes(item.id) && selected.length >= 4} onChange={() => toggle(item.id)} /><span><strong>{item.name}</strong><small>{item.kind === 'jar' ? 'JAR' : 'Nginx'} · {item.mode === 'console' ? '标准输出 / 错误' : item.path}</small></span></label>)}{!catalog.sources.length && <p>{loading ? '正在读取来源…' : '没有可读取的来源。请在 JAR / Nginx 登记日志，或请主机授权对应日志分类。'}</p>}</div>
        {!!catalog.warnings.length && <details className="log-warnings"><summary>来源提示（{catalog.warnings.length}）</summary>{catalog.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
      </aside>
      {!selected.length ? <div className="log-empty"><ScrollText size={36} /><h2>选择日志，开始对照</h2><p>从左侧选择最多 4 个来源。读取、筛选和清空显示均不修改原日志。</p><small>文件首屏最多 128 KiB；导出读取最近 1 MiB。控制台输出来自现有内存缓冲。</small></div> : <div className={`log-panels log-panels-${selected.length}`}>{selected.map(id => {
        const source = catalog.sources.find(item => item.id === id) || { id, name: '来源已移除或不再授权', path: '', kind: 'jar' as const, instanceId: '', mode: 'file' as const };
        return <LogPane key={id} source={source} stream={streams[id]} query={query} regex={regex} level={level} redact={redact} exportLog={() => void exportLog(source)} close={() => toggle(id)} clear={() => setStreams(previous => { const next = { ...previous, [id]: { ...previous[id], text: '', notice: '仅清空本页显示，接收游标保留。' } }; values.current = next; return next; })} />;
      })}</div>}
    </div>
  </section>;
}

function LogPane({ source, stream, query, regex, level, redact, exportLog, close, clear }: { source: LogSource; stream?: Stream; query: string; regex: boolean; level: string; redact: boolean; exportLog: () => void; close: () => void; clear: () => void }) {
  const [filtered, setFiltered] = useState(''), [filterError, setFilterError] = useState(''), [follow, setFollow] = useState(true), [notice, setNotice] = useState('');
  const output = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const worker = new Worker(new URL('./logs-filter.worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => { worker.terminate(); setFilterError('筛选运行超时，请简化正则表达式。'); }, 750);
    worker.onmessage = ({ data }: MessageEvent<{ text?: string; error?: string }>) => { clearTimeout(timer); worker.terminate(); setFilterError(data.error ? `筛选表达式无效：${data.error}` : ''); if (!data.error) setFiltered(data.text || ''); };
    worker.onerror = () => { clearTimeout(timer); worker.terminate(); setFilterError('筛选器未能启动，请刷新页面重试。'); };
    worker.postMessage({ text: stream?.text || '', query, regex, level, redact });
    return () => { clearTimeout(timer); worker.terminate(); };
  }, [stream?.text, query, regex, level, redact]);
  useEffect(() => { if (follow && output.current) output.current.scrollTop = output.current.scrollHeight; }, [filtered, follow]);
  return <section className="log-pane" aria-label={source.name}><header><div><strong>{source.name}</strong><small title={source.path}>{source.path || '应用内存输出'}</small></div><button aria-label={`关闭 ${source.name}`} onClick={close}><X size={15} /></button></header>
    <div className="log-pane-tools"><label><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} />自动滚动</label><div><button title="回到底部" aria-label={`回到底部 ${source.name}`} onClick={() => { setFollow(true); if (output.current) output.current.scrollTop = output.current.scrollHeight; }}><ArrowDown size={14} /></button><button title="清空本页显示" aria-label={`清空 ${source.name}`} onClick={clear}><Eraser size={14} /></button><button title="复制已筛选显示内容" aria-label={`复制 ${source.name}`} disabled={!!filterError} onClick={() => { void copyText(filtered).then(() => setNotice('已复制当前筛选内容。')).catch(error => setNotice(error.message)); }}><Copy size={14} /></button>{canExportLogs() && <button title="导出来源最近的有界内容（不应用筛选）" aria-label={`导出 ${source.name}`} onClick={exportLog}><Download size={14} /></button>}</div></div>
    {(stream?.error || filterError) && <p className="log-pane-error" role="alert">{stream?.error || filterError}{stream?.error && stream?.text && ' 当前保留上次内容，状态可能已过期。'}</p>}
    <pre ref={output} tabIndex={0} aria-label={`${source.name} 日志内容`}>{filterError ? '' : filtered || (stream ? '暂无匹配的日志行。' : '正在连接来源…')}</pre>
    <footer><span>{notice || stream?.notice || '只读追踪 · 不修改原文件'}</span><small>{stream?.checkedAt ? new Date(stream.checkedAt).toLocaleTimeString() : '等待读取'}</small></footer>
  </section>;
}
