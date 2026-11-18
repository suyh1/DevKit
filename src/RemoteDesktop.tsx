import { useEffect, useRef, useState } from 'react';
import { Monitor } from 'lucide-react';
import { Field, Modal, ModalCancel } from './project-components';
import { openRemoteDesktop } from './rdp-client';
import type { LanHost } from './lan-api';

export default function RemoteDesktop({ host, close }: { host: LanHost; close: () => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const session = useRef<ReturnType<typeof openRemoteDesktop> | null>(null);
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'connected'>('idle');
  const [error, setError] = useState('');
  useEffect(() => () => session.current?.close(), []);

  function disconnect() {
    session.current?.close();
    session.current = null;
    setPhase('idle');
  }

  return <Modal title={`远程桌面 · ${host.name}`} close={close} closeLabel="关闭远程桌面" icon={<Monitor size={18} />} className={phase === 'idle' ? 'lan-rdp-dialog' : 'lan-rdp-dialog lan-rdp-active'}>
    <form hidden={phase !== 'idle'} className="lan-rdp-form" onSubmit={event => {
      event.preventDefault();
      if (session.current || !viewport.current) return;
      const form = event.currentTarget, data = new FormData(form);
      const password = form.elements.namedItem('password') as HTMLInputElement;
      setError(''); setPhase('connecting');
      session.current = openRemoteDesktop(viewport.current, host.id, {
        username: String(data.get('username') || ''), password: password.value, domain: String(data.get('domain') || ''), trustCertificate: data.has('trustCertificate'),
      }, () => setPhase('connected'), message => {
        session.current = null;
        setError(message); setPhase('idle');
      });
      password.value = '';
    }}>
      {error && <p className="pc-error" role="alert">{error}</p>}
      <Field label="远程桌面用户名"><input name="username" data-modal-focus autoComplete="username" required maxLength={256} /></Field>
      <Field label="远程桌面密码"><input name="password" type="password" autoComplete="current-password" maxLength={1024} /></Field>
      <Field label="域（可选）"><input name="domain" maxLength={256} /></Field>
      <label className="lan-rdp-trust"><input name="trustCertificate" type="checkbox" />首次信任目标证书（用于自签名证书）</label>
      <footer className="pc-form-footer"><ModalCancel /><button className="run-button">连接</button></footer>
    </form>
    <section hidden={phase === 'idle'} aria-label="远程桌面会话">
      <div className="lan-rdp-toolbar"><span role="status">{phase === 'connecting' ? '正在连接目标远程桌面…' : '远程桌面已连接'}</span><div>
        <button type="button" className="text-button" disabled={phase !== 'connected'} onClick={() => session.current?.secureAttention()}>发送 Ctrl+Alt+Del</button>
        <button type="button" className="secondary-button" onClick={disconnect}>断开连接</button>
      </div></div>
      <div className="lan-rdp-viewport" ref={viewport} />
    </section>
  </Modal>;
}
