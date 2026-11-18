import { useCallback, useEffect, useState } from 'react';
import { Copy, ExternalLink, File, Files, Folder, FolderOpen, FolderUp, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useConfirmation } from './Confirmation';
import { Modal, ModalCancel } from './project-components';
import { fileShareRequest, publishedShares } from './planning-share-api';
import type { FileShare, FileShareState, PublishedShare } from './planning-share-api';
import { copyText } from './motion-primitives';
import { SharingButton } from './Sharing';
import './planning-share.css';

export function PublishedFileShares({ active }: { active: boolean }) {
  const [shares, setShares] = useState<PublishedShare[] | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(() => {
    setError('');
    void publishedShares().then(result => setShares(result.shares), failure => setError(failure.message));
  }, []);
  useEffect(() => { if (active) refresh(); }, [active, refresh]);
  return <section className="planning-workspace">
    <header className="planning-heading"><div><h1>本机文件共享管理</h1><p>浏览共享主机已发布的文件和文件夹。</p></div>
      <button className="secondary-button" onClick={refresh}><RefreshCw size={15} />刷新</button>
    </header>
    {error && <p className="pc-error" role="alert">{error}</p>}
    {!error && !shares && <p role="status">正在读取文件共享…</p>}
    {shares?.length === 0 && <p className="planning-empty">主机尚未发布可访问的文件共享。</p>}
    <div className="file-share-list">{shares?.map(share => <article className="planning-card" key={share.id}>
      <div className="planning-card-title"><FolderUp size={21} /><h2>{share.name}</h2></div>
      <ul className="file-share-roots">{share.roots.map((root, index) => <li key={index}>
        {root.directory ? <Folder size={15} /> : <File size={15} />}<span>{root.label}</span>
      </li>)}</ul>
      <a className="secondary-button file-share-browse" href={share.href}><ExternalLink size={15} />浏览与下载</a>
    </article>)}</div>
  </section>;
}

