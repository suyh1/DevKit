import { MotionDetails } from './Motion';
import Skeleton from './Skeleton';
import SegmentedControl from './SegmentedControl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Copy, File, Files, Folder, FolderOpen, Globe2, Pencil, Plus, RefreshCw, Search, Server, Trash2, X } from 'lucide-react';
import { useConfirmation } from './Confirmation';
import { Modal, ModalCancel, ModalForm } from './project-components';
import { CreateRelated } from './related-workspaces';
import { fileShareRequest, publishedShares } from './planning-share-api';
import type { FileShare, FileShareState, PublishedShare } from './planning-share-api';
import { copyText } from './motion-primitives';
import { SharingButton } from './Sharing';
import { missingResourceLink, useWorkspaceResource } from './workspace-links';
import './planning-share.css';

const shareStatus = (share: FileShare) => share.running ? '运行中' : share.enabled ? '启动失败' : '已停止';
const shareTone = (share: FileShare) => share.running ? 'done' : share.enabled ? 'late' : 'backlog';
const scopeLabel = (roots: PublishedShare['roots']) => {
  const folders = roots.filter(root => root.directory).length;
  return [folders && `${folders} 个文件夹`, roots.length - folders && `${roots.length - folders} 个文件`].filter(Boolean).join(' · ');
};

function ShareSearch({ query, change }: { query: string; change: (value: string) => void }) {
  return <label className="pl-search"><Search size={16} /><input type="search" aria-label="搜索共享" placeholder="搜索共享"
    value={query} onChange={event => change(event.target.value)} /></label>;
}
function ShareRoots({ roots }: { roots: { label: string; directory: boolean; path?: string }[] }) {
  return <ul className="pl-share-roots pl-lines">{roots.map((root, index) => <li key={root.path || index}>
    {root.directory ? <Folder size={16} /> : <File size={16} />}
    <div><strong>{root.label}</strong>{root.path && <code title={root.path}>{root.path}</code>}</div>
    <small>{root.directory ? '文件夹' : '文件'}</small>
  </li>)}</ul>;
}

