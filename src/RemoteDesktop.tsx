import SegmentedControl from './SegmentedControl';
import SessionClipboard from './SessionClipboard';
import { TextInput } from './TextControl';
import { useEffect, useRef, useState } from 'react';
import { Monitor } from 'lucide-react';
import { Field, Modal, ModalCancel } from './project-components';
import { openRemoteDesktop } from './rdp-client';
import type { LanHost } from './lan-api';

export default function RemoteDesktop({ host, close, direct }: { host: LanHost; close: () => void; direct: () => void }) {
  const vnc = host.mode === 'vnc';
  const [route, setRoute] = useState<'direct' | 'gateway'>(vnc ? 'direct' : 'gateway');
  const terminal = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  const [drive, setDrive] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLElement>(null);
  const [maximized, setMaximized] = useState(false), [full, setFull] = useState(false);
  const [remote, setRemote] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    const update = () => setFull(!!screen.current && document.fullscreenElement === screen.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  function resetScreen() {
    if (document.fullscreenElement === screen.current && screen.current) void document.exitFullscreen().catch(() => {});
    setDrive(false); setMaximized(false); setRemote(''); setNotice('');
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
      if (vnc && route === 'direct') { direct(); return; }
      if (session.current || !viewport.current) return;
      const form = event.currentTarget, data = new FormData(form);
      const password = form.elements.namedItem('password') as HTMLInputElement;
      setError(''); setPhase('connecting');
      session.current = openRemoteDesktop(viewport.current, host.id, {
        username: String(data.get('username') || ''), password: password.value, domain: String(data.get('domain') || ''), trustCertificate: data.has('trustCertificate'),
      }, { resizeDesktop: !vnc, terminalShortcuts: () => vnc && terminal.current, onConnect: () => setPhase('connected'), onError: message => {
        session.current = null;
        resetScreen(); setError(message); setPhase('idle');
      }, onDrive: setDrive, onClipboard: setRemote, onNotice: setNotice });
      password.value = '';
    }}>
      {error && <p className="pc-error" role="alert">{error}</p>}
      {vnc && <SegmentedControl label="VNC 连接方式" value={route} options={[{ value: 'direct', label: '共享主机直连' }, { value: 'gateway', label: 'guacd 网关' }]} onChange={value => { setRoute(value); setError(''); }} />}
      {route === 'gateway' && <>
        <Field label={vnc ? "VNC 用户名（选填）" : "远程桌面用户名"}><TextInput name="username" data-modal-focus autoComplete="username" required={!vnc} maxLength={256} /></Field>
        <Field label="远程桌面密码"><TextInput name="password" type="password" autoComplete="current-password" maxLength={1024} /></Field>
      </>}
      {!vnc && <><Field label="域（可选）"><TextInput name="domain" maxLength={256} /></Field>
      <label className="lan-rdp-trust"><input name="trustCertificate" className="form-check" type="checkbox" />首次信任目标证书（用于自签名证书）</label></>}
      <footer className="pc-form-footer"><ModalCancel /><button className="run-button">{vnc ? (route === 'direct' ? '从共享主机直连 VNC' : '通过网关连接') : '连接'}</button></footer>
    </form>
    <section ref={screen} className={maximized ? 'lan-rdp-view lan-rdp-maximized' : 'lan-rdp-view'} hidden={phase === 'idle'} aria-label="远程桌面会话">
      <div className="lan-rdp-toolbar"><span role="status">{phase === 'connecting' ? '正在连接目标远程桌面…' : notice || '远程桌面已连接'}</span><div>
        <button type="button" className="text-button" onClick={() => {
          if (full) void document.exitFullscreen();
          else if (maximized) setMaximized(false);
          else if (document.fullscreenEnabled && screen.current) void screen.current.requestFullscreen().catch(() => setMaximized(true));
          else setMaximized(true);
        }}>{full || maximized ? '退出全屏' : '会话全屏'}</button>
        {phase === 'connected' && <button type="button" className="text-button" onClick={() => session.current?.capture()}>复制画面</button>}
        {vnc && phase === 'connected' && <label title="Ctrl+C 和 Ctrl+V 使用远端终端的复制粘贴快捷键"><input type="checkbox" defaultChecked={terminal.current} onChange={e => { terminal.current = e.target.checked; viewport.current?.querySelector<HTMLElement>('[tabindex]')?.focus(); }} />终端复制粘贴</label>}
        {drive && phase === 'connected' && <><input type="file" ref={picker} multiple hidden onChange={event => {
          const files = Array.from(event.target.files || []); event.target.value = '';
          if (files.length) void session.current?.sendFiles(files).catch(error => setNotice(error.message));
        }} /><button type="button" className="text-button" title="远端文件资源管理器中的 DevKit 磁盘；将文件放进 Download 可下载到本机" onClick={() => picker.current?.click()}>发送文件</button></>}
        <button type="button" className="text-button" disabled={phase !== 'connected'} onClick={() => session.current?.secureAttention()}>发送 Ctrl+Alt+Del</button>
        <button type="button" className="secondary-button" onClick={disconnect}>断开连接</button>
      </div></div>
      {phase === 'connected' && <SessionClipboard protocol={vnc ? "web-vnc" : "web-rdp"} remote={remote} send={text => session.current?.paste(text)} />}
      <div className="lan-rdp-viewport" ref={viewport} />
    </section>
  </Modal>;
}
