import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Download, File, Folder, RefreshCw, Upload } from 'lucide-react';
import { downloadSftp, lanRequest, uploadSftp } from './lan-api';

type Listing = { directory: string; parent: string; truncated: boolean; entries: { name: string; path: string; kind: string; size?: number }[] };

export default function SftpPanel({ session, portal }: { session: string; portal: boolean }) {
  const [listing, setListing] = useState<Listing>(), [directory, setDirectory] = useState('.');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const picker = useRef<HTMLInputElement>(null), transferController = useRef<AbortController | null>(null);
  async function list(path: string) {
    const result = await lanRequest<Listing>('file-list', { id: session, path });
    setListing(result); setDirectory(result.directory);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => { void run(() => list('.')); return () => transferController.current?.abort(); }, [session]);

  async function transfer(action: 'file-upload' | 'file-download', path: string) {
    const result = await lanRequest<{ name: string } | null>(action, { id: session, path });
    if (!result) return;
    setNotice(`${action === 'file-upload' ? '已上传' : '已下载'} ${result.name}`);
    if (action === 'file-upload') await list(path);
  }
  async function browserTransfer(path: string, fileOrName: File | string) {
    const controller = new AbortController();
    transferController.current = controller;
    try {
      if (typeof fileOrName === 'string') setNotice(await downloadSftp(session, path, fileOrName, controller.signal));
      else {
        const result = await uploadSftp(session, path, fileOrName, controller.signal);
        setNotice(`已上传 ${result.name}`);
        await list(path);
      }
    } finally { transferController.current = null; }
  }

  return <aside className="lan-sftp" aria-label="SFTP 文件">
    <header><h3>SFTP 文件</h3>{portal && <input hidden type="file" ref={picker} onChange={event => {
      const input = event.currentTarget, file = input.files?.[0]; input.value = '';
      if (file && listing) void run(() => browserTransfer(listing.directory, file));
    }} />}<button className="secondary-button" disabled={busy || !listing} onClick={() => {
      if (portal) picker.current?.click();
      else void run(() => transfer('file-upload', listing!.directory));
    }}><Upload size={14} />上传</button></header>
    <form className="lan-sftp-path" onSubmit={event => { event.preventDefault(); void run(() => list(directory)); }}>
      <button type="button" className="icon-button" aria-label="上级目录" disabled={busy || !listing || listing.directory === listing.parent} onClick={() => void run(() => list(listing!.parent))}><ArrowUp size={15} /></button>
      <input aria-label="SFTP 远程目录" value={directory} disabled={busy} spellCheck={false} onChange={event => setDirectory(event.target.value)} />
      <button className="icon-button" aria-label="打开或刷新目录" disabled={busy || !directory.trim()}><RefreshCw size={14} /></button>
    </form>
    <ul>{listing?.entries.map(({ name, path, kind, size }) => <li key={path}>
      {kind === 'directory' ? <button className="text-button" title={name} disabled={busy} onClick={() => void run(() => list(path))}><Folder size={14} /><span>{name}</span></button> :
        <><span className="lan-sftp-entry" title={name}><File size={14} /><span>{name}</span></span>{kind === 'file' && <button className="icon-button" title={size === undefined ? '下载' : `${size.toLocaleString()} 字节`} aria-label={`下载 ${name}`} disabled={busy} onClick={() => void run(() => portal ? browserTransfer(path, name) : transfer('file-download', path))}><Download size={14} /></button>}</>}
    </li>)}</ul>
    {listing?.truncated && <p className="lan-note">显示目录中的前 1000 项。</p>}
    {listing && !listing.entries.length && !busy && <p className="lan-note">此目录为空。</p>}
    {busy && <p className="lan-note" role="status">正在处理文件操作…</p>}
    {notice && <p className="lan-note" role="status">{notice}</p>}
    {error && <p className="lan-sftp-error" role="alert">{error}</p>}
  </aside>;
}
