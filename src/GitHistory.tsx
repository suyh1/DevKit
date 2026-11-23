import { useState } from 'react';
import { GitCommitHorizontal, Search } from 'lucide-react';
import type { Commit, GitState } from './git-api';
import { useGitRead } from './git-api';
import Skeleton from './Skeleton';
import FileMeta from './FileMeta';
import { DiffText } from './GitReview';

const colors = ['var(--accent)', 'var(--syntax-string)', 'var(--warning)', 'var(--syntax-keyword)', 'var(--success)'];
const laneX = (n: number) => 9 + n * 12;

export function graphRows(commits: Commit[]) {
  let lanes: string[] = [];
  return commits.map((commit) => {
    const incoming = lanes.length;
    if (!lanes.includes(commit.id)) lanes.push(commit.id);
    const lane = lanes.indexOf(commit.id);
    const next = [...lanes];
    next.splice(lane, 1);
    const unseen = commit.parents.filter((id) => !next.includes(id));
    next.splice(lane, 0, ...unseen);
    const edges = lanes.flatMap((id, col) =>
      (id === commit.id ? commit.parents : [id]).map((target) => ({ from: col, to: next.indexOf(target) })),
    );
    const row = { lane, columns: incoming, width: Math.max(lanes.length, next.length), edges };
    lanes = next;
    return row;
  });
}

function Lane({ row }: { row: ReturnType<typeof graphRows>[number] }) {
  return (
    <svg aria-hidden="true" className="git-lane" width={laneX(row.width) + 2} height="56">
      {Array.from({ length: row.columns }, (_, i) => (
        <path key={i} d={'M' + laneX(i) + ' 0v28'} stroke={colors[i % colors.length]} />
      ))}
      {row.edges.map((edge) => (
        <path
          key={edge.from + ':' + edge.to}
          fill="none"
          d={
            'M' +
            laneX(edge.from) +
            ' 28C' +
            laneX(edge.from) +
            ' 43 ' +
            laneX(edge.to) +
            ' 42 ' +
            laneX(edge.to) +
            ' 56'
          }
          stroke={colors[edge.to % colors.length]}
        />
      ))}
      <circle cx={laneX(row.lane)} cy="28" r="4.2" fill="var(--surface)" stroke={colors[row.lane % colors.length]} />
    </svg>
  );
}

export function PatchView({
  portal,
  id,
  path,
  staged,
  commit,
  stash,
  generation,
}: {
  portal: boolean;
  id: string;
  path?: string;
  staged?: boolean;
  commit?: string;
  stash?: string;
  generation: number;
}) {
  const { data, error } = useGitRead<string>(
    portal,
    stash ? 'stash-show' : commit ? 'show' : 'patch',
    { id, path, staged, commit, stash },
    !!(path || commit || stash),
    generation,
  );

  return (
    <article className="git-inspector">
      <header>
        <GitCommitHorizontal size={18} />
        <FileMeta
          name={path || stash?.slice(0, 12) || commit?.slice(0, 12) || '差异预览'}
          encoding={stash ? '贮藏差异' : commit ? '提交详情' : staged ? '暂存区' : '工作区'}
        />
      </header>
      {error ? (
        <p role="alert">{error}</p>
      ) : !path && !commit && !stash ? (
        <p className="git-quiet">选择左侧记录查看差异。</p>
      ) : data === undefined ? (
        <Skeleton kind="editor" label="正在读取差异" />
      ) : !data ? (
        <p className="git-quiet">没有可显示的文本差异。</p>
      ) : (
        <DiffText text={data} />
      )}
    </article>
  );
}

