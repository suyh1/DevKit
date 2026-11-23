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
  const [selected, select] = useState(''),
    [message, setMessage] = useState('');
  const confirm = useConfirmation();
  const current = state.stashes.find((item) => item.id === selected) ?? state.stashes[0];
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
  async function apply() {
    if (
      !current ||
      !(await confirm({
        title: '应用这条贮藏？',
        context: state.branch,
        confirm: '应用贮藏',
        detail: '将改动及原暂存状态恢复到当前分支。贮藏记录会保留，如有冲突可在工作区检查。',
      }))
    )
      return;
    await mutate('stash-apply', { stash: current.id }, '已应用贮藏');
  }
  return (
    <div className="git-split devkit-bento">
      <section className="git-panel">
        <header>
          <h3>贮藏记录</h3>
          <small>最近 {state.stashes.length} 条</small>
        </header>
        <div className="git-rows">
          {state.stashes.map((s) => (
            <button
              className="git-commit-row"
              key={s.ref}
              aria-pressed={s.id === current?.id}
              onClick={() => select(s.id)}
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
        {edit && (
          <div className="git-compose">
            {current && (
              <MotionButton
                className="secondary-button"
                disabled={busy || !!state.files.length}
                onClick={() => void apply()}
              >
                <ArchiveRestore size={15} />
                应用选中的贮藏
              </MotionButton>
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
      </section>
      <PatchView key={current?.id} portal={portal} id={id} stash={current?.id} generation={generation} />
    </div>
  );
}
