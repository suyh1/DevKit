import { TextArea } from './TextControl';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Files,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  GitPullRequest,
  Globe2,
  History,
  Plus,
  RefreshCw,
  Tag,
} from 'lucide-react';
import { useConfirmation } from './Confirmation';
import { MotionButton } from './Motion';
import SegmentedControl from './SegmentedControl';
import Skeleton from './Skeleton';
import { ResourceLink, useWorkspaceResource } from './workspace-links';
import { useCardLight } from './tool-card-motion';
import GitFileGroup from './GitFileGroup';
import GitStashes from './GitStashes';
import { createPortal } from 'react-dom';
import ActionPopover from './ActionPopover';
import { ToastStack, type Notice } from './ToastStack';
import GitDelivery from './GitDelivery';
import { FileReview, ConflictReview } from './GitReview';
import { MergeProgress, MergePanel } from './GitMerge';
import { RepoGrants, CloneRepo } from './GitHostControls';
import { GitHistory } from './GitHistory';
import {
  gitRequest,
  useGitRead,
  type GitSeed,
  type GitMode,
  type GitMutation,
  type GitState,
  type Repository,
} from './git-api';
import './git-workspace.css';

const views = [
  { value: 'changes', label: '工作区', Icon: Files },
  { value: 'history', label: '提交历史', Icon: History },
  { value: 'refs', label: '分支与同步', Icon: GitFork },
  { value: 'stash', label: '贮藏', Icon: Archive },
] as const;
const branchName = (state: GitState) => (state.branch === '(detached)' ? '分离 HEAD' : state.branch);

function Changes({
  state,
  portal,
  id,
  edit,
  busy,
  mutate,
  generation,
  message,
  setMessage,
  onPreviewPush,
  seed,
  delivery,
}: {
  state: GitState;
  portal: boolean;
  id: string;
  edit: boolean;
  busy: boolean;
  mutate: GitMutation;
  generation: number;
  onPreviewPush?: () => void;
  seed?: GitSeed;
  delivery: ReactNode;
  message: string;
  setMessage: (value: string) => void;
}) {
  const [selection, select] = useState({ path: seed?.path ?? '', staged: !!seed?.staged });
  const [query, setQuery] = useState('');
  // Keep the reviewed bytes bound to the view that displayed them, including partially staged files.
  const reviewed = useRef(new Map<string, string>());
  const rememberReview = useCallback((path: string, staged: boolean, token: string) => {
    reviewed.current.set((staged ? 'index:' : 'work:') + path, token);
  }, []);
  const groups = [false, true].map((staged) => {
    const all = state.files.filter((file) =>
      staged ? file.index !== '.' && !file.conflict : file.work !== '.' || file.conflict,
    );
    return { staged, all, visible: all.filter((file) => file.path.toLowerCase().includes(query.toLowerCase())) };
  });
  const items = groups.flatMap((group) => group.visible.map((file) => ({ file, staged: group.staged })));
  const current =
    items.find((i) => i.staged === selection.staged && i.file.path === selection.path) ??
    items.find((i) => i.staged === selection.staged) ??
    items[0];
  const stagedCount = groups[1].all.length;
  const applyFiles = async (paths: string[], staged: boolean) => {
    const applied = await mutate(
      staged ? 'unstage' : 'stage',
      {
        files: paths.map((path) => ({ path, token: reviewed.current.get((staged ? 'index:' : 'work:') + path) })),
      },
      (staged ? '已取消暂存 ' : '已暂存 ') + paths.length + ' 个文件',
    );
    if (applied) {
      for (const path of paths) {
        reviewed.current.delete('index:' + path);
        reviewed.current.delete('work:' + path);
      }
    }
    return applied;
  };
  const canCommit =
    !busy && !!message.trim() && stagedCount > 0 && !state.mergeHead && !state.files.some((f) => f.conflict);
  const commit = async (preview = false) => {
    if (canCommit && (await mutate('commit', { message }, '已提交到 ' + state.branch))) {
      setMessage('');
      if (preview) onPreviewPush?.();
    }
  };
  const reviewProps = current
    ? { id, portal, file: current.file, staged: current.staged, generation, edit, busy, mutate }
    : null;
  return (
    <div className="git-working-layout devkit-bento">
      <section className="git-panel git-files-panel">
        <header>
          <h3>
            文件变更 <small>{state.files.length}</small>
          </h3>
          {state.files.length > 0 && (
            <input
              className="git-filter"
              placeholder="筛选文件路径"
              aria-label="筛选文件路径"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        </header>
        <div className="git-rows">
          {groups.map(({ staged, visible }) => (
            <GitFileGroup
              key={JSON.stringify([staged, query])}
              files={visible}
              staged={staged}
              activePath={current?.staged === staged ? current.file.path : undefined}
              edit={edit}
              busy={busy}
              onSelect={(path) => select({ path, staged })}
              onApply={(paths) => applyFiles(paths, staged)}
            />
          ))}
          {!items.length && (
            <p className="git-quiet">{state.files.length ? '没有匹配的文件。' : '工作区干净，所有改动均已提交。'}</p>
          )}
        </div>
      </section>
      {reviewProps ? (
        current?.file.conflict ? (
          <ConflictReview key={current.file.path} {...reviewProps} />
        ) : (
          <FileReview
            key={JSON.stringify([current?.file.path, current?.staged])}
            {...reviewProps}
            onReviewed={rememberReview}
          />
        )
      ) : (
        <article className="git-inspector">
          <header>
            <h3>差异预览</h3>
          </header>
          <p className="git-quiet">选择变更文件后可审阅差异。</p>
        </article>
      )}
      {edit && !state.mergeHead && (
        <form
          className="git-compose git-commit-desk"
          onSubmit={(e) => {
            e.preventDefault();
            void commit();
          }}
        >
          <div className="git-commit-destination">
            <GitCommitHorizontal size={19} />
            <div>
              <small>提交到本地分支</small>
              <strong>{branchName(state)}</strong>
            </div>
            <ActionPopover
              className="git-staged-menu"
              triggerClassName="text-button"
              label="查看已暂存文件"
              trigger={'已暂存 ' + stagedCount + ' 个文件'}
            >
              {groups[1].all.map((file) => (
                <button
                  type="button"
                  key={file.path}
                  onClick={() => {
                    setQuery('');
                    select({ staged: true, path: file.path });
                  }}
                >
                  {file.path}
                </button>
              ))}
              {!stagedCount && <small>在文件列表中选择要暂存的改动。</small>}
            </ActionPopover>
          </div>
          <label htmlFor="git-message">提交说明</label>
          <div className="git-commit-controls">
            <TextArea
              id="git-message"
              placeholder="概括这次提交的改动…"
              value={message}
              maxLength={8000}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void commit();
                }
              }}
            />
            <MotionButton type="submit" className="run-button" disabled={!canCommit} title="Ctrl / ⌘ + Enter">
              <GitCommitHorizontal size={16} />
              提交到 {branchName(state)}
            </MotionButton>
          </div>
          {onPreviewPush && (
            <button
              type="button"
              className="text-button git-submit-next"
              disabled={!canCommit}
              onClick={() => void commit(true)}
            >
              提交后预览推送 →
            </button>
          )}
        </form>
      )}
      {delivery}
    </div>
  );
}

