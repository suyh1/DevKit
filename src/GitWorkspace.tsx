import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  CircleDot,
  Files,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  GitPullRequest,
  Globe2,
  History,
  Layers,
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
import GitStashes from './GitStashes';
import GitDelivery from './GitDelivery';
import { FileReview, ConflictReview } from './GitReview';
import { MergeProgress, MergePanel } from './GitMerge';
import { RepoGrants, CloneRepo } from './GitHostControls';
import { GitHistory } from './GitHistory';
import {
  gitRequest,
  useGitRead,
  type Change,
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
const stateNames: Record<string, string> = { M: '修改', A: '新增', D: '删除', T: '类型变化', U: '冲突', '?': '未跟踪' };
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
}: {
  state: GitState;
  portal: boolean;
  id: string;
  edit: boolean;
  busy: boolean;
  mutate: GitMutation;
  generation: number;
  onPreviewPush?: () => void;
  message: string;
  setMessage: (value: string) => void;
}) {
  const [selection, select] = useState(''),
    [query, setQuery] = useState('');
  const sections = [
    { staged: false, name: '未暂存', files: state.files.filter((f) => f.work !== '.' || f.conflict) },
    { staged: true, name: '已暂存', files: state.files.filter((f) => f.index !== '.' && !f.conflict) },
  ];
  const items = sections.flatMap((s) =>
    s.files
      .filter((f) => f.path.toLowerCase().includes(query.toLowerCase()))
      .map((file) => ({ file, staged: s.staged, key: s.name + ':' + file.path })),
  );
  const current = items.find((i) => i.key === selection) || items[0];
  const stagedCount = sections[1].files.length;
  function itemLabel(file: Change, staged: boolean) {
    return file.conflict ? '冲突' : stateNames[staged ? file.index : file.work] || '改动';
  }
  const [reviewList, setReviewList] = useState(false);
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
    <div className="git-working-layout">
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
            <button
              type="button"
              className="text-button"
              aria-expanded={reviewList}
              onClick={() => setReviewList(!reviewList)}
            >
              已暂存 {stagedCount} 个文件
            </button>
          </div>
          {reviewList && (
            <div className="git-staged-list">
              {sections[1].files.map((file) => (
                <button
                  type="button"
                  key={file.path}
                  onClick={() => {
                    setQuery('');
                    select('已暂存:' + file.path);
                  }}
                >
                  {file.path}
                </button>
              ))}
              {!stagedCount && <small>从下方差异预览中暂存文件或差异块。</small>}
            </div>
          )}
          <label htmlFor="git-message">提交说明</label>
          <div className="git-commit-controls">
            <textarea
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
      <div className="git-split devkit-bento">
        <section className="git-panel">
          <header>
            <h3>文件变更</h3>
            <small>{state.files.length} 个文件</small>
          </header>
          {state.files.length > 0 && (
            <input
              className="git-filter"
              placeholder="筛选文件路径"
              aria-label="筛选文件路径"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <div className="git-rows">
            {sections.map((s) => (
              <section key={s.name} className="git-file-group">
                <h4>
                  {s.staged ? <Layers size={13} /> : <CircleDot size={13} />} {s.name} <small>{s.files.length}</small>
                </h4>
                {items
                  .filter((i) => i.staged === s.staged)
                  .map(({ file, key }) => (
                    <div key={key} className="git-file-row" data-selected={current?.key === key}>
                      <button aria-pressed={current?.key === key} onClick={() => select(key)} title={file.path}>
                        <em data-code={s.staged ? file.index : file.work}>{itemLabel(file, s.staged)}</em>
                        <span>{file.path}</span>
                      </button>
                    </div>
                  ))}
              </section>
            ))}
            {!items.length && (
              <p className="git-quiet">{state.files.length ? '没有匹配的文件。' : '工作区干净，所有改动均已提交。'}</p>
            )}
          </div>
        </section>
        {reviewProps ? (
          current?.file.conflict ? (
            <ConflictReview key={current.key} {...reviewProps} />
          ) : (
            <FileReview key={current?.key} {...reviewProps} />
          )
        ) : (
          <article className="git-inspector">
            <header>
              <h3>差异预览</h3>
            </header>
            <p className="git-quiet">选择变更文件后可审阅差异。</p>
          </article>
        )}
      </div>
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
  onChanges,
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
  onChanges: () => void;
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
  const [pushRequest, setPushRequest] = useState(0);
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
  const latest = state.commits.find((c) => c.id === state.head);
  return (
    <>
      <div className="git-branch-strip">
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
        {sync && state.worktree && (
          <GitDelivery
            initialOpen={!!seed?.push}
            request={pushRequest}
            state={state}
            id={repo.id}
            portal={portal}
            busy={busy || loading}
            generation={generation}
            mutate={mutate}
          />
        )}
      </div>
      {state.mergeHead && (
        <MergeProgress onChanges={onChanges} state={state} mutate={mutate} edit={edit} busy={busy || loading} />
      )}
      {mode === 'changes' && state.worktree ? (
        <Changes
          onPreviewPush={
            sync && state.remotes.length && state.branch !== '(detached)'
              ? () => setPushRequest((n) => n + 1)
              : undefined
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
        <GitHistory initialPath={seed?.path} state={state} id={repo.id} portal={portal} generation={generation} />
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
  const [notice, setNotice] = useState({ message: '', error: false });
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
  const report = (message: string, error = false) => setNotice({ message, error });
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
        report(title + '完成');
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
    <div ref={container} className="git-workspace">
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
      {busy && (
        <p role="status" className="git-notice">
          正在处理仓库操作…
        </p>
      )}
      {!busy && notice.message && (
        <p className={notice.error ? 'git-error' : 'git-notice'} role={notice.error ? 'alert' : 'status'}>
          {!notice.error && <Check size={15} />} {notice.message}
        </p>
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
                    {repo && !portal && <RepoGrants key={repo.id} repo={repo} onSaved={refresh} />}
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
            <>
              <SegmentedControl
                label="Git 仓库视图"
                value={activeMode}
                onChange={setMode}
                options={views
                  .filter((v) => !historyOnly || v.value === 'history')
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
              <RepositoryView
                key={repo.id + JSON.stringify(seed ?? {})}
                repo={repo}
                seed={seed}
                onChanges={() => setMode('changes')}
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
            </>
          ) : (
            <p role="status">该仓库已移除或撤下，请选择可访问的仓库。</p>
          )}
        </>
      )}
    </div>
  );
}
