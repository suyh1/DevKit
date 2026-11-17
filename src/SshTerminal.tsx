import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { lanRequest } from './lan-api';
import { copyText } from './motion-primitives';
import '@xterm/xterm/css/xterm.css';

export default function SshTerminal({ id, active }: { id: string; active: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const controls = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const [message, setMessage] = useState('正在连接…');
  const [generation, setGeneration] = useState(0);
  const [selection, setSelection] = useState(false), [feedback, setFeedback] = useState('');
  useEffect(() => {
    const node = container.current!;
    const terminal = new Terminal({ cursorBlink: true, scrollback: 5000, fontFamily: 'Consolas, monospace', theme: { background: '#101720' } });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(node);
    controls.current = terminal;
    fitAddon.current = fit;
    const observer = new ResizeObserver(() => { if (node.offsetWidth) fit.fit(); });
    observer.observe(node);
    if (node.offsetWidth) fit.fit();
    let disposed = false, session = '', timer: ReturnType<typeof setTimeout> | undefined;
    const resize = terminal.onResize(size => { if (session) void lanRequest('terminal-resize', { id: session, ...size }).catch(() => {}); });
    const input = terminal.onData(text => { if (session) void lanRequest('terminal-input', { id: session, text }).catch(() => {}); });
    const selected = terminal.onSelectionChange(() => setSelection(terminal.hasSelection()));
    async function close() {
      if (session) { const id = session; session = ''; await lanRequest('terminal-close', { id }).catch(() => {}); }
    }
    async function poll() {
      try {
        const result = await lanRequest<{ data: string; closed: boolean }>('terminal-read', { id: session });
        if (disposed) return;
        if (result.data) await new Promise<void>(resolve => terminal.write(Uint8Array.from(atob(result.data), char => char.charCodeAt(0)), resolve));
        if (disposed) return;
        if (result.closed) { setMessage('会话已断开'); await close(); }
        else timer = setTimeout(() => void poll(), result.data ? 10 : 60);
      } catch (error) { if (!disposed) { setMessage((error as Error).message); await close(); } }
    }
    void lanRequest<{ id: string }>('terminal-open', { id, cols: terminal.cols, rows: terminal.rows }).then(async connection => {
      session = connection.id;
      if (disposed) { await close(); return; }
      setMessage('');
      await lanRequest('terminal-resize', { id: session, cols: terminal.cols, rows: terminal.rows });
      if (!disposed) { if (node.offsetWidth && !document.activeElement?.closest('dialog')) terminal.focus(); void poll(); }
    }).catch(error => { if (!disposed) setMessage(error.message); void close(); });
    return () => { disposed = true; clearTimeout(timer); void close(); controls.current = null; fitAddon.current = null; observer.disconnect(); resize.dispose(); input.dispose(); selected.dispose(); terminal.dispose(); };
  }, [id, generation]);
  useEffect(() => { if (active) { fitAddon.current?.fit(); controls.current?.focus(); } }, [active]);
  return <div className="lan-ssh-session">
    <div className="lan-terminal-message"><span role="status">{message || feedback || '已连接'}</span>
      {message && message !== '正在连接…' && <button type="button" className="text-button" onClick={() => { setFeedback(''); setSelection(false); setMessage('正在连接…'); setGeneration(value => value + 1); }}>重新连接</button>}
      <button type="button" className="text-button" disabled={!selection} onClick={() => void copyText(controls.current?.getSelection() || '').then(() => setFeedback('已复制选区'), () => setFeedback('复制失败'))}>复制选区</button>
      <button type="button" className="text-button" onClick={() => { controls.current?.clear(); controls.current?.focus(); }}>清空显示</button>
    </div>
    <div className="lan-xterm" ref={container} />
  </div>;
}
