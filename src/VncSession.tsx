import { useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc';
import { VncChannel } from './vnc-channel';
import SegmentedControl from './SegmentedControl';

import SessionClipboard, { clipboardLimit } from './SessionClipboard';

const fieldLabels: Record<string, string> = { username: '用户名', password: 'VNC 密码', target: '目标' };
export default function VncSession({ id }: { id: string }) {
  const [remote, setRemote] = useState('');
  const viewport = useRef<HTMLDivElement>(null), client = useRef<RFB | undefined>(undefined);
  const [running, setRunning] = useState(true);
  const resumeDeadline = useRef<() => void>(() => {});
  const [connected, setConnected] = useState(false), [message, setMessage] = useState('');
  const [fields, setFields] = useState<string[]>([]), [fingerprint, setFingerprint] = useState('');
  const [scale, setScale] = useState(true), [viewOnly, setViewOnly] = useState(false);
  const options = useRef({ scale, viewOnly });
  options.current = { scale, viewOnly };
  useEffect(() => {
    if (!running || !viewport.current) return;
    let disposed = false, failure = '';
    setRemote(''); setMessage('正在连接 VNC…'); setFields([]); setFingerprint(''); setConnected(false);
    const channel = new VncChannel(id, message => { failure = message; });
    const rfb = new RFB(viewport.current, channel);
    client.current = rfb;
    rfb.scaleViewport = options.current.scale;
    rfb.viewOnly = options.current.viewOnly;
    let timer: ReturnType<typeof setTimeout>;
    function deadline() {
      clearTimeout(timer);
      timer = setTimeout(() => { failure = 'VNC 握手超时，请检查服务和端口。'; rfb.disconnect(); }, 20000);
    }
    resumeDeadline.current = deadline;
    deadline();
    rfb.addEventListener('connect', () => {
      clearTimeout(timer);
      if (!disposed) { setConnected(true); setMessage('VNC 已连接'); }
    });
    rfb.addEventListener('clipboard', event => {
      const value = (event as CustomEvent).detail.text;
      if (!disposed && typeof value === 'string') {
        if (new TextEncoder().encode(value).length <= clipboardLimit) setRemote(value);
        else { setRemote(''); setMessage('远端剪贴板文本超过 16 KiB'); }
      }
    });
    rfb.addEventListener('credentialsrequired', event => {
      clearTimeout(timer);
      if (!disposed) { setFields((event as CustomEvent).detail.types); setMessage('目标要求登录'); }
    });
    rfb.addEventListener('serververification', async event => {
      clearTimeout(timer);
      const hash = await crypto.subtle.digest('SHA-256', (event as CustomEvent).detail.publickey);
      if (!disposed) {
        setFingerprint(Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(':'));
        setMessage('请与管理员核对服务器公钥的 SHA-256 指纹');
      }
    });
    rfb.addEventListener('securityfailure', event => { failure = (event as CustomEvent).detail.reason || 'VNC 认证失败，请检查凭据。'; });
    rfb.addEventListener('disconnect', event => {
      if (!disposed) { setMessage(failure || ((event as CustomEvent).detail.clean ? 'VNC 会话已断开' : 'VNC 连接失败，请检查目标端口、认证方式和服务状态。')); setRunning(false); }
    });
    void channel.connect();
    return () => { disposed = true; clearTimeout(timer); rfb.disconnect(); channel.close(); client.current = undefined; };
  }, [id, running]);
  useEffect(() => { if (client.current) { client.current.scaleViewport = scale; client.current.viewOnly = viewOnly; } }, [scale, viewOnly]);
  return <div className="lan-vnc-session">
    <div className="lan-terminal-message"><span role="status">{message}</span>
      {running ? <button className="text-button" onClick={() => { setRunning(false); setMessage('已断开连接'); }}>断开连接</button> :
        <button className="secondary-button" onClick={() => setRunning(true)}>重新连接</button>}
      {running && connected && <>
        <SegmentedControl label="桌面缩放" value={scale ? 'fit' : 'original'} options={[{ value: 'fit', label: '适应窗口' }, { value: 'original', label: '原始大小' }]} onChange={value => setScale(value === 'fit')} />
        <label><input type="checkbox" checked={viewOnly} onChange={event => setViewOnly(event.target.checked)} />仅查看</label>
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
    {running && connected && <SessionClipboard remote={remote} readOnly={viewOnly} send={text => client.current?.clipboardPasteFrom(text)} />}
    <div ref={viewport} className="lan-vnc-screen" hidden={!running || !connected} />
  </div>;
}