export function PublishedFileShares({ active }: { active: boolean }) {
  const [shares, setShares] = useState<PublishedShare[] | null>(null), [selected, setSelected] = useState(''), [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const resource = useWorkspaceResource('file-shares');
  const refresh = useCallback(() => {
    setError('');
    void publishedShares().then(result => setShares(result.shares), failure => setError(failure.message));
  }, []);
  useEffect(() => { if (active) refresh(); }, [active, refresh]);
  useEffect(() => { if (active && resource) { setQuery(''); setSelected(resource); } }, [active, resource]);
  const needle = query.trim().toLowerCase();
  const visible = shares?.filter(share => [share.name, ...share.roots.map(root => root.label)].some(value => value.toLowerCase().includes(needle))) ?? [];
  const share = visible.find(item => item.id === selected) ?? (resource && selected === resource ? undefined : visible[0]);
  return <section className="planning-workspace pl-files-workspace">
    <header className="pl-page-head workspace-banner"><h1>本机文件共享管理</h1>
      <button className="pl-icon" type="button" aria-label="刷新共享" title="刷新共享" onClick={refresh}><RefreshCw size={16} /></button>
    </header>
    {error && <p className="pl-message pc-error" role="alert">{error}</p>}
    {resource && selected === resource && shares && !shares.some(item => item.id === resource) && <p className="pl-message" role="status">{missingResourceLink('文件共享')}</p>}
    {!error && !shares && <Skeleton kind="list" label="正在读取文件共享…" />}
    {shares && <>
      <div className="pl-share-summary"><FolderOpen size={16} aria-hidden="true" /><div><strong>{shares.length}</strong><span>项可访问共享</span></div>
        <span className="pl-state pl-summary-access" data-tone="doing"><i />只读下载</span></div>
      <div className="pl-share-shell">
        <section className="pl-surface pl-share-inventory">
          <header><h2>共享目录</h2><ShareSearch query={query} change={setQuery} /></header>
          {visible.length > 0 ? <ul className="pl-lines file-share-list">{visible.map(item => <li key={item.id}><button className="pl-share-row" type="button"
            aria-pressed={item.id === share?.id} onClick={() => setSelected(item.id)}>
            <Folder size={16} /><strong>{item.name}</strong><span>{scopeLabel(item.roots)}</span>
          </button><a className="pl-button pl-download" href={item.href} aria-label={`浏览与下载 ${item.name}`}><ArrowUpRight size={15} />下载</a></li>)}</ul> : <p className="pl-panel-empty">{shares.length ? '找不到匹配的共享。' : '主机暂无已发布的文件共享。'}</p>}
        </section>
        {share && <section className="pl-surface pl-share-detail">
          <header><div><small>共享详情</small><h2>{share.name}</h2></div></header>
          <div className="pl-share-detail-body">
            <div className="pl-share-detail-title"><h3>共享范围</h3><small>{scopeLabel(share.roots)}</small></div>
            <CreateRelated from="file-shares" page="project-todos" resource={share.id}>新建引用此共享的待办清单</CreateRelated>
            <ShareRoots roots={share.roots} />
          </div>
        </section>}
      </div>
    </>}
  </section>;
}

type ShareDraft = Pick<FileShare, 'name' | 'lan' | 'published' | 'enabled'> & { port: string; paths: string[] };
type ShareEditor = { id?: string; revision: number; draft: ShareDraft };
export default function FileShares({ active }: { active: boolean }) {
  const [state, setState] = useState<FileShareState | null>(null), [editor, setEditor] = useState<ShareEditor | null>(null);
  const [error, setError] = useState(''), [editorError, setEditorError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState(''), [query, setQuery] = useState(''), [filter, setFilter] = useState('');
  const requestId = useRef(0);
  const confirm = useConfirmation();
  const resource = useWorkspaceResource('file-shares');
  const refresh = useCallback(() => {
    const sequence = ++requestId.current;
    setError('');
    void fileShareRequest<FileShareState>('get').then(value => {
      if (sequence === requestId.current) setState(value);
    }, failure => { if (sequence === requestId.current) setError(failure.message); });
  }, []);
  useEffect(() => { if (active) refresh(); }, [active, refresh]);
  useEffect(() => { if (active && resource) { setQuery(''); setFilter(''); setSelected(resource); } }, [active, resource]);
  const shares = state?.shares ?? [];
  const needle = query.trim().toLowerCase();
  const visible = shares.filter(share => (!filter || shareTone(share) === filter) &&
    [share.name, String(share.port), ...share.roots.map(root => root.path)].some(value => value.toLowerCase().includes(needle)));
  const share = visible.find(item => item.id === selected) ?? visible[0];
  const running = shares.filter(item => item.running).length;
  const published = shares.filter(item => item.running && item.published).length;

  function edit(item?: FileShare) {
    if (!state) return;
    let port = 8780;
    while (shares.some(existing => existing.port === port)) port++;
    setEditorError('');
    setEditor({ id: item?.id, revision: state.revision, draft: item
      ? { name: item.name, port: String(item.port), paths: item.roots.map(root => root.path), enabled: item.enabled, lan: item.lan, published: item.published }
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
    const sequence = ++requestId.current;
    report(''); setNotice(''); setBusy(true);
    try {
      const result = await fileShareRequest<FileShareState>(action, value);
      if (sequence !== requestId.current) return;
      if (inEditor) {
        const added = editor?.id || result.shares.find(item => !shares.some(existing => existing.id === item.id))?.id;
        if (added) { setSelected(added); setFilter(''); setQuery(''); }
        setEditor(null);
      }
      setState(result);
      setNotice(message);
    } catch (failure) {
      report((failure as Error).message);
      if (!inEditor) void fileShareRequest<FileShareState>('get').then(result => { if (sequence === requestId.current) setState(result); }, () => {});
    } finally { setBusy(false); }
  }
  async function remove(item: FileShare) {
    if (!state || !await confirm({ title: '移除此文件共享？', detail: `“${item.name}”的网页链接将失效。选中的原文件和文件夹会保留。`, confirm: '移除共享', cancel: '取消' })) return;
    await mutate('remove', { id: item.id, revision: state.revision }, '共享已移除');
  }
  const copy = (link: string) => void copyText(link).then(() => setNotice('共享链接已复制'), () => setError('无法复制共享链接。'));
  const draft = editor?.draft;
  return <section className="planning-workspace pl-files-workspace">
    <header className="pl-page-head workspace-banner"><h1>本机文件共享管理</h1>
      <div className="pl-actions"><SharingButton />
        <button className="pl-icon" type="button" title="刷新共享" aria-label="刷新共享" disabled={busy} onClick={refresh}><RefreshCw size={16} /></button>
        <button className="pl-button pl-primary" type="button" disabled={busy || !state} onClick={() => edit()}><Plus size={16} />新建共享</button>
      </div>
    </header>
    {error && <p className="pl-message pc-error" role="alert">{error}</p>}
    {notice && <p className="pl-message" role="status">{notice}</p>}
    {!error && !state && <Skeleton kind="list" label="正在读取文件共享…" />}
    {state && <>
      <div className="pl-share-summary"><Server size={16} aria-hidden="true" />
        <div><strong>{running}</strong><span>运行中</span></div><div><strong>{published}</strong><span>已发布</span></div><div><strong>{shares.length}</strong><span>全部共享</span></div>
      </div>
      <div className="pl-share-shell">
        <section className="pl-surface pl-share-inventory">
          <header><h2>共享清单</h2><div className="pl-actions"><ShareSearch query={query} change={setQuery} />
            <SegmentedControl label="筛选共享状态" value={filter}
              options={[{ value: '', label: '全部状态' }, { value: 'done', label: '运行中' }, { value: 'backlog', label: '已停止' }, { value: 'late', label: '启动失败' }]} onChange={setFilter} /></div></header>
          {visible.length > 0 ? <div className="pl-share-inventory-inner">
            <div className="pl-share-labels" aria-hidden="true"><span>名称</span><span>端口</span><span>状态</span></div>
            <ul className="pl-lines file-share-list">{visible.map(item => <li key={item.id}><button className="pl-share-row pl-share-row-admin" type="button"
              aria-pressed={item.id === share?.id} onClick={() => setSelected(item.id)}>
              <span className="pl-share-row-name"><Folder size={16} /><span><strong>{item.name}</strong><small>{scopeLabel(item.roots)}</small></span></span>
              <code className="pl-share-port">:{item.port}</code><span className="pl-state" data-tone={shareTone(item)}><i />{shareStatus(item)}</span>
            </button></li>)}</ul>
          </div> : <p className="pl-panel-empty">{shares.length ? '找不到匹配的共享。' : '新建共享后，可添加需要下载的文件和文件夹。'}</p>}
        </section>
        {share && <section className="pl-surface pl-share-detail">
          <header><div><small>共享详情</small><h2>{share.name}</h2></div>
            <div className="pl-actions"><button className="pl-icon" type="button" title="编辑共享" aria-label={`编辑共享 ${share.name}`} disabled={busy} onClick={() => edit(share)}><Pencil size={16} /></button>
              <button className="pl-icon" type="button" title="移除共享" aria-label={`移除共享 ${share.name}`} disabled={busy} onClick={() => void remove(share)}><Trash2 size={16} /></button></div>
          </header>
          <div className="pl-share-detail-body">
            <div className="pl-share-endpoint"><code>:{share.port}</code><div><strong>{share.lan ? '局域网直连' : '仅本机直连'}</strong>
              <span className="pl-endpoint-status"><b data-tone={shareTone(share)}>{shareStatus(share)}</b>{share.published ? '已发布' : '未发布'}</span></div><Globe2 size={16} /></div>
            {share.error && <p className="pc-error" role="alert">{share.error}</p>}
            <div className="pl-actions">
              <button className="pl-button pl-primary" type="button" disabled={!share.running || busy} onClick={() => void fileShareRequest('open', { id: share.id }).catch(failure => setError(failure.message))}><ArrowUpRight size={16} />打开网页</button>
              <button className="pl-button" type="button" disabled={busy} onClick={() => void mutate('toggle', { id: share.id, revision: state.revision, enabled: !share.running }, share.running ? '共享已停止' : '共享已启动')}>{share.running ? '停止' : '启动'}</button>
            </div>
            {share.links.length > 0 && <MotionDetails className="pl-share-links"><summary>分享链接 · {share.links.length} 个地址</summary>
              {share.links.map(link => <div key={link}><code>{link}</code><button type="button" className="pl-text"
                aria-label={`复制 ${new URL(link).host} 的共享链接`} onClick={() => copy(link)}><Copy size={16} />复制链接</button></div>)}
            </MotionDetails>}
            <div className="pl-share-detail-title"><h3>共享范围</h3><small>{scopeLabel(share.roots)}</small></div>
            <CreateRelated from="file-shares" page="project-todos" resource={share.id}>新建引用此共享的待办清单</CreateRelated>
            <ShareRoots roots={share.roots} />
          </div>
        </section>}
      </div>
    </>}
    {editor && draft && <Modal title={editor.id ? '编辑文件共享' : '新建文件共享'} closeLabel="关闭文件共享编辑"
      close={() => setEditor(null)} draft={draft} busy={busy || choosing} className="planning-editor-dialog">
      <ModalForm footer={<footer className="pc-form-footer"><ModalCancel /><button className="pl-button pl-primary" disabled={!draft.paths.length}>保存共享</button></footer>} className="planning-form" onSubmit={event => {
        event.preventDefault();
        void mutate('save', { id: editor.id, revision: editor.revision, value: { ...draft, port: Number(draft.port) } }, '文件共享已保存');
      }}>
        <div className="planning-form-grid">
          <label>共享名称<input required value={draft.name} maxLength={120} onChange={event => change({ name: event.target.value })} /></label>
          <label>监听端口<input className="pl-mono" type="number" required min={1} max={65535} value={draft.port} onChange={event => change({ port: event.target.value })} /></label>
        </div>
        <fieldset className="pl-field-group"><legend>共享范围</legend>
          <div className="planning-actions">
            <button type="button" className="pl-button" disabled={draft.paths.length >= 32} onClick={() => void choose('choose-files')}><Files size={16} />添加文件</button>
            <button type="button" className="pl-button" disabled={draft.paths.length >= 32} onClick={() => void choose('choose-directory')}><FolderOpen size={16} />添加文件夹</button>
          </div>
          {draft.paths.length > 0 && <ul className="pl-edit-rows">{draft.paths.map(item => <li key={item}><code>{item}</code>
            <button type="button" className="pl-icon" aria-label={`移除路径 ${item}`} onClick={() => change({ paths: draft.paths.filter(value => value !== item) })}><X size={16} /></button></li>)}</ul>}
        </fieldset>
        <fieldset className="pl-field-group share-access-options"><legend>访问方式</legend>
          <label className="planning-check"><input role="switch" className="liquid-toggle" type="checkbox" checked={draft.enabled} onChange={event => change({ enabled: event.target.checked })} />启用共享并在下次启动时恢复</label>
          <label className="planning-check"><input role="switch" className="liquid-toggle" type="checkbox" checked={draft.lan} onChange={event => change({ lan: event.target.checked })} />允许局域网通过独立端口访问</label>
          {draft.lan && <p className="pl-meta">持有完整 HTTP 链接的人可以直接下载。</p>}
          <label className="planning-check"><input role="switch" className="liquid-toggle" type="checkbox" checked={draft.published} onChange={event => change({ published: event.target.checked })} />发布到共享工作台，供获准访客下载</label>
        </fieldset>
        {editorError && <p className="pc-error" role="alert">{editorError}</p>}
      </ModalForm>
    </Modal>}
  </section>;
}