export function CommitComparison({
  portal,
  id,
  base,
  target,
  generation,
}: {
  portal: boolean;
  id: string;
  base: string;
  target: string;
  generation: number;
}) {
  const { data, error } = useGitRead<string>(portal, 'compare', { id, base, target }, !!base && !!target, generation);
  return (
    <article className="git-inspector">
      <header>
        <GitCommitHorizontal size={16} />
        <strong>版本差异</strong>
        <code>
          {base.slice(0, 8)} → {target.slice(0, 8)}
        </code>
      </header>
      {error ? (
        <p role="alert">{error}</p>
      ) : data === undefined ? (
        <Skeleton kind="editor" label="正在比较版本" />
      ) : (
        <DiffText text={data || '两个版本的文件内容相同。'} />
      )}
    </article>
  );
}
export function GitHistory({
  state,
  portal,
  id,
  generation,
  initialPath = '',
}: {
  initialPath?: string;
  state: GitState;
  portal: boolean;
  id: string;
  generation: number;
}) {
  const [query, setQuery] = useState(''),
    [path, setPath] = useState(initialPath),
    [field, setField] = useState('message');
  const [filter, setFilter] = useState({ query: '', path: initialPath, field: 'message' }),
    [cursor, setCursor] = useState({ offset: 0, snapshot: '' }),
    [selected, select] = useState(''),
    [base, setBase] = useState('');
  const offset = cursor.offset;
  const filtered = !!filter.query || !!filter.path || offset > 0;
  const { data, error } = useGitRead<Pick<GitState, 'commits' | 'more' | 'snapshot'>>(
    portal,
    'history',
    { id, ...filter, offset, snapshot: cursor.snapshot },
    filtered,
    generation,
  );
  const page = filtered ? data : state;
  const visible = page?.commits || [],
    rows = graphRows(visible);
  const current = visible.find((c) => c.id === selected) || visible[0];
  return (
    <div className="git-split devkit-bento">
      <section className="git-panel">
        <header>
          <h3>提交历史</h3>
          <small>第 {1 + offset / 200} 页</small>
        </header>
        <form
          className="git-history-filter"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter({ field, query: query.trim(), path: path.trim() });
            setCursor({ offset: 0, snapshot: '' });
            select('');
          }}
        >
          <select aria-label="搜索字段" value={field} onChange={(e) => setField(e.target.value)}>
            {Object.entries({ message: '提交消息', author: '作者', ref: '分支或标签', hash: '提交哈希' }).map(
              ([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ),
            )}
          </select>
          <input
            aria-label="搜索提交"
            placeholder="检索全部历史"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <input
            aria-label="文件历史路径"
            placeholder="文件路径（可选）"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
          <button className="secondary-button">
            <Search size={14} />
            检索
          </button>
        </form>
        {error ? (
          <p role="alert">
            {error}{' '}
            <button className="text-button" onClick={() => setCursor({ offset: 0, snapshot: '' })}>
              回到第一页
            </button>
          </p>
        ) : !page ? (
          <Skeleton kind="list" label="正在检索提交" />
        ) : null}
        <div className="git-rows">
          {visible.map((c, i) => (
            <button
              key={c.id}
              className="git-commit-row"
              aria-pressed={c.id === current?.id}
              onClick={() => select(c.id)}
            >
              {!filter.query && !filter.path && <Lane row={rows[i]} />}
              <span>
                <strong title={c.subject}>{c.subject || '无标题提交'}</strong>
                <small>
                  <code>{c.id.slice(0, 7)}</code> · {c.author} · {c.date.slice(0, 10)} {c.refs && <em>{c.refs}</em>}
                </small>
              </span>
            </button>
          ))}
          {page && !visible.length && <p className="git-quiet">没有匹配的提交。</p>}
        </div>
        <div className="git-review-tools">
          <button
            className="text-button"
            disabled={!offset}
            onClick={() => setCursor({ offset: Math.max(0, offset - 200), snapshot: page?.snapshot || state.snapshot })}
          >
            上一页
          </button>
          <button
            className="text-button"
            disabled={!page?.more}
            onClick={() => setCursor({ offset: offset + 200, snapshot: page!.snapshot })}
          >
            下一页
          </button>
          {base ? (
            <button className="text-button" onClick={() => setBase('')}>
              清除起点 {base.slice(0, 7)}
            </button>
          ) : (
            <button className="text-button" disabled={!current} onClick={() => setBase(current!.id)}>
              设为比较起点
            </button>
          )}
        </div>
      </section>
      {base && current && base !== current.id ? (
        <CommitComparison portal={portal} id={id} base={base} target={current.id} generation={generation} />
      ) : (
        <PatchView key={current?.id} portal={portal} id={id} commit={current?.id} generation={generation} />
      )}
    </div>
  );
}
