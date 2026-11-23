import { useEffect, useState } from 'react';
import { FolderDown, ShieldCheck, Users } from 'lucide-react';
import { gitRequest, type Repository, type RepoLevel, type RepoPolicy } from './git-api';
import { Modal, ModalCancel, ModalForm } from './project-components';
import { pathSuffix } from './PathSummary';
import { projectRequest, type Sharing } from './project-api';
const labels: Record<RepoLevel, string> = {
  none: '不可访问',
  history: '仅提交历史',
  worktree: '查看历史、工作区和贮藏',
  edit: '工作区读写',
  sync: '查看与远端同步',
  collaborate: '读写与同步',
};
export function RepoGrants({ repo, onSaved }: { repo: Repository; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="text-button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <ShieldCheck size={15} />
        仓库访问权限
      </button>
      {open && <GrantsDialog repo={repo} close={() => setOpen(false)} onSaved={onSaved} />}
    </>
  );
}

function GrantsDialog({ repo, close, onSaved }: { repo: Repository; close: () => void; onSaved: () => void }) {
  const [policy, setPolicy] = useState<RepoPolicy>(repo.policy ?? { default: 'history', visitors: [] });
  const [visitors, setVisitors] = useState<string[]>();
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    let live = true;
    projectRequest<Sharing>('sharing').then(
      (s) => {
        if (live) setVisitors((s.visitors || []).map((v) => v.name));
      },
      (e) => {
        if (live) setLoadError(e.message);
      },
    );
    return () => {
      live = false;
    };
  }, []);
  const names = [...new Set([...(visitors ?? []), ...policy.visitors.map((v) => v.name)])];
  const options = Object.entries(labels).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
  return (
    <Modal
      title="仓库访问权限"
      description={repo.name}
      icon={<ShieldCheck size={20} />}
      closeLabel="关闭仓库访问权限"
      className="git-grants-dialog"
      close={close}
      draft={policy}
      busy={busy}
    >
      <ModalForm
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setSaveError('');
          try {
            await gitRequest(false, 'policy', { id: repo.id, policy });
            onSaved();
            close();
          } catch (error) {
            setSaveError((error as Error).message);
            setBusy(false);
          }
        }}
        footer={
          <footer className="pc-form-footer">
            <ModalCancel />
            <button className="run-button" type="submit" disabled={busy}>
              {busy ? '正在保存…' : '保存仓库权限'}
            </button>
          </footer>
        }
      >
        <div className="git-grants-default">
          <label htmlFor="git-default-grant">默认权限</label>
          <p>使用通用口令或未单独授权的访客按此设置访问。</p>
          <select
            id="git-default-grant"
            aria-label="默认仓库权限"
            value={policy.default}
            onChange={(e) => setPolicy({ ...policy, default: e.target.value as RepoLevel })}
          >
            {options}
          </select>
        </div>
        <section className="git-visitor-grants" aria-label="访客例外">
          <h3>
            <Users size={16} />
            访客例外
          </h3>
          {names.map((name) => (
            <label key={name}>
              <span>{name}</span>
              <select
                aria-label={name + '的仓库权限'}
                value={policy.visitors.find((v) => v.name === name)?.level ?? ''}
                onChange={(e) => {
                  const level = e.target.value as RepoLevel | '';
                  setPolicy({
                    ...policy,
                    visitors: [...policy.visitors.filter((v) => v.name !== name), ...(level ? [{ name, level }] : [])],
                  });
                }}
              >
                <option value="">继承默认权限</option>
                {options}
              </select>
            </label>
          ))}
          {loadError ? (
            <p role="alert">{loadError}</p>
          ) : (
            !names.length && (
              <p>{visitors ? '在局域网共享设置中添加命名访客后，可在这里逐人授权。' : '正在读取访客…'}</p>
            )
          )}
        </section>
        <p className="git-grants-note">实际访问范围同时受共享栏目的编辑和同步权限限制。</p>
        {saveError && (
          <p className="git-error" role="alert">
            {saveError}
          </p>
        )}
      </ModalForm>
    </Modal>
  );
}
export function CloneRepo({ onAdded, initialSource }: { initialSource?: string; onAdded: (repo: Repository) => void }) {
  const [open, setOpen] = useState(!!initialSource);
  useEffect(() => {
    if (initialSource) setOpen(true);
  }, [initialSource]);
  return (
    <>
      <button className="secondary-button" type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <FolderDown size={15} />
        克隆仓库
      </button>
      {open && (
        <CloneDialog key={initialSource} initialSource={initialSource} close={() => setOpen(false)} onAdded={onAdded} />
      )}
    </>
  );
}

function CloneDialog({
  onAdded,
  initialSource = '',
  close,
}: {
  initialSource?: string;
  onAdded: (repo: Repository) => void;
  close: () => void;
}) {
  const [source, setSource] = useState(initialSource),
    [parent, setParent] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal
      title="克隆仓库"
      icon={<FolderDown size={20} />}
      close={close}
      busy={busy}
      closeLabel="关闭克隆仓库"
      className="git-clone-dialog"
    >
      <ModalForm
        onSubmit={async (event) => {
          event.preventDefault();
          if (!source.trim() || !parent || busy) return;
          setBusy(true);
          setError('');
          try {
            const list = await gitRequest<Repository[]>(false, 'clone', { source: source.trim(), parent });
            onAdded(list[list.length - 1]);
            close();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
        footer={
          <footer className="pc-form-footer">
            <ModalCancel />
            <button className="run-button" disabled={busy || !parent || !source.trim()}>
              {busy ? '正在克隆…' : '克隆并登记'}
            </button>
          </footer>
        }
      >
        <label className="pc-field">
          <span>仓库地址</span>
          <input
            placeholder="HTTPS、SSH 或本地仓库路径"
            value={source}
            required
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <div className="pc-field">
          <span>保存到</span>
          <button
            type="button"
            className="secondary-button"
            onClick={async () => {
              try {
                const dir = await gitRequest<string>(false, 'choose-parent');
                if (dir) setParent(dir);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <span className="git-clone-parent" title={parent}>{parent ? pathSuffix(parent) : '选择父目录'}</span>
          </button>
        </div>
        {error && (
          <p role="alert" className="git-error">
            {error}
          </p>
        )}
      </ModalForm>
    </Modal>
  );
}
