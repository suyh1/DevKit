import { Fragment, lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Coffee, ExternalLink, Eye, EyeOff, Globe, Monitor, Pencil, Pin, Plus, Power, Radar, Search, Server, ShieldCheck, Terminal, Trash2, Upload, X } from 'lucide-react';
import { Modal, ModalCancel } from './project-components';
import { useConfirmation } from './Confirmation';
import LanHostImport from './LanHostImport';
import LanDiscovery from './LanDiscovery';
import { groupLanHosts, lanMonitorLabels, lanRequest, migrateLanHosts } from './lan-api';
import type { HostDiagnostic, HostDraft, LanHost, ManagedModule } from './lan-api';
import { ensureLanMonitor, monitorRequest, type LanMonitorStatus } from './monitor-api';
import { usePerformanceMode } from './DisplayMode';
import { canOperateMonitor, canWriteWorkspace, remoteAccess } from './workspace-remote';
import { sharedLanInventory } from './lan-api';
import { openWorkspaceLink } from './workspace-links';
import './lan-hosts.css';

const SshTerminal = lazy(() => import('./SshTerminal'));
const RemoteDesktop = lazy(() => import('./RemoteDesktop'));
const empty: HostDraft = { mode: 'ssh', name: '', address: '', user: '', port: 22, platform: 'linux', auth: 'password', modules: { jar: false, nginx: false } };
const titles = { jar: 'JAR 管理', nginx: 'Nginx 配置' };
const endpoint = (host: LanHost) => host.mode === 'share' ? host.address : `${host.user ? `${host.user}@` : ''}${host.address.includes(':') ? `[${host.address}]` : host.address}:${host.port}`;
const loopback = /^(localhost\.?|127\.(?:\d+\.){2}\d+|\[::1\])$/i;
function workbenchLink(address: string) {
  try {
    const url = new URL(address);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || ['0.0.0.0', '[::]'].includes(url.hostname)) return undefined;
    return !loopback.test(url.hostname) || loopback.test(location.hostname) ? url.origin : undefined;
  } catch { return undefined; }
}
type Tab = { id: number; host: LanHost };
let nextTab = 1;

