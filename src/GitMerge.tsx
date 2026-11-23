import { useState } from 'react';
import { GitMerge } from 'lucide-react';
import { CommitComparison } from './GitHistory';
import { useConfirmation } from './Confirmation';
import type { GitState, GitMutation } from './git-api';
export function MergePanel({
  state,
  edit,
  busy,
  portal,
  id,
  generation,
  mutate,
  initialBranch,
}: {
  initialBranch?: string;
  state: GitState;
  edit: boolean;
  busy: boolean;
  portal: boolean;
  id: string;
  generation: number;
  mutate: GitMutation;
}) {
  const [choice, setChoice] = useState(
      initialBranch
        ? (state.references.some((r) => r.kind === 'heads' && r.name === initialBranch) ? 'heads/' : 'remotes/') +
            initialBranch
        : '',
    ),
    confirm = useConfirmation();
  const refs = state.references.filter(
    (r) => r.kind !== 'tags' && !(r.name === state.branch && r.kind === 'heads') && !r.name.endsWith('/HEAD'),
  );
  const target = refs.find((r) => r.kind + '/' + r.name === choice);
  return (
    <section className="git-merge-panel">
      <header>
        <GitMerge size={17} />
        <h3>比较与合并分支</h3>
      </header>
      <label>
        将此分支合入 <b>{state.branch}</b>
        <select aria-label="比较目标分支" value={target ? choice : ''} onChange={(e) => setChoice(e.target.value)}>
          <option value="">选择本地或远端分支</option>
          {refs.map((r) => (
            <option key={r.kind + '/' + r.name} value={r.kind + '/' + r.name}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {target && state.head && (
        <>
          <CommitComparison portal={portal} id={id} base={state.head} target={target.hash} generation={generation} />
          {edit && (
            <button
              className="secondary-button"
              disabled={
                busy ||
                !!state.mergeHead ||
                !!state.files.length ||
                state.branch === '(detached)' ||
                target.hash === state.head
              }
              onClick={async () => {
                if (
                  await confirm({
                    title: '合并到 ' + state.branch + '？',
                    detail:
                      '来源 ' +
                      target.name +
                      ' · ' +
                      target.hash.slice(0, 8) +
                      '。可以快进时直接更新，分叉时停在合并提交前供核对。',
                    confirm: '开始合并',
                  })
                )
                  await mutate(
                    'merge',
                    { name: 'refs/' + target.kind + '/' + target.name, target: target.hash },
                    '已处理分支合并',
                  );
              }}
            >
              合并到 {state.branch}
            </button>
          )}
          {edit && !!state.files.length && <small>请先提交或贮藏当前改动。</small>}
        </>
      )}
    </section>
  );
}
export function MergeProgress({
  state,
  mutate,
  busy,
  edit,
  onChanges,
}: {
  onChanges: () => void;
  state: GitState;
  mutate: GitMutation;
  busy: boolean;
  edit: boolean;
}) {
  const confirm = useConfirmation(),
    conflicts = state.files.filter((f) => f.conflict).length;
  return (
    <section className="git-merge-progress">
      <GitMerge size={20} />
      <div>
        <strong>正在合并到 {state.branch}</strong>
        <small>
          {conflicts ? '还有 ' + conflicts + ' 个文件需要解决冲突' : '已就绪，可完成合并提交'} ·{' '}
          {state.mergeHead.slice(0, 8)}
        </small>
      </div>
      {conflicts > 0 && (
        <button className="secondary-button" onClick={onChanges}>
          查看冲突文件
        </button>
      )}
      {edit && (
        <>
          <button
            className="run-button"
            disabled={busy || !!conflicts}
            onClick={() => void mutate('merge-continue', {}, '已创建合并提交')}
          >
            完成合并
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={async () => {
              if (
                await confirm({
                  title: '中止当前合并？',
                  detail: 'Git 将恢复合并前的状态，已做的冲突解决会被撤回。',
                  confirm: '中止合并',
                })
              )
                await mutate('merge-abort', {}, '已中止合并');
            }}
          >
            中止合并
          </button>
        </>
      )}
    </section>
  );
}
