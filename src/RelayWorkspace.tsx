import { useEffect, useState } from 'react';
import { collab, useCollabList, useOperation, type PageProps } from './collab-api';
import { Modal, ModalForm, ModalCancel } from './project-components';
import { useConfirmation } from './Confirmation';
import SegmentedControl from './SegmentedControl';
import Skeleton from './Skeleton';
import { openWorkspaceLink } from './workspace-links';
import { remoteAccess } from './workspace-remote';

type Role = 'A' | 'B' | 'C';
type Mode = 'direct' | 'ssh' | 'reverse' | 'http' | 'socks';
type Rule = { id: string; revision: number; role: Role; name: string; target: string; targetPort: number; bind: string; source: string; listenPort: number; hub: string; sshPort: number; user: string; httpPort: number; socksPort: number; passive: string; mode?: Mode; connected?: boolean; error?: string };
type Result = { mode: Mode; ok: boolean; message: string };
const roles = [{ value: 'A', label: '中转端 A' }, { value: 'B', label: '访问端 B' }, { value: 'C', label: '服务端 C' }] as const;
const modes = { direct: '直达目标', ssh: 'SSH 本地转发', reverse: 'SSH 反向转发', http: 'HTTP CONNECT', socks: 'SOCKS5' };
const empty: Rule = { id: '', revision: 0, role: 'B', name: '', target: '', targetPort: 22, bind: '127.0.0.1', source: '', listenPort: 2222, hub: '', sshPort: 22, user: '', httpPort: 3128, socksPort: 1080, passive: '' };

function Guidance({ rule, mode }: { rule: Rule; mode: Mode }) {
  const endpoint = rule.target + ':' + rule.targetPort;
  return <details><summary>如何配置和验证</summary>
    {mode === 'direct' ? <p>在目标设备检查服务是否监听 {endpoint}（Linux 用 <code>ss -lnt</code>，Windows 用 <code>Get-NetTCPConnection -State Listen</code>）。在目标防火墙放行来自 DevKit 主机的 TCP {rule.targetPort}。若由 A 做路由，A 需启用转发，并为 B、C 配置经过 A 的去程及回程路由。</p>
    : mode === 'http' || mode === 'socks' ? <p>在 A 的现有代理中确认 {modes[mode]} 监听 {mode === 'http' ? rule.httpPort : rule.socksPort}，允许来自 B 的地址连接 {endpoint}。此入口支持免口令、按来源授权的代理；若代理要求账号认证，可选 A 的 SSH 档案。在 C 允许代理主机 A 访问目标端口。</p>
    : <><p>在 A 确认系统已有的 SSH 服务正在监听 TCP {rule.sshPort}，防火墙允许安装 DevKit 的设备登录。在「局域网主机」登记 A 的账号，并核对指纹。在 A 的 sshd_config 中为专用账号配置下列选项，替换示例账号。</p>
      <p>若 A 已安装 OpenSSH Server 但服务未启动，Linux 可用 <code>systemctl start sshd</code>（Debian / Ubuntu 使用 <code>systemctl start ssh</code>），Windows 可在管理员 PowerShell 使用 <code>Start-Service sshd</code>。</p>
      <pre>{mode === 'reverse' ? `Match User 转发账号\n    AllowTcpForwarding remote\n    GatewayPorts clientspecified\n    PermitListen ${rule.bind}:${rule.listenPort}` : `Match User 转发账号\n    AllowTcpForwarding local\n    PermitOpen ${endpoint}`}</pre>
      <p>检查该账号及其 authorized_keys 的转发限制。Linux 通常使用 /etc/ssh/sshd_config，以 sshd -t 校验后重载 sshd（部分发行版服务名为 ssh）。Windows 使用 %ProgramData%\\ssh\\sshd_config，以 sshd.exe -t 校验后在管理员 PowerShell 运行 Restart-Service sshd。</p>
      {mode === 'reverse' ? <p>在 C 检查本地目标服务，从 B 连接 A 的监听地址和端口。在 A 的防火墙只对 B 的来源地址开放该入口，核对 NAT 后 A 实际看到的来源 IP。</p>
        : <p>在 C 放行来自 A 的目标端口。启动后 B 的客户端连接本机入口，仍使用 C 上原有的服务账号。</p>}
      {rule.passive && <p>将被动范围 {rule.passive} 的各个端口一并加入 A 的 {mode === 'reverse' ? 'PermitListen' : 'PermitOpen'} 配置。</p>}
    </>}
  </details>;
}

