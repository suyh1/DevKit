import { useEffect, useState } from 'react';
import { collab, useCollabList, useOperation, type PageProps } from './collab-api';
import { lanRequest, type LanHost } from './lan-api';
import { openWorkspaceLink } from './workspace-links';
import { remoteAccess } from './workspace-remote';
import { Modal, ModalCancel, ModalForm } from './project-components';
import { useConfirmation } from './Confirmation';
import SegmentedControl from './SegmentedControl';
import Skeleton from './Skeleton';

type Role = 'A' | 'B' | 'C';
type Draft = { kind: 'routing'; id?: string; revision?: number; name: string; role: Role; b: string; c: string; ab: string; ac: string };
type Steps = { linux: string; windows: string; persist: string; nm?: string; undoLinux?: string; undoWindows?: string };
type Plan = Draft & { id: string; revision: number; steps: Record<Role, Steps> };
const roles: Role[] = ['A', 'B', 'C'];
const empty: Draft = { kind: 'routing', name: '', role: 'A', b: '', c: '', ab: '', ac: '' };
const addresses = [['b','B 的原 IPv4'], ['ab','A 面向 B 的 IPv4'], ['c','C 的原 IPv4'], ['ac','A 面向 C 的 IPv4']] as const;

function Editor({ initial, close, saved }: { initial: Draft; close: () => void; saved: (id: string) => Promise<void> }) {
  const [draft, set] = useState(initial), op = useOperation();
  return <Modal title={draft.id ? '编辑互通方案' : '新建互通方案'} close={close} busy={op.busy} closeLabel="关闭路由配置">
    <ModalForm className="relay-form" footer={<footer className="pc-modal-actions"><ModalCancel /><button className="run-button" disabled={op.busy}>保存方案</button></footer>}
      onSubmit={event => { event.preventDefault(); void op.run(async () => { const row = await collab<Plan>('relay','save',draft); await saved(row.id); }); }}>
      <label>方案名称<input aria-label="方案名称" required maxLength={80} value={draft.name} onChange={e => set({ ...draft, name:e.target.value })}/></label>
      <label>DevKit 安装位置</label><SegmentedControl label="DevKit 安装位置" value={draft.role} options={roles.map(value => ({ value, label:value }))} onChange={role => set({ ...draft, role })}/>
      {addresses.map(([key,label]) => <label key={key}>{label}<input required aria-label={label} value={draft[key]} onChange={e => set({ ...draft, [key]:e.target.value.trim() })}/></label>)}
      <p>B、C 各自应能在本地链路上把 A 用作下一跳。若中间还有路由器，请由相应网关配置去程和回程。</p>
      {op.message && <p role="alert">{op.message}</p>}
    </ModalForm></Modal>;
}

