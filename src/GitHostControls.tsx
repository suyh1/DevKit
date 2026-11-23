import { useEffect, useState } from 'react';
import { FolderDown, ShieldCheck } from 'lucide-react';
import { gitRequest, type Repository, type RepoLevel, type RepoPolicy } from './git-api';
import { projectRequest, type Sharing } from './project-api';
const labels: Record<RepoLevel, string> = {
  none: '不可访问',
  history: '仅提交历史',
  worktree: '查看历史、工作区和贮藏',
  edit: '工作区读写',
  sync: '查看与远端同步',
  collaborate: '读写与同步',
};
function Levels({ value, onChange, label }: { value: RepoLevel; onChange: (v: RepoLevel) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as RepoLevel)}>
      {Object.entries(labels).map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
export function RepoGrants({ repo, onSaved }: { repo: Repository; onSaved: () => void }) {
  const [policy, setPolicy] = useState<RepoPolicy>(repo.policy || { default: 'history', visitors: [] }),
    [visitors, setVisitors] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [notice, report] = useState('');
  useEffect(() => {
    let live = true;
    projectRequest<Sharing>('sharing').then(
      (s) => {
        if (live) setVisitors((s.visitors || []).map((v) => v.name));
      },
      (e) => {
        if (live) report(e.message);
      },
    );
    return () => {
      live = false;
    };
  }, []);
  const names = [...new Set([...visitors, ...policy.visitors.map((v) => v.name)])];
  return (
    <details className="git-host-panel">
      <summary>
        <ShieldCheck size={15} />
        仓库访问权限
      </summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await gitRequest(false, 'policy', { id: repo.id, policy });
            onSaved();
            report('仓库授权已保存');
          } catch (e) {
            report((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>栏目权限和仓库权限同时生效。单独指定访客时，可把默认权限设为「不可访问」。</p>
        <label>
          通用口令及未单独配置的访客
          <Levels value={policy.default} onChange={(v) => setPolicy({ ...policy, default: v })} label="默认仓库权限" />
        </label>
        {names.map((name) => {
          const grant = policy.visitors.find((v) => v.name === name);
          return (
            <label key={name}>
              {name}
              <select
                aria-label={name + '的仓库权限'}
                value={grant?.level || ''}
                onChange={(e) =>
                  setPolicy({
                    ...policy,
                    visitors: [
                      ...policy.visitors.filter((v) => v.name !== name),
                      ...(e.target.value ? [{ name, level: e.target.value as RepoLevel }] : []),
                    ],
                  })
                }
              >
                <option value="">继承默认权限</option>
                {Object.entries(labels).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        {!names.length && <small>在局域网共享设置中添加命名访客后，可在这里逐人授权。</small>}
        <button className="secondary-button" disabled={busy}>
          保存仓库权限
        </button>
        {notice && <small role="status">{notice}</small>}
      </form>
    </details>
  );
}
export function CloneRepo({ onAdded, initialSource }: { initialSource?: string; onAdded: (repo: Repository) => void }) {
  const [source, setSource] = useState(initialSource || ''),
    [parent, setParent] = useState(''),
    [busy, setBusy] = useState(false),
    [error, report] = useState('');
  useEffect(() => {
    if (initialSource) setSource(initialSource);
  }, [initialSource]);
  return (
    <details open={initialSource !== undefined || undefined} className="git-host-panel">
      <summary>
        <FolderDown size={15} />
        克隆仓库
      </summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          report('');
          try {
            const list = await gitRequest<Repository[]>(false, 'clone', { source: source.trim(), parent });
            onAdded(list[list.length - 1]);
            setSource('');
            setParent('');
          } catch (e) {
            report((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          仓库地址
          <input
            placeholder="https://host/team/project.git"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            required
          />
        </label>
        <label>
          保存到
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={async () => {
              try {
                const dir = await gitRequest<string>(false, 'choose-parent');
                if (dir) setParent(dir);
              } catch (e) {
                report((e as Error).message);
              }
            }}
          >
            {parent || '选择父目录'}
          </button>
        </label>
        <button className="run-button" disabled={busy || !parent || !source.trim()}>
          {busy ? '正在克隆…' : '克隆并登记'}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}
