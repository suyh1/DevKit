import { useEffect, useState } from 'react';
import { Modal } from './project-components';
import { ArrowRight, ArrowUpFromLine, GitBranch, GitCommitHorizontal } from 'lucide-react';
import { useGitRead, type GitState, type GitMutation } from './git-api';
type Plan = {
  token: string;
  remote: string;
  target: string;
  first: boolean;
  total: number;
  incoming: number;
  commits: string[];
};

export default function GitDelivery({
  state,
  id,
  portal,
  busy,
  generation,
  mutate,
  initialOpen = false,
  request,
}: {
  request: number;
  initialOpen?: boolean;
  state: GitState;
  id: string;
  portal: boolean;
  busy: boolean;
  generation: number;
  mutate: GitMutation;
}) {
  const [open, setOpen] = useState(initialOpen),
    [choice, setChoice] = useState('');
  useEffect(() => {
    if (request) {
      setOpen(true);
    }
  }, [request]);
  const upstream = state.remotes
    .filter((r) => state.upstream.startsWith(r + '/'))
    .sort((a, b) => b.length - a.length)[0];
  const remote = upstream || (state.remotes.includes(choice) ? choice : state.remotes[0]) || '';
  const ready = !!remote && !!state.head && state.branch !== '(detached)' && !state.mergeHead;
  const {
    data: plan,
    loading,
    error,
  } = useGitRead<Plan>(portal, 'push-plan', { id, remote }, open && ready, generation);
  const title = state.upstream ? '推送提交' : '首次发布分支';
  return (
    <section className="git-delivery">
      <div className="git-delivery-bar">
        <div className="git-route">
          <span>
            <GitBranch size={15} />
            {state.branch}
          </span>
          <ArrowRight size={15} />
          <strong>{state.upstream || (remote ? remote + '/' + state.branch : '暂无远端')}</strong>
        </div>
        <button className="git-push" aria-haspopup="dialog" disabled={busy || !ready} onClick={() => setOpen(!open)}>
          <ArrowUpFromLine size={15} />
          {title}
          {!!state.upstream && state.ahead > 0 && <b>{state.ahead}</b>}
        </button>
      </div>
      {!ready && (
        <small>
          {!remote ? '请在主机配置远端。' : state.mergeHead ? '完成合并后即可推送。' : '创建分支提交后即可推送。'}
        </small>
      )}
      {open && ready && (
        <Modal
          title="推送预览"
          description={state.branch + ' → ' + (state.upstream || remote + '/' + state.branch)}
          closeLabel="关闭推送预览"
          close={() => setOpen(false)}
          busy={busy}
          className="git-push-dialog"
        >
          <div className="git-push-preview">
            <label>
              目标远端
              <select disabled={!!upstream || busy} value={remote} onChange={(e) => setChoice(e.target.value)}>
                {state.remotes.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            {error ? (
              <p role="alert">{error}</p>
            ) : !plan ? (
              <p role="status">正在核对待推送提交…</p>
            ) : (
              <>
                <div>
                  <h3>
                    {plan.first ? '发布到新上游' : '推送至'}{' '}
                    <code>
                      {plan.remote}/{plan.target}
                    </code>
                  </h3>
                  <small>按本机远端记录计算 · {plan.total} 个待发送提交</small>
                </div>
                {plan.commits.length > 0 && (
                  <ul>
                    {plan.commits.map((c) => (
                      <li key={c}>
                        <GitCommitHorizontal size={14} />
                        {c}
                      </li>
                    ))}
                  </ul>
                )}
                {plan.incoming > 0 && <p role="status">远端有 {plan.incoming} 个本地未包含的提交，请先整合。</p>}
                <button
                  className="run-button"
                  disabled={busy || loading || plan.incoming > 0 || (!plan.total && !plan.first)}
                  onClick={async () => {
                    if (
                      await mutate(
                        'push',
                        { remote, token: plan.token },
                        plan.first ? '分支已推送并设置上游' : '推送完成',
                      )
                    )
                      setOpen(false);
                  }}
                >
                  <ArrowUpFromLine size={15} />
                  {plan.first ? '推送并设置上游' : plan.total ? '确认推送 ' + plan.total + ' 个提交' : '已与上游同步'}
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
