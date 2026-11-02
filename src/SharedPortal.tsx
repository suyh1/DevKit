import { themeStyles, normalizeThemeStyle } from './themes';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { SunMoon, LogOut, Copy, Download, Menu, X, FolderOpen, Server, Coffee, Activity, ScrollText, Send } from "lucide-react";
import ProjectCenter from "./ProjectCenter";
import NginxCenter from "./NginxCenter";
import JarCenter from './JarCenter';
import MonitorCenter from './MonitorCenter';
import LogCenter from './LogCenter';
import HttpWorkbench from "./HttpWorkbench";
import { useConfirmation } from "./Confirmation";
import { projectRequest } from "./project-api";
import type { Session } from "./project-api";
import { setRemoteAccess } from "./workspace-remote";
import { emptySharingServices, sharingServices } from "../shared/sharing.mjs";
import type { SharingServices } from "../shared/sharing.mjs";
import { Modal } from "./project-components";
import CodeEditor from "./CodeEditor";
import { httpCode } from "./http-code";
import { copyText } from "./motion-primitives";
import { saveText } from "./files";

const modules = [
  { id: "projects", name: "项目中心" },
  { id: "nginx", name: "Nginx 配置" },
  { id: "http", name: "HTTP 调试" },
  { id: 'jar', name: 'JAR 管理' },
  { id: 'monitor', name: '监控中心' },
  { id: 'logs', name: '日志中心' },
] as const;
type Page = keyof SharingServices;
type Theme = "system" | "light" | "dark";
const hashPage = () =>
  modules.find((module) => location.hash === "#" + module.id)?.id;
const pendingLogout = () => {
  try {
    return sessionStorage.getItem("devkit:logout-pending") === "true";
  } catch {
    return false;
  }
};
const connectionMessage = (error: unknown) =>
  error instanceof TypeError
    ? "无法连接共享主机，请检查网络、地址和共享状态后重试。"
    : (error as Error).message;
function preference(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Preferences do not prevent access to host data. */
  }
}

function PortalTheme() {
  const [themeStyle, setThemeStyle] = useState(() => normalizeThemeStyle(preference("devkit:portal-theme-style", "default")));
  useEffect(() => {
    document.documentElement.dataset.themeStyle = themeStyle;
    remember("devkit:portal-theme-style", themeStyle);
  }, [themeStyle]);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = preference("devkit:portal-theme", "system");
    return ["system", "light", "dark"].includes(saved)
      ? (saved as Theme)
      : "system";
  });
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    remember("devkit:portal-theme", theme);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return (
    <div className="portal-appearance">
      <label className="portal-theme">
        <span className="sr-only">主题风格</span>
        <select aria-label="共享页面主题风格" value={themeStyle} onChange={event => setThemeStyle(normalizeThemeStyle(event.target.value))}>
          {themeStyles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}
        </select>
      </label>
      <label className="portal-theme">
      <SunMoon size={16} aria-hidden="true" />
      <select
        aria-label="共享页面主题"
        value={theme}
        onChange={(event) => setTheme(event.target.value as Theme)}
      >
        <option value="system">跟随系统</option>
        <option value="light">浅色主题</option>
        <option value="dark">深色主题</option>
      </select>
      </label>
    </div>
  );
}

