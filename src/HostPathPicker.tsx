import { useEffect, useId, useState } from 'react';
import { ArrowUp, File, FolderOpen } from 'lucide-react';
import { Modal } from './project-components';
import type { HostGroup, RemoteDirectory } from './lan-api';
import './lan-hosts.css';

export type RemotePickKind = 'file' | 'jar' | 'directory';
export function HostSelect({ groups, id, change, locked }: { groups?: HostGroup[]; id: string; change: (id: string) => void; locked: boolean }) {
  const hint = useId();
  return <><label>目标主机<select value={id} aria-describedby={hint} onChange={event => change(event.target.value)} disabled={locked}>
    {(groups?.length ? groups : [{ id: '', name: '本机', edit: true }]).map(group => <option key={group.id} value={group.id} disabled={!group.edit}>{group.name}{'error' in group && group.error ? '（连接不可用）' : !group.edit ? '（只读）' : ''}</option>)}
  </select></label><span id={hint} className="sr-only">文件路径和运行操作均指向所选主机。可在桌面的共享栏目维护局域网主机连接。</span></>;
}

export default function HostPathPicker({ name, kind, request, close, select }: { name: string; kind: RemotePickKind; request: (directory: string) => Promise<RemoteDirectory>; close: () => void; select: (path: string) => void }) {
  const [directory, setDirectory] = useState(''), [listing, setListing] = useState<RemoteDirectory>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function load(value: string) {
    setBusy(true); setError('');
    try { const next = await request(value.trim()); setListing(next); setDirectory(next.directory); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(''); }, []);
  return <Modal title={`浏览 ${name} 的文件`} closeLabel="关闭远程文件选择" close={close} wide>
    <div className="host-directory" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <div className="host-directory-path"><button type="button" className="icon-button" aria-label="返回上级目录" disabled={busy || !listing?.parent} onClick={() => void load(listing!.parent)}><ArrowUp size={16} /></button><input aria-label="远程绝对目录" placeholder="输入绝对目录" value={directory} onChange={event => setDirectory(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!busy) void load(directory); } }} /><button type="button" className="secondary-button" disabled={busy} onClick={() => void load(directory)}>打开</button></div>
      {busy && <p role="status">正在读取目录…</p>}
      {error && <p className="pc-error" role="alert">{error}</p>}
      {listing && <><p className="lan-note">{listing.directory}{listing.truncated ? ' · 结果已截断，可直接输入下级目录。' : ''}</p><ul className="host-directory-list">{listing.entries.map(entry => <li key={entry.path}><button type="button" className="text-button" disabled={busy} onClick={() => entry.directory ? void load(entry.path) : select(entry.path)}>{entry.directory ? <FolderOpen size={16} /> : <File size={16} />}{entry.name}</button></li>)}</ul>{!listing.entries.length && <p className="lan-note">没有匹配的文件或目录。</p>}</>}
      {kind === 'directory' && listing && <button type="button" className="run-button" disabled={busy} onClick={() => select(listing.directory)}>选择当前目录</button>}
    </div>
  </Modal>;
}
