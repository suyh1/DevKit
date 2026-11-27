import { useState } from 'react';
import { collab, useOperation } from './collab-api';
import { remoteAccess } from './workspace-remote';
import SegmentedControl from './SegmentedControl';
import RoutingProfileDialog from './RoutingProfileDialog';
import Skeleton from './Skeleton';

type Snapshot = { a:string; links:{ address:string; network:string; device:string }[]; networks:string[]; routes:{ network:string; device:string; gateway?:string; metric:number }[]; previousTunnel?:string };
type Profiles = { profiles:{ id:string; label:string }[] };
const prefixes = (text:string) => [...new Set(text.trim().split(/[\s,，]+/).filter(Boolean))];

export default function GatewayWorkspace({ initial }: { initial:string }) {
  const desktop = !!window.devkitCollab;
  const access = remoteAccess()?.services?.relay;
  const canRead = desktop || access?.control && access.edit;
  const [a,setA] = useState(initial), [snapshot,setSnapshot] = useState<Snapshot>();
  const [choices,setChoices] = useState<Profiles['profiles']>(), [profile,setProfile] = useState(''), [enroll,setEnroll] = useState(false);
  const [mode,setMode] = useState<'direct'|'tunnel'>('direct');
  const [targets,setTargets] = useState(''), [port,setPort] = useState('51820');
  const [localB,setLocalB] = useState(''), [localC,setLocalC] = useState('');
  const read = useOperation(), save = useOperation();
  async function inspect(chosen:string) {
    setSnapshot(undefined); setChoices(undefined); save.clear();
    const result = await collab<Snapshot | Profiles>('relay','gateway',{ a:a.trim(), profile:chosen });
    if ('profiles' in result) {
      setChoices(result.profiles); setProfile('');
      if (!result.profiles.length) setEnroll(true);
      return;
    }
    setSnapshot(result); setTargets(result.networks.join('\n'));
  }
  const networks = prefixes(targets);
  return <div className="relay-workspace gateway-workspace">
    <div className="relay-topology"><div><h2>经 A 访问局域网</h2><p>填写跳板机 A 的 IPv4，读取它连接或有路由可达的网段。B、C 可使用网段内各主机的原 IP 和服务端口。</p></div></div>
    {canRead ? <form className="gateway-address" onSubmit={event => { event.preventDefault(); void read.run(() => inspect(profile)); }}>
      <label>A 的 IPv4 地址<input required spellCheck={false} placeholder="192.168.10.1" disabled={read.busy || save.busy} value={a}
        onChange={e => { setA(e.target.value); setSnapshot(undefined); setChoices(undefined); setProfile(''); setLocalB(''); setLocalC(''); read.clear(); save.clear(); }}/></label>
      {choices && choices.length > 0 && <label>A 的 SSH 档案<select required value={profile} onChange={e => setProfile(e.target.value)}>
        <option value="">选择已确认的账号</option>{choices.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>}
      <button className="primary-button" disabled={read.busy || save.busy}>{read.busy ? '正在读取…' : snapshot ? '重新读取网段' : '读取 A 的网段'}</button>
    </form> : <p className="relay-note">在 DevKit 桌面填写 A 的地址，或使用具有编辑和检测权限的共享账号查看网段。</p>}
    {read.busy && <Skeleton kind="projects" label="正在读取 A 的接口和路由表"/>}
    {read.message && <p role="alert">{read.message}</p>}
    {snapshot && <div className="devkit-bento relay-panels"><section><h3>接入方式</h3>
      <SegmentedControl label="接入方式" value={mode} options={[{value:'direct',label:'直连网关'},{value:'tunnel',label:'三层隧道'}]}
        onChange={value => { setMode(value); save.clear(); }} disabled={save.busy}/>
      {mode === 'direct' ? <p>在 A 上启用转发，在两侧网关应用目的网段和下一跳。也可只配置 B、C 本机，此时目标侧网关需要有返回访问端的路由。</p> :
        <p>B、C 经过其他网关连接 A 时，在 A 与接入端启用 WireGuard。A 对隧道流量做源地址转换，目标服务可直接向 A 回包。</p>}
      {desktop ? <button className="primary-button" disabled={save.busy || !networks.length} onClick={() => void save.run(() =>
        collab<string>('relay','exportgateway',{ ...snapshot, mode, networks, discovered:snapshot.networks, port:Number(port), local:{ B:prefixes(localB), C:prefixes(localC) } })
      )}>{mode === 'direct' ? '导出网关路由' : '导出 A、B、C 隧道配置'}</button> : <p className="relay-note">在桌面端导出配置并分发给接入设备。</p>}
      {save.message && <p role="status">{save.message}</p>}
      {mode === 'direct' ? <details><summary>A 的直连地址（{snapshot.links.length}）</summary>
        <ul className="gateway-links" tabIndex={0}>{snapshot.links.map(l => <li key={l.address + '/' + l.network}><code>{l.network}</code> 经 <code>{l.address}</code></li>)}</ul></details>
      : <><small>每次导出会生成一套新密钥。整包由管理员保管，每台设备只领取自己的目录。</small>
        <details><summary>UDP 端口与客户端本地网段</summary>
          <label>A 的 UDP 端口<input type="number" min={1} max={65535} value={port} onChange={e => { setPort(e.target.value); save.clear(); }}/></label>
          <p>如果客户端也直连目的网段，在下方填写要沿用本地连接的前缀。多个前缀用空格分隔。</p>
          {([['B',localB,setLocalB],['C',localC,setLocalC]] as const).map(([role,value,set]) => <label key={role}>{role} 本地优先的网段<input value={value} placeholder="可选，例如 192.168.10.0/24" onChange={e => { set(e.target.value); save.clear(); }}/></label>)}
        </details></>}
    </section><section><h3>目的网段（{networks.length}）</h3>
      <label>IPv4 前缀，每行一个<textarea spellCheck={false} value={targets} readOnly={!desktop} rows={Math.min(8, Math.max(3, networks.length))}
        onChange={e => { setTargets(e.target.value); save.clear(); }}/></label>
      <p className="relay-note">包含 A 的直连网段和显式路由。仅靠默认路由可达的内网可手动补入。是否能访问具体服务取决于回程、监听地址和防火墙。</p>
    </section></div>}
    {enroll && desktop && <RoutingProfileDialog device="A" address={a.trim()} close={() => setEnroll(false)} ready={async host => {
      setEnroll(false); setProfile(host.id); await read.run(() => inspect(host.id));
    }}/>}
  </div>;
}