function Editor({ initial, close, save, detect }: { initial: Rule; close: () => void; save: (data: Rule) => Promise<void>; detect: boolean }) {
  const [data, set] = useState(initial), op = useOperation();
  function field(key: keyof Rule, label: string, numeric = false, required = true) {
    return <label>{label}<input aria-label={label} required={required} type={numeric ? 'number' : 'text'} min={numeric ? 1 : undefined} max={numeric ? 65535 : undefined}
      value={String(data[key] || '')} onChange={event => set({ ...data, [key]: numeric ? Number(event.target.value) : event.target.value })} /></label>;
  }
  return <Modal title={data.id ? '编辑服务规则' : '新建服务规则'} close={close} busy={op.busy} closeLabel="关闭规则编辑">
    <ModalForm className="relay-form" onSubmit={event => { event.preventDefault(); void op.run(() => save(data)); }} footer={<footer className="pc-modal-actions"><ModalCancel /><button className="run-button" disabled={op.busy}>{detect ? '保存并检测' : '保存规则'}</button></footer>}>
      <label>DevKit 安装位置</label><SegmentedControl label="DevKit 安装位置" value={data.role} options={[...roles]} onChange={role => set({ ...data, role, bind: role === 'B' ? '127.0.0.1' : '', source: '', target: role === 'C' ? '127.0.0.1' : '' })} />
      <p>{data.role === 'A' ? 'B 连接 A 的入口，由 A 转发至 C 的服务。' : data.role === 'B' ? 'B 连接本机入口，DevKit 检测到 C 的直达路径及 A 上可用的转发方式。' : 'C 通过 SSH 在 A 建立入口，B 连接该入口访问 C。'}</p>
      {field('name', '服务名称')}
      {data.role !== 'A' && field('hub', 'A 的 SSH 或代理主机地址')}
      {field('target', data.role === 'C' ? 'C 本机可达的服务地址' : '目标服务地址')}
      {field('targetPort', '目标 TCP 端口', true)}
      {field('bind', data.role === 'B' ? 'B 的本地监听 IPv4' : 'B 可达的 A 监听 IPv4')}
      {field('listenPort', '入口 TCP 端口', true)}
      {field('source', '允许访问的来源 IPv4', false, !data.bind.startsWith('127.'))}
      {data.role !== 'A' && <details><summary>A 的检测入口与账号</summary>
        {field('sshPort', 'SSH 端口', true)}{field('user', '已登记的 SSH 用户名（可选）', false, false)}
        {data.role === 'B' && <>{field('httpPort', 'HTTP 代理端口', true)}{field('socksPort', 'SOCKS5 代理端口', true)}</>}
      </details>}
      <details><summary>FTP 被动传输</summary>{field('passive', '服务器被动端口范围（例如 50000-50009）', false, false)}<p>服务端配置相同范围，客户端优先使用 EPSV；使用 PASV 时选择沿用控制连接地址。</p></details>
      {op.message && <p role="alert">{op.message}</p>}
    </ModalForm>
  </Modal>;
}