function HostEditor({ host, seed, hosts, close, save, busy, error, portal }: { host?: LanHost; seed?: Partial<HostDraft>; hosts: LanHost[]; close: () => void; save: (value: HostDraft) => void; busy: boolean; error: string; portal: boolean }) {
  const [draft, setDraft] = useState<HostDraft>({ ...empty, ...seed, ...host, password: '' });
  const [revealed, setRevealed] = useState(false);
  const [tags, setTags] = useState(host?.tags?.join('，') || '');
  const [keyError, setKeyError] = useState('');
  const [keyName, setKeyName] = useState('');
  const [readingKey, setReadingKey] = useState(false);
  const keyPicker = useRef<HTMLInputElement>(null);
  const modeName = useId(), formError = useRef<HTMLParagraphElement>(null);
  const patch = (values: Partial<HostDraft>) => setDraft(current => ({ ...current, ...values }));
  const ssh = draft.mode === 'ssh';
  const sameIdentity = !!host && host.mode === draft.mode && host.address === draft.address.trim() &&
    (ssh ? host.user === draft.user.trim() && host.port === draft.port && host.auth === draft.auth && host.keyPath === draft.keyPath && host.jumpHostId === draft.jumpHostId : (host.visitor || '') === (draft.visitor || '').trim());
  const savedKey = sameIdentity && !!host?.hasStoredKey && !draft.clearKey;
  const customKey = ssh && draft.auth === 'key' && (!!draft.keyPath || !!draft.privateKey || savedKey);
  const hasCredential = sameIdentity && !!host?.hasPassword && !draft.privateKey && !draft.clearKey;
  const managesApps = draft.modules.jar || draft.modules.nginx;
  const jumps = hosts.filter(candidate => candidate.mode === 'ssh' && candidate.id !== host?.id);
  const protocols = [
    { value: 'ssh', title: 'SSH', detail: '登录远程终端', Icon: Terminal },
    { value: 'share', title: 'DevKit 共享', detail: '接入远程工作台', Icon: Globe },
  ] as const;

  useEffect(() => { if (error) formError.current?.focus(); }, [error]);

  return <Modal title={host ? '编辑主机连接' : '添加主机连接'} closeLabel="关闭主机设置" close={close} busy={busy} draft={{ ...draft, tags }}
    className="lan-host-dialog" icon={ssh ? <Terminal size={19} /> : <Globe size={19} />}>
    <form className="lan-host-form" onSubmit={event => { event.preventDefault(); if (!readingKey) save({ ...draft, tags: tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) }); }}>
      <div className="lan-host-body">
        <fieldset className="lan-host-section">
          <legend>连接方式</legend>
          <div className="lan-host-choices">
            {protocols.map(({ value, title, detail, Icon }) => <label className="lan-choice lan-protocol" key={value}>
              <input type="radio" name={modeName} value={value} checked={draft.mode === value} onChange={() => {
                setRevealed(false); setKeyName(''); setKeyError('');
                patch({ mode: value, address: '', password: '', keyPath: undefined, privateKey: undefined, clearKey: false, jumpHostId: undefined, clearPassword: false });
              }} />
              <span className="lan-choice-icon"><Icon size={17} /></span>
              <span className="lan-protocol-copy"><strong>{title}</strong><small>{detail}</small></span>
              <span className="lan-choice-mark" aria-hidden="true"><Check size={12} /></span>
            </label>)}
          </div>
        </fieldset>

        <fieldset className="lan-host-section">
          <legend>连接信息</legend>
          <div className={`lan-host-fields ${ssh ? 'lan-host-fields-ssh' : ''}`}>
            <label className="lan-field lan-address"><span>{ssh ? '主机名或 IP' : '共享地址'}</span>
              <input data-modal-focus required autoComplete="off" spellCheck={false} value={draft.address} onChange={event => patch({ address: event.target.value })}
                placeholder={ssh ? '192.168.1.20' : 'http://192.168.1.20:8765'} />
            </label>
            {ssh && <label className="lan-field lan-port"><span>端口</span><input required type="number" min={1} max={65535} value={draft.port || ''} onChange={event => patch({ port: Number(event.target.value) })} /></label>}
            <label className="lan-field lan-host-name"><span>显示名称 <small>选填</small></span><input value={draft.name} onChange={event => patch({ name: event.target.value })} maxLength={120} placeholder="例如：测试服务器" /></label>
            {ssh && <label className="lan-field lan-platform"><span>目标系统</span><span className="lan-select">
              <select value={draft.platform} onChange={event => patch({ platform: event.target.value as HostDraft['platform'] })}><option value="linux">Linux</option><option value="win32">Windows</option></select><ChevronDown size={15} aria-hidden="true" />
            </span></label>}
          </div>
        </fieldset>

        <fieldset className="lan-host-section">
          <legend>登录凭据</legend>
          <div className="lan-host-fields">
            {!ssh && <label className="lan-field"><span>访客名称（选填）</span><input autoComplete="off" value={draft.visitor || ''} maxLength={48} onChange={event => patch({ visitor: event.target.value })} /></label>}
            {ssh && <>
              <label className="lan-field"><span>用户名</span><input required autoComplete="off" value={draft.user} maxLength={120} onChange={event => patch({ user: event.target.value })} /></label>
              <label className="lan-field"><span>认证方式</span><span className="lan-select">
                <select value={draft.auth} onChange={event => { setRevealed(false); setKeyError(''); setKeyName(''); patch({ auth: event.target.value as HostDraft['auth'], keyPath: undefined, privateKey: undefined, clearKey: false, password: '', clearPassword: false }); }}>
                  <option value="password">用户名与密码</option><option value="key">{portal ? 'SSH 私钥' : 'SSH Agent 或私钥'}</option>
                </select><ChevronDown size={15} aria-hidden="true" />
              </span></label>
            </>}
            {ssh && draft.auth === 'key' && <div className="lan-key-picker">
              <span className="lan-note" title={draft.keyPath}>{keyName || draft.keyPath || (savedKey ? '已配置私钥' : portal || host?.explicitKeyOnly ? '选择私钥文件' : '使用 SSH Agent 或默认密钥')}</span>
              {portal && <input type="file" hidden ref={keyPicker} onChange={event => {
                const input = event.currentTarget, file = input.files?.[0]; input.value = '';
                if (!file) return;
                if (file.size > 262144) { setKeyError('私钥文件最多 256 KiB。'); return; }
                setReadingKey(true); setKeyError('');
                void file.text().then(privateKey => {
                  if (!privateKey.trim()) throw new Error('私钥文件为空。');
                  setKeyName(file.name); patch({ privateKey, clearKey: false, password: '', clearPassword: false });
                }).catch(failure => setKeyError(failure.message)).finally(() => setReadingKey(false));
              }} />}
              <button type="button" className="secondary-button" disabled={readingKey} onClick={() => {
                setKeyError('');
                if (portal) keyPicker.current?.click();
                else void lanRequest<string | null>('pick-ssh-key').then(keyPath => { if (keyPath) patch({ keyPath, clearKey: false, password: '', clearPassword: false }); }).catch(error => setKeyError(error.message));
              }}>选择私钥文件</button>
              {customKey && <button type="button" className="text-button" onClick={() => { setKeyName(''); patch({ keyPath: undefined, privateKey: undefined, clearKey: true, password: '', clearPassword: false }); }}>移除指定私钥</button>}
              {keyError && <small role="alert">{keyError}</small>}
            </div>}
            {(!ssh || draft.auth === 'password' || customKey) && <div className="lan-password-row">
              <label className="lan-field"><span>{customKey ? '私钥解锁口令（选填）' : ssh ? 'SSH 密码' : '目标共享口令'}</span><span className="lan-password">
                <input type={revealed ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} value={draft.password} maxLength={ssh ? 4096 : 128}
                  onChange={event => patch({ password: event.target.value, clearPassword: false })} placeholder={hasCredential && !draft.clearPassword ? '已保存，留空沿用' : undefined} />
              </span></label>
              <button type="button" className="icon-button lan-password-toggle" aria-label={revealed ? '隐藏密码' : '显示密码'} onClick={() => setRevealed(value => !value)}>
                {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>}
            {hasCredential && <label className="lan-clear-credential"><input type="checkbox" checked={!!draft.clearPassword} onChange={event => { setRevealed(false); patch({ clearPassword: event.target.checked, password: '' }); }} />清除已保存的凭据</label>}
            {ssh && <label className="lan-field"><span>SSH 跳板机 <small>选填</small></span><span className="lan-select">
              <select value={draft.jumpHostId || ''} onChange={event => patch({ jumpHostId: event.target.value || undefined })}>
                <option value="">直接连接</option>
                {draft.jumpHostId && !jumps.some(candidate => candidate.id === draft.jumpHostId) && <option value={draft.jumpHostId}>原跳板机已移除</option>}
                {jumps.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}{candidate.fingerprint ? '' : '（待验证指纹）'}</option>)}
              </select><ChevronDown size={15} aria-hidden="true" />
            </span></label>}
          </div>
        </fieldset>

        <fieldset className="lan-host-section lan-module-settings">
          <legend>显示在管理列表 <small>选填</small></legend>
          <div className="lan-host-choices">
            {([['jar', Coffee], ['nginx', Server]] as const).map(([module, Icon]) => <label className="lan-choice lan-module" key={module}>
              <input type="checkbox" checked={draft.modules[module]} onChange={event => patch({ modules: { ...draft.modules, [module]: event.target.checked } })} />
              <span className="lan-choice-icon"><Icon size={16} /></span>
              <strong>{titles[module]}</strong><span className="lan-choice-mark" aria-hidden="true"><Check size={12} /></span>
            </label>)}
          </div>
          {managesApps && <p className="lan-host-hint">{ssh ? '首次管理时自动识别目标平台并部署便携 Node.js。启用 JAR 管理需要目标机安装 Java，启用 Nginx 配置需要目标机安装 nginx。' : '请在目标 DevKit 开放对应栏目，并授予所需权限。'}</p>}
        </fieldset>
        <fieldset className="lan-host-section">
          <legend>分组与标签 <small>选填</small></legend>
          <div className="lan-host-fields">
            <label className="lan-field"><span>分组</span><input value={draft.group || ''} maxLength={60} onChange={event => patch({ group: event.target.value })} placeholder="例如：生产环境" /></label>
            <label className="lan-field"><span>标签</span><input value={tags} maxLength={490} onChange={event => setTags(event.target.value)} placeholder="以逗号分隔" /></label>
          </div>
        </fieldset>
        <fieldset className="lan-host-section">
          <legend>远程桌面与唤醒 <small>选填</small></legend>
          <div className="lan-host-fields">
            <label className="lan-field"><span>远程桌面端口</span><input type="number" min={1} max={65535} value={draft.rdpPort || ''} onChange={event => patch({ rdpPort: Number(event.target.value) || undefined })} placeholder={ssh && draft.platform === 'win32' ? '默认 3389' : '例如：3389'} /></label>
            <label className="lan-field"><span>设备 MAC 地址</span><input value={draft.mac || ''} onChange={event => patch({ mac: event.target.value })} maxLength={17} spellCheck={false} placeholder="00:11:22:33:44:55" /></label>
          </div>
        </fieldset>
        {error && <p className="lan-host-error" ref={formError} tabIndex={-1} role="alert">{error}</p>}
      </div>
      <footer className="lan-host-footer">
        {ssh && <span className="lan-host-security"><ShieldCheck size={15} />首次连接需核对 SSH 指纹</span>}
        <div className="lan-host-actions"><ModalCancel /><button type="submit" className="run-button" disabled={readingKey}>{busy ? '保存中…' : '保存连接'}</button></div>
      </footer>
    </form>
  </Modal>;
}

