import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import ProjectCenter from "./ProjectCenter";
import NginxCenter from "./NginxCenter";
import HttpWorkbench from "./HttpWorkbench";
import { ConfirmationProvider, useConfirmation } from "./Confirmation";
import { projectRequest } from "./project-api";
import type { Session } from "./project-api";
import { setRemoteAccess } from "./workspace-remote";
import "./theme.css";
import "./workspace-portal.css";

function Portal() {
  const [session, setSession] = useState<Session | null>(null);
  const [password, setPassword] = useState(""),
    [message, setMessage] = useState("");
  const [page, setPage] = useState("projects"),
    [busy, setBusy] = useState(false);
  const confirm = useConfirmation();
  function adopt(value: Session) {
    setRemoteAccess(value.authenticated ? value : null);
    setSession(value);
  }
  useEffect(() => {
    void projectRequest<Session>("session")
      .then(adopt)
      .catch((error) => setMessage(error.message));
  }, []);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      adopt(await projectRequest<Session>("login", { password }));
      setPassword("");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    if (
      !(await confirm({
        title: "退出共享工作台？",
        detail:
          "当前页面的草稿、响应和会话历史会关闭，进行中的 HTTP 请求会取消。",
        confirm: "退出",
        context: "局域网共享",
      }))
    )
      return;
    try {
      await projectRequest("logout");
      adopt({ authenticated: false, role: "viewer" });
      setPage("projects");
      setMessage("");
    } catch (error) {
      setMessage((error as Error).message);
    }
  }
  if (!session?.authenticated)
    return (
      <main className="workspace-portal portal-login">
        <form onSubmit={(event) => void login(event)}>
          <h1>DevKit 共享工作台</h1>
          <p>输入主机设置的访问口令。</p>
          <label>
            访问口令
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="run-button" disabled={busy || !session}>
            {busy ? "正在登录…" : "登录"}
          </button>
          {message && <p role="alert">{message}</p>}
        </form>
      </main>
    );
  return (
    <main className="workspace-portal">
      <header className="portal-bar">
        <strong>DevKit 共享工作台</strong>
        <nav aria-label="共享模块">
          {[
            ["projects", "项目中心", true],
            ["nginx", "Nginx 配置", session.shareNginx],
            ["http", "HTTP 调试", session.shareHttp],
          ]
            .filter((row) => row[2])
            .map(([id, label]) => (
              <button
                key={String(id)}
                className="secondary-button"
                aria-current={page === id ? "page" : undefined}
                onClick={() => setPage(String(id))}
              >
                {label}
              </button>
            ))}
        </nav>
        <button className="text-button" onClick={() => void logout()}>
          退出登录
        </button>
      </header>
      <p className="portal-access">
        {session.role === "viewer"
          ? "只读访问：可浏览共享内容，不能保存或执行请求。"
          : "协作编辑：保存与执行操作作用于共享主机。"}{" "}
        请求中的 localhost 和所有文件路径均指共享主机。
        {session.shareNginx &&
          !session.nginxControl &&
          " Nginx 运行操作未开放。"}
      </p>
      {message && <p role="status">{message}</p>}
      <div hidden={page !== "projects"} inert={page !== "projects"}>
        <ProjectCenter portal onLogout={() => void logout()} />
      </div>
      {session.shareNginx && (
        <div hidden={page !== "nginx"} inert={page !== "nginx"}>
          <NginxCenter active={page === "nginx"} />
        </div>
      )}
      {session.shareHttp && (
        <div hidden={page !== "http"} inert={page !== "http"}>
          <HttpWorkbench
            initial={null}
            onNotice={setMessage}
            onGenerate={() =>
              setMessage("请求代码生成请在桌面端使用，可先导出请求配置。")
            }
          />
        </div>
      )}
    </main>
  );
}
document.documentElement.dataset.theme = matchMedia(
  "(prefers-color-scheme: dark)",
).matches
  ? "dark"
  : "light";
createRoot(document.getElementById("root")!).render(
  <ConfirmationProvider>
    <Portal />
  </ConfirmationProvider>,
);
