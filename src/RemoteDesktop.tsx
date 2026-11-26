import SessionClipboard from './SessionClipboard';
import { TextInput } from './TextControl';
import { useEffect, useRef, useState } from 'react';
import { Monitor } from 'lucide-react';
import { Field, Modal, ModalCancel } from './project-components';
import { openRemoteDesktop } from './rdp-client';
import type { LanHost } from './lan-api';

export default function RemoteDesktop({ host, close }: { host: LanHost; close: () => void }) {
  const vnc = host.mode === 'vnc';
  const viewport = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLElement>(null);
  const [maximized, setMaximized] = useState(false), [full, setFull] = useState(false);
  const [remote, setRemote] = useState('');
  useEffect(() => {
    const update = () => setFull(!!screen.current && document.fullscreenElement === screen.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  function resetScreen() {
    if (document.fullscreenElement === screen.current && screen.current) void document.exitFullscreen().catch(() => {});
    setMaximized(false); setRemote('');
  }
  const session = useRef<ReturnType<typeof openRemoteDesktop> | null>(null);
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'connected'>('idle');
  const [error, setError] = useState('');
  useEffect(() => () => session.current?.close(), []);

  function disconnect() {
    session.current?.close();
    session.current = null;
    resetScreen(); setPhase('idle');
  }

  return <Modal title={`${vnc ? 'VNC' : '远程桌面'} · ${host.name}`} close={close} closeLabel="关闭远程桌面" icon={<Monitor size={18} />} className={phase === 'idle' ? 'lan-rdp-dialog' : 'lan-rdp-dialog lan-rdp-active'}>
    <form hidden={phase !== 'idle'} className="lan-rdp-form" onSubmit={event => {
      event.preventDefault();
      if (session.current || !viewport.current) return;
      const form = event.currentTarget, data = new FormData(form);
      const password = form.elements.namedItem('password') as HTMLInputElement;
      setError(''); setPhase('connecting');
      session.current = openRemoteDesktop(viewport.current, host.id, {
        username: String(data.get('username') || ''), password: password.value, domain: String(data.get('domain') || ''), trustCertificate: data.has('trustCertificate'),
      }, { resizeDesktop: !vnc, onConnect: () => setPhase('connected'), onError: message => {
        session.current = null;
        resetScreen(); setError(message); setPhase('idle');
      }, onClipboard: setRemote });
      password.value = '';
    }}>
      {error && <p className="pc-error" role="alert">{error}</p>}
      <Field label={vnc ? "VNC 用户名（选填）" : "远程桌面用户名"}><TextInput name="username" data-modal-focus autoComplete="username" required={!vnc} maxLength={256} /></Field>
      <Field label="远程桌面密码"><TextInput name="password" type="password" autoComplete="current-password" maxLength={1024} /></Field>
      {!vnc && <><Field label="域（可选）"><TextInput name="domain" maxLength={256} /></Field>
      <label className="lan-rdp-trust"><input name="trustCertificate" className="form-check" type="checkbox" />首次信任目标证书（用于自签名证书）</label></>}
      <footer className="pc-form-footer"><ModalCancel /><button className="run-button">连接</button></footer>
    </form>
    <section ref={screen} className={maximized ? 'lan-rdp-view lan-rdp-maximized' : 'lan-rdp-view'} hidden={phase === 'idle'} aria-label="远程桌面会话">
      <div className="lan-rdp-toolbar"><span role="status">{phase === 'connecting' ? '正在连接目标远程桌面…' : '远程桌面已连接'}</span><div>
        <button type="button" className="text-button" onClick={() => {
          if (full) void document.exitFullscreen();
          else if (maximized) setMaximized(false);
          else if (document.fullscreenEnabled && screen.current) void screen.current.requestFullscreen().catch(() => setMaximized(true));
          else setMaximized(true);
        }}>{full || maximized ? '退出全屏' : '会话全屏'}</button>
        <button type="button" className="text-button" disabled={phase !== 'connected'} onClick={() => session.current?.secureAttention()}>发送 Ctrl+Alt+Del</button>
        <button type="button" className="secondary-button" onClick={disconnect}>断开连接</button>
      </div></div>
      {phase === 'connected' && <SessionClipboard remote={remote} send={text => session.current?.paste(text)} />}
      <div className="lan-rdp-viewport" ref={viewport} />
    </section>
  </Modal>;
}
