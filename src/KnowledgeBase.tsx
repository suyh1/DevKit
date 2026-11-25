import { Modal as WorkspaceDialog } from './project-components';
import { TextInput } from './TextControl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, FolderOpen, FolderPlus, Plus, RefreshCw, Search } from 'lucide-react';
import { useConfirmation } from './Confirmation';
import {
  DocumentSectionContext,
  useDocumentLibrary,
  type DocumentSection,
  templates,
  type KnowledgePage,
  type Template,
} from './knowledge-api';
import {
  articleFields,
  createDraft,
  draftPrefix,
  readDraft,
  savedDrafts,
  type WritingDraft,
} from './knowledge-drafts';
import { KnowledgeEditor, outlines } from './KnowledgeEditor';
import { KnowledgeReader } from './KnowledgeReader';
import { Versions } from './KnowledgeVersions';
import { loadResources, type ResourceChoice } from './KnowledgeResourcePicker';
import { bodyMatch, referenceText, refersTo, resourceNames } from './knowledge-markdown';
import { openWorkspaceLink, ResourceLink, useWorkspaceResource } from './workspace-links';
import { useCardLight } from './tool-card-motion';
import Skeleton from './Skeleton';
import './knowledge.css';

type LibraryProps = { active: boolean; portal?: boolean; canEdit?: boolean; visitor?: string };

export default function KnowledgeBase({
  section = 'knowledge',
  ...props
}: LibraryProps & { section?: DocumentSection }) {
  return (
    <DocumentSectionContext.Provider value={section}>
      <DocumentLibrary {...props} />
    </DocumentSectionContext.Provider>
  );
}

