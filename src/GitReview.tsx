import { useState } from 'react';
import { Check, GitMerge, Layers, Minus, Plus } from 'lucide-react';
import { useGitRead, type Change, type GitMutation } from './git-api';
import Skeleton from './Skeleton';
import FileMeta from './FileMeta';
import { useConfirmation } from './Confirmation';

export function DiffText({
  text,
  onHunk,
  actionLabel,
  busy = false,
}: {
  text: string;
  onHunk?: (index: number) => void;
  actionLabel?: string;
  busy?: boolean;
}) {
  const [limit, setLimit] = useState(400);
  const lines = text.split('\n');
  let hunk = -1;
  return (
    <>
      <pre className="git-diff" tabIndex={0} aria-label="代码差异">
        {lines.slice(0, limit).map((line, i) => {
          const isHunk = line.startsWith('@@ ');
          if (isHunk) hunk++;
          const index = hunk;
          const tone = isHunk
            ? 'hunk'
            : /^(diff --git|index |--- |\+\+\+ )/.test(line)
              ? 'meta'
              : line.startsWith('+')
                ? 'added'
                : line.startsWith('-')
                  ? 'removed'
                  : '';
          return (
            <span key={i} className={tone}>
              {isHunk && onHunk && (
                <button type="button" className="git-hunk-button" disabled={busy} onClick={() => onHunk(index)}>
                  {actionLabel}此块
                </button>
              )}
              {line || ' '}
              {'\n'}
            </span>
          );
        })}
      </pre>
      {lines.length > limit && (
        <button className="text-button" onClick={() => setLimit(limit + 400)}>
          继续显示（余 {lines.length - limit} 行）
        </button>
      )}
    </>
  );
}

type Props = {
  portal: boolean;
  id: string;
  file: Change;
  staged: boolean;
  generation: number;
  edit: boolean;
  busy: boolean;
  mutate: GitMutation;
};
type Review = { text: string; token: string; hunks: { index: number; header: string }[]; truncated: boolean };
export function FileReview({ portal, id, file, staged, generation, edit, busy, mutate }: Props) {
  const { data, error, loading } = useGitRead<Review>(
    portal,
    'review',
    { id, path: file.path, staged },
    true,
    generation,
  );
  const label = staged ? '取消暂存' : '暂存';
  const apply = (hunk?: number) =>
    void mutate(
      staged ? 'unstage' : 'stage',
      { path: file.path, token: data?.token, hunk },
      hunk === undefined ? '已更新文件暂存状态' : '已更新所选差异块',
    );
  return (
    <article className="git-inspector">
      <header>
        <Layers size={17} />
        <FileMeta name={file.path} encoding={staged ? '暂存区' : '工作区'} />
      </header>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <Skeleton kind="editor" label="正在读取差异" />
      ) : (
        <>
          {edit && (
            <div className="git-review-tools">
              <button
                className="secondary-button"
                disabled={busy || loading || !data.text}
                aria-label={label + ' ' + file.path}
                onClick={() => apply()}
              >
                {staged ? <Minus size={14} /> : <Plus size={14} />} {label}整个文件
              </button>
              {data.hunks.length > 0 && <small>{data.hunks.length} 个差异块</small>}
            </div>
          )}
          {data.truncated && <p className="git-quiet">预览已截断，整文件操作包含未显示的内容。</p>}
          <DiffText
            key={data.token}
            text={data.text || '无文本差异。'}
            onHunk={edit && data.hunks.length ? apply : undefined}
            actionLabel={label}
            busy={busy || loading}
          />
        </>
      )}
    </article>
  );
}

type Side = { exists: boolean; text: string | null };
type Conflict = { token: string; ours: Side; theirs: Side; merged: string | null };
export function ConflictReview(props: Props) {
  const { portal, id, file, generation } = props;
  const { data, error, loading } = useGitRead<Conflict>(portal, 'conflict', { id, path: file.path }, true, generation);
  return (
    <article className="git-inspector">
      <header>
        <GitMerge size={18} />
        <FileMeta name={file.path} encoding="待解决冲突" />
      </header>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <Skeleton kind="editor" label="正在读取冲突版本" />
      ) : (
        <ConflictEditor key={data.token} {...props} busy={props.busy || loading} data={data} />
      )}
    </article>
  );
}
function ConflictEditor({ data, file, busy, edit, mutate }: Props & { data: Conflict }) {
  const [draft, setDraft] = useState(data.merged || ''),
    confirm = useConfirmation();
  const resolve = async (side: 'ours' | 'theirs' | 'manual') => {
    const label = side === 'manual' ? '保存编辑结果' : side === 'ours' ? '采用当前版本' : '采用合入版本';
    if (
      !(await confirm({
        title: label + '？',
        detail: file.path + ' 将按所选结果解决冲突并更新暂存区。',
        confirm: label,
      }))
    )
      return;
    await mutate(
      'resolve',
      { path: file.path, token: data.token, side, ...(side === 'manual' ? { text: draft } : {}) },
      '已解决文件冲突',
    );
  };
  return (
    <div className="git-conflict-editor">
      <div className="git-sides">
        {(['ours', 'theirs'] as const).map((side) => (
          <section key={side}>
            <h4>{side === 'ours' ? '当前版本' : '合入版本'}</h4>
            <pre>{data[side].exists ? (data[side].text ?? '二进制或大型文件') : '此侧已删除文件'}</pre>
            {edit && (
              <button className="secondary-button" disabled={busy} onClick={() => void resolve(side)}>
                采用{side === 'ours' ? '当前' : '合入'}版本
              </button>
            )}
          </section>
        ))}
      </div>
      {edit && data.merged !== null && (
        <label>
          编辑合并结果
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
          <button className="run-button" disabled={busy} onClick={() => void resolve('manual')}>
            <Check size={15} />
            保存并标记已解决
          </button>
        </label>
      )}
    </div>
  );
}
