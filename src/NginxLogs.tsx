import { useEffect, useRef, useState } from 'react';
import { nginxRequest } from './nginx-api';
import type { NginxInspection, NginxLog } from './nginx-api';
import CodeEditor from './CodeEditor';
import { saveText } from './files';

export default function NginxLogs({ id, active }: { id: string; active: boolean }) {
  const [scan, setScan] = useState<NginxInspection | null>(null), [path, setPath] = useState('');
  const [query, setQuery] = useState(''), [level, setLevel] = useState('all'), [lines, setLines] = useState(300);
  const [epoch, setEpoch] = useState(0);
  const [following, setFollowing] = useState(false), [result, setResult] = useState<NginxLog | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [rotated, setRotated] = useState(false);
  const previous = useRef<NginxLog | null>(null), serial = useRef(0);
  const followRef = useRef(following); followRef.current = following;
  useEffect(() => {
    let disposed = false; setScan(null); setPath(''); setResult(null); setFollowing(false); setError(''); previous.current = null;
    void nginxRequest<NginxInspection>('inspect', { id }).then(scan => { if (!disposed) { setScan(scan); setPath(scan.logs[0]?.path || ''); } }).catch(error => { if (!disposed) setError(error.message); });
    return () => { disposed = true; serial.current++; };
  }, [id]);
  useEffect(() => {
    let disposed = false, running = false; const ticket = ++serial.current;
    setResult(null); setError(''); setRotated(false);
    async function read(fromFollow = false) {
      if (!path || running || disposed || !active) return;
      running = true; setBusy(true);
      try {
        const next = await nginxRequest<NginxLog>('log-tail', { id, path, lines, query, level });
        if (!disposed && ticket === serial.current && (!fromFollow || followRef.current)) {
          setRotated(!!previous.current && previous.current.path === next.path && (previous.current.identity !== next.identity || previous.current.size > next.size));
          previous.current = next; setResult(next); setError('');
        }
      } catch (error) { if (!disposed) { setError((error as Error).message); setFollowing(false); } }
      finally { running = false; if (!disposed) setBusy(false); }
    }
    void read();
    const timer = active ? setInterval(() => { if (followRef.current) void read(true); }, 2000) : undefined;
    return () => { disposed = true; clearInterval(timer); };
  }, [id, path, lines, query, level, active, epoch]);
  return <section className="ng-log-view"><h3>实例日志</h3><div className="feature-toolbar"><label>日志文件<select aria-label="日志文件" value={path} onChange={event => setPath(event.target.value)}>{scan?.logs.map(log => <option key={log.path} value={log.path}>{log.kinds.join('/')} · {log.path}</option>)}</select></label><label>关键词<input aria-label="日志关键词" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></label><label>级别<select aria-label="日志级别" value={level} onChange={event => setLevel(event.target.value)}>{[['all', '全部'], ['error', '错误及以上'], ['warn', 'warn'], ['notice', 'notice'], ['info', 'info'], ['debug', 'debug']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>末尾行数<select aria-label="日志末尾行数" value={lines} onChange={event => setLines(Number(event.target.value))}>{[100, 300, 1000, 2000].map(value => <option key={value}>{value}</option>)}</select></label><button className="secondary-button" disabled={!path} aria-pressed={following} onClick={() => setFollowing(value => !value)}>{following ? '暂停跟随' : '跟随日志'}</button><button className="text-button" disabled={!path || busy} onClick={() => setEpoch(value => value + 1)}>刷新日志</button><button className="text-button" disabled={!result} onClick={() => void saveText(result?.text || '', 'nginx-log-fragment.log').catch(error => setError(String(error)))}>导出筛选片段</button></div>{scan?.warnings.map((warning, i) => <p className="ng-warning" key={i}>{warning}</p>)}{scan && !scan.logs.length && <p>未发现显式配置的文件日志。off、stderr、syslog、变量路径及未显式声明的编译默认日志不在此列表。</p>}{error && <p className="ng-error" role="alert">{error}</p>}{rotated && <p role="status">日志已轮转或截断，已重新读取当前文件。</p>}{result && <><p className="preview-note">文件 {result.size.toLocaleString()} 字节 · 更新于 {result.modifiedAt} · {result.truncated ? '仅显示末尾读取窗口内的匹配结果' : '已读取全部文件'}{busy ? ' · 刷新中' : ''}</p><div className="ng-log-editor"><CodeEditor label="日志内容" value={result.text} language="text" readOnly wrap /></div>{!result.text && <p>当前读取窗口内没有匹配的日志。</p>}</>}</section>;
}