function RequestCode({ source, close }: { source: string; close: () => void }) {
  const [style, setStyle] = useState("fetch"),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [feedback, setFeedback] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    setFeedback("");
    void Promise.resolve()
      .then(() => httpCode(source, { style }))
      .then((value) => {
        if (active) setCode(value);
      })
      .catch((error) => {
        if (active) {
          setCode("");
          setError(error.message);
        }
      });
    return () => {
      active = false;
    };
  }, [source, style]);
  return (
    <Modal
      title="生成请求代码"
      closeLabel="关闭请求代码"
      close={close}
      wide
      feedback={feedback}
    >
      <p>
        在当前浏览器生成代码，不会发送请求。代码可能包含当前请求的鉴权和正文，请妥善保管。
      </p>
      <label>
        代码格式
        <select
          aria-label="请求代码格式"
          value={style}
          onChange={(event) => setStyle(event.target.value)}
        >
          <option value="fetch">Fetch</option>
          <option value="axios">Axios</option>
          <option value="curl">cURL（POSIX shell）</option>
        </select>
      </label>
      {error && (
        <p role="alert" className="pc-error">
          {error}
        </p>
      )}
      <CodeEditor
        label="生成的请求代码"
        value={code}
        language={style === "curl" ? "text" : "javascript"}
        readOnly
        wrap
      />
      <footer>
        <button
          className="secondary-button"
          disabled={!code}
          onClick={() =>
            void copyText(code)
              .then(() => setFeedback("代码已复制。"))
              .catch((error) => setError(String(error)))
          }
        >
          <Copy size={14} />
          复制代码
        </button>
        <button
          className="run-button"
          disabled={!code}
          onClick={() =>
            void saveText(code, style === "curl" ? "request.sh" : "request.js")
              .then(setFeedback)
              .catch((error) => setError(String(error)))
          }
        >
          <Download size={14} />
          导出代码
        </button>
      </footer>
    </Modal>
  );
}