export default function LanHosts({ active, onOpenMonitor, portal = false }: { active: boolean; onOpenMonitor: (id: string) => void; portal?: boolean }) {
  const services = remoteAccess()?.services;
  const available = portal ? !!services?.['lan-hosts'].enabled : !!window.devkitDesktop?.lanHosts;
  const allowed = (key: 'edit' | 'diagnose' | 'terminal' | 'files' | 'discover' | 'wake' | 'rdp') => !portal || services?.['lan-hosts'][key] === true;
  const monitorAvailable = portal ? !!services?.monitor.enabled : !!window.devkitMonitor;
  const addMonitor = monitorAvailable && (!portal || canWriteWorkspace('monitor') && canOperateMonitor());
  const statusSeconds = usePerformanceMode() ? 15 : 5;
  const [statuses, setStatuses] = useState<LanMonitorStatus[]>([]);
  const [hosts, setHosts] = useState<LanHost[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<LanHost | 'new' | null>(null);
  const [seed, setSeed] = useState<Partial<HostDraft>>();
  const [discovering, setDiscovering] = useState(false);
  const [importing, setImporting] = useState(false);
  const [diagnostic, setDiagnostic] = useState<{ host: LanHost; result: HostDiagnostic }>();
  const [rdpHost, setRdpHost] = useState<LanHost>();
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [focusedHost, setFocusedHost] = useState('');
  const [tabs, setTabs] = useState<Tab[]>([]), [selected, setSelected] = useState<number>();
  const requestVersion = useRef(0), working = useRef(false);
  const confirm = useConfirmation();
  async function load(signal?: AbortSignal) {
    const version = ++requestVersion.current;
    if (portal) {
      const { hosts, statuses } = await sharedLanInventory(signal);
      if (version !== requestVersion.current || signal?.aborted) return;
      setHosts(hosts.map(host => ({ ...empty, hasPassword: false, ...host })));
      setStatuses(statuses);
    } else setHosts(await lanRequest<LanHost[]>('list'));
    setLoaded(true);
  }
  useEffect(() => {
    if (!available || !active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh(initial = false) {
      try {
        if (!portal) await migrateLanHosts();
        if (initial || !document.hidden && !working.current) await load(controller.signal);
      } catch (error) { if (!controller.signal.aborted && !working.current) setError((error as Error).message); }
      finally { if (portal && !controller.signal.aborted) timer = setTimeout(() => void refresh(), statusSeconds * 1000); }
    }
    void refresh(true);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, available, portal, statusSeconds]);
  useEffect(() => {
    if (!active || !monitorAvailable || portal) return;
    let mounted = true;
    const refresh = () => { void monitorRequest<LanMonitorStatus[]>('lan-statuses').then(result => { if (mounted) setStatuses(result); }).catch(() => {}); };
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, statusSeconds * 1000);
    return () => { mounted = false; clearInterval(timer); };
  }, [active, monitorAvailable, portal, statusSeconds]);
  async function task(run: () => Promise<void>) {
    if (working.current) return;
    working.current = true; requestVersion.current++;
    setBusy(true); setError(''); setNotice('');
    try { await run(); } catch (failure) { setError((failure as Error).message); }
    finally { working.current = false; setBusy(false); }
  }
  async function verify(host: LanHost) {
    const result = await lanRequest<{ message?: string; fingerprint?: string }>('test', { id: host.id });
    if (!result.fingerprint) { if (result.message) setNotice(result.message); return true; }
    const accepted = await confirm({ title: `信任 ${host.name} 的 SSH 主机指纹？`, detail: `${endpoint(host)}\n${result.fingerprint}\n请与服务器管理员提供的指纹核对。`, confirm: '信任并连接', cancel: '取消连接' });
    if (!accepted) return false;
    try {
      const verified = await lanRequest<{ message: string }>('test', { id: host.id, fingerprint: result.fingerprint });
      setNotice(verified.message); return true;
    } finally { await load(); }
  }
  async function diagnose(host: LanHost) {
    const result = await lanRequest<HostDiagnostic>('diagnose', { id: host.id });
    setDiagnostic({ host, result });
  }
  function closeTab(id: number) {
    const remaining = tabs.filter(tab => tab.id !== id);
    setTabs(remaining);
    if (selected === id) setSelected(remaining.at(-1)?.id);
  }
  const grouped = groupLanHosts(hosts, query, endpoint);
  const visibleHosts = grouped.flatMap(([, entries]) => entries);
  const currentHost = visibleHosts.find(host => host.id === focusedHost) ?? visibleHosts[0];
  return <section className="lan-center">
    <header className="lan-heading workspace-banner"><div><h1>局域网主机</h1><p>{allowed('terminal') ? '管理远程连接、验证主机指纹，并在 SSH 终端中维护服务器。' : '查看共享主机保存的远程连接与端口状态。'}</p></div>{available && <div className="lan-heading-actions">
      {portal && <button className="secondary-button" disabled={busy} onClick={() => void task(() => load())}>刷新</button>}
      {allowed('discover') && <button className="secondary-button" disabled={busy} onClick={() => setDiscovering(true)}><Radar size={15} />发现主机</button>}
      {allowed('edit') && <><button className="secondary-button" disabled={busy} onClick={() => setImporting(true)}><Upload size={15} />导入主机</button>
      <button className="run-button" disabled={busy || !loaded} onClick={() => { setError(''); setSeed(undefined); setEditing('new'); }}><Plus size={16} />添加主机</button></>}
    </div>}</header>
    {!available ? <p className="lan-note">局域网主机暂不可用。</p> : <div className={`lan-layout${allowed('terminal') ? '' : ' lan-layout-list'}`}>
      <aside className="lan-connections" aria-label="保存的主机连接">
        <label className="lan-search"><Search size={16} /><input aria-label="搜索主机" placeholder="搜索名称、地址或标签" value={query} onChange={event => setQuery(event.target.value)} /></label>
        {!hosts.length && <p className="lan-note">{loaded || error ? '暂无已保存的连接。' : '正在读取主机清单…'}</p>}
        {!!hosts.length && !grouped.length && <p className="lan-note">没有匹配的主机。</p>}
        <ul className="lan-host-list">{grouped.map(([key, entries]) => <Fragment key={key}>
          {key !== 'group:' || grouped.length > 1 ? <li className="lan-group-label">{key === 'pinned' ? '置顶' : entries[0].group || '未分组'}</li> : null}
          {entries.map(host => {
            const status = statuses.find(item => item.hostId === host.id);
            const link = portal && host.mode === 'share' ? workbenchLink(host.address) : undefined;
            return <li key={host.id}>
          <header><button type="button" className="lan-connection-select" aria-expanded={currentHost?.id === host.id} aria-controls={`lan-actions-${host.id}`} onClick={() => setFocusedHost(host.id)}>
            {host.mode === 'ssh' ? <Terminal size={17} /> : <Globe size={17} />}<span><strong>{host.name}</strong><small>{endpoint(host)}</small></span>
          </button>
            {allowed('edit') && <><button className="icon-button" disabled={busy} aria-label={`${host.pinned ? '取消置顶' : '置顶'} ${host.name}`} aria-pressed={!!host.pinned} onClick={() => void task(async () => {
              setHosts(await lanRequest<LanHost[]>('save', { ...host, pinned: !host.pinned }));
            })}><Pin size={14} /></button>
            <button className="icon-button" disabled={busy} aria-label={`编辑 ${host.name}`} onClick={() => { setError(''); setEditing(host); }}><Pencil size={15} /></button></>}
          </header>
          {!!host.tags?.length && <div className="lan-host-tags">{host.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
          <p className="lan-note">{host.mode === 'ssh' ? (!portal || allowed('edit') ? `${host.platform === 'win32' ? 'Windows' : 'Linux'} · ${host.auth === 'password' ? '密码' : '密钥'} · ${host.fingerprint ? '已信任' : '待验证指纹'}` : `SSH${host.fingerprint ? ' · 已信任' : ''}`) : 'DevKit 共享'}{(Object.keys(titles) as ManagedModule[]).filter(module => host.modules[module]).map(module => ` · ${titles[module]}`).join('')}</p>
          {status && <p className="lan-monitor-status"><span className={`monitor-status ${status.state}`}>{lanMonitorLabels[status.state]}</span>{status.checkedAt && <small>最近检测 {new Date(status.checkedAt).toLocaleString()}{status.elapsed === undefined ? '' : ` · ${status.elapsed} ms`}</small>}</p>}
          <div className="pc-actions" id={`lan-actions-${host.id}`} hidden={currentHost?.id !== host.id}>
            {host.mode === 'ssh' ? allowed('terminal') && <button className="secondary-button" disabled={busy || !host.fingerprint && !(allowed('edit') && allowed('diagnose'))} title={!host.fingerprint ? '首次连接需核对 SSH 指纹' : undefined} onClick={() => void task(async () => { if (host.fingerprint || await verify(host)) { const id = nextTab++; setTabs(items => [...items, { id, host }]); setSelected(id); } })}><Terminal size={14} />打开终端</button> : portal ? link && <a className="text-button" href={link} target="_blank" rel="noreferrer"><ExternalLink size={14} />打开工作台</a> : <button className="secondary-button" disabled={busy} onClick={() => void task(async () => { const result = await window.devkitDesktop?.openLanHost?.(host.address, host.modules.nginx && !host.modules.jar ? 'nginx' : 'jar'); if (!result || result.error) throw new Error(result?.error || '远程工作台不可用。'); })}><ExternalLink size={14} />打开工作台</button>}
            {allowed('diagnose') && <button className="text-button" disabled={busy} onClick={() => void task(() => diagnose(host))}>测试连接</button>}
            {monitorAvailable && (status || addMonitor) && <button className="text-button" disabled={busy} onClick={() => void task(async () => onOpenMonitor(portal && status ? status.id : await ensureLanMonitor(host)))}>{status ? '监控历史' : '启用端口监控'}</button>}
            {host.hasLogs && <button className="text-button" disabled={busy} onClick={() => openWorkspaceLink('logs', `host:${host.id}`)}>查看日志</button>}
            {(portal ? allowed('rdp') && host.canRdp : window.devkitDesktop?.platform === 'win32' && (host.rdpPort || host.platform === 'win32')) && <button className="text-button" disabled={busy} onClick={() => {
              if (portal) setRdpHost(host);
              else void task(async () => { await lanRequest('open-rdp', { id: host.id }); });
            }}><Monitor size={14} />{portal ? '连接远程桌面' : '远程桌面'}</button>}
            {allowed('wake') && (host.canWake || host.mac) && <button className="text-button" disabled={busy} onClick={() => void task(async () => {
              const result = await lanRequest<{ broadcast: string }>('wake', { id: host.id });
              setNotice(`已向 ${host.name} 发送唤醒包（${result.broadcast}）。`);
            })}><Power size={14} />网络唤醒</button>}
            {host.fingerprint && allowed('diagnose') && allowed('edit') && <button title={host.fingerprint} className="text-button" disabled={busy} onClick={() => void task(async () => {
              if (await confirm({ title: `重置 ${host.name} 的 SSH 指纹？`, detail: '下次连接时需要重新核对指纹。', confirm: '重置指纹' })) setHosts(await lanRequest<LanHost[]>('reset-trust', { id: host.id }));
            })}>重置指纹</button>}
            {allowed('edit') && <button className="icon-button" disabled={busy} aria-label={`移除 ${host.name}`} onClick={() => void task(async () => {
              if (await confirm({ title: `移除 ${host.name}？`, detail: '此主机及其应用将从当前工作台列表移除，目标机上的应用和配置会保留。', confirm: '移除连接' })) {
                setHosts(await lanRequest<LanHost[]>('remove', portal ? { id: host.id, revision: host.revision } : host.id));
                setTabs(items => items.filter(tab => tab.host.id !== host.id));
                setSelected(current => tabs.find(tab => tab.id === current)?.host.id === host.id ? tabs.filter(tab => tab.host.id !== host.id).at(-1)?.id : current);
              }
            })}><Trash2 size={15} /></button>}
          </div>
        </li>; })}</Fragment>)}</ul>
      </aside>
      {allowed('terminal') && <section className="lan-terminal-area" aria-label="SSH 终端">
        {!!tabs.length ? <div role="tablist" aria-label="SSH 会话" className="lan-terminal-tabs">{tabs.map(tab => <div key={tab.id} className={selected === tab.id ? 'selected' : ''}><button type="button" role="tab" aria-selected={selected === tab.id} aria-controls={`lan-tab-${tab.id}`} onClick={() => setSelected(tab.id)}><Terminal size={14} />{tab.host.name}<small>{endpoint(tab.host)}</small></button><button type="button" className="icon-button" aria-label={`关闭 ${tab.host.name} 的终端`} onClick={() => closeTab(tab.id)}><X size={14} /></button></div>)}</div> : <div className="lan-terminal-empty"><Terminal size={32} /><h2>SSH 终端</h2><p>从左侧选择一台 SSH 主机打开会话。</p></div>}
        <Suspense fallback={<p className="lan-note">正在加载终端…</p>}>{tabs.map(tab => <div key={tab.id} id={`lan-tab-${tab.id}`} role="tabpanel" aria-label={tab.host.name} hidden={selected !== tab.id}><SshTerminal id={tab.host.id} active={active && selected === tab.id} allowFiles={allowed('files')} portal={portal} /></div>)}</Suspense>
      </section>}
    </div>}
    {notice && <p className="pc-feedback" role="status">{notice}</p>}
    {error && !editing && <p className="pc-error" role="alert">{error}</p>}
    {diagnostic && <Modal title={`连接诊断 · ${diagnostic.host.name}`} closeLabel="关闭连接诊断" close={() => setDiagnostic(undefined)} busy={busy}>
      <p className="lan-note">检测时间 {new Date(diagnostic.result.checkedAt).toLocaleString()}</p>
      <ul className="lan-diagnostic" aria-label="诊断结果">{diagnostic.result.checks.map(check => <li key={check.name}>
        <strong>{check.name}</strong><span data-state={check.state}>{check.state === 'pass' ? '通过' : check.state === 'skip' ? '跳过' : check.detail === diagnostic.result.fingerprint ? '待核对' : '失败'}</span><small>{check.detail}</small>
      </li>)}</ul>
      {error && <p className="pc-error" role="alert">{error}</p>}
      <footer><ModalCancel />{diagnostic.result.fingerprint && allowed('edit') && <button className="run-button" disabled={busy} onClick={() => void task(async () => {
        if (await verify(diagnostic.host)) await diagnose(diagnostic.host);
      })}>核对指纹并继续</button>}</footer>
    </Modal>}
    {editing && <HostEditor portal={portal} host={editing === 'new' ? undefined : editing} seed={editing === 'new' ? seed : undefined} hosts={hosts} error={error} busy={busy} close={() => { setEditing(null); setError(''); }} save={value => void task(async () => { setHosts(await lanRequest<LanHost[]>('save', { ...value, id: editing === 'new' ? undefined : editing.id, revision: editing === 'new' ? undefined : editing.revision })); setEditing(null); setNotice('连接已保存。'); })} />}
    {importing && <LanHostImport close={() => setImporting(false)} onImport={updated => { setHosts(updated); setImporting(false); setNotice('所选主机连接已导入。'); }} />}
    {discovering && <LanDiscovery close={() => setDiscovering(false)} onChoose={allowed('edit') ? draft => { setDiscovering(false); setSeed(draft); setError(''); setEditing('new'); } : undefined} />}
    {rdpHost && active && <Suspense fallback={<p className="lan-note" role="status">正在加载远程桌面…</p>}><RemoteDesktop host={rdpHost} close={() => setRdpHost(undefined)} /></Suspense>}
  </section>;
}
