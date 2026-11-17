import { useState } from 'react';
import { ExternalLink, Globe, Pencil, Trash2 } from 'lucide-react';
import { Modal } from './project-components';
import SshWorkspace from './SshWorkspace';
import { sshRequest } from './ssh-api';
import type { ManagedModule, SshHost } from './ssh-api';
import './lan-hosts.css';

type ShareHost = { mode: 'share'; name: string; address: string };
type Host = ShareHost | SshHost;
type Draft = { mode: Host['mode']; name: string; address: string; user: string; port: number; platform: SshHost['platform'] };
const storageKey = 'devkit:lan-hosts';
const emptyHost: Draft = { mode: 'share', name: '', address: '', user: '', port: 22, platform: 'linux' };
const moduleName = { jar: 'JAR 管理', nginx: 'Nginx 配置' };
const key = (host: Host) => host.mode === 'ssh' ? JSON.stringify([host.mode, host.address, host.port, host.user, host.platform]) : host.address;

function normalizeHost(host: Draft): Host {
  if (host.mode === 'ssh') {
    const address = host.address.trim().replace(/^\[([^\]]+)\]$/, '$1');
    const user = host.user.trim();
    if (!/^[a-z0-9][a-z0-9.-]*$/i.test(address) && !/^[a-f0-9:]+(?:(?:%)[a-z0-9_.-]+)?$/i.test(address)) throw new Error('请输入 SSH 主机名或 IP 地址。');
    if (!/^[a-z0-9_.@\\-]{1,120}$/i.test(user) || !Number.isInteger(host.port) || host.port < 1 || host.port > 65535) throw new Error('请输入有效的 SSH 用户名和 1–65535 之间的端口。');
    return { mode: 'ssh', name: host.name.trim() || address, address, user, port: host.port, platform: host.platform };
  }
  let url: URL;
  try { url = new URL(host.address.trim()); }
  catch { throw new Error('请填写完整共享地址，例如 http://192.168.1.20:8765。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || (url.hash && !Object.hasOwn(moduleName, url.hash.slice(1)))) {
    throw new Error('请填写 HTTP(S) 共享主机地址。口令在登录页面输入。');
  }
  return { mode: 'share', name: host.name.trim() || url.host, address: url.origin };
}

function loadHosts(): Host[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(data)) return data.flatMap(host => {
      try { return [normalizeHost({ ...emptyHost, ...host })]; } catch { return []; }
    });
  } catch { /* The dialog can still accept an address for this session. */ }
  return [];
}

