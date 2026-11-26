import { useState } from 'react';
import { collab, useCollabList, useOperation, type PageProps } from './collab-api';
import { saveText } from './files';
import { copyText } from './motion-primitives';
import SegmentedControl from './SegmentedControl';
import Skeleton from './Skeleton';
import { openWorkspaceLink, workspaceHash } from './workspace-links';

type Role = 'A' | 'B' | 'C';
type Device = {
  role: Role; revision: number; address: string; publicKey: string;
  listenPort?: number; endpoint?: string; config: string; linuxConfig: string;
};
const modes = [{ value: 'A', label: 'A 中转' }, { value: 'B', label: 'B 设备' }, { value: 'C', label: 'C 设备' }, { value: 'check', label: '验证连接' }];
const platforms = [{ value: 'linux', label: 'Linux' }, { value: 'windows', label: 'Windows' }];

export function WireGuardWorkspace({ active, edit, resource }: PageProps & { resource?: string }) {
  const { value: devices, error, refresh } = useCollabList<Device>('wireguard', active);
  const op = useOperation();
  const [drafts, setDrafts] = useState<Partial<Record<Role, Device>>>({});
  const [platform, setPlatform] = useState('linux');
  const endpoint = resource?.startsWith('endpoint/') ? resource.slice(9) : undefined;
  const listener = /^listen\/([1-9]\d{0,4})$/.exec(resource || '');
  const mode = endpoint ? 'B' : modes.some(item => item.value === resource) ? resource : 'A';
  const selected = devices?.find(device => device.role === mode);
  const draft = selected && drafts[selected.role];
  const fields = selected && (edit && draft || (endpoint && edit ? { ...selected, endpoint }
    : listener && edit ? { ...selected, listenPort: Number(listener[1]) } : selected));
  const basename = 'devkit-' + selected?.role.toLowerCase();
  const config = platform === 'linux' ? selected?.linuxConfig : selected?.config;
  const linux = platform === 'linux';
  const update = (changes: Partial<Device>) => {
    if (fields) setDrafts(previous => ({ ...previous, [fields.role]: { ...fields, ...changes } }));
    op.clear();
  };
  const discard = (role: Role) => setDrafts(previous => ({ ...previous, [role]: undefined }));
  const missing = devices?.filter(device => !device.publicKey).map(device => device.role).join('、');
  const dirty = !!draft || fields?.endpoint !== selected?.endpoint || fields?.listenPort !== selected?.listenPort;

  return <div className="wg-workspace">
    {error && <p role="alert">{error} <button onClick={() => void refresh()}>重试</button></p>}
    {!devices && !error && <Skeleton kind="projects" label="正在读取组网配置" />}
    {devices && <>
      <div className="wg-topology">
        <div><h2>B ↔ A ↔ C</h2><p>B 和 C 分别连到 A 的 UDP 入口。隧道启动后，两端使用对方的隧道 IP 访问服务。</p></div>
        <span>{devices.filter(device => device.publicKey).length} / 3 台已登记</span>
      </div>
      <SegmentedControl label="组网设备与验证" value={mode || 'A'} options={modes} onChange={next => { op.clear(); openWorkspaceLink('wireguard', next); }} />
      {mode === 'check' ? <ConnectionCheck devices={devices} /> : fields && selected && <div className="devkit-bento wg-panels">
        <section>
          <h3>{mode} 的设备参数</h3>
          <form onSubmit={event => {
            event.preventDefault();
            if (edit) void op.run(async () => {
              const { role, address, publicKey, listenPort, endpoint: peerEndpoint, revision } = fields;
              await collab('wireguard', 'save', { role, address, publicKey, listenPort, endpoint: peerEndpoint, revision });
              discard(role);
              if ((listener || endpoint) && location.hash === workspaceHash('wireguard', resource)) openWorkspaceLink('wireguard', role);
              await refresh();
              return role + ' 的参数已保存。已部署的设备需重新应用更新后的配置。';
            });
          }}>
            <fieldset disabled={!edit || op.busy}>
              <label>隧道 IPv4<input required value={fields.address} maxLength={15} onChange={e => update({ address: e.target.value })} /></label>
              {mode === 'A' ? <label>UDP 监听端口<input type="number" min={1} max={65535} required value={fields.listenPort || ''} onChange={e => update({ listenPort: Number(e.target.value) })} /></label>
                : <label>从 {mode} 可达的 A 入口<input required placeholder="relay.example.org:51820" value={fields.endpoint} maxLength={259} onChange={e => update({ endpoint: e.target.value })} /></label>}
              <label>{mode} 的 WireGuard 公钥<input required spellCheck={false} autoComplete="off" maxLength={44} value={fields.publicKey} onChange={e => update({ publicKey: e.target.value.trim() })} /></label>
            </fieldset>
            {edit && <div className="collab-actions">
              <button className="primary-button" disabled={op.busy || !dirty}>保存 {mode} 的参数</button>
              {dirty && <button type="button" disabled={op.busy} onClick={() => { discard(selected.role); openWorkspaceLink('wireguard', selected.role); op.clear(); }}>放弃修改</button>}
            </div>}
            {draft && draft.revision !== selected.revision && <p role="alert">此设备已被更新。核对后放弃草稿可载入最新参数。</p>}
          </form>
        </section>
        <section>
          <h3>在 {mode} 上部署</h3>
          <SegmentedControl label="设备系统" value={platform} options={platforms} onChange={setPlatform} />
          {linux ? <><p>安装 WireGuard 和 wg-quick。在 {mode} 的 root 终端生成或读取本机公钥，将最后一行输出填入本机公钥栏。</p>
            <pre>{`cd /etc/wireguard || exit\numask 077\ntest -e ${basename}.key || wg genkey > ${basename}.key\nwg pubkey < ${basename}.key`}</pre></>
            : <p>在 {mode} 的 WireGuard 客户端选择「新建空隧道」，命名为 <code>{basename}</code>。复制窗口上方的公钥填入设备参数，保留本机的 PrivateKey 行。</p>}
          {mode === 'A' && <p>允许 B、C 访问 A 的 UDP {selected.listenPort}，在 A 的防火墙放行两个隧道 IP 之间所需的双向转发。{linux ? 'Linux 配置会在启动时开启此隧道接口的 IPv4 转发。' : '激活隧道后，在管理员 PowerShell 启用接口转发。'}</p>}
          {mode === 'A' && !linux && <pre>Set-NetIPInterface -InterfaceAlias devkit-a -AddressFamily IPv4 -Forwarding Enabled</pre>}
          {missing ? <p className="collab-muted">待登记 {missing}。三端参数齐备后可导出各自的配置。</p> : dirty ? <p>保存或放弃当前修改后可导出配置。</p> : config && <>
            <p>{linux ? `将下载的配置放到 /etc/wireguard/${basename}.conf，运行 wg-quick up ${basename}。` : '复制配置到本机隧道编辑器，将 PrivateKey 占位行换回该设备原有的私钥行，再保存并激活。'}</p>
            <div className="collab-actions">
              <button disabled={op.busy} onClick={() => void op.run(() => saveText(config, basename + '.conf'))}>下载 {mode} 配置</button>
              <button disabled={op.busy} onClick={() => void op.run(async () => { await copyText(config); return '配置已复制'; })}>复制配置</button>
            </div>
            <details><summary>查看 {mode} 的配置</summary><pre>{config}</pre></details>
          </>}
        </section>
      </div>}
      {op.message && <p role="status">{op.message}</p>}
    </>}
  </div>;
}

function ConnectionCheck({ devices }: { devices: Device[] }) {
  const [hub, b, c] = devices;
  return <div className="devkit-bento wg-panels">
    <section><h3>检查两段握手</h3>
      <p>先启动 A，再启动 B 和 C。在 A 上运行 <code>wg show</code>，或在客户端查看两条对端记录的最近握手时间。缺少哪一端，就检查该端的 A 入口、UDP 放行和公钥。</p>
      <p>两端均有握手后，从 B 测试 C 的实际服务。若到 A（{hub.address}）可达、到 C 的服务失败，检查 A 的接口转发、双方的 AllowedIPs，以及 C 的服务监听地址和防火墙。</p>
    </section>
    <section><h3>从 B 访问 C</h3><pre>{`ssh user@${c.address}\nsftp user@${c.address}\nhttp://${c.address}:8080/`}</pre>
      <p>将 user 和端口换成实际值。从 C 反向访问时，目标填 B 的 {b.address}。服务须监听隧道地址或相应的网络接口。</p>
      <p>FTP 客户端使用被动模式。服务器需放行控制端口和被动数据端口范围；若使用 PASV，请向客户端公布可达的隧道 IP。</p>
    </section>
  </div>;
}