function ApplyDialog({ plan, close, done }: { plan: Plan; close: () => void; done: (message: string) => void }) {
  const op = useOperation(), [hosts,setHosts] = useState<LanHost[]>([]), [ids,setIds] = useState<Partial<Record<Role,string>>>({}), [error,setError] = useState('');
  useEffect(() => {
    let live = true;
    void lanRequest<LanHost[]>('list').then(list => {
      if (!live) return;
      const trusted = list.filter(h => h.mode === 'ssh' && h.fingerprint);
      setHosts(trusted);
      const matches: Partial<Record<Role,string>> = {};
      for (const role of roles.filter(r => r !== plan.role)) {
        const ips = role === 'A' ? [plan.ab,plan.ac] : [role === 'B' ? plan.b : plan.c];
        const found = trusted.filter(host => ips.includes(host.address));
        if (found.length === 1) matches[role] = found[0].id;
      }
      setIds(matches);
    }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [plan.id, plan.revision]);
  return <Modal title="一键配置双向路由" close={close} busy={op.busy} closeLabel="关闭路由配置"><ModalForm className="relay-form" onSubmit={event => {
    event.preventDefault(); void op.run(async () => done(await collab<string>('relay','apply',{ id:plan.id, revision:plan.revision, profiles:ids })));
  }} footer={<footer className="pc-modal-actions"><ModalCancel /><button className="run-button" disabled={op.busy || roles.some(r => r !== plan.role && !ids[r])}>{op.busy ? '正在配置…' : '配置 A、B、C'}</button></footer>}>
    <p>在 A 的指定接口开启 IPv4 转发，在 B 和 C 各保存一条通往对方原 IP 的主机路由。A 将按照现有路由表和防火墙策略处理经过这两个接口的流量。</p>
    {roles.map(role => <div key={role}><strong>{role} · {role === 'A' ? plan.ab + ' / ' + plan.ac : role === 'B' ? plan.b : plan.c}</strong>
      {role === plan.role ? <p>当前 DevKit 所在设备，使用本机系统权限。</p> : <label>管理档案<select required value={ids[role] || ''} onChange={e => setIds({ ...ids, [role]:e.target.value })}>
        <option value="">选择已确认指纹的 SSH 档案</option>{hosts.map(h => <option key={h.id} value={h.id}>{h.name} · {h.user}@{h.address}:{h.port}</option>)}</select></label>}</div>)}
    <p>首次使用可在「局域网主机」登记管理连接并确认指纹。Windows 使用管理员会话，Linux 使用 root 或已获非交互 sudo 权限的账号。</p>
    {(error || op.message) && <p role="alert">{error || op.message}</p>}
  </ModalForm></Modal>;
}

export default function RoutingWorkspace({ active, edit, resource }: PageProps & { resource?: string }) {
  const list = useCollabList<Plan>('relay', active), op = useOperation(), confirm = useConfirmation();
  const [editor,setEditor] = useState<Draft | null>(null), [apply,setApply] = useState<Plan | null>(null);
  const plans = list.value?.filter(p => p.kind === 'routing'), plan = plans?.find(p => p.id === resource?.split('/')[1]) || plans?.[0];
  const [report,setReport] = useState<{ id:string; revision:number; text:string }>();
  const desktop = !!window.devkitCollab, control = desktop || !!remoteAccess()?.services?.relay.control;
  return <div className="relay-workspace"><div className="relay-topology"><div><h2>原 IP 双向互通</h2><p>B 与 C 通过 A 路由，可用对方原 IP 发起连接。新增服务沿用同一条路由。</p></div>
    {edit && <button onClick={() => setEditor({ ...empty })}>新建互通方案</button>}</div>
    {list.error && <p role="alert">{list.error}</p>}{!list.value && !list.error && <Skeleton kind="projects" label="读取互通方案" />}
    {plans && !plan && <p>暂无方案。准备 B、C 的原 IPv4，以及 A 面向两端的接口地址。</p>}
    {plan && <><label>互通方案<select value={plan.id} onChange={e => openWorkspaceLink('relay','routing/' + e.target.value)}>
      {plans?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <div className="devkit-bento relay-panels"><section><h3>{plan.name}</h3>
        <p>B <code>{plan.b}</code> ↔ A <code>{plan.ab} / {plan.ac}</code> ↔ C <code>{plan.c}</code></p>
        <div className="collab-actions">{desktop && <button className="primary-button" disabled={op.busy} onClick={() => setApply(plan)}>一键配置</button>}
          {control && <button disabled={op.busy} onClick={() => void op.run(async () => {
            const lines = await collab<string[]>('relay','detect',{ id:plan.id, revision:plan.revision });
            setReport({ ...plan, text:lines.join('\n') });
          })}>检测本机 {plan.role}</button>}
          {edit && <><button onClick={() => setEditor(plan)}>编辑</button><button onClick={() => void op.run(async () => {
            if (await confirm({ title:'移除互通方案', detail:'将删除 DevKit 中的记录。已写入各设备的系统路由继续生效。', confirm:'移除' })) {
              await collab('relay','remove',plan); await list.refresh(); openWorkspaceLink('relay','routing');
            }
          })}>移除</button></>}</div>
        {report?.id === plan.id && report.revision === plan.revision && <p role="status" style={{ whiteSpace:'pre-line' }}>{report.text}</p>}
        <p>在 B 连接 {plan.c}，并从 C 主动连接 {plan.b} 的已开放服务。A 的转发策略以及两端的服务监听、防火墙均应允许该通信。</p>
      </section><section><h3>各设备配置与验证</h3>{roles.map(role => <details key={plan.id + role}><summary>{role} · {role === 'A' ? '开启 IPv4 转发' : '到 ' + (role === 'B' ? plan.c : plan.b) + ' 的主机路由'}</summary>
        <p>先核对现有设置，保留已有等效配置。</p><details><summary>Windows 管理员 PowerShell</summary><pre>{plan.steps[role].windows}</pre></details>
        <details><summary>Linux</summary><pre>{plan.steps[role].linux}</pre>
        {role === 'A' ? <><p>用下列命令输出对应的持久设置，保存到 /etc/sysctl.d/ 下的 .conf 文件。</p><pre>{plan.steps.A.persist}</pre></> :
          <><p>使用 systemd-networkd 时，将此节加入对应接口的 .network 配置。使用 NetworkManager 时，在现有连接上用 nmcli connection modify 追加该路由。</p>
          <pre>{plan.steps[role].persist}</pre><pre>{plan.steps[role].nm}</pre></>}</details>
        <details><summary>撤回此项配置</summary>{role === 'A' ? <p>将本次启用的接口转发恢复为原值，并移除对应的持久设置。保留其他业务所需的转发。</p> :
          <><pre>{plan.steps[role].undoWindows}</pre><pre>{plan.steps[role].undoLinux}</pre><p>Linux 同时移除该接口持久配置中的对应路由。</p></>}</details>
      </details>)}</section></div></>}
    {op.message && <p role="status">{op.message}</p>}
    {editor && edit && <Editor initial={editor} close={() => setEditor(null)} saved={async id => { setEditor(null); openWorkspaceLink('relay','routing/' + id); await list.refresh(); }}/>}
    {apply && desktop && <ApplyDialog plan={apply} close={() => setApply(null)} done={text => { setReport({ ...apply, text }); setApply(null); }}/>}
  </div>;
}
