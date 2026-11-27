import { useCallback, useState } from 'react';
import { collab, useLive, useOperation } from './collab-api';
import { lanRequest, type LanHost } from './lan-api';
import { remoteAccess } from './workspace-remote';
import SegmentedControl from './SegmentedControl';
import RoutingProfileDialog from './RoutingProfileDialog';
import Skeleton from './Skeleton';

type Deployment = { id?:string; a?:string; mode?:string; phase:string; message:string };
type Snapshot = { a:string; local?:boolean; profile?:string; links:{ address:string; network:string; device:string }[]; networks:string[]; routes:{ network:string; device:string; gateway?:string; metric:number }[]; previousTunnel?:string };
type Profiles = { profiles:{ id:string; label:string }[] };
const prefixes = (text:string) => [...new Set(text.trim().split(/[\s,，]+/).filter(Boolean))];

export default function GatewayWorkspace({ initial }: { initial:string }) {
  const desktop = !!window.devkitCollab;
  const access = remoteAccess()?.services?.relay;
  const canRead = desktop || access?.control && access.edit;
  const [a,setA] = useState(initial), [snapshot,setSnapshot] = useState<Snapshot>();
  const [choices,setChoices] = useState<Profiles['profiles']>(), [profile,setProfile] = useState(''), [enroll,setEnroll] = useState(false);
  const [mode,setMode] = useState<'auto'|'direct'|'tunnel'>('auto');
  const [targets,setTargets] = useState(''), [port,setPort] = useState('51820');
  const [localB,setLocalB] = useState(''), [localC,setLocalC] = useState('');
  const [client,setClient] = useState(''), [enrollClient,setEnrollClient] = useState(false);
  const read = useOperation(), save = useOperation();
  const deployment = useLive(desktop,useCallback(() => collab<Deployment>('relay','gateway-status'),[]),1000);
  const current = deployment.value;
  const locked = !!current && !['idle','restored'].includes(current.phase);
  async function start(clientProfile?:string) {
    if (!snapshot) return;
    await collab('relay','gateway-start',{ a:snapshot.a, profile:snapshot.profile, client:client.trim(), clientProfile,
      mode, networks:prefixes(targets), localNetworks:prefixes(localB), port:Number(port) });
    await deployment.refresh();
  }
  async function deploy() {
    if (snapshot?.local) {
      if (snapshot.links.some(link => link.address === client.trim())) throw Error('请填写要接入的另一台设备的 IPv4 地址。');
      const matches = (await lanRequest<LanHost[]>('list')).filter(h => h.mode === 'ssh' && h.fingerprint && h.address === client.trim());
      if (matches.length !== 1) { setEnrollClient(true); return; }
      await start(matches[0].id);
    } else await start();
  }
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
    <div className="relay-topology"><div><h2>经 A 访问局域网</h2><p>{desktop ? '填写 A 的 IPv4，读取网段后点「一键接入」。接入后，在访问电脑上用目标设备的原 IP 和端口打开服务。' : '填写 A 的 IPv4，查看它连接或有路由可达的网段。'}</p></div></div>
    {canRead ? <form className="gateway-address" onSubmit={event => { event.preventDefault(); void read.run(() => inspect(profile)); }}>
      <label>A 的 IPv4 地址<input required spellCheck={false} placeholder="192.168.10.1" disabled={read.busy || save.busy || locked} value={a}
        onChange={e => { setA(e.target.value); setSnapshot(undefined); setChoices(undefined); setProfile(''); setLocalB(''); setLocalC(''); setClient(''); read.clear(); save.clear(); }}/></label>
      {choices && choices.length > 0 && <label>A 的 SSH 档案<select required value={profile} onChange={e => setProfile(e.target.value)}>
        <option value="">选择已确认的账号</option>{choices.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>}
      <button className="primary-button" disabled={read.busy || save.busy || locked}>{read.busy ? '正在读取…' : snapshot ? '重新读取网段' : '读取 A 的网段'}</button>
    </form> : <p className="relay-note">在 DevKit 桌面填写 A 的地址，或使用具有编辑和检测权限的共享账号查看网段。</p>}
    {read.busy && <Skeleton kind="projects" label="正在读取 A 的接口和路由表"/>}
    {read.message && <p role="alert">{read.message}</p>}
    {desktop && current?.id && <div className="relay-deployment" aria-label="部署状态">
      <p role="status"><strong>A · {current.a}</strong>　{current.message}</p>
      {locked && <button type="button" disabled={save.busy || ['cancelling','restoring'].includes(current.phase)} onClick={() => void save.run(async () => {
        await collab('relay','gateway-cancel',{ id:current.id }); await deployment.refresh();
      })}>{current.phase === 'cancelling' ? '正在取消…' : current.phase === 'restoring' ? '正在恢复…' : current.phase === 'cleanup' ? '重试取消部署' : '取消部署'}</button>}
    </div>}
    {!snapshot && save.message && <p role="alert">{save.message}</p>}
    {deployment.error && <p role="alert">{deployment.error}</p>}
    {snapshot && <div className="devkit-bento relay-panels"><section><h3>接入方式</h3>
      {desktop && snapshot.local && <label>访问设备的 IPv4 地址<input aria-label="访问设备的 IPv4 地址" placeholder="要经 A 访问局域网的电脑"
        disabled={locked || save.busy} value={client} onChange={e => { setClient(e.target.value); save.clear(); }}/></label>}
      {desktop && <button className="primary-button" disabled={save.busy || !current || locked || !networks.length || (snapshot.local && !client.trim())}
        onClick={() => void save.run(deploy)}>一键接入</button>}
      <SegmentedControl label="接入方式" value={mode} options={[{value:'auto',label:'自动选择'},{value:'direct',label:'直连网关'},{value:'tunnel',label:'三层隧道'}]}
        onChange={value => { setMode(value); save.clear(); }} disabled={save.busy || locked}/>
      <p>{mode === 'tunnel' ? 'DevKit 会准备 WireGuard、配置两端并验证握手。' : mode === 'direct' ?
        'DevKit 在 A 开启转发并为访问设备添加路由。目标侧需要有回程路由。' : 'DevKit 根据访问设备到 A 的路由选择直连或 WireGuard 隧道。'}</p>
      {desktop && mode !== 'auto' && <button disabled={save.busy || !networks.length || locked} onClick={() => void save.run(() =>
        collab<string>('relay','exportgateway',{ ...snapshot, mode, networks, discovered:snapshot.networks, port:Number(port), local:{ B:prefixes(localB), C:prefixes(localC) } })
      )}>{mode === 'direct' ? '导出网关路由' : '导出 A、B、C 隧道配置'}</button>}
      {!desktop && <p className="relay-note">在 DevKit 桌面端可一键接入和取消部署。</p>}
      {save.message && <p role="status">{save.message}</p>}
      {mode !== 'tunnel' ? <details><summary>A 的直连地址（{snapshot.links.length}）</summary>
        <ul className="gateway-links" tabIndex={0}>{snapshot.links.map(l => <li key={l.address + '/' + l.network}><code>{l.network}</code> 经 <code>{l.address}</code></li>)}</ul></details>
      : <><small>每次导出会生成一套新密钥。整包由管理员保管，每台设备只领取自己的目录。</small>
        <details><summary>UDP 端口与客户端本地网段</summary>
          <label>A 的 UDP 端口<input disabled={locked || save.busy} type="number" min={1} max={65535} value={port} onChange={e => { setPort(e.target.value); save.clear(); }}/></label>
          <p>如果客户端也直连目的网段，在下方填写要沿用本地连接的前缀。多个前缀用空格分隔。</p>
          {([['B',localB,setLocalB],['C',localC,setLocalC]] as const).map(([role,value,set]) => <label key={role}>{role} 本地优先的网段<input value={value} disabled={locked || save.busy} placeholder="可选，例如 192.168.10.0/24" onChange={e => { set(e.target.value); save.clear(); }}/></label>)}
        </details></>}
    </section><section><h3>目的网段（{networks.length}）</h3>
      <label>IPv4 前缀，每行一个<textarea spellCheck={false} value={targets} readOnly={!desktop || locked || save.busy} rows={Math.min(8, Math.max(3, networks.length))}
        onChange={e => { setTargets(e.target.value); save.clear(); }}/></label>
      <p className="relay-note">包含 A 的直连网段和显式路由。仅靠默认路由可达的内网可手动补入。是否能访问具体服务取决于回程、监听地址和防火墙。</p>
    </section></div>}
    {enrollClient && desktop && <RoutingProfileDialog device="访问端" address={client.trim()} close={() => setEnrollClient(false)} ready={async host => {
      setEnrollClient(false); await save.run(() => start(host.id));
    }}/>}
    {enroll && desktop && <RoutingProfileDialog device="A" address={a.trim()} close={() => setEnroll(false)} ready={async host => {
      setEnroll(false); setProfile(host.id); await read.run(() => inspect(host.id));
    }}/>}
  </div>;
}