export default function SharedPortal() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (drawerOpen) drawer.current?.showModal();
    else if (drawer.current?.open) drawer.current.close();
  }, [drawerOpen]);
  useEffect(() => {
    const desktop = matchMedia('(min-width:781px)'), resize = () => { if (desktop.matches) setDrawerOpen(false); };
    desktop.addEventListener('change', resize); return () => desktop.removeEventListener('change', resize);
  }, []);
  const [session, setSession] = useState<Session | null>(null),
    [page, setPage] = useState<Page>(
      () =>
        hashPage() || (preference("devkit:portal-page", "projects") as Page),
    );
  const [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(true),
    [reauth, setReauth] = useState(false),
    [source, setSource] = useState<string | null>(null);
  const confirm = useConfirmation();
  const bar = useRef<HTMLElement>(null),
    content = useRef<HTMLDivElement | null>(null),
    positions = useRef<Partial<Record<Page, number>>>({});
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null),
    [notice, setNotice] = useState("");
  const needsLogout = useRef(pendingLogout());
  const notify = useCallback((text: string) => setNotice(text), []);
  const attachContent = useCallback((node: HTMLDivElement | null) => {
    content.current = node;
    setScrollRoot(node);
  }, []);
  function rememberLogout(value: boolean) {
    needsLogout.current = value;
    try {
      if (value) sessionStorage.setItem("devkit:logout-pending", "true");
      else sessionStorage.removeItem("devkit:logout-pending");
    } catch {
      /* Keep the intent in memory. */
    }
  }
  function navigate(next: Page, push = true) {
    setDrawerOpen(false);
    if (content.current) positions.current[page] = content.current.scrollTop;
    if (push && location.hash !== "#" + next)
      history.pushState(null, "", "#" + next);
    setPage(next);
    remember("devkit:portal-page", next);
    setNotice("");
    setMessage("");
  }
  useLayoutEffect(() => {
    if (scrollRoot) scrollRoot.scrollTop = positions.current[page] || 0;
  }, [page, scrollRoot]);
  useLayoutEffect(() => {
    const header = bar.current;
    if (!header) return;
    const resize = new ResizeObserver(() =>
      header.parentElement?.style.setProperty(
        "--portal-bar-height",
        header.getBoundingClientRect().height + "px",
      ),
    );
    resize.observe(header);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    if (!session?.authenticated) return;
    const changed = () => {
      const requested = hashPage(),
        next =
          requested && session.services?.[requested].enabled
            ? requested
            : modules.find((module) => session.services?.[module.id].enabled)
                ?.id;
      if (next) {
        navigate(next, false);
        if (location.hash !== "#" + next)
          history.replaceState(null, "", "#" + next);
      }
    };
    window.addEventListener("popstate", changed);
    window.addEventListener("hashchange", changed);
    return () => {
      window.removeEventListener("popstate", changed);
      window.removeEventListener("hashchange", changed);
    };
  }, [session, page]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  function adopt(value: Session) {
    const normalized = value.authenticated
      ? {
          ...value,
          services:
            value.services ||
            sharingServices({ ...value, canEdit: value.role === "editor" }),
        }
      : value;
    setRemoteAccess(normalized.authenticated ? normalized : null);
    setSession(normalized);
    if (normalized.authenticated) {
      const requested = hashPage() || page;
      const next = normalized.services?.[requested]?.enabled
        ? requested
        : modules.find((module) => normalized.services?.[module.id].enabled)
            ?.id;
      if (next) {
        setPage(next);
        history.replaceState(null, "", "#" + next);
        remember("devkit:portal-page", next);
      }
    }
  }
  async function connect() {
    setBusy(true);
    setMessage("");
    try {
      if (needsLogout.current) {
        await projectRequest("logout");
        rememberLogout(false);
      }
      adopt(await projectRequest<Session>("session"));
    } catch (error) {
      if (needsLogout.current) adopt({ authenticated: false, role: "viewer" });
      setMessage(connectionMessage(error));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void connect();
  }, []);
  useEffect(() => {
    const expired = () => setReauth(true);
    window.addEventListener("devkit:session-required", expired);
    return () => window.removeEventListener("devkit:session-required", expired);
  }, []);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      adopt(await projectRequest<Session>("login", { password }));
      setPassword("");
      setReauth(false);
      rememberLogout(false);
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
    rememberLogout(true);
    let offline = false;
    try {
      await projectRequest("logout");
      rememberLogout(false);
    } catch {
      offline = true;
    } finally {
      adopt({ authenticated: false, role: "viewer" });
      setPassword("");
      setSource(null);
      setReauth(false);
      setNotice("");
      positions.current = {};
      setMessage(
        offline
          ? "已退出本页并清除草稿。暂未连上主机，恢复连接后会先注销旧会话。"
          : "",
      );
    }
  }
  const services = session?.services || emptySharingServices(),
    active = services[page],
    available = modules.filter((module) => services[module.id].enabled);
  const summary = !active?.enabled
    ? "没有可访问的服务"
    : [
        ('edit' in active && active.edit)
          ? "可编辑"
          : { projects: "项目只读", nginx: "配置只读", http: "接口定义只读", jar: '实例设置只读', monitor: '监控只读', logs: '日志只读' }[
              page
            ],
        page === "nginx" && services.nginx.control ? "可管理运行" : "",
        page === 'jar' && services.jar.control ? '可管理运行与控制台输入' : '',
        page === 'monitor' && services.monitor.control ? '可启停与立即检测' : '',
        page === "http" && services.http.send ? "可发送请求" : "",
        page === "projects" && services.projects.probe ? "可检测入口" : "",
      ]
        .filter(Boolean)
        .join(" · ");
  const loginForm = (
    <form onSubmit={(event) => void login(event)}>
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
      <button className="run-button" disabled={busy}>
        {busy ? "正在连接…" : "登录"}
      </button>
      {message && (
        <p role="alert" className="pc-error">
          {message}
        </p>
      )}
      {(!session || needsLogout.current) && !busy && (
        <button
          type="button"
          className="text-button"
          onClick={() => void connect()}
        >
          重试连接
        </button>
      )}
    </form>
  );
  return (
    <main className={`workspace-portal ${session?.authenticated ? 'portal-authenticated' : ''}`}>
      <header className="portal-bar" ref={bar}>
        {session?.authenticated && <button className="portal-menu-button secondary-button" aria-label="打开共享导航" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><Menu size={18} /></button>}
        <strong>DevKit 共享工作台</strong>
        <div className="portal-account">
          <PortalTheme />
          {session?.authenticated && (
            <button
              className="text-button portal-logout"
              onClick={() => void logout()}
            >
              <LogOut size={15} />
              退出登录
            </button>
          )}
        </div>
      </header>
      {session?.authenticated && <>
        <aside className="portal-sidebar"><span className="portal-nav-caption">共享工作台</span><PortalNavigation modules={available} page={page} navigate={navigate} /><p>内容与运行操作均来自共享主机。服务及权限由主机配置。</p></aside>
        <dialog className="portal-drawer" ref={drawer} aria-label="共享导航" onCancel={() => setDrawerOpen(false)} onClose={() => setDrawerOpen(false)}><header><strong>共享工作台</strong><button className="secondary-button" aria-label="关闭共享导航" onClick={() => setDrawerOpen(false)}><X size={18} /></button></header><PortalNavigation modules={available} page={page} navigate={navigate} /></dialog>
      </>}
      <div className={`portal-content ${page === 'projects' ? 'portal-projects-content' : ''}`} ref={attachContent}>
        {!session?.authenticated ? (
          <section className="portal-login">
            <h1>登录共享工作台</h1>
            <p>输入主机设置的访问口令，登录后只展示已开放的服务。</p>
            {loginForm}
          </section>
        ) : (
          <>
            <div className="portal-access">
              <strong>{summary}</strong>
              <span>
                {page === "projects"
                  ? "项目与档案保存在共享主机；入口在当前浏览器打开，入口检测由主机执行。"
                  : page === 'logs' ? '仅可读取已授权的日志来源；筛选与清空显示不修改主机文件。' : page === 'monitor' ? '检测由主机定时执行；故障与恢复记录、历史样本保存在共享主机。' : page === 'jar' ? 'JAR、Java 路径与进程都属于共享主机；可多人查看控制台，输入需运行权限与控制权。' : page === "nginx"
                    ? "配置、路径及运行操作均属于共享主机；导出文件下载到当前浏览器。"
                    : "接口项目保存在共享主机，请求从主机发出，localhost 指主机；快速请求集合保存在当前浏览器。"}
              </span>
            </div>
            {notice && (
              <div className="portal-notice" role="status">
                <span>{notice}</span>
                <button
                  type="button"
                  className="text-button"
                  aria-label="关闭操作反馈"
                  onClick={() => setNotice("")}
                >
                  关闭
                </button>
              </div>
            )}
            {available.length === 0 && (
              <section className="portal-empty">
                <h1>尚无可访问的服务</h1>
                <p>请联系主机管理者检查服务开放设置。</p>
              </section>
            )}
            {services.projects.enabled && (
              <div
                className="portal-page portal-projects-page"
                hidden={page !== "projects"}
                inert={page !== "projects"}
              >
                <ProjectCenter portal portalSession={session} />
              </div>
            )}
            {services.nginx.enabled && (
              <div
                className="portal-page"
                hidden={page !== "nginx"}
                inert={page !== "nginx"}
              >
                <NginxCenter
                  active={page === "nginx"}
                  scrollRoot={scrollRoot}
                />
              </div>
            )}
            {services.jar.enabled && <div className="portal-page" hidden={page !== 'jar'} inert={page !== 'jar'}><JarCenter active={page === 'jar'} /></div>}
            {services.monitor.enabled && <div className="portal-page" hidden={page !== 'monitor'} inert={page !== 'monitor'}><MonitorCenter active={page === 'monitor'} /></div>}
            {services.logs.enabled && <div className="portal-page" hidden={page !== 'logs'} inert={page !== 'logs'}><LogCenter active={page === 'logs'} /></div>}
            {services.http.enabled && (
              <div
                className="portal-page"
                hidden={page !== "http"}
                inert={page !== "http"}
              >
                <HttpWorkbench
                  initial={null}
                  onNotice={notify}
                  onGenerate={setSource}
                />
              </div>
            )}
            {reauth && (
              <Modal
                title="重新登录共享工作台"
                closeLabel="关闭重新登录提示"
                close={() => setReauth(false)}
                busy={busy}
              >
                <p>
                  会话已失效，当前草稿仍保留。可关闭此提示先导出；重新登录将按主机当前开放的服务和权限显示。
                </p>
                {loginForm}
              </Modal>
            )}
            {source !== null && (
              <RequestCode source={source} close={() => setSource(null)} />
            )}
          </>
        )}
      </div>
    </main>
  );
}

function PortalNavigation({ modules, page, navigate }: { modules: { id: Page; name: string }[]; page: Page; navigate: (page: Page) => void }) {
  return <nav className="portal-navigation" aria-label="共享模块">{modules.map(module => {
    const Icon = module.id === 'logs' ? ScrollText : module.id === 'monitor' ? Activity : module.id === 'jar' ? Coffee : module.id === 'nginx' ? Server : module.id === 'http' ? Send : FolderOpen;
    return <button key={module.id} aria-current={page === module.id ? 'page' : undefined} onClick={() => navigate(module.id)}><Icon size={17} /><span>{module.name}</span></button>;
  })}</nav>;
}