function References({
  state,
  edit,
  sync,
  busy,
  mutate,
}: {
  state: GitState;
  edit: boolean;
  sync: boolean;
  busy: boolean;
  mutate: GitMutation;
}) {
  const confirm = useConfirmation();
  const [kind, setKind] = useState('heads'),
    [name, setName] = useState(''),
    [choice, setChoice] = useState('');
  const remote = state.remotes.includes(choice) ? choice : state.remotes[0];
  const refs = state.references.filter((r) => r.kind === kind);
  const synchronize = async (action: string, label: string) => {
    if (
      action !== 'fetch' &&
      !(await confirm({
        title: label + '当前分支？',
        context: state.branch,
        detail: '从 ' + state.upstream + ' 获取并快进当前工作目录。',
        confirm: label,
      }))
    )
      return;
    await mutate(action, { remote }, label + '完成');
  };
  return (
    <div className="git-split devkit-bento">
      <section className="git-panel">
        <header>
          <h3>仓库引用</h3>
          <small>{state.references.length} 项</small>
        </header>
        <SegmentedControl
          label="引用类型"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'heads', label: '本地分支' },
            { value: 'remotes', label: '远端分支' },
            { value: 'tags', label: '标签' },
          ]}
        />
        <div className="git-rows">
          {refs.map((r) => (
            <div className="git-ref" key={r.name}>
              {kind === 'tags' ? <Tag size={16} /> : <GitBranch size={16} />}
              <span>
                <strong>{r.name}</strong>
                <small>
                  {r.hash.slice(0, 9)} {r.upstream && ' · ' + r.upstream}
                </small>
              </span>
              {kind === 'heads' &&
                (r.name === state.branch ? (
                  <small>当前</small>
                ) : (
                  edit && (
                    <button
                      className="text-button"
                      disabled={busy || !!state.files.length}
                      onClick={() => void mutate('switch', { name: r.name }, '已切换分支')}
                    >
                      切换
                    </button>
                  )
                ))}
            </div>
          ))}
          {!refs.length && <p className="git-quiet">暂无此类引用。</p>}
        </div>
        {edit && kind !== 'remotes' && (
          <form
            className="git-compose"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await mutate(kind === 'tags' ? 'tag' : 'create-branch', { name: name.trim() }, '引用已创建'))
                setName('');
            }}
          >
            <label htmlFor="git-reference">从当前提交创建{kind === 'tags' ? '标签' : '分支'}</label>
            <input
              id="git-reference"
              placeholder={kind === 'tags' ? 'v1.0.0' : 'feature/search'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={240}
            />
            <MotionButton className="secondary-button" disabled={!state.head || !name.trim() || busy}>
              <Plus size={15} />
              创建{kind === 'tags' ? '标签' : '分支'}
            </MotionButton>
          </form>
        )}
      </section>
      <section className="git-panel git-sync">
        <header>
          <h3>远端同步</h3>
          <Globe2 size={18} />
        </header>
        <div className="git-tracking">
          <GitBranch size={18} />
          <strong>{branchName(state)}</strong>
          <ChevronRight size={15} />
          <code>{state.upstream || '未设置上游'}</code>
        </div>
        <div className="git-counts">
          <span>
            <ArrowUp size={16} />
            领先 <b>{state.upstream ? state.ahead : '—'}</b>
          </span>
          <span>
            <ArrowDown size={16} />
            落后 <b>{state.upstream ? state.behind : '—'}</b>
          </span>
        </div>
        {remote ? (
          <>
            <label>
              远端
              <select value={remote} onChange={(e) => setChoice(e.target.value)}>
                {state.remotes.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            {sync && (
              <div className="git-actions">
                {[
                  ['fetch', '获取'],
                  ['pull', '快进拉取'],
                ].map(([action, label]) => (
                  <MotionButton
                    className="secondary-button"
                    key={action}
                    disabled={
                      busy || (action !== 'fetch' && !state.upstream) || (action === 'pull' && !!state.files.length)
                    }
                    onClick={() => void synchronize(action, label)}
                  >
                    {label}
                  </MotionButton>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="git-quiet">在主机为此仓库配置远端后即可同步。</p>
        )}
      </section>
    </div>
  );
}

function RepositoryView({
  repo,
  onModeChange,
  seed,
  portal,
  edit,
  sync,
  mode,
  generation,
  refresh,
  busy,
  setBusy,
  report,
}: {
  repo: Repository;
  onModeChange: (mode: GitMode) => void;
  seed?: import('./git-api').GitSeed;
  portal: boolean;
  edit: boolean;
  sync: boolean;
  mode: GitMode;
  generation: number;
  refresh: () => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
  report: (message: string, error?: boolean) => void;
}) {
  const [pushOpen, setPushOpen] = useState(!!seed?.push);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const { data: state, error, loading } = useGitRead<GitState>(portal, 'state', { id: repo.id }, true, generation);
  const mutate: GitMutation = async (action, payload, notice) => {
    if (!state || busy || loading) return false;
    setBusy(true);
    report('');
    try {
      const result = await gitRequest<{ notice?: string }>(portal, action, {
        id: repo.id,
        revision: state.revision,
        ...payload,
      });
      report(result.notice || notice);
      return true;
    } catch (failure) {
      report((failure as Error).message, true);
      return false;
    } finally {
      setBusy(false);
      refresh();
    }
  };
  if (!state)
    return error ? (
      <p role="alert" className="git-error">
        {error}
      </p>
    ) : (
      <Skeleton kind="projects" label="正在读取仓库" />
    );
  const message = drafts[state.branch] || '';
  const setMessage = (value: string) => setDrafts((prev) => ({ ...prev, [state.branch]: value }));
  const delivery = sync && state.worktree && (
    <GitDelivery
      open={pushOpen}
      setOpen={setPushOpen}
      state={state}
      id={repo.id}
      portal={portal}
      busy={busy || loading}
      generation={generation}
      mutate={mutate}
    />
  );
  const latest = state.commits.find((c) => c.id === state.head);
  return (
    <>
      <div className="git-view-bar">
        <section className="git-hero">
          <div className="git-hero-main">
            <span>
              <GitBranch size={16} />
              当前分支
            </span>
            <h2>{branchName(state)}</h2>
            <p>
              <code>{state.head.slice(0, 8) || 'HEAD'}</code>
              {latest?.subject || (state.head ? '当前提交' : '等待首次提交')}
            </p>
          </div>
          <div className="git-numbers">
            {state.worktree && (
              <div>
                <b>{state.files.length}</b>
                <span>变更文件</span>
              </div>
            )}
            <div>
              <b>{state.references.filter((r) => r.kind === 'heads').length}</b>
              <span>本地分支</span>
            </div>
          </div>
        </section>
        <SegmentedControl
          label="Git 仓库视图"
          value={mode}
          onChange={onModeChange}
          options={views
            .filter((v) => state.worktree || v.value === 'history')
            .map((v) => ({
              ...v,
              content: (
                <>
                  <v.Icon size={15} />
                  {v.label}
                </>
              ),
            }))}
        />
      </div>
      {state.mergeHead && (
        <MergeProgress
          onChanges={() => onModeChange('changes')}
          state={state}
          mutate={mutate}
          edit={edit}
          busy={busy || loading}
        />
      )}
      {mode === 'changes' && state.worktree ? (
        <Changes
          seed={seed?.mode === 'changes' ? seed : undefined}
          delivery={delivery}
          onPreviewPush={
            sync && state.remotes.length && state.branch !== '(detached)' ? () => setPushOpen(true) : undefined
          }
          message={message}
          setMessage={setMessage}
          state={state}
          id={repo.id}
          portal={portal}
          edit={edit}
          busy={busy || loading}
          mutate={mutate}
          generation={generation}
        />
      ) : mode === 'history' || !state.worktree ? (
        <GitHistory
          initialPath={seed?.mode === 'history' ? seed.path : undefined}
          state={state}
          id={repo.id}
          portal={portal}
          generation={generation}
        />
      ) : mode === 'stash' ? (
        <GitStashes
          state={state}
          portal={portal}
          id={repo.id}
          edit={edit}
          busy={busy || loading}
          mutate={mutate}
          generation={generation}
        />
      ) : (
        <>
          <MergePanel
            initialBranch={seed?.branch}
            state={state}
            portal={portal}
            id={repo.id}
            generation={generation}
            edit={edit}
            busy={busy || loading}
            mutate={mutate}
          />
          <References state={state} edit={edit} sync={sync} busy={busy || loading} mutate={mutate} />
          {delivery}
        </>
      )}
    </>
  );
}

export default function GitWorkspace({
  active,
  portal = false,
  edit = !portal,
  sync = !portal,
  seed,
}: {
  active: boolean;
  portal?: boolean;
  edit?: boolean;
  sync?: boolean;
  seed?: import('./git-api').GitSeed;
}) {
  const [mode, setMode] = useState<GitMode>('changes'),
    [selected, setSelected] = useState('');
  const [generation, bump] = useState(0),
    [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const noticeId = useRef(0);
  const confirm = useConfirmation(),
    resource = useWorkspaceResource('git');
  const list = useGitRead<Repository[]>(portal, 'list', {}, active, generation);
  const repos = list.data,
    repo = repos?.find((r) => r.id === selected) || (!selected ? repos?.[0] : undefined);
  const container = useRef<HTMLDivElement>(null);
  useCardLight(container, active && !!repos && !repos.length, '[data-resource-card]');
  useEffect(() => {
    if (seed) setMode(seed.mode);
  }, [seed]);
  useEffect(() => {
    if (active && resource) setSelected(resource);
  }, [active, resource]);
  const refresh = () => bump((n) => n + 1);
  const report = (message: string, error = false) =>
    setNotice(message ? { id: ++noticeId.current, kind: error ? 'error' : 'success', message } : undefined);
  async function manage(action: 'register' | 'publish' | 'remove') {
    if (busy) return;
    setBusy(true);
    report('');
    try {
      if (action === 'register') {
        const root = await gitRequest<string>(false, 'choose');
        if (!root) return;
        const updated = await gitRequest<Repository[]>(false, action, { root });
        setSelected(updated[updated.length - 1].id);
        report('已登记仓库');
      } else if (repo) {
        const publishing = action === 'publish' && !repo.published;
        const title = action === 'remove' ? '移除仓库登记' : publishing ? '发布仓库' : '撤下仓库';
        if (
          !(await confirm({
            title,
            context: repo.name,
            confirm: title,
            detail:
              action === 'remove'
                ? '从工作台移除此项登记，磁盘上的文件会保留。'
                : publishing
                  ? '访客将按此仓库的访问权限查看内容。开放工作区也会公开未提交改动和贮藏。'
                  : '此仓库将从共享网页撤下。',
          }))
        )
          return;
        await gitRequest(false, action, { id: repo.id, published: !repo.published });
        if (action === 'remove') setSelected('');
        // The repository selector and publish action already display the resulting state.
      }
      refresh();
    } catch (error) {
      report((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const historyOnly = portal && repo?.access?.worktree === false;
  const activeMode = historyOnly ? 'history' : mode;
  if (!active) return null;
  return (
    <div ref={container} className="git-workspace" aria-busy={busy}>
      <header className="git-heading workspace-banner">
        <div>
          <FolderGit2 size={24} />
          <h1>Git 仓库管理</h1>
        </div>
        <div className="git-actions">
          {!portal && (
            <CloneRepo
              initialSource={seed?.clone}
              onAdded={(r) => {
                setSelected(r.id);
                refresh();
                report('克隆完成，仓库已登记');
              }}
            />
          )}
          {!portal && (
            <MotionButton disabled={busy} className="secondary-button" onClick={() => void manage('register')}>
              <Plus size={15} />
              登记仓库
            </MotionButton>
          )}
          <button className="icon-button" aria-label="刷新仓库" title="刷新仓库" disabled={busy} onClick={refresh}>
            <RefreshCw size={16} />
          </button>
        </div>
      </header>
      {notice &&
        createPortal(
          <ToastStack
            items={[notice]}
            dismiss={(id) => setNotice((current) => (current?.id === id ? undefined : current))}
          />,
          (notice.kind === 'error' && container.current?.querySelector('dialog[open]')) || document.body,
        )}
      {list.error ? (
        <p role="alert" className="git-error">
          {list.error}
        </p>
      ) : !repos ? (
        <Skeleton kind="projects" label="正在读取仓库列表" />
      ) : !repos.length ? (
        <div className="git-empty" data-resource-card>
          <GitPullRequest size={36} strokeWidth={1.25} />
          <h2>{portal ? '暂无已发布仓库' : '连接第一个 Git 仓库'}</h2>
          <p>
            {portal
              ? '主机发布仓库后，即可在这里审阅改动和提交。'
              : '选择已有工作目录，即可审阅差异、整理提交和切换分支。'}
          </p>
          {!portal && (
            <MotionButton className="run-button" disabled={busy} onClick={() => void manage('register')}>
              <FolderGit2 size={16} />
              选择工作目录
            </MotionButton>
          )}
        </div>
      ) : (
        <>
          <div className="git-repo-bar">
            <label>
              <FolderGit2 size={17} />
              <select
                title={repo?.root || repo?.name}
                aria-label="当前仓库"
                disabled={busy}
                value={repo?.id || ''}
                onChange={(e) => {
                  setSelected(e.target.value);
                  report('');
                }}
              >
                {!repo && <option value="">选择仓库</option>}
                {repos.map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.name}
                    {!portal && repos.some((other) => other.id !== r.id && other.name === r.name) && ' · ' + r.root}
                  </option>
                ))}
              </select>
            </label>
            {repo && (
              <div className="git-actions">
                {portal && repo.access && (
                  <small>
                    {historyOnly
                      ? '仅提交历史'
                      : [
                          repo.access.edit && edit ? '可编辑工作区' : '工作区只读',
                          repo.access.sync && sync ? '可同步远端' : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </small>
                )}
                {repo.published && <ResourceLink page="git" id={repo.id} compact />}
                {!portal && (
                  <>
                    {repo && !portal && (
                      <RepoGrants
                        key={repo.id}
                        repo={repo}
                        onSaved={() => {
                          refresh();
                          report('仓库授权已保存');
                        }}
                      />
                    )}
                    <button className="text-button" disabled={busy} onClick={() => void manage('publish')}>
                      <Globe2 size={14} />
                      {repo.published ? '撤下共享' : '发布到网页'}
                    </button>
                    <button className="text-button" disabled={busy} onClick={() => void manage('remove')}>
                      移除登记
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          {repo ? (
            <RepositoryView
              key={repo.id + JSON.stringify(seed ?? {})}
              repo={repo}
              seed={seed}
              onModeChange={setMode}
              portal={portal}
              edit={edit && (repo.access?.edit ?? true)}
              sync={sync && (repo.access?.sync ?? true)}
              mode={activeMode}
              generation={generation}
              refresh={refresh}
              busy={busy}
              setBusy={setBusy}
              report={report}
            />
          ) : (
            <p role="status">该仓库已移除或撤下，请选择可访问的仓库。</p>
          )}
        </>
      )}
    </div>
  );
}
