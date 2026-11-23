import { useMemo, useState } from 'react';
import { GitCommitHorizontal, Search } from 'lucide-react';
import type { Commit, GitState } from './git-api';
import { useGitRead } from './git-api';
import Skeleton from './Skeleton';
import FileMeta from './FileMeta';

const colors = ['#399984', '#c46f4f', '#9674c9', '#518ac4', '#bc963f'];
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
  const [limit, setLimit] = useState(400);
  const { data, error } = useGitRead<string>(
    portal,
    stash ? 'stash-show' : commit ? 'show' : 'patch',
    { id, path, staged, commit, stash },
    !!(path || commit || stash),
    generation,
  );
  const lines = useMemo(() => data?.trimEnd().split('\n') || [], [data]);
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
        <>
          <pre className="git-diff" tabIndex={0} aria-label="代码差异">
            {lines.slice(0, limit).map((line, i) => {
              const tone = line.startsWith('@@')
                ? 'hunk'
                : /^(diff --git|index |--- |\+\+\+ )/.test(line)
                  ? 'meta'
                  : line.startsWith('+')
                    ? 'added'
                    : line.startsWith('-')
                      ? 'removed'
                      : '';
              return (
                <span className={tone} key={i}>
                  {line || ' '}
                  {'\n'}
                </span>
              );
            })}
          </pre>
          {lines.length > limit && (
            <button className="text-button" onClick={() => setLimit(limit + 400)}>
              继续显示差异（余 {lines.length - limit} 行）
            </button>
          )}
        </>
      )}
    </article>
  );
}

export function GitHistory({
  state,
  portal,
  id,
  generation,
}: {
  state: GitState;
  portal: boolean;
  id: string;
  generation: number;
}) {
  const [query, setQuery] = useState(''),
    [selected, setSelected] = useState('');
  const rows = useMemo(() => graphRows(state.commits), [state.commits]);
  const visible = state.commits
    .map((c, i) => ({ c, i }))
    .filter(({ c }) =>
      [c.subject, c.author, c.id, c.refs].some((v) => v.toLowerCase().includes(query.trim().toLowerCase())),
    );
  const current = visible.find(({ c }) => c.id === selected)?.c ?? visible[0]?.c;
  return (
    <div className="git-split devkit-bento">
      <section className="git-panel">
        <header>
          <h3>提交历史</h3>
          <small>
            {state.more ? '最近 ' : ''}
            {state.commits.length} 条
          </small>
        </header>
        <label className="git-search">
          <Search size={15} />
          <input
            aria-label="搜索提交"
            placeholder="消息、作者或哈希"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="git-rows">
          {visible.map(({ c, i }) => (
            <button
              key={c.id}
              className="git-commit-row"
              aria-pressed={c.id === current?.id}
              onClick={() => setSelected(c.id)}
            >
              {!query.trim() && <Lane row={rows[i]} />}
              <span>
                <strong title={c.subject}>{c.subject || '无标题提交'}</strong>
                <small>
                  <code>{c.id.slice(0, 7)}</code> · {c.author} · {c.date.slice(0, 10)}{' '}
                  {c.refs && <em title={c.refs}>{c.refs}</em>}
                </small>
              </span>
            </button>
          ))}
          {!visible.length && <p className="git-quiet">{query ? '没有匹配的提交。' : '仓库还没有提交。'}</p>}
        </div>
      </section>
      <PatchView key={current?.id} portal={portal} id={id} commit={current?.id} generation={generation} />
    </div>
  );
}
