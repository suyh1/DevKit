import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { lanRequest } from './lan-api';
import { copyText } from './motion-primitives';
import { readSessionClipboard } from './remote-clipboard';
import SftpPanel from './SftpPanel';
import '@xterm/xterm/css/xterm.css';

export default function SshTerminal({ id, active, allowFiles, portal }: { id: string; active: boolean; allowFiles: boolean; portal: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const controls = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const [message, setMessage] = useState('正在连接…');
  const [connectionId, setConnectionId] = useState(''), [filesOpen, setFilesOpen] = useState(false);
  const [running, setRunning] = useState(true);
  const [generation, setGeneration] = useState(0);
  const [selection, setSelection] = useState(false), [feedback, setFeedback] = useState('');
  useEffect(() => {
    if (!running) return;
    const node = container.current!;
    function appearance() {
      const style = getComputedStyle(node);
      const token = (name: string) => style.getPropertyValue(name).trim();
      return {
        fontFamily: token('--font-mono'),
        fontSize: parseFloat(token('--code-size')) || 14,
        theme: {
          background: token('--surface'), foreground: token('--text'), cursor: token('--accent'),
          cursorAccent: token('--surface'), selectionBackground: token('--selection'),
        },
      };
    }
    const terminal = new Terminal({ cursorBlink: true, scrollback: 5000, minimumContrastRatio: 4.5, ...appearance() });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(node);
    controls.current = terminal;
    fitAddon.current = fit;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (node.offsetWidth) fit.fit(); });
    });
    observer.observe(node);
    const themeObserver = new MutationObserver(() => {
      terminal.options = appearance();
      if (node.offsetWidth) fit.fit();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-theme-style'] });
    const app = node.closest('.app');
    if (app) themeObserver.observe(app, { attributes: true, attributeFilter: ['style'] });
    if (node.offsetWidth) fit.fit();
    let disposed = false, session = '', timer: ReturnType<typeof setTimeout> | undefined;
    let inputQueue: Promise<unknown> = Promise.resolve();
    const resize = terminal.onResize(size => { if (session) void lanRequest('terminal-resize', { id: session, ...size }).catch(() => {}); });
    const input = terminal.onData(text => {
      const id = session;
      if (new TextEncoder().encode(text).length > 524288) { setFeedback('每次最多粘贴 512 KiB 文本'); return; }
      if (id) inputQueue = inputQueue.then(() => {
        if (!disposed && session === id) return lanRequest('terminal-input', { id, text });
      }).catch(() => {});
    });
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
        if (result.closed) { setConnectionId(''); setMessage('会话已断开'); await close(); }
        else timer = setTimeout(() => void poll(), result.data ? 10 : 60);
      } catch (error) { if (!disposed) { setConnectionId(''); setMessage((error as Error).message); await close(); } }
    }
    void lanRequest<{ id: string }>('terminal-open', { id, cols: terminal.cols, rows: terminal.rows }).then(async connection => {
      session = connection.id;
      if (disposed) { await close(); return; }
      setMessage('');
      await lanRequest('terminal-resize', { id: session, cols: terminal.cols, rows: terminal.rows });
      if (!disposed) { setConnectionId(session); if (node.offsetWidth && !document.activeElement?.closest('dialog, .lan-terminal-tabs')) terminal.focus(); void poll(); }
    }).catch(error => { if (!disposed) { setConnectionId(''); setMessage(error.message); } void close(); });
    return () => { disposed = true; clearTimeout(timer); void close(); controls.current = null; fitAddon.current = null; observer.disconnect(); cancelAnimationFrame(frame); themeObserver.disconnect(); resize.dispose(); input.dispose(); selected.dispose(); terminal.dispose(); };
  }, [id, generation, running]);
  useEffect(() => {
    if (active) {
      fitAddon.current?.fit();
      if (!document.activeElement?.closest('dialog, .lan-terminal-tabs')) controls.current?.focus();
    }
  }, [active]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(''), 4000);
    return () => clearTimeout(timer);
  }, [feedback]);
  return <div className="lan-ssh-session">
    <div className="lan-terminal-message"><span role="status">{message || feedback || <span className="lan-live-dot" title="已连接"><span className="sr-only">已连接</span></span>}</span>
      {message && message !== '正在连接…' && <button type="button" className="text-button" onClick={() => { setFeedback(''); setSelection(false); setMessage('正在连接…'); setGeneration(value => value + 1); setRunning(true); }}>重新连接</button>}
      {running && (connectionId || message === '正在连接…') && <button type="button" className="text-button" onClick={() => {
        setRunning(false); setConnectionId(''); setSelection(false); setMessage('会话已断开');
      }}>断开连接</button>}
      <button type="button" className="text-button" disabled={!selection} onClick={() => void copyText(controls.current?.getSelection() || '').then(() => setFeedback('已复制选区'), () => setFeedback('复制失败'))}>复制选区</button>
      <button type="button" className="text-button" disabled={!connectionId} onClick={async () => {
        const terminal = controls.current;
        try {
          const text = await readSessionClipboard();
          if (terminal && terminal === controls.current) { terminal.paste(text); terminal.focus(); }
        } catch { setFeedback('请在终端内按 Ctrl+V 或 ⌘V 粘贴'); controls.current?.focus(); }
      }}>粘贴</button>
      <button type="button" className="text-button" onClick={() => { controls.current?.clear(); controls.current?.focus(); }}>清空显示</button>
      {allowFiles && <button type="button" className="text-button" aria-pressed={filesOpen} disabled={!connectionId} onClick={() => setFilesOpen(value => !value)}>SFTP 文件</button>}
    </div>
    <div className="lan-terminal-content">
      <div className="lan-xterm" ref={container} />
      {allowFiles && filesOpen && connectionId && <SftpPanel key={connectionId} session={connectionId} portal={portal} />}
    </div>
  </div>;
}
