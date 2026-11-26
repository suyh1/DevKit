import SessionProtocolFields, { SerialAddress } from './SessionProtocolFields';
import FloatingDetails from './FloatingDetails';
import { TextInput } from './TextControl';
import { navigateTabList } from './tab-navigation';
import Skeleton from './Skeleton';
import SegmentedControl from './SegmentedControl';
import { Fragment, lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { Cable, Maximize, Minimize, Check, ServerCog, ExternalLink, Eye, EyeOff, Globe, FolderOpen, Monitor, Pencil, Pin, Plus, Power, Radar, Search, Server, ShieldCheck, Terminal, Trash2, Upload, X } from 'lucide-react';
import { Modal, ModalCancel } from './project-components';
import { useConfirmation } from './Confirmation';
import LanHostImport from './LanHostImport';
import LanDiscovery from './LanDiscovery';
import { groupLanHosts, lanMonitorLabels, lanRequest, migrateLanHosts } from './lan-api';
import type { HostDiagnostic, HostDraft, LanHost, ManagedModule } from './lan-api';
import { jarRequest } from './jar-api';
import { nginxRequest } from './nginx-api';
import type { HostGroup } from './lan-api';
import { ensureLanMonitor, monitorRequest, type LanMonitorStatus } from './monitor-api';
import { usePerformanceMode } from './DisplayMode';
import { remoteAccess } from './workspace-remote';
import { sharedLanInventory } from './lan-api';
import { RelatedLink, useRelatedCreation, useWorkspaceFeedback, useWorkspaceGuard } from './related-workspaces';
import { missingResourceLink, openWorkspaceLink, useWorkspaceResource } from './workspace-links';
import './lan-hosts.css';

import { defaultPort, protocolName } from './lan-protocols';
const VncSession = lazy(() => import('./VncSession'));
const SftpSession = lazy(() => import('./SftpSession'));
const protocolIcon = { ssh: Terminal, telnet: Terminal, serial: Cable, ftp: FolderOpen, sftp: FolderOpen, vnc: Monitor, rdp: Monitor, share: Globe };
const protocolDetail = { ssh: '登录远程终端', telnet: '连接网络终端', serial: '连接本机设备', ftp: 'FTP / FTPS 文件传输', sftp: '浏览与传输文件', vnc: '控制远端屏幕', rdp: '连接远程桌面', share: '接入远程工作台' };
const SshTerminal = lazy(() => import('./SshTerminal'));
const RemoteDesktop = lazy(() => import('./RemoteDesktop'));
const empty: HostDraft = { mode: 'ssh', name: '', address: '', user: '', port: 22, platform: 'linux', auth: 'password', modules: { jar: false, nginx: false } };
const titles = { jar: '服务管理', nginx: 'Nginx 配置' };
const endpoint = (host: LanHost) => host.mode === 'serial' ? host.address + ' · ' + host.baudRate + ' baud' : host.mode === 'share' ? host.address : `${host.user ? `${host.user}@` : ''}${host.address.includes(':') ? `[${host.address}]` : host.address}:${host.port}`;
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

function HostEditor({ active, host, seed, hosts, close, save, canConnect, busy, error, portal, newJump }: { active: boolean; newJump?: (select: (id: string) => void) => void; host?: LanHost; seed?: Partial<HostDraft>; hosts: LanHost[]; close: () => void; save: (value: HostDraft, connect?: boolean) => void; canConnect?: (mode: HostDraft['mode']) => boolean; busy: boolean; error: string; portal: boolean }) {
  const [draft, setDraft] = useState<HostDraft>({ ...empty, ...seed, ...host, password: '' });
  const [revealed, setRevealed] = useState(false);
  const [tags, setTags] = useState(host?.tags?.join('，') || '');
  const [keyError, setKeyError] = useState('');
  const [keyName, setKeyName] = useState('');
  const [readingKey, setReadingKey] = useState(false);
  const keyPicker = useRef<HTMLInputElement>(null);
  const modeName = useId(), formError = useRef<HTMLParagraphElement>(null);
  const patch = (values: Partial<HostDraft>) => setDraft(current => ({ ...current, ...values }));
  const ssh = draft.mode === 'ssh' || draft.mode === 'sftp';
  const ftp = draft.mode === 'ftp', serial = draft.mode === 'serial';
  const share = draft.mode === 'share', management = share || draft.mode === 'ssh';
  const ProtocolIcon = protocolIcon[draft.mode];
  const sameIdentity = !!host && host.mode === draft.mode && host.address === draft.address.trim() &&
    (ftp ? host.user === (draft.user.trim() || 'anonymous') && host.port === draft.port && host.ftpSecurity === draft.ftpSecurity : ssh ? host.user === draft.user.trim() && host.port === draft.port && host.auth === draft.auth && host.keyPath === draft.keyPath && host.jumpHostId === draft.jumpHostId : (host.visitor || '') === (draft.visitor || '').trim());
  const savedKey = sameIdentity && !!host?.hasStoredKey && !draft.clearKey;
  const customKey = ssh && draft.auth === 'key' && (!!draft.keyPath || !!draft.privateKey || savedKey);
  const hasCredential = sameIdentity && !!host?.hasPassword && !draft.privateKey && !draft.clearKey;
  const managesApps = draft.modules.jar || draft.modules.nginx;
  const jumps = hosts.filter(candidate => candidate.mode === 'ssh' && candidate.id !== host?.id);
  const protocols = Object.keys(protocolIcon) as HostDraft['mode'][];

  useEffect(() => { if (error) formError.current?.focus(); }, [error]);

  return <Modal active={active} title={host ? '编辑主机连接' : newJump ? '添加主机连接' : '新建跳板机'} closeLabel="关闭主机设置" close={close} busy={busy} draft={{ ...draft, tags }}
    className="lan-host-dialog" icon={<ProtocolIcon size={19} />}>
    <form className="lan-host-form" onSubmit={event => { event.preventDefault(); if (!readingKey) save({ ...draft, tags: tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) }, ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === 'connect'); }}>
      <div className="lan-host-body">
        <fieldset className="lan-host-section">
          <legend>连接方式</legend>
          <div className="lan-host-choices">
            {protocols.filter(value => (newJump || value === 'ssh') && (!portal || value !== 'serial')).map(value => {
              const Icon = protocolIcon[value];
              return <label className="lan-choice lan-protocol" key={value}>
              <input type="radio" name={modeName} value={value} checked={draft.mode === value} onChange={() => {
                setRevealed(false); setKeyName(''); setKeyError('');
                patch({ mode: value, ftpSecurity: undefined, port: defaultPort[value], address: share || serial || value === 'share' || value === 'serial' ? '' : draft.address, user: '', lineEnding: undefined, visitor: undefined, rdpPort: undefined, modules: { jar: false, nginx: false }, password: '', keyPath: undefined, privateKey: undefined, clearKey: false, jumpHostId: undefined, clearPassword: false });
              }} />
              <span className="lan-choice-icon"><Icon size={17} /></span>
              <span className="lan-protocol-copy"><strong>{protocolName[value]}</strong><small>{protocolDetail[value]}</small></span>
              <span className="lan-choice-mark" aria-hidden="true"><Check size={12} /></span>
            </label>; })}
          </div>
        </fieldset>

        <fieldset className="lan-host-section">
          <legend>连接信息</legend>
          <div className={`lan-host-fields ${!share ? 'lan-host-fields-ssh' : ''}`}>
            {serial ? <SerialAddress draft={draft} patch={patch} /> : <label className="lan-field lan-address"><span>{!share ? '主机名或 IP' : '共享地址'}</span>
              <TextInput data-modal-focus required autoComplete="off" spellCheck={false} value={draft.address} onChange={event => patch({ address: event.target.value })}
                placeholder={!share ? '192.168.1.20' : 'http://192.168.1.20:8765'} />
            </label>}
            {!share && !serial && <label className="lan-field lan-port"><span>端口</span><input required type="number" min={1} max={65535} value={draft.port || ''} onChange={event => patch({ port: Number(event.target.value) })} /></label>}
            <label className="lan-field lan-host-name"><span>显示名称 <small>选填</small></span><TextInput value={draft.name} onChange={event => patch({ name: event.target.value })} maxLength={120} placeholder="例如：测试服务器" /></label>
            {ssh && <div className="lan-field lan-platform"><span>目标系统</span><SegmentedControl label="目标系统" value={draft.platform} options={[{ value: 'linux', label: 'Linux' }, { value: 'win32', label: 'Windows' }]} onChange={platform => patch({ platform })} /></div>}
          </div>
        </fieldset>

        <SessionProtocolFields draft={draft} patch={patch} />
        {(ssh || share || ftp) && <fieldset className="lan-host-section">
          <legend>登录凭据</legend>
          <div className="lan-host-fields">
            {share && <label className="lan-field"><span>访客名称（选填）</span><TextInput autoComplete="off" value={draft.visitor || ''} maxLength={48} onChange={event => patch({ visitor: event.target.value })} /></label>}
            {ssh && <>
              <label className="lan-field"><span>用户名</span><TextInput required autoComplete="off" value={draft.user} maxLength={120} onChange={event => patch({ user: event.target.value })} /></label>
              <label className="lan-field"><span>认证方式</span>
                <select value={draft.auth} onChange={event => { setRevealed(false); setKeyError(''); setKeyName(''); patch({ auth: event.target.value as HostDraft['auth'], keyPath: undefined, privateKey: undefined, clearKey: false, password: '', clearPassword: false }); }}>
                  <option value="password">用户名与密码</option><option value="key">{portal ? 'SSH 私钥' : 'SSH Agent 或私钥'}</option>
                </select>
              </label>
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
              <label className="lan-field"><span>{customKey ? '私钥解锁口令（选填）' : ssh ? 'SSH 密码' : ftp ? 'FTP 密码' : '目标共享口令'}</span><span className="lan-password">
                <TextInput type={revealed ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} value={draft.password} maxLength={share ? 128 : 4096}
                  onChange={event => patch({ password: event.target.value, clearPassword: false })} placeholder={hasCredential && !draft.clearPassword ? '已保存，留空沿用' : undefined} />
              </span></label>
              <button type="button" className="icon-button lan-password-toggle" aria-label={revealed ? '隐藏密码' : '显示密码'} onClick={() => setRevealed(value => !value)}>
                {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>}
            {hasCredential && <label className="lan-clear-credential"><input className="form-check" type="checkbox" checked={!!draft.clearPassword} onChange={event => { setRevealed(false); patch({ clearPassword: event.target.checked, password: '' }); }} />清除已保存的凭据</label>}
            {ssh && <div className="lan-jump-row">
              <label className="lan-field"><span>SSH 跳板机 <small>选填</small></span>
                <select value={draft.jumpHostId || ''} onChange={event => patch({ jumpHostId: event.target.value || undefined })}>
                  <option value="">直接连接</option>
                  {draft.jumpHostId && !jumps.some(candidate => candidate.id === draft.jumpHostId) && <option value={draft.jumpHostId}>原跳板机已移除</option>}
                  {jumps.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}{candidate.fingerprint ? '' : '（待验证指纹）'}</option>)}
                </select>
              </label>
              {newJump && <button type="button" className="secondary-button" onClick={() => newJump(id => patch({ jumpHostId: id }))}><Plus size={14} />新建跳板机</button>}
            </div>}
          </div>
        </fieldset>}

        {management && <fieldset className="lan-host-section lan-module-settings">
          <legend>显示在管理列表 <small>选填</small></legend>
          <div className="lan-host-choices">
            {([['jar', ServerCog], ['nginx', Server]] as const).map(([module, Icon]) => <label className="lan-choice lan-module" key={module}>
              <input type="checkbox" checked={draft.modules[module]} onChange={event => patch({ modules: { ...draft.modules, [module]: event.target.checked } })} />
              <span className="lan-choice-icon"><Icon size={16} /></span>
              <strong>{titles[module]}</strong><span className="lan-choice-mark" aria-hidden="true"><Check size={12} /></span>
            </label>)}
          </div>
          {managesApps && <p className="lan-host-hint">{ssh ? '首次管理时自动识别目标平台并部署便携 Node.js。运行 JAR 需要 Java，运行 npm 项目需要 Node.js 和 npm，启用 Nginx 配置需要目标机安装 nginx。' : '请在目标 DevKit 开放对应栏目，并授予所需权限。'}</p>}
        </fieldset>}
        <fieldset className="lan-host-section">
          <legend>分组与标签 <small>选填</small></legend>
          <div className="lan-host-fields">
            <label className="lan-field"><span>分组</span><TextInput value={draft.group || ''} maxLength={60} onChange={event => patch({ group: event.target.value })} placeholder="例如：生产环境" /></label>
            <label className="lan-field"><span>标签</span><TextInput value={tags} maxLength={490} onChange={event => setTags(event.target.value)} placeholder="以逗号分隔" /></label>
          </div>
        </fieldset>
        {!serial && <fieldset className="lan-host-section">
          <legend>{management ? '远程桌面与唤醒' : '网络唤醒'} <small>选填</small></legend>
          <div className="lan-host-fields">
            {management && <label className="lan-field"><span>远程桌面端口</span><input type="number" min={1} max={65535} value={draft.rdpPort || ''} onChange={event => patch({ rdpPort: Number(event.target.value) || undefined })} placeholder={ssh && draft.platform === 'win32' ? '默认 3389' : '例如：3389'} /></label>}
            <label className="lan-field"><span>设备 MAC 地址</span><TextInput value={draft.mac || ''} onChange={event => patch({ mac: event.target.value })} maxLength={17} spellCheck={false} placeholder="00:11:22:33:44:55" /></label>
          </div>
        </fieldset>}
        {error && <p className="lan-host-error" ref={formError} tabIndex={-1} role="alert">{error}</p>}
      </div>
      <footer className="lan-host-footer">
        {ssh && <span className="lan-host-security"><ShieldCheck size={15} />首次连接需核对 SSH 指纹</span>}
        <div className="lan-host-actions">
          <ModalCancel />
          <button type="submit" className="run-button" disabled={readingKey}>{busy ? '保存中…' : '保存连接'}</button>
          {canConnect?.(draft.mode) && <button type="submit" value="connect" className="secondary-button" disabled={readingKey}>保存并连接</button>}
        </div>
      </footer>
    </form>
  </Modal>;
}

