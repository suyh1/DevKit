import { useMemo, useState } from 'react';
import { GitBranch, GitCommitHorizontal, GitFork, GitMerge, Radio, Search, Tag } from 'lucide-react';
import { graphStart, layoutGraph, type GraphCursor } from './git-graph';
import type { GitState, Reference } from './git-api';
import { useGitRead } from './git-api';
import Skeleton from './Skeleton';
import FileMeta from './FileMeta';
import { DiffText } from './GitReview';

const colors = ['var(--accent)', 'var(--syntax-string)', 'var(--warning)', 'var(--syntax-keyword)', 'var(--success)'];
const laneX = (column: number) => 12 + column * 16;
const ink = (color: number) => colors[color % colors.length];

function Lane({
  row,
  width,
  merge,
  head,
}: {
  row: ReturnType<typeof layoutGraph>['rows'][number];
  width: number;
  merge: boolean;
  head: boolean;
}) {
  const x = laneX(row.column),
    color = ink(row.color);
  return (
    <svg aria-hidden="true" className="git-lane" width={laneX(width)} height="56">
      {row.incoming.map((lane, i) => (
        <path key={lane.target} d={`M${laneX(i)} 0v28`} stroke={ink(lane.color)} />
      ))}
      {row.edges.map(({ from, to, color }) => (
        <path
          key={from + ':' + to}
          fill="none"
          d={`M${laneX(from)} 28 C${laneX(from)} 42 ${laneX(to)} 42 ${laneX(to)} 56`}
          stroke={ink(color)}
        />
      ))}
      {head && <circle cx={x} cy="28" r="8" fill="var(--surface)" stroke={color} />}
      <circle cx={x} cy="28" r={merge ? 5 : 4} fill={merge ? 'var(--surface)' : color} stroke={color} />
      {merge && <circle cx={x} cy="28" r="2" fill={color} />}
    </svg>
  );
}

function RefLabels({ refs, head }: { refs?: Reference[]; head: boolean }) {
  return (
    <>
      {head && (
        <em className="git-ref-label" data-kind="head">
          HEAD
        </em>
      )}
      {refs?.map((ref) => {
        const Icon = ref.kind === 'tags' ? Tag : ref.kind === 'heads' ? GitBranch : Radio;
        const type = ref.kind === 'tags' ? '标签' : ref.kind === 'heads' ? '本地分支' : '远端分支';
        return (
          <em
            className="git-ref-label"
            data-kind={ref.kind}
            key={ref.kind + '/' + ref.name}
            title={type + ' · ' + ref.name}
            aria-label={type + ' ' + ref.name}
          >
            <Icon size={11} />
            {ref.name}
          </em>
        );
      })}
    </>
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
  const [pageStarts, setPageStarts] = useState<GraphCursor[]>([graphStart]);
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
  const visible = page?.commits;
  const showGraph = !filter.query && !filter.path;
  const graph = useMemo(
    () => layoutGraph(showGraph ? (visible ?? []) : [], pageStarts[offset / 200]),
    [showGraph, visible, pageStarts, offset],
  );
  const refsByCommit = useMemo(() => {
    const grouped = new Map<string, Reference[]>();
    for (const ref of state.references) {
      const hash = ref.peeled || ref.hash;
      const group = grouped.get(hash) ?? [];
      group.push(ref);
      grouped.set(hash, group);
    }
    return grouped;
  }, [state.references]);
  const current = visible?.find((c) => c.id === selected) || visible?.[0];
  return (
    <div className="git-split git-history-layout devkit-bento">
      <section className="git-panel">
        <header>
          <h3>
            <GitFork size={16} /> {showGraph ? '提交图' : '历史检索结果'}
          </h3>
          <small>第 {1 + offset / 200} 页</small>
        </header>
        <form
          className="git-history-filter"
          onSubmit={(e) => {
            e.preventDefault();
            setPageStarts([graphStart]);
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
        <div className="git-rows git-graph-scroll" key={JSON.stringify([offset, filter])}>
          {visible?.map((c, i) => (
            <button
              key={c.id}
              className="git-commit-row"
              style={showGraph ? { minWidth: laneX(graph.width) + 180 } : undefined}
              aria-pressed={c.id === current?.id}
              onClick={() => select(c.id)}
            >
              {showGraph && (
                <Lane row={graph.rows[i]} width={graph.width} merge={c.parents.length > 1} head={c.id === state.head} />
              )}
              <span>
                <span className="git-commit-subject">
                  {c.parents.length > 1 && <GitMerge size={13} aria-label="合并提交" />}
                  <strong title={c.subject}>{c.subject || '无标题提交'}</strong>
                </span>
                <small>
                  <RefLabels refs={refsByCommit.get(c.id)} head={c.id === state.head} />
                  <code>{c.id.slice(0, 7)}</code> · {c.author} · {c.date.slice(0, 10)}
                </small>
              </span>
            </button>
          ))}
          {page && !visible?.length && <p className="git-quiet">没有匹配的提交。</p>}
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
            onClick={() => {
              setPageStarts([...pageStarts.slice(0, offset / 200 + 1), graph.next]);
              setCursor({ offset: offset + 200, snapshot: page!.snapshot });
            }}
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
      <div className="git-history-detail">
        {current && (
          <header className="git-selected-commit">
            <small>
              {current.parents.length > 1 ? '合并提交' : '提交'} · <code>{current.id.slice(0, 12)}</code>
            </small>
            <h4>{current.subject || '无标题提交'}</h4>
            <span>
              {current.author} · {current.date.slice(0, 10)}
            </span>
            <div>
              <RefLabels refs={refsByCommit.get(current.id)} head={current.id === state.head} />
            </div>
          </header>
        )}
        {base && current && base !== current.id ? (
          <CommitComparison portal={portal} id={id} base={base} target={current.id} generation={generation} />
        ) : (
          <PatchView key={current?.id} portal={portal} id={id} commit={current?.id} generation={generation} />
        )}
      </div>
    </div>
  );
}