function DocumentLibrary({ active, portal = false, canEdit = !portal, visitor = '' }: LibraryProps) {
  const { section, name, request } = useDocumentLibrary();
  const developer = section === 'dev-docs';
  const resource = useWorkspaceResource(section),
    prefix = draftPrefix(portal, visitor, section);
  const seedQuery = developer && resource?.startsWith('search:') ? resource.slice(7) : undefined;
  const seedFolder = developer && resource?.startsWith('folder:') ? resource.slice(7) : undefined;
  const token = resource?.startsWith('write:') ? resource.slice(6) : '';
  const initial = useMemo(
    () => (token && canEdit ? readDraft(prefix, token) : undefined),
    [prefix, token, canEdit],
  );
  const related = useMemo(() => {
    const match = /^related:(jar|nginx):(.+)$/.exec(resource ?? '');
    return match ? { page: match[1] as 'jar' | 'nginx', id: match[2] } : undefined;
  }, [resource]);
  const [origin, setOrigin] = useState<ResourceChoice>(),
    [originLoading, setOriginLoading] = useState(false);
  useEffect(() => {
    setOrigin(undefined);
    if (!related || !active) return;
    let live = true;
    setOriginLoading(true);
    void loadResources(related.page, (rows) => {
      const row = rows.find((r) => r.id === related.id);
      if (live && row) setOrigin(row);
    })
      .catch(() => {})
      .finally(() => {
        if (live) setOriginLoading(false);
      });
    return () => {
      live = false;
    };
  }, [related, active]);
  const [pages, setPages] = useState<KnowledgePage[]>(),
    [directories, setDirectories] = useState<string[]>([]);
  const [folder, setFolder] = useState<string | null>(null),
    [project, setProject] = useState(''),
    [tag, setTag] = useState(''),
    [query, setQuery] = useState('');
  const [folderInput, setFolderInput] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<KnowledgePage>(),
    [jump, setJump] = useState<{ id: string; line: number }>();
  const readerHeading = useRef<HTMLHeadingElement>(null);
  const seq = useRef(0),
    grid = useRef<HTMLDivElement>(null),
    selectedHere = useRef<string>(''),
    confirm = useConfirmation();
  const refresh = useCallback(async () => {
    const tick = ++seq.current;
    try {
      const lib = await request<{ pages: KnowledgePage[]; folders: string[] }>('library');
      if (tick === seq.current) {
        setPages(lib.pages);
        setDirectories(lib.folders);
        setError('');
      }
    } catch (e) {
      if (tick === seq.current) setError((e as Error).message);
    }
  }, [request]);
  useEffect(() => {
    if (active) void refresh();
    return () => {
      ++seq.current;
    };
  }, [active, refresh]);
  const folders = useMemo(() => {
    const all = new Set<string>();
    for (const path of [...directories, ...(pages ?? []).map((p) => p.folder)]) {
      let prefix = '';
      for (const part of path.split('/').filter(Boolean)) {
        prefix = prefix ? prefix + '/' + part : part;
        all.add(prefix);
      }
    }
    return [...all].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [directories, pages]);
  const projects = useMemo(() => [...new Set(pages?.map((p) => p.project).filter(Boolean))].sort(), [pages]);
  const tags = useMemo(() => [...new Set(pages?.flatMap((p) => p.tags))].sort(), [pages]);
  const term = query.trim().toLowerCase();
  const hits = useMemo(
    () => new Map((pages ?? []).map((p) => [p.id, bodyMatch(p.body, term, developer)])),
    [pages, term, developer],
  );
  const visible = useMemo(
    () =>
      (pages ?? [])
        .filter(
          (p) =>
            (folder === null || p.folder === folder || (!!folder && p.folder.startsWith(folder + '/'))) &&
            (!project || p.project === project) &&
            (!tag || p.tags.includes(tag)) &&
            (!related || refersTo(p.body, related.page, related.id)) &&
            (!term ||
              [p.title, p.folder, p.project, ...p.tags, p.body].some((value) =>
                value.toLowerCase().includes(term),
              )),
        )
        .sort(
          (a, b) =>
            Number(!!hits.get(b.id)?.heading) - Number(!!hits.get(a.id)?.heading) ||
            b.updated.localeCompare(a.updated),
        ),
    [pages, folder, project, tag, related, term, hits],
  );
  const byFolder = useMemo(() => {
    const groups = new Map<string, KnowledgePage[]>();
    if (developer && !term)
      for (const item of visible) {
        const group = groups.get(item.folder);
        if (group) group.push(item);
        else groups.set(item.folder, [item]);
      }
    return groups;
  }, [developer, term, visible]);
  const [id, anchor] = (seedQuery !== undefined || seedFolder !== undefined ? '' : (resource ?? '')).split('~');
  const missing =
    !!id && !related && !token && !!pages && !pages.some((p) => p.id === id);
  const page = missing ? undefined : (visible.find((p) => p.id === id) ?? visible[0]);
  const seededJump = useMemo(() => {
    const hit = page && seedQuery === query ? hits.get(page.id) : undefined;
    return page && hit ? { id: page.id, line: hit.line } : undefined;
  }, [page, seedQuery, query, hits]);
  const backlinks = useMemo(
    () => (page ? (pages ?? []).filter((p) => p.id !== page.id && refersTo(p.body, section, page.id)) : []),
    [pages, page, section],
  );
  useCardLight(grid, active && !!pages && !initial, '[data-resource-card]');
  useEffect(() => {
    if ((seedQuery !== undefined || seedFolder !== undefined || selectedHere.current !== id) && !token) {
      setQuery(seedQuery ?? '');
      setFolder(seedFolder ?? null);
      setProject('');
      setTag('');
      setJump(undefined);
    }
    selectedHere.current = '';
  }, [id, token, seedQuery, seedFolder]);
  const drafts = canEdit && !initial && active ? savedDrafts(prefix) : [];
  function navigate(id?: string) {
    openWorkspaceLink(section, id);
  }
  function openDraft(draft: WritingDraft) {
    try {
      localStorage.setItem(prefix + draft.token, JSON.stringify(draft));
      navigate('write:' + draft.token);
    } catch {
      setError('无法建立本机草稿，请检查浏览器存储空间。');
    }
  }
  function start(template?: Template) {
    let body = template ? outlines[template] : '';
    if (related && origin) {
      const link = referenceText(
        related.page,
        related.id,
        [origin.label, origin.host].filter(Boolean).join(' · '),
      );
      if (!template) body = link + '\n';
      else if (body.includes('1. ')) body = body.replace('1. ', '1. ' + link);
      else body = body.trimEnd() + '\n\n' + link + '\n';
    }
    openDraft(createDraft({ title: '', folder: folder ?? '', project, tags: tag ? [tag] : [], body }));
  }
  function updated(p: KnowledgePage) {
    ++seq.current;
    setPages((old) => [...(old ?? []).filter((item) => item.id !== p.id), p]);
  }
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function documentCard(row: KnowledgePage) {
    const hit = hits.get(row.id);
    return (
      <button
        key={row.id}
        data-resource-card
        className="kb-card"
        aria-current={page?.id === row.id ? 'page' : undefined}
        onClick={() => {
          selectedHere.current = row.id;
          setJump(hit ? { id: row.id, line: hit.line } : undefined);
          navigate(row.id);
          if (developer && !hit)
            requestAnimationFrame(() => {
              readerHeading.current?.focus({ preventScroll: true });
              readerHeading.current?.scrollIntoView({ block: 'nearest' });
            });
        }}
      >
        {(!developer || term) && (
          <span>
            {row.folder || '未归档'}
            {row.project && ' · ' + row.project}
          </span>
        )}
        <strong title={row.title}>{row.title}</strong>
        {hit && <small>{hit.snippet}</small>}
      </button>
    );
  }
  if (initial && canEdit)
    return (
      <KnowledgeEditor
        key={prefix + token}
        initial={initial}
        prefix={prefix}
        active={active}
        folders={folders}
        projects={projects}
        saved={updated}
        leave={navigate}
      />
    );
  return (
    <section className="kb-center" aria-label={name}>
      <header className="kb-header">
        <div>
          <BookOpen size={22} />
          <h1>{name}</h1>
        </div>
        <div>
          <button className="icon-button" aria-label="刷新文档" onClick={() => void refresh()}>
            <RefreshCw size={16} />
          </button>
          {canEdit && (
            <>
              <select
                aria-label="从模板新建"
                value=""
                disabled={!pages || (!!related && !origin)}
                onChange={(e) => start(e.target.value as Template)}
              >
                <option value="">从模板新建</option>
                {templates.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
              <button
                className="run-button"
                disabled={!pages || (!!related && !origin)}
                onClick={() => start()}
              >
                <Plus size={15} />
                新建文档
              </button>
            </>
          )}
        </div>
      </header>
      {folderInput === null && error && (
        <p role="alert" className="pc-notice">
          {error}
        </p>
      )}
      {token && !initial && (
        <p role="status">
          此草稿已结束或仅保存在原设备上。
          <button className="text-button" onClick={() => navigate()}>
            返回文档目录
          </button>
        </p>
      )}
      {!pages && !error && <Skeleton kind="list" label={developer ? "正在读取开发文档" : "正在读取知识库"} />}
      {pages && (
        <div className="kb-layout">
          <aside className="kb-library">
            <label className="kb-search">
              <Search size={16} />
              <TextInput
                embedded
                type="search"
                aria-label={developer ? '开发文档全文搜索' : '知识库全文搜索'}
                placeholder={developer ? '搜索全部文档、命令或用法' : '搜索标题或正文'}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setJump(undefined);
                  if (developer) {
                    setFolder(null);
                    setProject('');
                    setTag('');
                  }
                }}
              />
            </label>
            <div className="kb-folder-nav">
              <select
                aria-label="筛选目录"
                value={folder === null ? '*' : folder ? '/' + folder : ''}
                onChange={(e) => setFolder(e.target.value === '*' ? null : e.target.value.slice(1))}
              >
                <option value="*">全部目录</option>
                <option value="">未归档</option>
                {folders.map((f) => (
                  <option key={f} value={'/' + f}>
                    {f}
                  </option>
                ))}
              </select>
              {canEdit && (
                <button
                  className="icon-button"
                  title="新建目录"
                  aria-label="新建目录"
                  onClick={() => setFolderInput(folder ? folder + '/' : '')}
                >
                  <FolderPlus size={16} />
                </button>
              )}
            </div>
            {folderInput !== null && canEdit && (
              <WorkspaceDialog
                title="新建目录"
                closeLabel="关闭新建目录"
                close={() => setFolderInput(null)}
                busy={busy}
              >
                <form
                  className="kb-folder-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      const all = await request<string[]>('create-folder', { folder: folderInput });
                      setDirectories(all);
                      setFolder(
                        folderInput
                          .split('/')
                          .map((s) => s.trim())
                          .filter(Boolean)
                          .join('/'),
                      );
                      setFolderInput(null);
                    });
                  }}
                >
                  <TextInput
                    autoFocus
                    aria-label="目录路径"
                    placeholder="基础知识 / 网络"
                    required
                    maxLength={240}
                    value={folderInput}
                    onChange={(e) => setFolderInput(e.target.value)}
                  />
                  <button disabled={busy} className="secondary-button">
                    创建目录
                  </button>
                  <button type="button" className="text-button" onClick={() => setFolderInput(null)}>
                    取消
                  </button>
                </form>
                {error && <p role="alert">{error}</p>}
              </WorkspaceDialog>
            )}
            <details className="kb-filters">
              <summary>
                项目与标签{(project || tag) && ' · ' + [project, tag].filter(Boolean).join(' / ')}
              </summary>
              <div className="kb-fields">
                <select aria-label="筛选项目" value={project} onChange={(e) => setProject(e.target.value)}>
                  <option value="">全部项目</option>
                  {projects.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
                <select aria-label="筛选标签" value={tag} onChange={(e) => setTag(e.target.value)}>
                  <option value="">全部标签</option>
                  {tags.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
            </details>
            {drafts.length > 0 && (
              <details className="kb-drafts">
                <summary>本机草稿 · {drafts.length}</summary>
                <div className="disclosure-scroll">
                  {drafts.map((d) => (
                    <button
                      className="text-button"
                      key={d.token}
                      onClick={() => navigate('write:' + d.token)}
                    >
                      {d.form.title || '无标题草稿'} · 继续写作
                    </button>
                  ))}
                </div>
              </details>
            )}
            {related && (
              <div className="kb-scope">
                {origin
                  ? [origin.label, origin.host].filter(Boolean).join(' · ')
                  : originLoading
                    ? '正在读取实例…'
                    : resourceNames[related.page] + '不可用'}{' '}
                · 关联手册{' '}
                <button className="text-button" onClick={() => navigate()}>
                  查看全部
                </button>
              </div>
            )}
            <div className="kb-cards" data-section={section} ref={grid} aria-label="文档目录">
              {developer && !term
                ? [...byFolder].map(([path, rows]) => (
                    <details className="dev-doc-folder" key={path} open>
                      <summary>
                        <FolderOpen size={15} /> {path || '未归档'} <small>{rows.length}</small>
                      </summary>
                      {rows.map(documentCard)}
                    </details>
                  ))
                : visible.map(documentCard)}
            </div>
          </aside>
          <article className="kb-reader">
            {page ? (
              <>
                <small>
                  {[page.folder || '未归档', page.project, ...page.tags].filter(Boolean).join(' / ')}
                </small>
                <h2 ref={readerHeading} tabIndex={-1}>
                  {page.title}
                </h2>
                <div className="kb-meta">
                  v{page.revision} · {page.actor} · {new Date(page.updated).toLocaleString()}
                </div>
                <div className="kb-actions">
                  {developer && (
                    <button
                      className="text-button"
                      onClick={() => {
                        const selected =
                          grid.current?.querySelector<HTMLButtonElement>('[aria-current="page"]');
                        const group = selected?.closest('details');
                        if (group) group.open = true;
                        selected?.focus();
                      }}
                    >
                      返回文档目录
                    </button>
                  )}
                  <ResourceLink page={section} id={page.id} compact />
                  <button className="text-button" onClick={() => setVersions(page)}>
                    版本历史
                  </button>
                  {canEdit && (
                    <>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          const existing = drafts.find((d) => d.documentId === page.id);
                          existing
                            ? navigate('write:' + existing.token)
                            : openDraft(createDraft(articleFields(page), page));
                        }}
                      >
                        编辑文档
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await confirm({
                              title: '删除文档？',
                              detail: '《' + page.title + '》及其版本历史将被删除。',
                              confirm: '删除文档',
                            })
                          )
                            void action(async () => {
                              await request('remove', { id: page.id, revision: page.revision });
                              await refresh();
                              navigate();
                            });
                        }}
                      >
                        删除
                      </button>
                    </>
                  )}
                </div>
                <KnowledgeReader page={page} anchor={anchor} jump={jump ?? seededJump} />
                {!!backlinks.length && (
                  <aside className="kb-backlinks">
                    <h3>引用本文的文档</h3>
                    {backlinks.map((p) => (
                      <button className="text-button" key={p.id} onClick={() => navigate(p.id)}>
                        {p.title}
                      </button>
                    ))}
                  </aside>
                )}
              </>
            ) : (
              <p className="kb-empty">
                {missing
                  ? '链接中的文档已删除或不存在。'
                  : !pages.length
                    ? '当前文档库还没有文档。'
                    : related
                      ? '没有文档引用这个实例。'
                      : '当前条件下没有文档。'}
              </p>
            )}
          </article>
        </div>
      )}
      {active && versions && (
        <Versions
          page={versions}
          close={() => setVersions(undefined)}
          editable={canEdit}
          busy={busy}
          error={error}
          restore={(version) =>
            void action(async () => {
              const p = await request<KnowledgePage>('restore', {
                id: versions.id,
                revision: versions.revision,
                version,
              });
              updated(p);
              setVersions(undefined);
              navigate(p.id);
            })
          }
        />
      )}
    </section>
  );
}
