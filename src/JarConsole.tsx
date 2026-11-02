import { useEffect, useRef, useState } from 'react';
import { Copy, Search, Square, X } from 'lucide-react';
import { jarRequest, newJarClientId } from './jar-api';
import type { JarConsoleSnapshot } from './jar-api';
import { canOperateJar } from './workspace-remote';
import { copyText } from './motion-primitives';
import { useConfirmation } from './Confirmation';

export default function JarConsole({ id, name, active, close, stop }: { id: string; name: string; active: boolean; close: () => void; stop: () => void }) {
  const clientId = useRef(newJarClientId()), position = useRef<{ cursor: number; generation?: string }>({ cursor: 0 });
  const [snapshot, setSnapshot] = useState<JarConsoleSnapshot | null>(null), [text, setText] = useState(''), [input, setInput] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [connectionError, setConnectionError] = useState(''), [notice, setNotice] = useState(''), [query, setQuery] = useState(''), [follow, setFollow] = useState(true);
  const output = useRef<HTMLPreElement>(null), confirm = useConfirmation();
  const control = canOperateJar();
  const payload = () => ({ id, clientId: clientId.current, ...position.current });
  async function task(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } }
  useEffect(() => {
    if (!active) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    async function read() {
      let next = 750;
      if (document.hidden) { if (!disposed) timer = setTimeout(() => void read(), 1000); return; }
      try {
        const result = await jarRequest<JarConsoleSnapshot>('console-read', payload());
        if (disposed) return;
        setConnectionError('');
        setSnapshot(result);
        if (result.available) {
          if (result.reset) { setText(result.text || ''); if (position.current.generation && position.current.generation !== result.generation) { setInput(''); setNotice('应用已重新启动，输出与输入控制权已重置。'); } }
          else if (result.text) setText(current => (current + result.text).slice(-1024 * 1024));
          if (result.truncated) setNotice('部分旧输出已超出缓冲上限，当前显示仍保留的内容。');
          position.current = { cursor: result.cursor || 0, generation: result.generation };
          if ((result.cursor || 0) < (result.end || 0)) next = 40;
        }
      } catch (failure) { if (!disposed) setConnectionError((failure as Error).message); next = 3000; }
      finally { if (!disposed) timer = setTimeout(() => void read(), next); }
    }
    void read();
    return () => { disposed = true; clearTimeout(timer); void jarRequest('console-release', payload()).catch(() => {}); };
  }, [active, id, control]);
  useEffect(() => { if (follow && output.current) output.current.scrollTop = output.current.scrollHeight; }, [text, follow]);
  const matches = query ? text.split('\n').filter(line => line.toLowerCase().includes(query.toLowerCase())).join('\n') : text;
  return <section className="jar-log jar-console" aria-label={`${name} 应用控制台`}>
    <header><div><h2>{name} · 控制台</h2><p>关闭面板或断线后应用继续运行。输出仅在内存保留，最多 1 Mi 字符，不写标准输出日志文件。</p></div><button className="icon-button" aria-label="关闭控制台" onClick={close}><X size={17} /></button></header>
    <div className="jar-toolbar"><label className="jar-search"><Search size={14} /><input aria-label="搜索控制台输出" value={query} onChange={event => setQuery(event.target.value)} placeholder="筛选当前输出行" /></label><div className="jar-actions">
      <label className="jar-auto"><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} />自动滚动</label>
      <button className="text-button" onClick={() => { setFollow(true); if (output.current) output.current.scrollTop = output.current.scrollHeight; }}>回到底部</button>
      <button className="text-button" onClick={() => { setText(''); setNotice('仅清空本页显示，不影响其他查看者。'); }}>清空显示</button>
      <button className="text-button" onClick={() => void task(async () => { await copyText(matches); setNotice('已复制控制台输出。'); })}><Copy size={14} />复制输出</button>
    </div></div>
    {(error || connectionError) && <p className="jar-error" role="alert">{error || connectionError}</p>}{notice && <p className="jar-help" role="status">{notice}</p>}
    <pre ref={output} tabIndex={0} aria-label="控制台输出">{matches || (!snapshot ? '正在连接控制台…' : snapshot.available ? '等待应用输出…' : '控制台尚未运行。请选择 console 模式启动应用。')}</pre>
    <div className="jar-console-control"><span>{snapshot?.lease ? snapshot.lease.mine ? '你持有输入控制权' : `输入控制者：${snapshot.lease.label}` : '当前无人控制输入'}</span>
      <button className="secondary-button" disabled={busy || !control || !snapshot?.inputOpen} onClick={() => void task(async () => {
        if (snapshot?.lease?.mine) { await jarRequest('console-release', payload()); setSnapshot(current => current && ({ ...current, lease: null })); }
        else { const result = await jarRequest<{ lease: JarConsoleSnapshot['lease'] }>('console-claim', payload()); setSnapshot(current => current && ({ ...current, lease: result.lease })); }
      })}>{snapshot?.lease?.mine ? '释放输入控制权' : '取得输入控制权'}</button>
      <button className="text-button jar-danger" disabled={busy || !control || !snapshot?.available} onClick={stop}><Square size={14} />停止应用</button>
    </div>
    <form className="jar-console-input" onSubmit={event => { event.preventDefault(); void task(async () => { await jarRequest('console-input', { ...payload(), text: input }); setInput(''); }); }}>
      <input aria-label="发送给 Java 应用的输入" maxLength={4096} placeholder={control ? '应用输入，每次发送一行；不会执行系统 Shell' : '只读访问，未授予控制台输入权限'} value={input} disabled={busy || !control || !snapshot?.lease?.mine || !snapshot?.inputOpen} onChange={event => setInput(event.target.value)} />
      <button className="run-button" disabled={busy || !control || !snapshot?.lease?.mine || !snapshot?.inputOpen} type="submit">发送</button>
      <button className="text-button" disabled={busy || !control || !snapshot?.lease?.mine || !snapshot?.inputOpen} type="button" onClick={() => void (async () => { if (await confirm({ title: '结束此应用的标准输入？', detail: '向应用发送 EOF，输入管道需要重新启动应用才能恢复。', confirm: '结束输入' })) await task(async () => { await jarRequest('console-eof', payload()); setSnapshot(current => current && ({ ...current, inputOpen: false, lease: null })); }); })()}>结束输入</button>
    </form>
    <p className="jar-help">断线或停止查看 20 秒后输入控制权释放，关闭视图时主动释放；多人可同时查看。控制台使用 UTF-8 标准输入输出，不提供 PTY、System.console() 或全屏终端。</p>
  </section>;
}