type ShareDraft = Pick<FileShare, 'name' | 'lan' | 'published' | 'enabled'> & { port: string; paths: string[] };
type ShareEditor = { id?: string; revision: number; draft: ShareDraft };
export default function FileShares({ active }: { active: boolean }) {
  const [state, setState] = useState<FileShareState | null>(null), [editor, setEditor] = useState<ShareEditor | null>(null);
  const [error, setError] = useState(''), [editorError, setEditorError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [choosing, setChoosing] = useState(false);
  const confirm = useConfirmation();
  const refresh = useCallback(() => {
    setError('');
    void fileShareRequest<FileShareState>('get').then(setState, failure => setError(failure.message));
  }, []);
  useEffect(() => { if (active) refresh(); }, [active, refresh]);
  function edit(share?: FileShare) {
    if (!state) return;
    let port = 8780;
    while (state.shares.some(item => item.port === port)) port++;
    setEditorError('');
    setEditor({ id: share?.id, revision: state.revision, draft: share
      ? { name: share.name, port: String(share.port), paths: share.roots.map(root => root.path), enabled: share.enabled, lan: share.lan, published: share.published }
      : { name: '', port: String(port), paths: [], enabled: true, lan: false, published: false } });
  }
  const change = (values: Partial<ShareDraft>) => setEditor(current => current && ({ ...current, draft: { ...current.draft, ...values } }));
  async function choose(action: 'choose-files' | 'choose-directory') {
    setChoosing(true);
    setEditorError('');
    try {
      const paths = await fileShareRequest<string[]>(action);
      if (editor && paths.length) change({ paths: [...new Set([...editor.draft.paths, ...paths])].slice(0, 32) });
    } catch (failure) { setEditorError((failure as Error).message); }
    finally { setChoosing(false); }
  }
  async function mutate(action: string, value: unknown, message: string) {
    const inEditor = action === 'save';
    const report = inEditor ? setEditorError : setError;
    report(''); setNotice(''); setBusy(true);
    try {
      setState(await fileShareRequest<FileShareState>(action, value));
      if (inEditor) setEditor(null);
      setNotice(message);
    } catch (failure) {
      report((failure as Error).message);
      if (!inEditor) void fileShareRequest<FileShareState>('get').then(setState, () => {});
    } finally { setBusy(false); }
  }
  async function remove(share: FileShare) {
    if (!state || !await confirm({ title: '移除此文件共享？', detail: `“${share.name}”的网页链接将失效。选中的原文件和文件夹会保留。`, confirm: '移除共享', cancel: '取消' })) return;
    await mutate('remove', { id: share.id, revision: state.revision }, '共享已移除');
  }
  const draft = editor?.draft;
  return <section className="planning-workspace">
    <header className="planning-heading"><div><h1>本机文件共享管理</h1><p>为各个共享指定端口与文件范围，访客可以在浏览器中下载。</p></div>
      <div className="planning-actions">
        <SharingButton />
        <button className="secondary-button" disabled={busy} onClick={refresh}><RefreshCw size={15} />刷新</button>
        <button className="run-button" disabled={busy || !state} onClick={() => edit()}><Plus size={16} />新建共享</button>
      </div>
    </header>
    {error && <p className="pc-error" role="alert">{error}</p>}
    {notice && <p className="planning-notice" role="status">{notice}</p>}
    {!error && !state && <p role="status">正在读取文件共享…</p>}
    {state?.shares.length === 0 && <p className="planning-empty">尚未配置共享。新建共享后，可添加多个文件或文件夹。</p>}
    <div className="file-share-list">{state?.shares.map(share => <article className="planning-card" key={share.id}>
      <div className="planning-card-title"><FolderUp size={21} /><h2>{share.name}</h2>
        <span className="planning-badge" data-kind={share.running ? 'done' : share.enabled ? 'high' : 'idle'}>{share.running ? '运行中' : share.enabled ? '启动失败' : '已停止'}</span>
      </div>
      <p className="planning-meta">{share.lan ? '局域网直连' : '本机直连'} · 端口 {share.port}{share.published ? ' · 发布到共享工作台' : ''}</p>
      {share.error && <p className="pc-error">{share.error}</p>}
      <ul className="file-share-roots">{share.roots.map(root => <li key={root.path}>
        {root.directory ? <Folder size={15} /> : <File size={15} />}<span title={root.path}>{root.path}</span>
      </li>)}</ul>
      <div className="planning-actions">
        <button className="secondary-button" disabled={!share.running || busy} onClick={() => void fileShareRequest('open', { id: share.id }).catch(failure => setError(failure.message))}><ExternalLink size={15} />打开网页</button>
        <button className="secondary-button" disabled={!share.running || busy} onClick={() => void copyText(share.links[1] || share.links[0]).then(() => setNotice('共享链接已复制'), () => setError('无法复制共享链接。'))}><Copy size={14} />复制链接</button>
        <button className="secondary-button" disabled={busy} onClick={() => void mutate('toggle', { id: share.id, revision: state.revision, enabled: !share.running }, share.running ? '共享已停止' : '共享已启动')}>{share.running ? '停止' : '启动'}</button>
        <button className="icon-button" title="编辑共享" aria-label={`编辑共享 ${share.name}`} disabled={busy} onClick={() => edit(share)}><Pencil size={15} /></button>
        <button className="icon-button" title="移除共享" aria-label={`移除共享 ${share.name}`} disabled={busy} onClick={() => void remove(share)}><Trash2 size={15} /></button>
      </div>
    </article>)}</div>
    {editor && draft && <Modal title={editor.id ? '编辑文件共享' : '新建文件共享'} closeLabel="关闭文件共享编辑" close={() => setEditor(null)} draft={draft} busy={busy || choosing}>
      <form className="planning-form" onSubmit={event => {
        event.preventDefault();
        void mutate('save', { id: editor.id, revision: editor.revision, value: { ...draft, port: Number(draft.port) } }, '文件共享已保存');
      }}>
        <div className="planning-form-grid">
          <label>共享名称<input required value={draft.name} maxLength={120} onChange={event => change({ name: event.target.value })} /></label>
          <label>监听端口<input type="number" required min={1} max={65535} value={draft.port} onChange={event => change({ port: event.target.value })} /></label>
        </div>
        <fieldset className="file-share-paths"><legend>共享范围</legend>
          <div className="planning-actions">
            <button type="button" className="secondary-button" disabled={draft.paths.length >= 32} onClick={() => void choose('choose-files')}><Files size={15} />添加文件</button>
            <button type="button" className="secondary-button" disabled={draft.paths.length >= 32} onClick={() => void choose('choose-directory')}><FolderOpen size={15} />添加文件夹</button>
          </div>
          <ul className="file-share-roots">{draft.paths.map(item => <li key={item}><span>{item}</span><button type="button" className="icon-button" aria-label={`移除路径 ${item}`} onClick={() => change({ paths: draft.paths.filter(value => value !== item) })}><X size={15} /></button></li>)}</ul>
        </fieldset>
        <label className="planning-check"><input type="checkbox" checked={draft.enabled} onChange={event => change({ enabled: event.target.checked })} />启用共享并在下次启动时恢复</label>
        <label className="planning-check"><input type="checkbox" checked={draft.lan} onChange={event => change({ lan: event.target.checked })} />允许局域网通过独立端口访问</label>
        {draft.lan && <p className="planning-meta">持有完整 HTTP 链接的人可以直接下载。</p>}
        <label className="planning-check"><input type="checkbox" checked={draft.published} onChange={event => change({ published: event.target.checked })} />发布到共享工作台，供获准访客下载</label>
        {editorError && <p className="pc-error" role="alert">{editorError}</p>}
        <div className="planning-actions planning-form-footer"><ModalCancel /><button className="run-button" disabled={!draft.paths.length}>保存共享</button></div>
      </form>
    </Modal>}
  </section>;
}