function HostDialog({ module, close }: { module: ManagedModule; close: () => void }) {
  const [hosts, setHosts] = useState(loadHosts);
  const [draft, setDraft] = useState(emptyHost);
  const [editing, setEditing] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [ssh, setSsh] = useState<SshHost | null>(null);
  const original = { ...emptyHost, ...hosts.find(host => key(host) === editing) };

  function remember(next: Host[]) {
    localStorage.setItem(storageKey, JSON.stringify(next));
    setHosts(next);
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setFeedback('');
    try {
      const host = normalizeHost(draft);
      if (hosts.some(item => key(item) === key(host) && key(item) !== editing)) throw new Error('此连接已在主机列表中。');
      remember(editing ? hosts.map(item => key(item) === editing ? host : item) : [...hosts, host]);
      setDraft(emptyHost);
      setEditing('');
      setFeedback('主机已保存。');
    } catch (failure) { setError((failure as Error).message); }
  }

  async function connect(source: Draft) {
    if (busy) return;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const host = normalizeHost(source);
      if (host.mode === 'ssh') {
        await sshRequest({ host, module, action: 'check' });
        setSsh(host);
        return;
      }
      const result = await window.devkitDesktop?.openLanHost?.(host.address, module);
      if (!result || result.error) throw new Error(result?.error || '桌面连接功能暂不可用。');
      setFeedback(`已打开 ${host.name} 的${moduleName[module]}。`);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  const sshMode = draft.mode === 'ssh';
  if (ssh) return <SshWorkspace host={ssh} module={module} back={() => setSsh(null)} close={close} />;
  return <Modal title={`局域网主机 · ${moduleName[module]}`} closeLabel="关闭局域网主机" close={close} busy={busy} feedback={feedback} draft={JSON.stringify(draft) === JSON.stringify(original) ? undefined : draft}>
    <div className="lan-hosts">
      {!!hosts.length && <ul className="lan-host-list">{hosts.map(host => <li key={key(host)}>
        <div><strong>{host.name}</strong><small>{host.mode === 'ssh' ? `SSH · ${host.user}@${host.address}:${host.port}` : host.address}</small></div>
        <button type="button" className="secondary-button" onClick={() => void connect({ ...emptyHost, ...host })}><ExternalLink size={14} />{moduleName[module]}</button>
        <button type="button" className="icon-button" aria-label={`编辑 ${host.name}`} onClick={() => { setEditing(key(host)); setDraft({ ...emptyHost, ...host }); setError(''); }}><Pencil size={15} /></button>
        <button type="button" className="icon-button" aria-label={`移除 ${host.name}`} onClick={() => {
          try {
            remember(hosts.filter(item => key(item) !== key(host)));
            if (editing === key(host)) { setDraft(emptyHost); setEditing(''); }
            setError('');
            setFeedback('已移除保存的主机地址。');
          } catch (failure) { setError((failure as Error).message); }
        }}><Trash2 size={15} /></button>
      </li>)}</ul>}
      <form onSubmit={save}>
        <label>连接方式<select value={draft.mode} onChange={event => setDraft({ ...emptyHost, name: draft.name, mode: event.target.value === 'ssh' ? 'ssh' : 'share' })}>
          <option value="share">DevKit 共享</option><option value="ssh">SSH</option>
        </select></label>
        <p>{sshMode
          ? '目标机开启 SSH。先在本机终端验证主机指纹和密钥登录，DevKit 会复用系统 OpenSSH 配置。'
          : `在目标电脑的 DevKit 或独立服务上开启局域网共享，开放 ${moduleName[module]} 及所需权限。`}</p>
        <label>主机名称（可选）<input maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="例如：测试服务器" /></label>
        <label>{sshMode ? 'SSH 主机名或 IP' : '共享地址'}<input required maxLength={sshMode ? 253 : 2048} value={draft.address} onChange={event => setDraft({ ...draft, address: event.target.value })} placeholder={sshMode ? '192.168.1.20' : 'http://192.168.1.20:8765'} /></label>
        {sshMode && <div className="lan-ssh-fields">
          <label>SSH 用户名<input required maxLength={120} value={draft.user} onChange={event => setDraft({ ...draft, user: event.target.value })} /></label>
          <label>SSH 端口<input required type="number" min={1} max={65535} value={draft.port || ''} onChange={event => setDraft({ ...draft, port: Number(event.target.value) })} /></label>
          <label>目标系统<select value={draft.platform} onChange={event => setDraft({ ...draft, platform: event.target.value === 'win32' ? 'win32' : 'linux' })}><option value="linux">Linux</option><option value="win32">Windows</option></select></label>
        </div>}
        {error && <p className="pc-error" role="alert">{error}</p>}
        <div className="pc-actions">
          {editing && <button type="button" className="text-button" onClick={() => { setDraft(emptyHost); setEditing(''); setError(''); }}>取消编辑</button>}
          <button type="button" className="secondary-button" disabled={!draft.address.trim()} onClick={() => void connect(draft)}>直接打开</button>
          <button type="submit" className="run-button">{editing ? '保存主机' : '添加主机'}</button>
        </div>
      </form>
    </div>
  </Modal>;
}

export default function LanHosts({ module }: { module: ManagedModule }) {
  const [open, setOpen] = useState(false);
  if (!window.devkitDesktop?.openLanHost) return null;
  return <>
    <button className="secondary-button" onClick={() => setOpen(true)}><Globe size={15} />局域网主机</button>
    {open && <HostDialog module={module} close={() => setOpen(false)} />}
  </>;
}
