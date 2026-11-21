import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Plus, RefreshCw, Search } from 'lucide-react';
import { useConfirmation } from './Confirmation';
import { knowledgeRequest, kinds, type Article, type KnowledgePage } from './knowledge-api';
import { KnowledgeEditor, outlines } from './KnowledgeEditor';
import { referenceText, refersTo, renderArticle, resourceNames, resourceTarget } from './knowledge-markdown';
import { openWorkspaceLink, ResourceLink, useWorkspaceResource, workspaceHash } from './workspace-links';
import { useWorkspaceGuard } from './related-workspaces';
import { Modal } from './project-components';
import { SharingButton } from './Sharing';
import { useCardLight } from './tool-card-motion';
import Skeleton from './Skeleton';
import './knowledge.css';

function Prose({ page }: { page: KnowledgePage }) {
  const html = useMemo(() => renderArticle(page.body), [page.body]);
  const guard = useWorkspaceGuard();
  return (
    <div
      className="kb-prose"
      onClick={(event) => {
        const href = (event.target as Element).closest('a')?.getAttribute('href');
        const link = href && resourceTarget(href);
        if (!link) return;
        event.preventDefault();
        if (guard(link.page)) {
          history.replaceState(history.state, '', workspaceHash('knowledge', page.id));
          openWorkspaceLink(link.page, link.id);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function Versions({
  page,
  close,
  restore,
  busy,
  editable,
  error,
}: {
  page: KnowledgePage;
  close: () => void;
  restore: (version: number) => void;
  busy: boolean;
  editable: boolean;
  error: string;
}) {
  const [entries, setEntries] = useState<KnowledgePage[]>();
  const [failure, setFailure] = useState(''),
    [selected, setSelected] = useState(0);
  useEffect(() => {
    let live = true;
    void knowledgeRequest<KnowledgePage[]>('history', { id: page.id }).then(
      (rows) => {
        if (live) setEntries(rows);
      },
      (err) => {
        if (live) setFailure(err.message);
      },
    );
    return () => {
      live = false;
    };
  }, [page.id, page.revision]);
  const item = entries?.find((entry) => entry.revision === selected) ?? entries?.[0];
  return (
    <Modal
      title="版本历史"
      description={page.title}
      closeLabel="关闭版本历史"
      close={close}
      busy={busy}
      wide
      footer={
        <footer>
          <button className="secondary-button" onClick={close}>
            关闭
          </button>
          {editable && item && (
            <button className="run-button" onClick={() => restore(item.revision)}>
              恢复为新版本
            </button>
          )}
        </footer>
      }
    >
      {(error || failure) && <p role="alert">{error || failure}</p>}
      {!entries && !failure && <Skeleton kind="list" label="正在读取历史版本" />}
      {entries && !item && <p>首次保存后还没有旧版本。</p>}
      {item && (
        <>
          <label className="pc-field">
            选择旧版本
            <select value={item.revision} onChange={(e) => setSelected(Number(e.target.value))}>
              {entries?.map((row) => (
                <option key={row.revision} value={row.revision}>
                  v{row.revision} · {new Date(row.updated).toLocaleString()} · {row.actor}
                </option>
              ))}
            </select>
          </label>
          <p>
            {item.project || '通用'} / {item.kind}
          </p>
          <h3>{item.title}</h3>
          <div
            className="kb-prose"
            onClick={(e) => {
              if ((e.target as Element).closest('a')) e.preventDefault();
            }}
            dangerouslySetInnerHTML={{ __html: renderArticle(item.body) }}
          />
        </>
      )}
    </Modal>
  );
}

export default function KnowledgeBase({
  active,
  portal = false,
  canEdit = !portal,
}: {
  active: boolean;
  portal?: boolean;
  canEdit?: boolean;
}) {
  const resource = useWorkspaceResource('knowledge');
  const related = useMemo(() => {
    const match = /^related:(jar|nginx):(.+)$/.exec(resource ?? '');
    return match ? { page: match[1] as 'jar' | 'nginx', id: match[2] } : undefined;
  }, [resource]);
  const [pages, setPages] = useState<KnowledgePage[]>();
  const [query, setQuery] = useState(''),
    [project, setProject] = useState(''),
    [kind, setKind] = useState('');
  const [editing, setEditing] = useState<{ base?: KnowledgePage; initial: Article }>();
  const [versions, setVersions] = useState<KnowledgePage>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [formError, setFormError] = useState('');
  const sequence = useRef(0),
    grid = useRef<HTMLDivElement>(null);
  const confirm = useConfirmation();
  const refresh = useCallback(async () => {
    const tick = ++sequence.current;
    try {
      const items = await knowledgeRequest<KnowledgePage[]>('list');
      if (sequence.current === tick) {
        setPages(items);
        setError('');
      }
    } catch (failure) {
      if (sequence.current === tick) setError((failure as Error).message);
    }
  }, []);
  useEffect(() => {
    if (active) void refresh();
    return () => {
      ++sequence.current;
    };
  }, [active, refresh]);
  const projects = useMemo(
    () =>
      [...new Set(pages?.map((item) => item.project).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'zh-CN'),
      ),
    [pages],
  );
  const pool = useMemo(
    () =>
      (pages || [])
        .filter((item) => !related || refersTo(item.body, related.page, related.id))
        .sort((a, b) => b.updated.localeCompare(a.updated)),
    [pages, related],
  );
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return pool.filter(
      (item) =>
        (!project || item.project === project) &&
        (!kind || item.kind === kind) &&
        [item.title, item.body, item.project, item.kind].some((value) =>
          value.toLocaleLowerCase().includes(term),
        ),
    );
  }, [pool, project, kind, query]);
  const missing = !!resource && !related && !!pages && !pages.some((item) => item.id === resource);
  const page = missing ? undefined : (visible.find((item) => item.id === resource) ?? visible[0]);
  useCardLight(grid, active && !!pages, '[data-resource-card]');
  const directorySelection = useRef<string | undefined>(undefined);
  const reset = () => {
    setProject('');
    setKind('');
    setQuery('');
  };
  // Direct links from search, browser history or instance details must be visible.
  useEffect(() => {
    if (!resource || directorySelection.current !== resource) reset();
    directorySelection.current = undefined;
  }, [resource]);
  function create() {
    const body = related
      ? outlines.部署手册.replace(
          '1. ',
          '1. ' + referenceText(related.page, related.id, resourceNames[related.page]),
        )
      : outlines.部署手册;
    setFormError('');
    setEditing({ initial: { title: '', project, kind: '部署手册', body } });
  }
  async function mutate(action: string, payload: object) {
    if (busy || !canEdit) return;
    setBusy(true);
    setFormError('');
    setError('');
    try {
      const updated = await knowledgeRequest<KnowledgePage | null>(action, payload);
      ++sequence.current;
      const id = updated?.id ?? ('id' in payload ? payload.id : '');
      setPages((old) => [...(old ?? []).filter((item) => item.id !== id), ...(updated ? [updated] : [])]);
      setEditing(undefined);
      setVersions(undefined);
      reset();
      openWorkspaceLink('knowledge', updated?.id);
    } catch (failure) {
      const detail = (failure as Error).message;
      if (editing || versions) setFormError(detail);
      else setError(detail);
      if ((failure as { status?: number }).status === 409) void refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="kb-center" aria-label="团队知识库">
      <header className="kb-header">
        <div>
          <BookOpen aria-hidden="true" size={22} />
          <h1>团队知识库</h1>
        </div>
        <div>
          {!portal && <SharingButton />}
          <button
            className="icon-button"
            title="刷新文档"
            aria-label="刷新文档"
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} />
          </button>
          {canEdit && (
            <button className="run-button" disabled={!pages || busy} onClick={create}>
              <Plus size={15} />
              新建文档
            </button>
          )}
        </div>
      </header>
      {error && (
        <p className="pc-notice" role="alert">
          {error}
        </p>
      )}
      {!pages && !error && <Skeleton kind="list" label="正在读取知识库" />}
      {pages && (
        <div className="kb-layout">
          <aside className="kb-library">
            <label className="kb-search">
              <Search size={16} />
              <input
                type="search"
                aria-label="知识库全文搜索"
                placeholder="搜索标题或正文"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="kb-fields">
              <select aria-label="筛选项目" value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="">全部项目</option>
                {projects.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
              <select aria-label="筛选文档类型" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">全部类型</option>
                {kinds.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </div>
            {related && (
              <div className="kb-scope">
                {resourceNames[related.page]}关联手册{' '}
                <button className="text-button" onClick={() => openWorkspaceLink('knowledge')}>
                  查看全部
                </button>
              </div>
            )}
            <div className="kb-cards" ref={grid} aria-label="文档目录">
              {visible.map((row) => (
                <button
                  key={row.id}
                  data-resource-card
                  className="kb-card"
                  aria-current={row.id === page?.id ? 'page' : undefined}
                  onClick={() => {
                    directorySelection.current = row.id;
                    openWorkspaceLink('knowledge', row.id);
                  }}
                >
                  <span>
                    {row.project || '通用'} · {row.kind}
                  </span>
                  <strong title={row.title}>{row.title}</strong>
                </button>
              ))}
            </div>
          </aside>
          <article className="kb-reader">
            {page ? (
              <>
                <small>
                  {page.project || '通用'} / {page.kind}
                </small>
                <h2>{page.title}</h2>
                <div className="kb-meta">
                  v{page.revision} · {page.actor} · {new Date(page.updated).toLocaleString()}
                </div>
                <div className="kb-actions">
                  <ResourceLink page="knowledge" id={page.id} compact />
                  <button
                    className="text-button"
                    onClick={() => {
                      setVersions(page);
                      setFormError('');
                    }}
                  >
                    版本历史
                  </button>
                  {canEdit && (
                    <>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setFormError('');
                          setEditing({ base: page, initial: page });
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
                              title: '删除这篇文档？',
                              detail: '《' + page.title + '》及其版本历史将被删除。',
                              confirm: '删除文档',
                            })
                          )
                            void mutate('remove', { id: page.id, revision: page.revision });
                        }}
                      >
                        删除
                      </button>
                    </>
                  )}
                </div>
                <Prose page={page} />
              </>
            ) : (
              <p className="kb-empty">
                {missing
                  ? '链接中的文档已删除或不存在。'
                  : !pages.length
                    ? canEdit
                      ? '知识库还是空的。点击「新建文档」写下第一份手册。'
                      : '知识库中还没有文档。'
                    : related && !pool.length
                      ? '还没有文档引用这个实例。'
                      : '没有符合条件的文档。'}
              </p>
            )}
          </article>
        </div>
      )}
      {editing && canEdit && (
        <KnowledgeEditor
          active={active}
          initial={editing.initial}
          editing={!!editing.base}
          projects={projects}
          busy={busy}
          error={formError}
          close={() => setEditing(undefined)}
          save={(value) =>
            void mutate(editing.base ? 'save' : 'create', {
              ...value,
              id: editing.base?.id,
              revision: editing.base?.revision,
            })
          }
        />
      )}
      {active && versions && (
        <Versions
          page={versions}
          close={() => setVersions(undefined)}
          editable={canEdit}
          busy={busy}
          error={formError}
          restore={(version) =>
            void mutate('restore', { id: versions.id, revision: versions.revision, version })
          }
        />
      )}
    </section>
  );
}
