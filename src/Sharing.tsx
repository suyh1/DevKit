import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Globe, RefreshCw } from "lucide-react";
import { isProjectDesktop, projectRequest } from "./project-api";
import type { Sharing } from "./project-api";
import { Modal, Field } from "./project-components";
import { MotionButton, MotionPresence } from "./Motion";
import { copyText } from "./motion-primitives";
import "./sharing.css";

type SharingContextValue = {
  status: Sharing | null;
  error: string;
  open: () => void;
};
const SharingContext = createContext<SharingContextValue | null>(null);

export function SharingProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Sharing | null>(null),
    [error, setError] = useState(""),
    [opened, setOpened] = useState(false);
  const generation = useRef(0),
    alive = useRef(true);
  const accept = useCallback((value: Sharing) => {
    generation.current++;
    if (alive.current) {
      setStatus(value);
      setError("");
    }
  }, []);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const value = await projectRequest<Sharing>("sharing");
      if (alive.current && request === generation.current) {
        setStatus(value);
        setError("");
      }
      return value;
    } catch (failure) {
      if (alive.current && request === generation.current)
        setError((failure as Error).message);
      throw failure;
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    if (!isProjectDesktop()) return;
    const update = () => {
      if (!document.hidden) void refresh().catch(() => {});
    };
    update();
    const timer = setInterval(update, 5000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      alive.current = false;
      generation.current++;
      clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [refresh]);
  return (
    <SharingContext.Provider
      value={{ status, error, open: () => setOpened(true) }}
    >
      {children}
      <MotionPresence kind="dialog" present={opened}>
        {opened && (
          <SharingPanel
            close={() => setOpened(false)}
            refresh={refresh}
            accept={accept}
          />
        )}
      </MotionPresence>
    </SharingContext.Provider>
  );
}

export function SharingButton({ global = false }: { global?: boolean }) {
  const context = useContext(SharingContext);
  if (!context || !isProjectDesktop()) return null;
  const { status, error, open } = context;
  const state = error
    ? "unknown"
    : !status
      ? "loading"
      : status.running
        ? "running"
        : "stopped";
  const description = error
    ? "共享状态读取失败"
    : !status
      ? "正在读取共享状态"
      : status.running
        ? `共享中 · 端口 ${status.port}`
        : "共享未开启";
  return (
    <button
      type="button"
      className={
        global ? "global-sharing-button" : "secondary-button sharing-shortcut"
      }
      data-sharing-state={state}
      aria-label={global ? `局域网共享：${description}` : "共享设置"}
      aria-haspopup="dialog"
      title={`局域网共享 · ${description}${status?.running ? "\n" + status.addresses.join("\n") : ""}`}
      onClick={open}
    >
      <Globe size={15} />
      <span>
        {global
          ? status?.running && !error
            ? "共享中"
            : "局域网共享"
          : "共享设置"}
      </span>
      {global && <i aria-hidden="true" />}
    </button>
  );
}

