import { useEffect, useState } from 'react';
import { useConfirmation } from './Confirmation';
import { Modal, ModalCancel, ModalForm } from './project-components';
import { useOperation } from './collab-api';
import { lanRequest, type LanHost } from './lan-api';

type Props = { device:string; address:string; viaA?:string; close:() => void; ready:(host:LanHost) => Promise<void> };

export default function RoutingProfileDialog({ device,address,viaA,close,ready }:Props) {
  const [hosts,setHosts] = useState<LanHost[]>(), [choice,setChoice] = useState(''), [error,setError] = useState('');
  const [user,setUser] = useState(''), [password,setPassword] = useState(''), [port,setPort] = useState('22');
  const [platform,setPlatform] = useState<'linux'|'win32'>('linux'), [jump,setJump] = useState('');
  const op = useOperation(), confirm = useConfirmation();
  useEffect(() => {
    let active = true;
    void lanRequest<LanHost[]>('list').then(rows => {
      if (!active) return;
      const ssh = rows.filter(h => h.mode === 'ssh');
      setHosts(ssh);
      const matches = ssh.filter(h => h.address === address);
      setChoice(matches.length === 1 ? matches[0].id : matches.length ? '' : 'new');
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [address]);
  const matches = hosts?.filter(h => h.address === address) || [];
  const selected = matches.find(h => h.id === choice);
  const hub = hosts?.find(h => h.id === viaA && h.fingerprint);
  const key = selected?.auth === 'key';
  async function verify() {
    if (!hosts || !choice) return;
    const details = selected ? { id:selected.id, revision:selected.revision, address } :
      { name:device + ' · ' + address, address, user:user.trim(), port:Number(port), platform, jumpHostId:jump || undefined };
    const endpoint = (selected?.user || user.trim()) + '@' + address + ':' + (selected?.port || port);
    const jumpHost = hosts.find(h => h.id === (selected?.jumpHostId || jump));
    const route = jumpHost ? '\n经 ' + jumpHost.name + '（' + jumpHost.address + '）连接' : '';
    if (selected?.fingerprint && !password) {
      await lanRequest('test',{ id:selected.id });
      await ready(selected); return;
    }
    const probe = key ? await lanRequest<{ fingerprint?:string }>('test',{ id:selected!.id }) :
      await lanRequest<{ fingerprint:string }>('routing-fingerprint',details);
    if (!probe.fingerprint) throw new Error('未收到待确认的主机指纹，请重新打开档案。');
    const accepted = await confirm({ title:'确认设备 ' + device + ' 的 SSH 指纹', detail:endpoint + route + '\n' + probe.fingerprint + '\n请与设备管理员提供的 SHA256 指纹核对。', confirm:'信任并继续', cancel:'返回核对' });
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
      <p>设备 {device} · <code>{address}</code></p>
      <fieldset disabled={op.busy || !hosts} className="relay-addresses">
        {!!matches.length && <label>管理档案<select value={choice} onChange={e => { setChoice(e.target.value); setPassword(''); op.clear(); }}>
          <option value="">选择管理档案</option>{matches.map(h => <option key={h.id} value={h.id}>{h.user}@{h.address}:{h.port} · {h.fingerprint ? '已信任' : '待核对指纹'}</option>)}
          <option value="new">新建账号档案</option></select></label>}
        {choice === 'new' && <><label>SSH 用户名<input required autoComplete="off" value={user} onChange={e => setUser(e.target.value)} maxLength={120}/></label>
          <label>目标系统<select value={platform} onChange={e => setPlatform(e.target.value as 'linux'|'win32')}><option value="linux">Linux</option><option value="win32">Windows</option></select></label>
          <label>SSH 端口<input required type="number" min={1} max={65535} value={port} onChange={e => setPort(e.target.value)}/></label>
          {hub && <label>管理连接路径<select value={jump} onChange={e => setJump(e.target.value)}><option value="">直接连接</option><option value={hub.id}>经已信任的 A（{hub.address}）</option></select><small>本机无法直达目标时，可选择经 A 连接。</small></label>}</>}
        {choice && !key && <label>SSH 密码<input type="password" autoComplete="new-password" required={!selected?.hasPassword} value={password}
          placeholder={selected?.hasPassword ? '留空使用已保存的密码' : undefined} maxLength={4096} onChange={e => setPassword(e.target.value)}/></label>}
      </fieldset>
      {error || op.message ? <p role="alert">{error || op.message}</p> : null}
    </ModalForm></Modal>;
}
