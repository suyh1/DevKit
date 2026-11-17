import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Coffee, ExternalLink, Eye, EyeOff, Globe, Pencil, Plus, Search, Server, ShieldCheck, Terminal, Trash2, X } from 'lucide-react';
import { Modal, ModalCancel } from './project-components';
import { useConfirmation } from './Confirmation';
import { lanRequest, migrateLanHosts } from './lan-api';
import type { HostDraft, LanHost, ManagedModule } from './lan-api';
import './lan-hosts.css';

const SshTerminal = lazy(() => import('./SshTerminal'));
const empty: HostDraft = { mode: 'ssh', name: '', address: '', user: '', port: 22, platform: 'linux', auth: 'password', modules: { jar: false, nginx: false } };
const titles = { jar: 'JAR 管理', nginx: 'Nginx 配置' };
const endpoint = (host: LanHost) => host.mode === 'share' ? host.address : `${host.user}@${host.address.includes(':') ? `[${host.address}]` : host.address}:${host.port}`;
type Tab = { id: number; host: LanHost };
let nextTab = 1;

function HostEditor({ host, close, save, busy, error }: { host?: LanHost; close: () => void; save: (value: HostDraft) => void; busy: boolean; error: string }) {
  const [draft, setDraft] = useState<HostDraft>({ ...empty, ...host, password: '' });
  const [revealed, setRevealed] = useState(false);
  const modeName = useId(), formError = useRef<HTMLParagraphElement>(null);
  const patch = (values: Partial<HostDraft>) => setDraft(current => ({ ...current, ...values }));
  const ssh = draft.mode === 'ssh';
  const hasCredential = !!host?.hasPassword && host.mode === draft.mode && host.address === draft.address.trim() &&
    (!ssh || (host.user === draft.user.trim() && host.port === draft.port && host.auth === draft.auth));
  const managesApps = draft.modules.jar || draft.modules.nginx;
  const protocols = [
    { value: 'ssh', title: 'SSH', detail: '登录远程终端', Icon: Terminal },
    { value: 'share', title: 'DevKit 共享', detail: '接入远程工作台', Icon: Globe },
  ] as const;

  useEffect(() => { if (error) formError.current?.focus(); }, [error]);

  return <Modal title={host ? '编辑主机连接' : '添加主机连接'} closeLabel="关闭主机设置" close={close} busy={busy} draft={draft}
    className="lan-host-dialog" icon={ssh ? <Terminal size={19} /> : <Globe size={19} />}>
    <form className="lan-host-form" onSubmit={event => { event.preventDefault(); save(draft); }}>
      <div className="lan-host-body">
        <fieldset className="lan-host-section">
          <legend>连接方式</legend>
          <div className="lan-host-choices">
            {protocols.map(({ value, title, detail, Icon }) => <label className="lan-choice lan-protocol" key={value}>
              <input type="radio" name={modeName} value={value} checked={draft.mode === value} onChange={() => {
                setRevealed(false);
                patch({ mode: value, address: '', password: '', clearPassword: false });
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
            {ssh && <>
              <label className="lan-field"><span>用户名</span><input required autoComplete="off" value={draft.user} maxLength={120} onChange={event => patch({ user: event.target.value })} /></label>
              <label className="lan-field"><span>认证方式</span><span className="lan-select">
                <select value={draft.auth} onChange={event => { setRevealed(false); patch({ auth: event.target.value as HostDraft['auth'], password: '', clearPassword: false }); }}>
                  <option value="password">用户名与密码</option><option value="key">SSH Agent 或默认密钥</option>
                </select><ChevronDown size={15} aria-hidden="true" />
              </span></label>
            </>}
            {(!ssh || draft.auth === 'password') && <div className="lan-password-row">
              <label className="lan-field"><span>{ssh ? 'SSH 密码' : '目标共享口令'}</span><span className="lan-password">
                <input type={revealed ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} value={draft.password} maxLength={ssh ? 4096 : 128}
                  onChange={event => patch({ password: event.target.value, clearPassword: false })} placeholder={hasCredential && !draft.clearPassword ? '已保存，留空沿用' : undefined} />
              </span></label>
              <button type="button" className="icon-button lan-password-toggle" aria-label={revealed ? '隐藏密码' : '显示密码'} onClick={() => setRevealed(value => !value)}>
                {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>}
            {hasCredential && <label className="lan-clear-credential"><input type="checkbox" checked={!!draft.clearPassword} onChange={event => { setRevealed(false); patch({ clearPassword: event.target.checked, password: '' }); }} />清除已保存的凭据</label>}
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
          {managesApps && <p className="lan-host-hint">{ssh ? 'JAR 和 Nginx 管理需要目标机启用 SFTP，并安装 Node.js 24+。' : '请在目标 DevKit 开放对应栏目，并授予所需权限。'}</p>}
        </fieldset>
        {error && <p className="lan-host-error" ref={formError} tabIndex={-1} role="alert">{error}</p>}
      </div>
      <footer className="lan-host-footer">
        {ssh && <span className="lan-host-security"><ShieldCheck size={15} />首次连接需核对 SSH 指纹</span>}
        <div className="lan-host-actions"><ModalCancel /><button type="submit" className="run-button">{busy ? '保存中…' : '保存连接'}</button></div>
      </footer>
    </form>
  </Modal>;
}

export default function LanHosts({ active }: { active: boolean }) {
  const available = !!window.devkitDesktop?.lanHosts;
  const [hosts, setHosts] = useState<LanHost[]>([]);
  const [editing, setEditing] = useState<LanHost | 'new' | null>(null);
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [tabs, setTabs] = useState<Tab[]>([]), [selected, setSelected] = useState<number>();
  const confirm = useConfirmation();
  async function load() { setHosts(await lanRequest<LanHost[]>('list')); }
  useEffect(() => { if (available && active) void migrateLanHosts().then(load).catch(error => setError(error.message)); }, [active, available]);
  async function task(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await run(); } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
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
  function closeTab(id: number) {
    const remaining = tabs.filter(tab => tab.id !== id);
    setTabs(remaining);
    if (selected === id) setSelected(remaining.at(-1)?.id);
  }
  const filtered = hosts.filter(host => `${host.name} ${endpoint(host)}`.toLowerCase().includes(query.toLowerCase().trim()));
  return <section className="lan-center">
    <header className="lan-heading"><div><h1>局域网主机</h1><p>管理远程连接、验证主机指纹，并在 SSH 终端中维护服务器。</p></div>{available && <button className="run-button" onClick={() => { setError(''); setEditing('new'); }}><Plus size={16} />添加主机</button>}</header>
    {!available ? <p className="lan-note">请在 DevKit 桌面端配置主机连接并使用 SSH 终端。</p> : <div className="lan-layout">
      <aside className="lan-connections" aria-label="保存的主机连接">
        <label className="lan-search"><Search size={16} /><input aria-label="搜索主机" placeholder="搜索名称或地址" value={query} onChange={event => setQuery(event.target.value)} /></label>
        {!hosts.length && <p className="lan-note">暂无已保存的连接。</p>}
        {!!hosts.length && !filtered.length && <p className="lan-note">没有匹配的主机。</p>}
        <ul className="lan-host-list">{filtered.map(host => <li key={host.id}>
          <header>{host.mode === 'ssh' ? <Terminal size={17} /> : <Globe size={17} />}<div><strong>{host.name}</strong><small>{endpoint(host)}</small></div>
            <button className="icon-button" disabled={busy} aria-label={`编辑 ${host.name}`} onClick={() => { setError(''); setEditing(host); }}><Pencil size={15} /></button>
          </header>
          <p className="lan-note">{host.mode === 'ssh' ? `${host.platform === 'win32' ? 'Windows' : 'Linux'} · ${host.auth === 'password' ? '密码' : '密钥'} · ${host.fingerprint ? '已信任' : '待验证指纹'}` : 'DevKit 共享'}{(Object.keys(titles) as ManagedModule[]).filter(module => host.modules[module]).map(module => ` · ${titles[module]}`).join('')}</p>
          <div className="pc-actions">
            {host.mode === 'ssh' ? <button className="secondary-button" disabled={busy} onClick={() => void task(async () => { if (host.fingerprint || await verify(host)) { const id = nextTab++; setTabs(items => [...items, { id, host }]); setSelected(id); } })}><Terminal size={14} />打开终端</button> : <button className="secondary-button" disabled={busy} onClick={() => void task(async () => { const result = await window.devkitDesktop?.openLanHost?.(host.address, host.modules.nginx && !host.modules.jar ? 'nginx' : 'jar'); if (!result || result.error) throw new Error(result?.error || '远程工作台不可用。'); })}><ExternalLink size={14} />打开工作台</button>}
            <button className="text-button" disabled={busy} onClick={() => void task(async () => { await verify(host); })}>测试连接</button>
            {host.fingerprint && <button title={host.fingerprint} className="text-button" disabled={busy} onClick={() => void task(async () => {
              if (await confirm({ title: `重置 ${host.name} 的 SSH 指纹？`, detail: '下次连接时需要重新核对指纹。', confirm: '重置指纹' })) setHosts(await lanRequest<LanHost[]>('reset-trust', { id: host.id }));
            })}>重置指纹</button>}
            <button className="icon-button" disabled={busy} aria-label={`移除 ${host.name}`} onClick={() => void task(async () => {
              if (await confirm({ title: `移除 ${host.name}？`, detail: '此主机及其应用将从当前工作台列表移除，目标机上的应用和配置会保留。', confirm: '移除连接' })) {
                setHosts(await lanRequest<LanHost[]>('remove', host.id));
                setTabs(items => items.filter(tab => tab.host.id !== host.id));
                setSelected(current => tabs.find(tab => tab.id === current)?.host.id === host.id ? tabs.filter(tab => tab.host.id !== host.id).at(-1)?.id : current);
              }
            })}><Trash2 size={15} /></button>
          </div>
        </li>)}</ul>
      </aside>
      <section className="lan-terminal-area" aria-label="SSH 终端">
        {!!tabs.length ? <div role="tablist" aria-label="SSH 会话" className="lan-terminal-tabs">{tabs.map(tab => <div key={tab.id} className={selected === tab.id ? 'selected' : ''}><button type="button" role="tab" aria-selected={selected === tab.id} aria-controls={`lan-tab-${tab.id}`} onClick={() => setSelected(tab.id)}><Terminal size={14} />{tab.host.name}</button><button type="button" className="icon-button" aria-label={`关闭 ${tab.host.name} 的终端`} onClick={() => closeTab(tab.id)}><X size={14} /></button></div>)}</div> : <div className="lan-terminal-empty"><Terminal size={32} /><h2>SSH 终端</h2><p>从左侧选择一台 SSH 主机打开会话。</p></div>}
        <Suspense fallback={<p className="lan-note">正在加载终端…</p>}>{tabs.map(tab => <div key={tab.id} id={`lan-tab-${tab.id}`} role="tabpanel" aria-label={tab.host.name} hidden={selected !== tab.id}><SshTerminal id={tab.host.id} active={active && selected === tab.id} /></div>)}</Suspense>
      </section>
    </div>}
    {notice && <p className="pc-feedback" role="status">{notice}</p>}
    {error && !editing && <p className="pc-error" role="alert">{error}</p>}
    {editing && <HostEditor host={editing === 'new' ? undefined : editing} error={error} busy={busy} close={() => { setEditing(null); setError(''); }} save={value => void task(async () => { setHosts(await lanRequest<LanHost[]>('save', { ...value, id: editing === 'new' ? undefined : editing.id })); setEditing(null); setNotice('连接已保存。'); })} />}
  </section>;
}
