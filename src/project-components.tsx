import { MotionButton } from './Motion';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { AlertCircle, Copy, X } from "lucide-react";
import { resolveProject } from "../shared/projects.mjs";
import type { Profile, Project, ProjectState } from "../shared/projects.mjs";

const CloseDialog = createContext(() => {});
export function Modal({
  title,
  close,
  children,
  draft,
  busy = false,
  wide = false,
  savedKey = 0,
  feedback,
  closeLabel = "关闭项目中心窗口",
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  draft?: unknown;
  busy?: boolean;
  wide?: boolean;
  savedKey?: number;
  feedback?: string;
  closeLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    heading = useId();
  const baseline = useRef(JSON.stringify(draft));
  const [discard, setDiscard] = useState(false);
  const previousSaved = useRef(savedKey);
  if (previousSaved.current !== savedKey) {
    baseline.current = JSON.stringify(draft);
    previousSaved.current = savedKey;
  }
  const dirty =
    draft !== undefined && JSON.stringify(draft) !== baseline.current;
  const requestClose = () => {
    if (!busy) {
      if (dirty) setDiscard(true);
      else close();
    }
  };
  useEffect(() => {
    const before = document.activeElement;
    ref.current?.showModal();
    ref.current
      ?.querySelector<HTMLInputElement>("input:not([type=checkbox]), select")
      ?.focus();
    return () => {
      if (before instanceof HTMLElement && before.isConnected && !document.querySelector('dialog[open]')) before.focus();
    };
  }, []);
  useEffect(() => {
    if (discard)
      ref.current
        ?.querySelector<HTMLButtonElement>(".pc-discard button")
        ?.focus();
  }, [discard]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);
  return (
    <CloseDialog.Provider value={requestClose}>
      <dialog
        ref={ref}
        className={`pc-dialog ${wide ? "pc-dialog-wide" : ""}`}
        aria-labelledby={heading}
        aria-busy={busy}
        onCancel={(event) => {
          event.preventDefault();
          requestClose();
        }}
      >
        <header>
          <div>
            <h2 id={heading}>{title}</h2>
            {dirty && <small className="pc-draft-state">有未保存的更改</small>}
            {feedback && (
              <small className="pc-inline-feedback" role="status">
                {feedback}
              </small>
            )}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={closeLabel}
            disabled={busy}
            onClick={requestClose}
          >
            <X size={18} />
          </button>
        </header>
        {discard && (
          <div className="pc-discard" role="alert">
            <AlertCircle size={18} />
            <div>
              <strong>放弃尚未保存的更改？</strong>
              <p>返回可继续编辑；放弃后本次草稿不会保存。</p>
              <div className="pc-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setDiscard(false)}
                >
                  继续编辑
                </button>
                <button
                  type="button"
                  className="pc-danger-button"
                  onClick={close}
                >
                  放弃更改
                </button>
              </div>
            </div>
          </div>
        )}
        <fieldset className="pc-modal-content" disabled={busy}>
          {children}
        </fieldset>
      </dialog>
    </CloseDialog.Provider>
  );
}
export function ModalCancel({
  children = "取消",
}: {
  children?: React.ReactNode;
}) {
  const close = useContext(CloseDialog);
  return (
    <button type="button" className="secondary-button" onClick={close}>
      {children}
    </button>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="pc-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function UrlPreview({
  project,
  profile,
  copy,
}: {
  project: Project;
  profile: Profile;
  copy: (value: string) => Promise<void>;
}) {
  const result = resolveProject(project, profile),
    parsed = result.url ? new URL(result.url) : null;
  return (
    <section className="pc-preview" aria-label="最终地址预览">
      <div className="pc-section-title">
        <strong>当前档案的地址预览 · {profile.name}</strong>
        <MotionButton variant="copy"
          type="button"
          className="text-button"
          disabled={!result.url}
          onClick={() => void copy(result.url)}
        >
          <Copy size={13} />
          复制
        </MotionButton>
      </div>
      <code className={result.error ? "pc-invalid" : ""}>
        {result.error || result.url}
      </code>
      {parsed && (
        <>
          <dl className="pc-url-parts">
            <div>
              <dt>协议 / 主机</dt>
              <dd>{parsed.origin}</dd>
            </div>
            <div>
              <dt>路径</dt>
              <dd>{parsed.pathname}</dd>
            </div>
            {parsed.hash && (
              <div>
                <dt>锚点</dt>
                <dd>{parsed.hash}</dd>
              </div>
            )}
          </dl>
          {parsed.search && (
            <div className="pc-query-preview">
              <span>最终查询参数（已解码）</span>
              {[...parsed.searchParams].map(([key, value], index) => (
                <div key={index}>
                  <code>{key || "（空名称）"}</code>
                  <code>{value || "（空值）"}</code>
                </div>
              ))}
            </div>
          )}
          <p className="pc-hint">
            {parsed.pathname === "/"
              ? "域名后的 / 表示根路径，自动补全属于正常 URL 格式。"
              : "路径来自地址模板。"}
            查询参数只按填写内容拼接，是否有效取决于目标服务。
          </p>
          {result.localOnly && (
            <p className="pc-hint">
              本机地址指向访问者自己的电脑；共享给其他电脑时请使用服务的实际内网
              IP。
            </p>
          )}
        </>
      )}
    </section>
  );
}
export function StateChanges({
  current,
  next,
}: {
  current: ProjectState;
  next: ProjectState;
}) {
  const diff = <T,>(before: T[], after: T[], key: (value: T) => string) => {
    const old = new Map(before.map((item) => [key(item), item])),
      incoming = new Set(after.map(key));
    return {
      added: after.filter((item) => !old.has(key(item))).length,
      updated: after.filter(
        (item) =>
          old.has(key(item)) &&
          JSON.stringify(old.get(key(item))) !== JSON.stringify(item),
      ).length,
      removed: before.filter((item) => !incoming.has(key(item))).length,
    };
  };
  const scopedProjects = (state: ProjectState) =>
    state.profiles.flatMap(profile => profile.projects.map(project => ({
      ...project,
      identity: JSON.stringify([profile.name, project.code]),
    })));
  const projects = diff(scopedProjects(current), scopedProjects(next), item => item.identity),
    profiles = diff(current.profiles, next.profiles, (item) => item.name);
  return (
    <div className="pc-change-grid">
      {[
        ["项目", projects],
        ["配置档案", profiles],
      ].map(([title, value]) => {
        const counts = value as typeof projects;
        return (
          <div key={title as string}>
            <strong>{title as string}</strong>
            <p>
              新增 {counts.added} · 更新 {counts.updated} · 移除{" "}
              {counts.removed}
            </p>
          </div>
        );
      })}
    </div>
  );
}
