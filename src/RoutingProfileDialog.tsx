import { useEffect, useRef, useState } from 'react';
import { useConfirmation } from './Confirmation';
import { Modal, ModalCancel, ModalForm } from './project-components';
import { useOperation } from './collab-api';
import { lanRequest, type LanHost } from './lan-api';

type Props = { device:string; address:string; viaA?:string; close:() => void; ready:(host:LanHost) => Promise<void> };

export default function RoutingProfileDialog({ device,address,viaA,close,ready }:Props) {
  const [hosts,setHosts] = useState<LanHost[]>(), [choice,setChoice] = useState(''), [error,setError] = useState('');
  const [user,setUser] = useState(''), [password,setPassword] = useState(''), [port,setPort] = useState('22');
  const [platform,setPlatform] = useState<'linux'|'win32'>('linux');
  const op = useOperation(), confirm = useConfirmation();
  const fields = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    let active = true;
    void lanRequest<LanHost[]>('list').then(rows => {
      if (!active) return;
      const ssh = rows.filter(h => h.mode === 'ssh');
      setHosts(ssh);
      const matches = ssh.filter(h => h.address === address && (!viaA || h.jumpHostId === viaA));
      setChoice(matches.length === 1 ? matches[0].id : matches.length ? '' : 'new');
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [address,viaA]);
  useEffect(() => {
    if (hosts && fields.current?.closest('dialog')?.open)
      fields.current.querySelector<HTMLElement>('select, input')?.focus();
  }, [hosts]);
  const matches = hosts?.filter(h => h.address === address && (!viaA || h.jumpHostId === viaA)) || [];
  const selected = matches.find(h => h.id === choice);
  const hub = hosts?.find(h => h.id === viaA && h.fingerprint);
  const jumpHost = hosts?.find(h => h.id === (selected?.jumpHostId || viaA));
  const key = selected?.auth === 'key';
  async function verify() {
    if (!hosts || !choice) return;
    if (viaA && !hub) throw new Error('A 的已信任档案已变化，请返回方案重新确认 A。');
    const details = selected ? { id:selected.id, revision:selected.revision, address } :
      { name:device + ' · ' + address, address, user:user.trim(), port:Number(port), platform, jumpHostId:viaA };
    const endpoint = (selected?.user || user.trim()) + '@' + address + ':' + (selected?.port || port);
    if (selected?.fingerprint && !password) {
      await lanRequest('test',{ id:selected.id });
      await ready(selected); return;
    }
    const probe = key ? await lanRequest<{ fingerprint?:string }>('test',{ id:selected!.id }) :
      await lanRequest<{ fingerprint:string }>('routing-fingerprint',details);
    if (!probe.fingerprint) throw new Error('未收到待确认的主机指纹，请重新打开档案。');
    const accepted = await confirm({ title:'确认设备 ' + device + ' 的 SSH 指纹',
      detail:<span className="relay-fingerprint">
        <code>{endpoint}</code>
        {jumpHost && <span>经 {jumpHost.name}（{jumpHost.address}）连接</span>}
        <span>请与设备管理员提供的 SHA256 指纹逐字核对。</span>
        <code className="relay-key">{probe.fingerprint}</code>
      </span>, confirm:'信任并继续', cancel:'返回核对' });
    if (!accepted) return;
    let host:LanHost;
    if (key) {
      await lanRequest('test',{ id:selected!.id, fingerprint:probe.fingerprint });
      host = { ...selected!, fingerprint:probe.fingerprint };
    } else {
      host = await lanRequest<LanHost>('routing-enroll',{ ...details, password, fingerprint:probe.fingerprint });
    }
    setPassword('');
    await ready(host);
  }
  return <Modal title={'补全 ' + device + ' 的 SSH 管理档案'} closeLabel="返回互通方案" close={close} busy={op.busy}>
    <ModalForm className="relay-form" onSubmit={e => { e.preventDefault(); void op.run(verify); }}
      footer={<footer className="pc-modal-actions"><ModalCancel /><button className="run-button" disabled={op.busy || !hosts || !choice}>
        {op.busy ? '正在验证…' : selected?.fingerprint && !password ? '使用此档案继续' : '核对 SSH 指纹'}</button></footer>}>
      <dl className="relay-endpoints">
        <div><dt>目标设备 {device}</dt><dd><code>{address}</code></dd></div>
        {(viaA || jumpHost) && <div><dt>管理路径</dt><dd>本机 → {viaA ? 'A' : jumpHost?.name} <code>{jumpHost?.address || '档案待确认'}</code> → {device}</dd></div>}
      </dl>
      <fieldset ref={fields} disabled={op.busy || !hosts} className="relay-addresses">
        {!!matches.length && <label>管理档案<select value={choice} onChange={e => { setChoice(e.target.value); setPassword(''); op.clear(); }}>
          <option value="">选择管理档案</option>{matches.map(h => <option key={h.id} value={h.id}>{h.user}@{h.address}:{h.port} · {h.fingerprint ? '已信任' : '待核对指纹'}</option>)}
          <option value="new">新建账号档案</option></select></label>}
        {choice === 'new' && <label>SSH 用户名<input required autoComplete="off" value={user} onChange={e => setUser(e.target.value)} maxLength={120}/></label>}
        {choice && !key && <label>SSH 密码<input type="password" autoComplete="new-password" required={!selected?.hasPassword} value={password}
          placeholder={selected?.hasPassword ? '留空使用已保存的密码' : undefined} maxLength={4096} onChange={e => setPassword(e.target.value)}/></label>}
        {choice === 'new' && <div className="relay-field-pair">
          <label>目标系统<select value={platform} onChange={e => setPlatform(e.target.value as 'linux'|'win32')}><option value="linux">Linux</option><option value="win32">Windows</option></select></label>
          <label>SSH 端口<input required type="number" min={1} max={65535} value={port} onChange={e => setPort(e.target.value)}/></label>
        </div>}
      </fieldset>
      {error || op.message ? <p role="alert">{error || op.message}</p> : null}
    </ModalForm></Modal>;
}