export function RelayWorkspace({ active, edit, resource }: PageProps & { resource?: string }) {
  const control = window.devkitCollab ? true : !!remoteAccess()?.services?.relay.control;
  const list = useCollabList<Rule>('relay', active), op = useOperation(), confirm = useConfirmation();
  const [editor, setEditor] = useState<Rule | null>(null);
  const [report, setReport] = useState<{ id: string; revision: number; results: Result[] }>();
  const selected = list.value?.find(rule => rule.id === resource) || list.value?.[0];
  useEffect(() => {
    if (!active || !edit || !resource?.startsWith('new/')) return;
    const [, host, port] = resource.split('/');
    setEditor({ ...empty, target: host, targetPort: Number(port) || 22, name: host });
  }, [active, edit, resource]);
  async function check(rule: Pick<Rule, 'id' | 'revision'>) {
    setReport(undefined);
    const results = await collab<Result[]>('relay', 'detect', { id: rule.id, revision: rule.revision });
    setReport({ id: rule.id, revision: rule.revision, results });
  }
  const results = selected && report?.id === selected.id && report.revision === selected.revision ? report.results : [];
  return <div className="relay-workspace">
    <div className="relay-topology"><div><h2>跨网服务转发</h2><p>选择唯一安装 DevKit 的设备。其他设备使用原有客户端，通过分配的地址和端口连接。</p></div>
      {edit && <button onClick={() => setEditor({ ...empty })}>新建规则</button>}</div>
    {list.error && <p role="alert">{list.error}</p>}
    {!list.value && !list.error && <Skeleton kind="projects" label="正在读取服务规则" />}
    {list.value && !selected && <p>暂无服务规则。{edit ? '新建规则后可检测现场支持的连接方式。' : '等待主机管理者添加规则。'}</p>}
    {selected && <><label>服务规则<select value={selected.id} onChange={e => { op.clear(); openWorkspaceLink('relay', e.target.value); }}>{list.value?.map(rule => <option value={rule.id} key={rule.id}>{rule.name} · {rule.target}:{rule.targetPort}</option>)}</select></label>
      <div className="devkit-bento relay-panels"><section><h3>{selected.name}</h3>
        <p>DevKit 在 {selected.role}。{selected.role === 'C' ? 'A 监听' : selected.role + ' 监听'} <code>{selected.bind}:{selected.listenPort}</code> → <code>{selected.target}:{selected.targetPort}</code></p>
        {selected.hub && <p>A 的地址 <code>{selected.hub}</code>，SSH {selected.sshPort}{selected.role === 'B' && `，HTTP CONNECT ${selected.httpPort}，SOCKS5 ${selected.socksPort}`}。</p>}
        {selected.source && <p>允许来源 {selected.source}</p>}{selected.passive && <p>FTP 被动端口 {selected.passive}</p>}
        <strong>{selected.mode ? modes[selected.mode] + (selected.connected ? ' · 已接通过客户端' : ' · 已监听，等待客户端验证') : '已停止'}</strong>
        {selected.error && <p role="alert">{selected.error}</p>}
        <div className="collab-actions">{control && (selected.mode ? <button className="primary-button" disabled={op.busy} onClick={() => void op.run(async () => { await collab('relay','stop',selected); await list.refresh(); })}>停止转发</button>
          : <button className="primary-button" disabled={op.busy} onClick={() => void op.run(() => check(selected))}>{op.busy ? '处理中…' : '检测可用能力'}</button>)}
          {edit && !selected.mode && <><button disabled={op.busy} onClick={() => setEditor({ ...empty, ...selected })}>编辑</button><button disabled={op.busy} onClick={() => void op.run(async () => {
            if (await confirm({ title: '移除服务规则', detail: selected.name, confirm: '移除' })) { await collab('relay','remove',selected); await list.refresh(); openWorkspaceLink('relay'); }
          })}>移除</button></>}</div>
        {selected.mode && <p>在访问端连接 {selected.bind === '0.0.0.0' ? 'A 的可达地址' : selected.bind}:{selected.listenPort}。Windows 可用 Test-NetConnection 测试端口，再用实际客户端登录或访问。</p>}
      </section><section><h3>能力检测与配置</h3>
        {!results.length && <p>{selected.mode ? '转发已启动，可在访问端验证实际服务。' : '检测会尝试连接指定目标。SSH 使用已确认指纹的 A 档案，反向检测会短暂申请并释放 A 的指定端口。'}</p>}
        {results.map(result => <div key={result.mode} className="relay-result"><strong>{modes[result.mode]} · {result.ok ? '可用' : '未通过'}</strong><p>{result.message}</p>
          {control && result.ok && !selected.mode && <button disabled={op.busy} onClick={() => void op.run(async () => { await collab('relay','start',{ id: selected.id, revision: selected.revision, mode: result.mode }); await list.refresh(); })}>使用{modes[result.mode]}</button>}
          <Guidance rule={selected} mode={result.mode}/></div>)}
        {results.length > 0 && results.every(r => !r.ok) && <details open><summary>现场没有可用通道</summary>
          <p>若能管理 A 或其网关，可在 A 上将 B 可达的 A 地址和入口端口映射到 C 的服务，并允许 B 的来源通过防火墙。C 允许来自映射路径的连接；从 B 使用原客户端测试映射入口。</p>
          <details><summary>Windows A 的单端口映射示例</summary><p>由 A 的管理员将下列占位内容换成实际地址，在防火墙中仅向 B 放行 TCP {selected.listenPort}；C 的服务应监听 A 能到达的接口。</p>
            <pre>{`netsh interface portproxy add v4tov4 listenaddress=A面向B的IPv4 listenport=${selected.listenPort} connectaddress=C面向A的IPv4 connectport=${selected.targetPort}\nnetsh interface portproxy show v4tov4`}</pre>
            <p>从 B 测试 A 的该端口。使用这种固定映射时，请保留入口给系统映射独占。</p></details>
          <p>若需要保留 C 的原始 IP，在 B 侧网关配置到 C 的去程路由、在 C 侧配置到 B 的回程路由，并在中间设备 A 启用转发。具体下一跳取决于现场网卡和网段。</p>
        </details>}
        {!results.length && <Guidance rule={selected} mode={selected.mode || (selected.role === 'A' ? 'direct' : selected.role === 'B' ? 'ssh' : 'reverse')} />}
      </section></div></>}
    {op.message && <p role="status">{op.message}</p>}
    {editor && active && edit && <Editor initial={editor} detect={control} close={() => setEditor(null)} save={async data => {
      const saved = await collab<{ id: string; revision: number }>('relay','save',data);
      setEditor(null); openWorkspaceLink('relay',saved.id); await list.refresh();
      if (control) await op.run(() => check(saved));
    }}/>}
  </div>;
}