function SharingPanel({
  close,
  refresh,
  accept,
}: {
  close: () => void;
  refresh: () => Promise<Sharing>;
  accept: (value: Sharing) => void;
}) {
  const [draft, setDraft] = useState<Sharing | null>(null),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(true);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [saved, setSaved] = useState(0);
  const locked = useRef(false);
  const panel = useRef<HTMLDivElement>(null), ready = draft !== null;
  useEffect(() => { if (ready) panel.current?.querySelector<HTMLSelectElement>('select')?.focus(); }, [ready]);
  const fields = draft
    ? {
        host: draft.host,
        port: draft.port,
        canEdit: draft.canEdit,
        shareNginx: draft.shareNginx,
        shareHttp: draft.shareHttp,
        nginxControl: draft.nginxControl,
        autoStart: draft.autoStart,
        password,
      }
    : undefined;
  useEffect(() => {
    let active = true;
    void refresh()
      .then((value) => {
        if (active) {
          setDraft(value);
          setSaved((value) => value + 1);
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  async function apply(action: "start" | "stop") {
    if (locked.current || !draft) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const value = await projectRequest<Sharing>(
        action,
        action === "start" ? fields : undefined,
      );
      accept(value);
      setDraft(value);
      setPassword("");
      setSaved((value) => value + 1);
      setMessage(
        action === "start"
          ? "工作台共享已启动，原有访客需重新登录。"
          : "共享已停止，自动启动已关闭。",
      );
    } catch (failure) {
      setError((failure as Error).message);
      try {
        const value = await refresh();
        setDraft((current) =>
          current
            ? { ...current, running: value.running, addresses: value.addresses }
            : value,
        );
      } catch {}
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="sharing-panel" ref={panel}>
      <Modal
        title="局域网共享"
        closeLabel="关闭共享设置"
        close={close}
        busy={busy}
        draft={fields}
        savedKey={saved}
        feedback={message}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void apply("start");
          }}
        >
          {error && (
            <p className="pc-error" role="alert">
              {error}
            </p>
          )}
          {!draft ? (
            <>
              <p role="status">
                {busy ? "正在读取共享设置…" : "无法读取共享设置。请重试。"}
              </p>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError("");
                  void refresh()
                    .then((value) => {
                      setDraft(value);
                      setSaved((value) => value + 1);
                    })
                    .catch((error) => setError(error.message))
                    .finally(() => setBusy(false));
                }}
              >
                <RefreshCw size={14} />
                重试
              </button>
            </>
          ) : (
            <>
              <p>
                统一管理项目中心、Nginx 配置和 HTTP
                调试的局域网访问。所有路径、文件与运行命令都属于这台主机，退出
                DevKit 会停止共享。
              </p>
              <fieldset disabled={busy} className="sharing-fields">
                <div className="pc-form-grid">
                  <Field label="监听范围">
                    <select
                      value={draft.host}
                      onChange={(event) =>
                        setDraft({ ...draft, host: event.target.value })
                      }
                    >
                      <option value="0.0.0.0">局域网（所有 IPv4 网卡）</option>
                      <option value="127.0.0.1">仅本机（用于测试）</option>
                    </select>
                  </Field>
                  <Field label="端口">
                    <input
                      type="number"
                      required
                      min={1}
                      max={65535}
                      value={draft.port}
                      onChange={(event) =>
                        setDraft({ ...draft, port: Number(event.target.value) })
                      }
                    />
                  </Field>
                </div>
                <Field
                  label={
                    draft.hasPassword
                      ? "更换访问口令（留空保留）"
                      : "首次访问口令（至少 8 位）"
                  }
                >
                  <input
                    type="password"
                    autoComplete="new-password"
                    required={!draft.hasPassword}
                    minLength={8}
                    maxLength={128}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
                <h3>开放模块</h3>
                <p className="pc-hint">
                  项目中心随共享服务开放，Nginx 与 HTTP 可分别开启。
                </p>
                {(
                  [
                    ["shareNginx", "开放 Nginx 主机实例、路径配置与日志"],
                    ["shareHttp", "开放 HTTP 接口项目、文档、环境和调试"],
                  ] as const
                ).map(([key, label]) => (
                  <label className="pc-check" key={key}>
                    <input
                      type="checkbox"
                      checked={draft[key] === true}
                      onChange={(event) =>
                        setDraft({ ...draft, [key]: event.target.checked })
                      }
                    />
                    {label}
                  </label>
                ))}
                <h3>访问权限</h3>
                <label className="pc-check">
                  <input
                    type="checkbox"
                    checked={draft.canEdit}
                    onChange={(event) =>
                      setDraft({ ...draft, canEdit: event.target.checked })
                    }
                  />
                  允许持有口令的访客保存共享内容、恢复备份和发送 HTTP 请求
                </label>
                <label className="pc-check">
                  <input
                    type="checkbox"
                    checked={draft.nginxControl === true}
                    onChange={(event) =>
                      setDraft({ ...draft, nginxControl: event.target.checked })
                    }
                  />
                  允许主机程序检测及 Nginx 检查、启动、重载和停止（还需开放
                  Nginx 并允许编辑）
                </label>
                <label className="pc-check">
                  <input
                    type="checkbox"
                    checked={draft.autoStart}
                    onChange={(event) =>
                      setDraft({ ...draft, autoStart: event.target.checked })
                    }
                  />
                  下次启动 DevKit 时自动开启共享
                </label>
              </fieldset>
              <p className="pc-hint">
                默认只读。仅用于可信局域网，HTTP
                不加密；访问口令请单独设置。系统防火墙需允许所选端口入站。
              </p>
              <div className="pc-sharing-state">
                <strong>{draft.running ? "共享正在运行" : "共享已停止"}</strong>
                {draft.addresses.map((url) => (
                  <div key={url}>
                    <code>{url}</code>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        void copyText(url)
                          .then(() => setMessage("共享地址已复制。"))
                          .catch((error) => setError(String(error)))
                      }
                    >
                      复制地址
                    </button>
                  </div>
                ))}
                <small>数据目录：{draft.directory}</small>
              </div>
              <footer>
                {draft.running && (
                  <MotionButton
                    busy={busy}
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void apply("stop")}
                  >
                    停止共享
                  </MotionButton>
                )}
                <MotionButton
                  busy={busy}
                  className="run-button"
                  disabled={busy}
                >
                  {draft.running ? "应用设置并重启共享" : "开启共享"}
                </MotionButton>
              </footer>
            </>
          )}
        </form>
      </Modal>
    </div>
  );
}
