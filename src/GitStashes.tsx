import { useState } from 'react';
import { Archive, ArchiveRestore } from 'lucide-react';
import { useConfirmation } from './Confirmation';
import { MotionButton } from './Motion';
import { PatchView } from './GitHistory';
import type { GitState, GitMutation } from './git-api';

export default function GitStashes({
  state,
  portal,
  id,
  edit,
  busy,
  mutate,
  generation,
}: {
  state: GitState;
  portal: boolean;
  id: string;
  edit: boolean;
  busy: boolean;
  mutate: GitMutation;
  generation: number;
}) {
  const [selected, select] = useState<GitState['stashes'][number]>(),
    [message, setMessage] = useState('');
  const confirm = useConfirmation();
  const current =
    state.stashes.find((item) => item.id === selected?.id && item.ref === selected.ref) ??
    state.stashes.find((item) => item.id === selected?.id) ??
    state.stashes[0];
  async function save() {
    if (
      !(await confirm({
        title: '贮藏当前改动？',
        context: state.branch,
        confirm: '保存贮藏',
        detail: '暂存区、工作区和未跟踪文件将保存到同一条贮藏记录，并从当前工作目录收起。',
      }))
    )
      return;
    if (await mutate('stash-save', { message }, '改动已保存到贮藏')) setMessage('');
  }
  async function restore(action: 'stash-apply' | 'stash-pop' | 'stash-drop') {
    if (!current) return;
    const label = action === 'stash-apply' ? '应用贮藏' : action === 'stash-pop' ? '弹出贮藏' : '删除贮藏';
    const detail =
      action === 'stash-drop'
        ? '删除这条贮藏记录，工作目录会保留当前内容。'
        : '将改动及原暂存状态恢复到当前分支。' +
          (action === 'stash-pop' ? '成功后删除该记录，出现冲突时保留。' : '贮藏记录会保留。');
    if (await confirm({ title: label + '？', context: current.ref + ' · ' + current.message, confirm: label, detail }))
      await mutate(action, { stash: current.id, ref: current.ref }, label + '完成');
  }
  return (
    <div className="git-split devkit-bento">
      <section className="git-panel">
        <header>
          <h3>贮藏记录</h3>
          <small>最近 {state.stashes.length} 条</small>
        </header>
        {edit && (
          <div className="git-compose">
            {current && (
              <div className="git-actions">
                <MotionButton
                  className="secondary-button"
                  disabled={busy || !!state.files.length}
                  onClick={() => void restore('stash-apply')}
                >
                  <ArchiveRestore size={15} />
                  应用选中的贮藏
                </MotionButton>
                <button
                  className="secondary-button"
                  disabled={busy || !!state.files.length}
                  onClick={() => void restore('stash-pop')}
                >
                  弹出贮藏…
                </button>
                <button className="text-button" disabled={busy} onClick={() => void restore('stash-drop')}>
                  删除贮藏…
                </button>
              </div>
            )}
            <label htmlFor="git-stash-note">新贮藏说明</label>
            <input
              id="git-stash-note"
              placeholder="记录这批改动（可选）"
              value={message}
              maxLength={500}
              onChange={(e) => setMessage(e.target.value)}
            />
            <MotionButton
              className="run-button"
              disabled={busy || !state.head || !state.files.length || state.files.some((f) => f.conflict)}
              onClick={() => void save()}
            >
              <Archive size={15} />
              贮藏当前改动
            </MotionButton>
          </div>
        )}
        <div className="git-rows">
          {state.stashes.map((s) => (
            <button
              className="git-commit-row"
              key={s.ref}
              aria-pressed={s.ref === current?.ref}
              onClick={() => select(s)}
            >
              <Archive size={15} />
              <span>
                <strong title={s.message}>{s.message}</strong>
                <small>
                  {s.ref} · {s.date.slice(0, 10)}
                </small>
              </span>
            </button>
          ))}
          {!current && <p className="git-quiet">尚无贮藏记录。</p>}
        </div>
      </section>
      <PatchView key={current?.id} portal={portal} id={id} stash={current?.id} generation={generation} />
    </div>
  );
}
