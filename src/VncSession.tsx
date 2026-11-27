import { useEffect, useRef, useState } from 'react';
import RFB from './vnc-rfb';
import { dibToPng, pngToDib } from './vnc-bitmap';
import { checkText } from './clipboard-formats';
import { VncChannel } from './vnc-channel';
import SegmentedControl from './SegmentedControl';

import SessionClipboard from './SessionClipboard';
import { bindRemoteClipboard, copyScreen } from './remote-clipboard';

const fieldLabels: Record<string, string> = { username: '用户名', password: 'VNC 密码', target: '目标' };
export default function VncSession({ id, portal = false }: { id: string; portal?: boolean }) {
  const [remote, setRemote] = useState('');
  const viewport = useRef<HTMLDivElement>(null), client = useRef<RFB | undefined>(undefined);
  const [running, setRunning] = useState(true);
  const resumeDeadline = useRef<() => void>(() => {});
  const [connected, setConnected] = useState(false), [message, setMessage] = useState('');
  const [fields, setFields] = useState<string[]>([]), [fingerprint, setFingerprint] = useState('');
  const [scale, setScale] = useState(true), [viewOnly, setViewOnly] = useState(false);
  const shortcuts = useRef<ReturnType<typeof bindRemoteClipboard> | undefined>(undefined);
  const options = useRef({ scale, viewOnly });
  options.current = { scale, viewOnly };
  useEffect(() => {
    if (!running || !viewport.current) return;
    let disposed = false, failure = '';
    setRemote(''); setMessage('正在连接 VNC…'); setFields([]); setFingerprint(''); setConnected(false);
    const channel = new VncChannel(id, message => { failure = message; }, portal);
    const rfb = new RFB(viewport.current, channel);
    client.current = rfb;
    rfb.scaleViewport = options.current.scale;
    rfb.viewOnly = options.current.viewOnly;
    let ready = false;
    const clipboard = bindRemoteClipboard(viewport.current, {
      enabled: () => ready && !disposed && !rfb.viewOnly,
      protocol: 'desktop-vnc',
      async sendFiles(files, usable) {
        if (files.length !== 1 || files[0].type !== 'image/png') throw new Error('VNC 文件剪贴板未标准化，请使用 SFTP 或 FTP 会话传文件。');
        const dib = await pngToDib(files[0]);
        if (!usable()) return false;
        await rfb.clipboardPasteDib(dib, usable);
        return true;
      },
      sendText: (text, usable) => rfb.clipboardPasteFrom(text, usable),
      key: (symbol, code, down) => rfb.sendKey(symbol, code, down),
      notice: message => setMessage(message || 'VNC 已连接'),
    });
    shortcuts.current = clipboard;
    let timer: ReturnType<typeof setTimeout>;
    function deadline() {
      clearTimeout(timer);
      timer = setTimeout(() => { failure = 'VNC 握手超时，请检查服务和端口。'; rfb.disconnect(); }, 20000);
    }
    resumeDeadline.current = deadline;
    deadline();
    rfb.addEventListener('connect', () => {
      clearTimeout(timer);
      if (!disposed) { ready = true; setConnected(true); setMessage('VNC 已连接'); }
    });
    rfb.addEventListener('clipboard', event => {
      const value = (event as CustomEvent).detail.text;
      if (!disposed && typeof value === 'string') {
        void clipboard.receive(value);
        const problem = checkText(value, 'desktop-vnc');
        setRemote(problem ? '' : value);
        if (problem) setMessage(problem);
      }
    });
    rfb.addEventListener('clipboardimage', event => { void clipboard.receiveImage(() => dibToPng((event as CustomEvent).detail)); });
    rfb.addEventListener('clipboarderror', event => { if (!disposed) setMessage((event as CustomEvent).detail); });
    rfb.addEventListener('credentialsrequired', event => {
      clearTimeout(timer);
      if (!disposed) { setFields((event as CustomEvent).detail.types); setMessage('目标要求登录'); }
    });
    rfb.addEventListener('serververification', async event => {
      clearTimeout(timer);
      if (!window.crypto.subtle) {
        failure = '此 VNC 认证需要通过 HTTPS 访问共享页，请使用 HTTPS 地址或选择 guacd 网关。';
        rfb.disconnect();
        return;
      }
      const hash = await crypto.subtle.digest('SHA-256', (event as CustomEvent).detail.publickey);
      if (!disposed) {
        setFingerprint(Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(':'));
        setMessage('请与管理员核对服务器公钥的 SHA-256 指纹');
      }
    });
    rfb.addEventListener('securityfailure', event => { failure = (event as CustomEvent).detail.reason || 'VNC 认证失败，请检查凭据。'; });
    rfb.addEventListener('disconnect', event => {
      ready = false; clipboard.reset();
      if (!disposed) { setMessage(failure || ((event as CustomEvent).detail.clean ? 'VNC 会话已断开' : 'VNC 连接失败，请检查目标端口、认证方式和服务状态。')); setRunning(false); }
    });
    void channel.connect();
    return () => { disposed = true; clipboard.dispose(); shortcuts.current = undefined; clearTimeout(timer); rfb.disconnect(); channel.close(); client.current = undefined; };
  }, [id, running, portal]);
  useEffect(() => { if (client.current) { client.current.scaleViewport = scale; client.current.viewOnly = viewOnly; if (viewOnly) shortcuts.current?.reset(); } }, [scale, viewOnly]);
  return <div className="lan-vnc-session">
    <div className="lan-terminal-message"><span role="status">{message}</span>
      {running ? <button className="text-button" onClick={() => { setRunning(false); setMessage('已断开连接'); }}>断开连接</button> :
        <button className="secondary-button" onClick={() => setRunning(true)}>重新连接</button>}
      {running && connected && <>
        <SegmentedControl label="桌面缩放" value={scale ? 'fit' : 'original'} options={[{ value: 'fit', label: '适应窗口' }, { value: 'original', label: '原始大小' }]} onChange={value => setScale(value === 'fit')} />
        <label><input type="checkbox" checked={viewOnly} onChange={event => setViewOnly(event.target.checked)} />仅查看</label>
        <button className="text-button" onClick={() => {
          const rfb = client.current;
          if (rfb) void copyScreen(new Promise((resolve, reject) => rfb.toBlob(blob => blob ? resolve(blob) : reject(), 'image/png')), setMessage);
        }}>复制画面</button>
        <button disabled={viewOnly} className="text-button" onClick={() => { client.current?.sendCtrlAltDel(); client.current?.focus(); }}>发送 Ctrl+Alt+Del</button>
      </>}
    </div>
    {running && fields.length > 0 && <form className="lan-vnc-login" onSubmit={event => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      resumeDeadline.current();
      client.current?.sendCredentials(Object.fromEntries(fields.map(name => [name, String(values.get(name) || '')])));
      form.reset(); setFields([]); setMessage('正在验证凭据…');
    }}>
      {fields.map(name => <label className="lan-field" key={name}>{fieldLabels[name] || name}<input autoFocus={name === fields[0]} name={name} type={name === 'password' ? 'password' : 'text'} autoComplete={name === 'password' ? 'current-password' : 'off'} maxLength={1024} /></label>)}
      <button className="run-button">登录</button>
    </form>}
    {running && fingerprint && <div className="lan-vnc-login"><code>{fingerprint}</code><button className="secondary-button" onClick={() => { resumeDeadline.current(); client.current?.approveServer(); setFingerprint(''); setMessage('正在验证…'); }}>信任本次连接</button></div>}
    {running && connected && <SessionClipboard protocol="desktop-vnc" remote={remote} readOnly={viewOnly} send={text => client.current?.clipboardPasteFrom(text)} />}
    <div ref={viewport} className="lan-vnc-screen" hidden={!running || !connected} />
  </div>;
}