export default function LanHosts({ active, onOpenMonitor, initialDraft, consumeDraft, portal = false }: { initialDraft?: Partial<HostDraft>; consumeDraft?: () => void; active: boolean; onOpenMonitor: (id: string) => void; portal?: boolean }) {
  const services = remoteAccess()?.services;
  const available = portal ? !!services?.['lan-hosts'].enabled : !!window.devkitDesktop?.lanHosts;
  const allowed = (key: 'edit' | 'diagnose' | 'terminal' | 'files' | 'discover' | 'wake' | 'rdp') => !portal || services?.['lan-hosts'][key] === true;
  const monitorAvailable = portal ? !!services?.monitor.enabled : !!window.devkitMonitor;
  const guard = useWorkspaceGuard();
  const feedback = useWorkspaceFeedback();
  const statusSeconds = usePerformanceMode() ? 15 : 5;
  const [statuses, setStatuses] = useState<LanMonitorStatus[]>([]);
  const [hosts, setHosts] = useState<LanHost[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<LanHost | 'new' | null>(null);
  const [selectJump, setSelectJump] = useState<((id: string) => void) | null>(null);
  const [seed, setSeed] = useState<Partial<HostDraft>>();
  useEffect(() => {
    if (active && loaded && initialDraft) {
      setSeed(initialDraft); setError(''); setEditing('new'); consumeDraft?.();
    }
  }, [active, loaded, initialDraft, consumeDraft]);
  const [discovering, setDiscovering] = useState(false);
  const [importing, setImporting] = useState(false);
  const [diagnostic, setDiagnostic] = useState<{ host: LanHost; result: HostDiagnostic }>();
  const [rdpHost, setRdpHost] = useState<LanHost>();
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [focusedHost, setFocusedHost] = useState('');
  const linked = useWorkspaceResource('lan-hosts'), linkedRow = useRef<HTMLLIElement>(null);
  const linkedExists = hosts.some(host => host.id === linked);
  useEffect(() => {
    if (active && linked && linkedExists) { setQuery(''); setFocusedHost(linked); }
  }, [active, linked, linkedExists]);
  useEffect(() => { if (active && linked && focusedHost === linked) linkedRow.current?.scrollIntoView({ block: 'nearest' }); }, [active, linked, focusedHost, query]);
  const connections = useRef<HTMLElement>(null), terminalArea = useRef<HTMLElement>(null);
  function focusSession() {
    requestAnimationFrame(() => terminalArea.current?.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')?.focus());
  }
  function focusHost(id: string) {
    requestAnimationFrame(() => {
      const target = connections.current?.querySelector<HTMLElement>(`[data-host-id="${CSS.escape(id)}"] summary`)
        ?? connections.current?.querySelector<HTMLInputElement>('.lan-search input');
      target?.focus();
    });
  }
  const [tabs, setTabs] = useState<Tab[]>([]), [selected, setSelected] = useState<number>();
  const requestVersion = useRef(0), working = useRef(false);
  const confirm = useConfirmation();
  const finishCreation = useRelatedCreation('lan-hosts', active && loaded && allowed('edit') && !busy, from => {
    setError('');
    setSeed(from === 'jar' || from === 'nginx' ? { modules: { jar: from === 'jar', nginx: from === 'nginx' } } : undefined);
    setEditing('new');
  });
  function closeEditor() { setSelectJump(null); setEditing(null); setError(''); finishCreation(); }
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
  function viewInstances(module: ManagedModule, host: LanHost) {
    if (!guard(module)) return;
    const go = () => openWorkspaceLink(module, `host:${host.id}`);
    if (!portal || allowed('edit')) { go(); return; }
    const origin = location.hash;
    void task(async () => {
      const request = module === 'jar' ? jarRequest : nginxRequest;
      const state = await request<{ groups?: HostGroup[] }>('get', { scope: 'inventory-local' });
      if (location.hash !== origin) return;
      if (state.groups?.some(group => group.id === host.id)) go();
      else feedback(`此主机没有向当前访客提供${titles[module]}实例列表。`);
    });
  }
  const [expanded, setExpanded] = useState(false), [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const update = () => setFullscreen(!!document.fullscreenElement && document.fullscreenElement === terminalArea.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  useEffect(() => {
    if (expanded || fullscreen) terminalArea.current?.querySelector<HTMLElement>('[role=tabpanel]:not([hidden]) :is(.xterm-helper-textarea, .lan-vnc-screen canvas)')?.focus({ preventScroll: true });
  }, [expanded, fullscreen]);
  function returnToList(id?: string) {
    setExpanded(false);
    if (document.fullscreenElement === terminalArea.current && terminalArea.current) {
      void document.exitFullscreen().finally(() => { if (id) focusHost(id); });
    } else if (id) focusHost(id);
  }
  function closeTab(id: number) {
    const remaining = tabs.filter(tab => tab.id !== id);
    setTabs(remaining);
    if (selected === id) setSelected(remaining.at(-1)?.id);
    if (remaining.length) focusSession();
    else if (tabs[0]) returnToList(tabs[0].host.id);
  }
  function openTab(host: LanHost) {
    const id = nextTab++;
    setTabs(items => [...items, { id, host }]); setSelected(id); focusSession();
  }
  function canConnect(mode: HostDraft['mode']) {
    if (mode === 'share') return false;
    if (mode === 'vnc' || mode === 'rdp') return allowed('rdp');
    return allowed('terminal') && (!['sftp','ftp'].includes(mode) || allowed('files'));
  }
  async function openDesktop(host: LanHost) {
    if (portal) setRdpHost(host);
    else if (host.mode === 'vnc') openTab(host);
    else { await lanRequest('open-rdp', { id: host.id }); setNotice('已打开 RDP 客户端。'); }
  }
  async function connectProfile(host: LanHost) {
    if (host.mode === 'rdp' || host.mode === 'vnc') await openDesktop(host);
    else if (!['ssh','sftp'].includes(host.mode) || host.fingerprint || await verify(host)) openTab(host);
  }
  async function saveProfile(value: HostDraft, connect = false) {
    const original = editing && editing !== 'new' ? editing : undefined;
    const next = await lanRequest<LanHost[]>('save', { ...value, id: original?.id, revision: original?.revision });
    setHosts(next); closeEditor(); setNotice('连接已保存。');
    if (!connect) return;
    // Match the normalized endpoint even when editing an address assigns a new profile ID.
    const device = value.address.trim();
    const address = value.mode === 'serial' ? (/^com/i.test(device) ? device.toUpperCase() : device) : device.toLowerCase().replace(/^\[|\]$/g, '');
    const saved = next.find(host => host.mode === value.mode && host.address === address && host.port === value.port &&
      (host.mode !== 'ftp' || host.user === (value.user.trim() || 'anonymous')) &&
      (host.mode !== 'ssh' && host.mode !== 'sftp' || host.user === value.user.trim() && host.jumpHostId === value.jumpHostId));
    if (saved) await connectProfile(saved);
  }
  const grouped = groupLanHosts(hosts, query, host => protocolName[host.mode] + ' ' + endpoint(host));
  return <section className="lan-center">
    <header className="lan-heading workspace-banner"><div><h1>局域网主机</h1></div>{available && <div className="lan-heading-actions">
      {portal && <button className="secondary-button" disabled={busy} onClick={() => void task(() => load())}>刷新</button>}
      {allowed('discover') && <button className="secondary-button" disabled={busy} onClick={() => setDiscovering(true)}><Radar size={15} />发现主机</button>}
      {allowed('edit') && <><button className="secondary-button" disabled={busy} onClick={() => setImporting(true)}><Upload size={15} />导入主机</button>
      <button className="run-button" disabled={busy || !loaded} onClick={() => { setError(''); setSeed(undefined); setEditing('new'); }}><Plus size={16} />添加主机</button></>}
    </div>}</header>
    {!available ? <p className="lan-note">局域网主机暂不可用。</p> : <div className={`lan-layout${expanded && tabs.length ? ' lan-layout-expanded' : ''}${allowed('terminal') ? '' : ' lan-layout-list'}`}>
      <aside ref={connections} className="lan-connections" aria-label="保存的主机连接">
        <label className="lan-search"><Search size={16} /><TextInput embedded aria-label="搜索主机" placeholder="搜索名称、协议、地址或标签" value={query} onChange={event => setQuery(event.target.value)} /></label>
        {linked && loaded && !linkedExists && <p className="pc-notice" role="status">{missingResourceLink('主机')}</p>}
        {!hosts.length && <p className="lan-note">{loaded || error ? '暂无已保存的连接。' : '正在读取主机清单…'}</p>}
        {!!hosts.length && !grouped.length && <p className="lan-note">没有匹配的主机。</p>}
        <ul className="lan-host-list">{grouped.map(([key, entries]) => <Fragment key={key}>
          {key !== 'group:' || grouped.length > 1 ? <li className="lan-group-label">{key === 'pinned' ? '置顶' : entries[0].group || '未分组'}</li> : null}
          {entries.map(host => {
            const status = statuses.find(item => item.hostId === host.id);
            const Icon = protocolIcon[host.mode];
            const sshProfile = host.mode === 'ssh' || host.mode === 'sftp';
            const link = portal && host.mode === 'share' ? workbenchLink(host.address) : undefined;
            return <li key={host.id} data-host-id={host.id} ref={host.id === linked ? linkedRow : undefined}>
          <header><FloatingDetails open={focusedHost === host.id} onToggle={event => {
              if (event.currentTarget.open) setFocusedHost(host.id);
              else setFocusedHost(current => current === host.id ? '' : current);
            }}><summary className="lan-connection-select" aria-expanded={focusedHost === host.id}>
            <Icon size={17} /><span><strong>{host.name}</strong><small>{protocolName[host.mode]} · {endpoint(host)}</small></span>
          </summary>
          <p className="lan-note">{sshProfile ? (!portal || allowed('edit') ? `${host.platform === 'win32' ? 'Windows' : 'Linux'} · ${host.auth === 'password' ? '密码' : '密钥'} · ${host.fingerprint ? '已信任' : '待验证指纹'}` : `${protocolName[host.mode]}${host.fingerprint ? ' · 已信任' : ''}`) : protocolName[host.mode]}{(Object.keys(titles) as ManagedModule[]).filter(module => host.modules[module]).map(module => ` · ${titles[module]}`).join('')}</p>
          <div className="pc-actions" id={`lan-actions-${host.id}`} onClick={event => {
              if ((event.target as Element).closest('button, a')) setFocusedHost('');
            }}>
            {sshProfile && allowed('terminal') && (host.mode === 'ssh' || allowed('files')) && <button className="secondary-button" disabled={busy || !host.fingerprint && !(allowed('edit') && allowed('diagnose'))} title={!host.fingerprint ? '首次连接需核对 SSH 指纹' : undefined} onClick={() => void task(() => connectProfile(host))}><Icon size={14} />{host.mode === 'ssh' ? '打开终端' : '打开 SFTP'}</button>}
            {['telnet','serial','ftp'].includes(host.mode) && canConnect(host.mode) && <button className="secondary-button" disabled={busy} onClick={() => openTab(host)}><Icon size={14} />打开{protocolName[host.mode]}</button>}
            {host.mode === 'vnc' && !portal && <button className="secondary-button" onClick={() => openTab(host)}><Monitor size={14} />打开 VNC</button>}
            {host.mode === 'share' && (portal ? link && <a className="text-button" href={link} target="_blank" rel="noreferrer"><ExternalLink size={14} />打开工作台</a> : <button className="secondary-button" disabled={busy} onClick={() => void task(async () => { const result = await window.devkitDesktop?.openLanHost?.(host.address, host.modules.nginx && !host.modules.jar ? 'nginx' : 'jar'); if (!result || result.error) throw new Error(result?.error || '远程工作台不可用。'); })}><ExternalLink size={14} />打开工作台</button>)}
            {(['jar', 'nginx'] as const).filter(module => host.modules[module] || portal && !allowed('edit') && (host.mode === 'ssh' || host.mode === 'share')).map(module =>
              <button type="button" className="text-button" key={module} disabled={busy} onClick={() => viewInstances(module, host)}>{module === 'jar' ? '查看应用服务' : '查看 Nginx 实例'}</button>)}
            {host.mode !== 'serial' && allowed('diagnose') && <button className="text-button" disabled={busy} onClick={() => void task(() => diagnose(host))}>测试连接</button>}
            {host.jumpHostId && <RelatedLink page="lan-hosts" id={host.jumpHostId}>查看跳板机</RelatedLink>}
            {host.mode !== 'serial' && (portal || monitorAvailable) && <button className="text-button" disabled={busy} onClick={() => { if (status ? guard('monitor') : guard('monitor', 'edit', 'control')) void task(async () => onOpenMonitor(status?.id || await ensureLanMonitor(host))); }}>{status ? '监控历史' : '启用端口监控'}</button>}
            {(portal || host.hasLogs) && <button className="text-button" disabled={busy} onClick={() => {
              if (!guard('logs')) return;
              if (host.hasLogs) openWorkspaceLink('logs', `host:${host.id}`);
              else feedback('此主机没有向当前访客开放的日志来源。');
            }}>查看日志</button>}
            {(portal ? allowed('rdp') && host.canRdp : (host.mode === 'rdp' || !!host.rdpPort || host.platform === 'win32' && host.mode === 'ssh')) && <button className="text-button" disabled={busy} onClick={() => {
              void task(() => openDesktop(host));
            }}><Monitor size={14} />{host.mode === 'vnc' ? '连接 VNC' : portal ? '连接远程桌面' : '远程桌面'}</button>}
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
          </div></FloatingDetails>
            {allowed('edit') && <><button className="icon-button" disabled={busy} aria-label={`${host.pinned ? '取消置顶' : '置顶'} ${host.name}`} aria-pressed={!!host.pinned} onClick={() => void task(async () => {
              setHosts(await lanRequest<LanHost[]>('save', { ...host, pinned: !host.pinned }));
            })}><Pin size={14} /></button>
            <button className="icon-button" disabled={busy} aria-label={`编辑 ${host.name}`} onClick={() => { setError(''); setEditing(host); }}><Pencil size={15} /></button></>}
          </header>
          {!!host.tags?.length && <div className="lan-host-tags">{host.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
          {status && <p className="lan-monitor-status"><span className={`monitor-status ${status.state}`}>{lanMonitorLabels[status.state]}</span>{status.checkedAt && <small>最近检测 {new Date(status.checkedAt).toLocaleString()}{status.elapsed === undefined ? '' : ` · ${status.elapsed} ms`}</small>}</p>}

        </li>; })}</Fragment>)}</ul>
      </aside>
      {allowed('terminal') && <section ref={terminalArea} className="lan-terminal-area" aria-label="远程会话">
        {!!tabs.length && <div className="lan-session-controls">
          <button className="text-button" onClick={() => returnToList(tabs.find(item => item.id === selected)?.host.id)}>返回主机列表</button>
          {!fullscreen && <button className="text-button" aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize size={14} /> : <Maximize size={14} />}{expanded ? '还原布局' : '展开工作区'}</button>}
          {document.fullscreenEnabled && <button className="secondary-button" onClick={() => {
            void (fullscreen ? document.exitFullscreen() : terminalArea.current?.requestFullscreen())?.catch(() => { setExpanded(true); setNotice('已展开工作区。'); });
          }}>{fullscreen ? '退出全屏' : '会话全屏'}</button>}
        </div>}
        {!!tabs.length ? <div role="tablist" onKeyDown={navigateTabList} aria-label="远程会话标签" className="lan-terminal-tabs">
          {tabs.map(tab => <div key={tab.id} className={selected === tab.id ? 'selected' : ''}>
            <button type="button" role="tab" aria-selected={selected === tab.id} tabIndex={selected === tab.id ? 0 : -1}
              aria-controls={`lan-tab-${tab.id}`} onClick={() => setSelected(tab.id)}>
              <strong>{protocolName[tab.host.mode]}</strong><span title={tab.host.name}>{tab.host.name}</span><small>{endpoint(tab.host)}</small>
            </button>
            <button type="button" className="icon-button" aria-label={`关闭 ${tab.host.name} 的会话`} onClick={() => closeTab(tab.id)}><X size={14} /></button>
          </div>)}
        </div> : <div className="lan-terminal-empty"><Monitor size={32} /><h2>远程会话</h2><p>从主机列表选择连接，打开终端、文件或远程桌面。</p></div>}
        {tabs.map(tab => <div key={tab.id} id={`lan-tab-${tab.id}`} role="tabpanel" aria-label={tab.host.name} hidden={selected !== tab.id}>
          <Suspense fallback={<Skeleton kind="editor" label="正在加载会话…" />}>
            {tab.host.mode === 'vnc' && <VncSession id={tab.host.id} />}
            {['ftp','sftp'].includes(tab.host.mode) && allowed('files') && <SftpSession label={protocolName[tab.host.mode]} id={tab.host.id} portal={portal} />}
            {['ssh','telnet','serial'].includes(tab.host.mode) && <SshTerminal id={tab.host.id} active={active && selected === tab.id} allowFiles={tab.host.mode === 'ssh' && allowed('files')} portal={portal} />}
          </Suspense>
        </div>)}
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
    {editing && <HostEditor active={active} newJump={select => { setError(''); setSelectJump(() => select); }} portal={portal} host={editing === 'new' ? undefined : editing} seed={editing === 'new' ? seed : undefined} hosts={hosts} error={error} busy={busy} close={closeEditor} canConnect={mode => canConnect(mode) && (!portal || !['ssh','sftp'].includes(mode) || (allowed('edit') && allowed('diagnose')))} save={(value, connect) => void task(() => saveProfile(value, connect))} />}
    {importing && <LanHostImport close={() => setImporting(false)} onImport={updated => { setHosts(updated); setImporting(false); setNotice('所选主机连接已导入。'); }} />}
    {editing && selectJump && <HostEditor active={active} portal={portal} hosts={hosts} busy={busy} error={error}
      close={() => { setSelectJump(null); setError(''); }}
      save={value => void task(async () => {
        const next = await lanRequest<LanHost[]>('save', value);
        setHosts(next);
        const added = next.find(host => host.mode === 'ssh' && host.address === value.address.trim() && host.port === value.port && host.user === value.user.trim() && host.jumpHostId === value.jumpHostId);
        if (added) selectJump(added.id);
        setSelectJump(null);
      })} />}
    {discovering && <LanDiscovery close={() => setDiscovering(false)} onChoose={allowed('edit') ? draft => { setDiscovering(false); setSeed(draft); setError(''); setEditing('new'); } : undefined} />}
    {rdpHost && active && <Suspense fallback={<p className="lan-note" role="status">正在加载远程桌面…</p>}><RemoteDesktop host={rdpHost} close={() => setRdpHost(undefined)} /></Suspense>}
  </section>;
}
