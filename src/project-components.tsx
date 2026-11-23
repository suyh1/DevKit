import { MotionButton } from './Motion';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AlertCircle, Copy, X } from "lucide-react";
import { resolveProject } from "../shared/projects.mjs";
import type { Profile, Project, ProjectState } from "../shared/projects.mjs";

const CloseDialog = createContext(() => {});

/** Keep native submission and validation, with actions outside the scrolling fields. */
export function ModalForm({ children, footer, className = "", ...props }: React.ComponentProps<"form"> & {
  footer: React.ReactNode;
}) {
  return (
    <form {...props} className={`pc-modal-frame ${className}`}>
      <div className="pc-modal-body">{children}</div>
      {footer}
    </form>
  );
}

export function Modal({
  title,
  description,
  close,
  children,
  footer,
  draft,
  busy = false,
  active = true,
  wide = false,
  savedKey = 0,
  feedback,
  className = "",
  icon,
  closeLabel = "关闭项目中心窗口",
}: {
  title: string;
  description?: string;
  close: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  draft?: unknown;
  busy?: boolean;
  active?: boolean;
  wide?: boolean;
  savedKey?: number;
  feedback?: string;
  className?: string;
  icon?: React.ReactNode;
  closeLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    heading = useId(),
    descriptionId = useId();
  const lastField = useRef<HTMLElement>(null);
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
      if (dirty) {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && ref.current?.contains(focused) && focused.matches("input, select, textarea, [contenteditable=true]")) lastField.current = focused;
        setDiscard(true);
      } else close();
    }
  };
  useEffect(() => {
    const dialog = ref.current;
    if (!active || !dialog) return;
    const before = document.activeElement;
    dialog.showModal();
    const initial = ref.current?.querySelector<HTMLElement>("[data-modal-focus]") ||
      ref.current?.querySelector<HTMLElement>("input:not([type=checkbox]), select");
    initial?.focus();
    return () => {
      dialog.close();
      if (before instanceof HTMLElement && before.isConnected && !document.querySelector('dialog[open]')) before.focus();
    };
  }, [active]);
  const returningToDraft = useRef(false);
  useLayoutEffect(() => {
    if (discard) {
      returningToDraft.current = true;
      ref.current?.querySelector<HTMLButtonElement>(".pc-discard button")?.focus();
    } else if (returningToDraft.current) {
      returningToDraft.current = false;
      const target = lastField.current;
      (target?.isConnected && !target.matches(":disabled") ? target : ref.current?.querySelector<HTMLButtonElement>("header button"))?.focus();
    }
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
        className={`pc-dialog ${wide ? "pc-dialog-wide" : ""} ${className}`}
        aria-labelledby={heading}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy}
        onFocusCapture={event => {
          if (event.target.matches("input, select, textarea, [contenteditable=true]")) lastField.current = event.target;
        }}
        onCancel={(event) => {
          event.preventDefault();
          requestClose();
        }}
      >
        <header>
          <div>
            {icon && <span className="pc-dialog-icon" aria-hidden="true">{icon}</span>}
            <h2 id={heading}>{title}</h2>
            {description && <p className="pc-dialog-description" id={descriptionId}>{description}</p>}
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
          <div className={footer ? "pc-modal-body" : "pc-modal-slot"}>{children}</div>
          {footer}
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
