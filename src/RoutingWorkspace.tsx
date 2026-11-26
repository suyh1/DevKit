import { useEffect, useState } from 'react';
import { collab, useCollabList, useOperation, type PageProps } from './collab-api';
import { lanRequest, type LanHost } from './lan-api';
import { openWorkspaceLink } from './workspace-links';
import { remoteAccess } from './workspace-remote';
import { Modal, ModalCancel, ModalForm } from './project-components';
import { useConfirmation } from './Confirmation';
import Skeleton from './Skeleton';
import { routingProfiles } from '../shared/routing-profiles.mjs';
import RoutingProfileDialog from './RoutingProfileDialog';
import { OverflowName } from './FileMeta';

type Role = 'A' | 'B' | 'C';
type Draft = { kind: 'routing'; pending?:boolean; id?: string; revision?: number; name: string; role: Role; a?: string; b: string; c: string; ab: string; ac: string };
type Steps = { linux: string; windows: string; persist: string; nm?: string; undoLinux?: string; undoWindows?: string };
type Plan = Draft & { pending?:false; id: string; revision: number; steps: Record<Role, Steps> };
type PendingPlan = Pick<Plan, 'kind'|'id'|'revision'|'name'|'b'|'c'> & { pending:true; a:string };
const roles: Role[] = ['A', 'B', 'C'];
const empty: Draft = { kind: 'routing', name: '', role: 'A', b: '', c: '', ab: '', ac: '' };
type Profiles = Partial<Record<Role,string>>;
type Saved = Draft & { id:string; revision:number };
type Discovery = {
  role?:Role; profiles?:Profiles; reason?:string; candidates?:{ id:string; label:string }[];
  ab?:{ ip?:string; reason?:string }; ac?:{ ip?:string; reason?:string };
};
const sides = [['ab','B'], ['ac','C']] as const;
const devices = [
  ['a','中间这台设备','192.168.1.10'],
  ['b','要互通的第一台设备','192.168.1.20'],
  ['c','要互通的第二台设备','10.0.0.30'],
] as const;
function Editor({ initial, close, saved }: { initial: Draft; close: () => void; saved: (plan:Saved, configure:boolean, profiles:Profiles) => Promise<void> }) {
  const desktop = !!window.devkitCollab;
  const [draft, set] = useState({ ...initial, a:initial.a || (initial.role === 'C' ? initial.ac : initial.ab) }), op = useOperation();
  const [result, setResult] = useState<Discovery>(), [chosenRole, chooseRole] = useState<Role>(), [profileA, chooseProfile] = useState('');
  const [continueConfig,setContinueConfig] = useState(false);
  const [enrollA,setEnrollA] = useState<boolean | null>(null);
  const incomplete = !initial.id || initial.pending;
  const canDiscover = desktop || !!remoteAccess()?.services?.relay.control;
  const [manual, setManual] = useState(!incomplete);
  const name = draft.name.trim() || draft.b + ' ↔ ' + draft.c;
  async function saveDraft() {
    const { a,b,c,id,revision } = draft;
    const ref = await collab<{id:string;revision:number}>('relay','save',{ kind:'routing', pending:true, a,b,c,id,revision,name });
    await saved({ ...draft, ...ref, name, pending:true }, false, {});
  }
  function changeAddress(key:'a'|'b'|'c', value:string) {
    set({ ...draft, [key]:value.trim(), ab:'', ac:'' });
    setResult(undefined); chooseRole(undefined); chooseProfile(''); setManual(!incomplete); op.clear();
  }
  async function submit(configure:boolean, newA?:string) {
    setContinueConfig(configure);
    let found = newA ? undefined : result;
    if (!manual && (!found?.ab || !found.ac)) {
      found = await collab<Discovery>('relay','discover',{ a:draft.a, b:draft.b, c:draft.c, role:chosenRole || result?.role, profileA:newA || profileA });
      setResult(found);
      if (!desktop && !found.role) { setManual(true); return; }
      if (!found.role || !found.ab || !found.ac) return;
    }
    if (configure && found?.role && found.role !== 'A' && !found.profiles?.A && !found.candidates && !newA) {
      setEnrollA(true); return;
    }
    const settings = { ...draft, pending:false, name,
      role:found?.role || draft.role, ab:found?.ab?.ip || draft.ab, ac:found?.ac?.ip || draft.ac };
    if (!settings.ab || !settings.ac) return;
    const ref = await collab<{ id:string; revision:number }>('relay','save',settings);
    await saved({ ...settings, ...ref }, configure, found?.profiles || {});
  }
  if (desktop && enrollA !== null) return <RoutingProfileDialog device="A" address={draft.a} close={() => setEnrollA(null)} ready={async host => {
    const configure = enrollA;
    setEnrollA(null); chooseProfile(host.id);
    await op.run(() => submit(configure,host.id));
  }}/>;
  const action = desktop && incomplete ? 'configure' : !desktop && !canDiscover && !manual ? 'draft' : 'save';
  return <Modal title={draft.pending ? '继续互通方案' : draft.id ? '编辑互通方案' : '新建互通方案'} close={close} busy={op.busy} closeLabel="关闭路由配置">
    <ModalForm className="relay-form" footer={<footer className="pc-modal-actions"><ModalCancel />
      {desktop && incomplete && <button type="submit" value="save" disabled={op.busy}>仅保存</button>}
      {incomplete && (!desktop || result || op.message) && action !== 'draft' &&
        <button type="button" disabled={op.busy} onClick={() => void op.run(saveDraft)}>保存草稿</button>}
      <button type="submit" value={action} className="run-button" disabled={op.busy}>
        {op.busy ? '处理中…' : action === 'draft' ? '保存草稿' : action === 'configure' ? '检测并配置' : incomplete && !manual && !result ? '识别并保存' : '保存方案'}</button></footer>}
      onSubmit={event => { event.preventDefault(); const button = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const intent = button?.value || action;
        void op.run(() => intent === 'draft' ? saveDraft() : submit(intent === 'configure')); }}>
      <fieldset disabled={op.busy} className="relay-addresses">
        <legend>哪两台设备需要通过 A 互相访问？</legend>
        <p className="relay-note">把两边都能连上的那台设备叫作 A，另外两台叫作 B 和 C。填写 A 的登录 IP，以及你希望用来访问 B、C 的 IP。</p>
        <div className="relay-device-inputs">
          {devices.map(([key,label,example]) =>
            <label key={key}><span className="relay-device-label"><b>{key.toUpperCase()}</b>{label}</span>
              <input className="relay-ip" required aria-label={key.toUpperCase() + ' ' + label + '的 IP'} placeholder={'如 ' + example} spellCheck={false}
                value={draft[key]} onChange={e => changeAddress(key,e.target.value)}/></label>)}
        </div>
        <details><summary>不知道设备的 IP？</summary>
          <p>在设备上打开网络设置，查看正在使用的有线或无线连接，找到「IPv4 地址」。B、C 各填自己的地址。A 如果有多个地址，先填平时登录 A 用的那个。</p>
        </details>
        <label>方案名称（可选）<input aria-label="方案名称" maxLength={80} placeholder="默认使用 B、C 的 IP" value={draft.name} onChange={e => set({ ...draft, name:e.target.value })}/></label>
        {manual && <label>哪台设备装了 DevKit？<select required value={chosenRole || (incomplete ? '' : draft.role)} onChange={e => {
          const role = e.target.value as Role; chooseRole(role); set({ ...draft, role });
        }}><option value="">请选择设备</option>{devices.map(([key,label]) => <option key={key} value={key.toUpperCase()}>{key.toUpperCase()} · {label}</option>)}</select></label>}
        {result?.reason && !manual && <label>哪台设备装了 DevKit？<select aria-label="确认安装位置" required value={chosenRole || ''} onChange={e => chooseRole(e.target.value as Role)}>
          <option value="">选择安装位置</option>{roles.map(r => <option key={r}>{r}</option>)}</select></label>}
        {result?.candidates && <label>A 有多个已确认的管理档案<select required value={profileA} onChange={e => chooseProfile(e.target.value)}>
          <option value="">选择 A 的档案</option>{result.candidates.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>}
        {desktop && result?.role && result.role !== 'A' && result.ab && !result.profiles?.A &&
          <button type="button" onClick={() => setEnrollA(continueConfig)}>补全 A 的 SSH 管理档案并重新检测</button>}
        {!desktop && !result?.role && result && <p className="relay-note">DevKit 没能确定安装在哪台设备上。可以保存草稿，也可以手动补充下面的信息。</p>}
        {!desktop && incomplete && !canDiscover && !manual && <button type="button" onClick={() => setManual(true)}>我知道连接地址，手动填写</button>}
        {sides.map(([key,peer]) => {
          const label = '从 ' + peer + ' 直接连接 A 时用的 IP';
          if (result?.[key]?.ip) return <p key={key}>{label}（已识别）<code>{result[key]?.ip}</code></p>;
          if (!manual && !result?.[key]) return null;
          return <label key={key}>{label}
            <input className="relay-ip" spellCheck={false} required aria-label={label} value={draft[key]} onChange={e => set({ ...draft, [key]:e.target.value.trim() })}/>
            <small>例如，在 {peer} 上用 {peer === 'B' ? '192.168.1.10' : '10.0.0.10'} 直接打开 A 的共享文件夹，就填 {peer === 'B' ? '192.168.1.10' : '10.0.0.10'}。两边用同一个地址连 A 时，两项可以相同。</small>
          </label>;
        })}
        {(result?.ab?.reason || result?.ac?.reason) && <details><summary>查看未能识别的原因</summary>
          {sides.map(([key,peer]) => result[key]?.reason && <p key={key}>{peer} 连接 A：{result[key]?.reason}</p>)}
        </details>}
      </fieldset>
      {incomplete && <p className="relay-note">{desktop ? '选择「检测并配置」后，DevKit 会查找连接地址，再为三台设备设置互通。' : canDiscover ? '网页可以识别地址并保存方案。实际配置请在 DevKit 桌面端完成。' : '此网页没有自动检测权限。可以先保存这三个 IP，再到运行 DevKit 的设备上打开草稿继续。'}</p>}
      {incomplete && (manual || result?.ab && !result.ab.ip || result?.ac && !result.ac.ip) &&
        <p className="relay-note">不知道该填什么时，可以先保存草稿，请管理 A 的人打开同一份方案确认。</p>}
      {op.message && <p role="alert">{op.message}</p>}
    </ModalForm></Modal>;
}

function ApplyDialog({ plan, preset, close, done }: { plan: Saved; preset:Profiles; close: () => void; done: (message: string) => void }) {
  const op = useOperation(), [hosts,setHosts] = useState<LanHost[]>([]), [ids,setIds] = useState<Partial<Record<Role,string>>>({}), [error,setError] = useState('');
  const [enroll,setEnroll] = useState<Role>();
  function address(role:Role) { return role === 'A' ? plan.a || (plan.role === 'C' ? plan.ac : plan.ab) : role === 'B' ? plan.b : plan.c; }
  function resolve(list:LanHost[], preferred:Profiles) {
    return routingProfiles(list, plan.role, { A:[plan.a,plan.ab,plan.ac], B:[plan.b], C:[plan.c] }, preferred);
  }
  function selectProfiles(list:LanHost[], preferred:Profiles) {
    const { profiles, matching } = resolve(list,preferred);
    setIds(profiles);
    // An ambiguous A account must be resolved before enrolling its peer.
    const pending = plan.role !== 'A' && !profiles.A ? ['A'] as const : roles;
    setEnroll(pending.find(role => role !== plan.role && !profiles[role] && !matching[role].length));
    return profiles;
  }
  function apply(profiles:Profiles) {
    return op.run(async () => done(await collab<string>('relay','apply',{ id:plan.id, revision:plan.revision, profiles })));
  }
  useEffect(() => {
    let live = true;
    void lanRequest<LanHost[]>('list').then(list => {
      if (!live) return;
      const trusted = list.filter(h => h.mode === 'ssh' && h.fingerprint);
      setHosts(trusted);
      selectProfiles(trusted,preset);
    }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [plan.id, plan.revision]);
  if (enroll) return <RoutingProfileDialog key={enroll} device={enroll} address={address(enroll)} viaA={enroll !== 'A' ? ids.A : undefined} close={() => setEnroll(undefined)} ready={async host => {
    const trusted = [...hosts.filter(h => h.id !== host.id),host];
    setHosts(trusted);
    const profiles = selectProfiles(trusted,{ ...ids, [enroll]:host.id });
    if (roles.every(r => r === plan.role || profiles[r])) await apply(profiles);
  }}/>;
  const { available } = resolve(hosts,ids);
  return <Modal title="一键配置双向路由" close={close} busy={op.busy} closeLabel="关闭路由配置"><ModalForm className="relay-form" onSubmit={event => {
    event.preventDefault(); void apply(ids);
  }} footer={<footer className="pc-modal-actions"><ModalCancel /><button className="run-button" disabled={op.busy || roles.some(r => r !== plan.role && !ids[r])}>{op.busy ? '正在配置…' : '配置 A、B、C'}</button></footer>}>
    <p>在 A 的指定接口开启 IPv4 转发，在 B 和 C 各保存一条通往对方原 IP 的主机路由。A 将按照现有路由表和防火墙策略处理经过这两个接口的流量。</p>
    {roles.map(role => <div className="relay-profile-row" key={role}><strong>设备 {role}</strong><code>{address(role)}</code>
      {role === plan.role ? <p>当前 DevKit 所在设备，使用本机系统权限。</p> : <label>管理档案<select required value={ids[role] || ''} onChange={e => selectProfiles(hosts,{ ...ids, [role]:e.target.value })}>
        <option value="">选择已确认指纹的 SSH 档案</option>{available[role].map(h => <option key={h.id} value={h.id}>{h.name} · {h.user}@{h.address}:{h.port}</option>)}</select></label>}
      {role !== plan.role && <button type="button" disabled={op.busy || (plan.role !== 'A' && role !== 'A' && !ids.A)} onClick={() => setEnroll(role)}>补全 {role} 的 SSH 档案</button>}</div>)}
    <p>缺少管理连接时，可在这里填写账号、密码并确认 SSH 指纹。Windows 使用管理员会话，Linux 使用 root 或已获非交互 sudo 权限的账号。</p>
    {(error || op.message) && <p role="alert">{error || op.message}</p>}
  </ModalForm></Modal>;
}

export default function RoutingWorkspace({ active, edit, resource }: PageProps & { resource?: string }) {
  const list = useCollabList<Plan | PendingPlan>('relay', active), op = useOperation(), confirm = useConfirmation();
  const [editor,setEditor] = useState<Draft | null>(null), [apply,setApply] = useState<Saved | null>(null), [preset,setPreset] = useState<Profiles>({});
  useEffect(() => {
    if (!active || !edit || !resource?.startsWith('routing/new/')) return;
    const [, , a, b, c] = resource.split('/');
    setEditor({ ...empty, a, b, c });
  }, [active, edit, resource]);
  const plans = list.value?.filter(p => p.kind === 'routing'), selected = plans?.find(p => p.id === resource?.split('/')[1]) || plans?.[0];
  const plan = selected?.pending ? undefined : selected;
  const [report,setReport] = useState<{ id:string; revision:number; text:string }>();
  const desktop = !!window.devkitCollab, control = desktop || !!remoteAccess()?.services?.relay.control;
  async function remove(row: Plan | PendingPlan) {
    const detail = row.pending ? '将删除这份草稿。' : '将删除 DevKit 中的记录。已写入各设备的系统路由继续生效。';
    if (await confirm({ title:'移除互通方案', detail, confirm:'移除' })) {
      await collab('relay','remove',row); await list.refresh(); openWorkspaceLink('relay','routing');
    }
  }
  return <div className="relay-workspace"><div className="relay-topology"><div><h2>原 IP 双向互通</h2><p>B 和 C 都能用原 IP 访问对方的服务。新增端口也沿用这条路由。</p></div>
    {edit && <button className={plans?.length ? undefined : 'primary-button'} onClick={() => setEditor({ ...empty })}>新建互通方案</button>}</div>
    {list.error && <p role="alert">{list.error}</p>}{!list.value && !list.error && <Skeleton kind="projects" label="读取互通方案" />}
    {plans && !selected && <p className="relay-note">{edit ? '准备好三台设备的 IP，就可以新建第一份方案。' : '暂无互通方案。主机管理者添加后即可在这里查看。'}</p>}
    {selected && <label>互通方案<select value={selected.id} onChange={e => { op.clear(); openWorkspaceLink('relay','routing/' + e.target.value); }}>
      {plans?.map(p => <option key={p.id} value={p.id}>{p.name}{p.pending ? '（草稿）' : ''}</option>)}</select></label>}
    {selected?.pending && <div className="devkit-bento relay-panels"><section>
      <h3><OverflowName name={selected.name} /></h3>
      <p>三个 IP 已保存为草稿。{desktop ? '继续后，DevKit 会尝试识别连接地址。' : '可以在 DevKit 桌面端打开这份草稿继续配置。'}</p>
      <dl className="relay-endpoints">{devices.map(([key,label]) => <div key={key}><dt>{key.toUpperCase()} · {label}</dt><dd><code>{selected[key]}</code></dd></div>)}</dl>
      {edit && <div className="collab-actions"><button className="primary-button" onClick={() => setEditor({ ...empty, ...selected })}>继续填写</button>
        <button disabled={op.busy} onClick={() => void op.run(() => remove(selected))}>移除</button></div>}
    </section></div>}
    {plan && <>
      <div className="devkit-bento relay-panels"><section><h3><OverflowName name={plan.name} /></h3>
        <dl className="relay-path" aria-label="B 经 A 与 C 双向互通的地址">
          <div><dt><b>B</b>互通端</dt><dd><code>{plan.b}</code></dd></div>
          <div><dt><b>A</b>中转端</dt><dd><span>B 连接 A</span><code>{plan.ab}</code><span>C 连接 A</span><code>{plan.ac}</code></dd></div>
          <div><dt><b>C</b>互通端</dt><dd><code>{plan.c}</code></dd></div>
        </dl>
        <div className="collab-actions">{desktop && <button className="primary-button" disabled={op.busy} onClick={() => { setPreset({}); setApply(plan); }}>一键配置</button>}
          {control && <button disabled={op.busy} onClick={() => void op.run(async () => {
            const lines = await collab<string[]>('relay','detect',{ id:plan.id, revision:plan.revision });
            setReport({ ...plan, text:lines.join('\n') });
          })}>检测本机 {plan.role}</button>}
          {edit && <><button onClick={() => setEditor(plan)}>编辑</button><button onClick={() => void op.run(() => remove(plan))}>移除</button></>}</div>
        {report?.id === plan.id && report.revision === plan.revision && <p role="status" style={{ whiteSpace:'pre-line' }}>{report.text}</p>}
        <p className="relay-note">配置后，从 B、C 各访问一次对方已开放的服务，验证两个方向都能连接。</p>
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
    {editor && edit && <Editor initial={editor} close={() => setEditor(null)} saved={async (row,configure,profiles) => {
      setEditor(null); openWorkspaceLink('relay','routing/' + row.id); await list.refresh();
      if (!configure) return;
      if (roles.some(role => role !== row.role && !profiles[role])) { setPreset(profiles); setApply(row); return; }
      await op.run(async () => {
        const text = await collab<string>('relay','apply',{ id:row.id, revision:row.revision, profiles });
        setReport({ ...row, text });
      });
    }}/>}
    {apply && desktop && <ApplyDialog plan={apply} preset={preset} close={() => setApply(null)} done={text => { setReport({ ...apply, text }); setApply(null); }}/>}
  </div>;
}
