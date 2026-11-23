import ConfigStorage from './ConfigStorage';
import LicenseDetails from './LicenseDetails';
import { TextInput } from './TextControl';
import SegmentedControl from './SegmentedControl';
import { clearPortalPickups } from './publisher-pickups';
import { themeStyles, normalizeThemeStyle } from './themes';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { SunMoon, LogOut, Copy, Download, Menu, X, Search, ListOrdered } from "lucide-react";
import { workspaceModuleNav } from './ui';
import { normalizeSharedModuleOrder, workspaceModules } from './catalog';
import { WorkspaceFeedback } from './related-workspaces';
import SharedWorkspaceOrder from './SharedWorkspaceOrder';
import CommandPalette from './CommandPalette';
import NavigationSheet from './NavigationSheet';
import { openWorkspaceLink, parseWorkspaceLink, workspaceHash } from './workspace-links';
import ProjectCenter from "./ProjectCenter";
import { CollaborationPage } from './CollaborationPage';
import KnowledgeBase from './KnowledgeBase';
import GitWorkspace from './GitWorkspace';
import TodoLists from './TodoLists';
import { PublishedFileShares } from './FileShares';
import NginxCenter from "./NginxCenter";
import JarCenter from './JarCenter';
import MonitorCenter from './MonitorCenter';
import LogCenter from './LogCenter';
import LanHosts from './LanHosts';
import HttpWorkbench from "./HttpWorkbench";
import { useConfirmation, useResetOverlays } from "./Confirmation";
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
import { DisplayModeProvider } from './DisplayMode';
import type { DisplayMode } from './DisplayMode';

const portalOrder = ['projects', 'git', 'knowledge', 'project-todos', 'file-shares', 'nginx', 'http', 'jar', 'monitor', 'logs', 'lan-hosts', 'transfer', 'mock', 'whiteboard'] as const satisfies readonly Page[];
const modules = portalOrder.map(id => workspaceModules.find(item => item.id === id)!);
type Page = keyof SharingServices;
type Theme = "system" | "light" | "dark";
const hashPage = () => modules.find(module => module.id === parseWorkspaceLink(location.hash)?.page)?.id;
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

function PortalTheme({ mode, setMode }: { mode: DisplayMode; setMode: (value: DisplayMode) => void }) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      const menu = details.current;
      if (menu?.open && !event.composedPath().includes(menu)) menu.open = false;
    }
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);
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
    <details ref={details} className="portal-appearance" onKeyDown={event => {
      if (event.key === 'Escape' && !(event.target instanceof HTMLOptionElement) && event.currentTarget.open) {
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary')?.focus();
      }
    }}>
      <summary className="secondary-button"><SunMoon size={16} aria-hidden="true" /><span>外观</span></summary>
      <div className="portal-appearance-options">
      <div className="choice-field portal-theme"><span>运行模式</span><SegmentedControl label="共享页面运行模式" value={mode}
        options={[{ value: 'normal', label: '正常模式' }, { value: 'performance', label: '性能模式' }]} onChange={setMode} /></div>
      <label className="portal-theme">
        主题风格
        <select aria-label="共享页面主题风格" value={themeStyle} onChange={event => setThemeStyle(normalizeThemeStyle(event.target.value))}>
          {themeStyles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}
        </select>
      </label>
      <div className="choice-field portal-theme">
      <span>明暗主题</span>
      <SegmentedControl label="共享页面主题" value={theme}
        options={[{ value: 'system', label: '跟随系统' }, { value: 'light', label: '浅色主题' }, { value: 'dark', label: '深色主题' }]} onChange={setTheme} />
      </div>
      <section aria-label="关于 DevKit"><strong>关于 DevKit</strong><LicenseDetails /></section>
      </div>
    </details>
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
  const [mode, setMode] = useState<DisplayMode>(() => preference('devkit:portal-display-mode', 'normal') === 'performance' ? 'performance' : 'normal');
  useEffect(() => remember('devkit:portal-display-mode', mode), [mode]);
  return <DisplayModeProvider mode={mode}><Portal mode={mode} setMode={setMode} /></DisplayModeProvider>;
}

function Portal({ mode, setMode }: { mode: DisplayMode; setMode: (value: DisplayMode) => void }) {
  const [order, setOrder] = useState<Page[]>(() => {
    try {
      const saved: unknown = JSON.parse(preference('devkit:portal-order', '[]'));
      return normalizeSharedModuleOrder(saved, portalOrder);
    } catch { return [...portalOrder]; }
  });
  const orderedModules = order.map(id => modules.find(module => module.id === id)!);
  const [orderTrigger, setOrderTrigger] = useState<HTMLButtonElement | null>(null);
  const [collaborationActions, setCollaborationActions] = useState<HTMLDivElement | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    const desktop = matchMedia('(min-width:781px)'), resize = () => { if (desktop.matches) setDrawerOpen(false); };
    desktop.addEventListener('change', resize); return () => desktop.removeEventListener('change', resize);
  }, []);
  const [session, setSession] = useState<Session | null>(null),
    [workspaceEpoch, setWorkspaceEpoch] = useState(0),
    [page, setPage] = useState<Page>(
      () =>
        hashPage() || (preference("devkit:portal-page", "projects") as Page),
    );
  const [showPassword, setShowPassword] = useState(false);
  const [visitor, setVisitor] = useState(''), [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(true),
    [reauth, setReauth] = useState(false),
    [source, setSource] = useState<string | null>(null);
  const confirm = useConfirmation();
  const resetOverlays = useResetOverlays();
  const bar = useRef<HTMLElement>(null),
    content = useRef<HTMLDivElement | null>(null),
    positions = useRef<Partial<Record<Page, number>>>({});
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null),
    [notice, setNotice] = useState("");
  const needsLogout = useRef(pendingLogout());
  const notify = useCallback((text: string) => setNotice(text), []);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    if (!session?.authenticated) { setSearchOpen(false); return; }
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [session?.authenticated]);
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
    if (push && location.hash !== workspaceHash(next)) location.hash = workspaceHash(next);
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
            : orderedModules.find((module) => session.services?.[module.id].enabled)
                ?.id;
      if (next) {
        if (next === page && requested === next) return;
        navigate(next, false);
        if (requested !== next) {
          if (requested) setNotice(`目标主机未开放${modules.find(item => item.id === requested)?.name || '所选服务'}。`);
          history.replaceState(null, "", "#" + next);
        }
      }
    };
    window.addEventListener("popstate", changed);
    window.addEventListener("hashchange", changed);
    return () => {
      window.removeEventListener("popstate", changed);
      window.removeEventListener("hashchange", changed);
    };
  }, [session, page, order]);
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
            sharingServices({ ...value, canEdit: value.role === "editor" }),
        }
      : value;
    const grants = (current: Session) => JSON.stringify(sharingServices({ services: current.services }));
    if (session?.authenticated && (!normalized.authenticated || (session.visitor || '') !== (normalized.visitor || '') || grants(session) !== grants(normalized))) {
      if (!normalized.authenticated || session.visitor !== normalized.visitor) clearPortalPickups();
      if (history.state?.creation) history.replaceState(null, '');
      setWorkspaceEpoch(epoch => epoch + 1);
      resetOverlays();
      setSearchOpen(false);
      setSource(null);
      setDrawerOpen(false);
      setOrderTrigger(null);
      setNotice('');
      positions.current = {};
    }
    setRemoteAccess(normalized.authenticated ? normalized : null);
    setSession(normalized);
    if (normalized.authenticated) {
      const linked = hashPage();
      const requested = linked || page;
      if (linked && !normalized.services?.[linked]?.enabled) setNotice(`目标主机未开放${modules.find(module => module.id === linked)?.name || '所选服务'}。`);
      const next = normalized.services?.[requested]?.enabled
        ? requested
        : orderedModules.find((module) => normalized.services?.[module.id].enabled)
            ?.id;
      if (next) {
        setPage(next);
        if (linked !== next) history.replaceState(null, "", "#" + next);
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
      adopt(await projectRequest<Session>("login", { visitor, password }));
      setPassword(""); setShowPassword(false);
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
      setPassword(""); setShowPassword(false);
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
    available = orderedModules.filter(module => services[module.id].enabled);
  const sortAction = available.length > 1 && <button type="button" className="shared-sort-action" aria-haspopup="dialog"
    onClick={event => setOrderTrigger(event.currentTarget)}><ListOrdered size={16} />排序</button>;
  const summary = !active?.enabled
    ? "没有可访问的服务"
    : [
        ('edit' in active && active.edit)
          ? "可编辑"
          : { git: '仓库只读', knowledge: '文档只读', projects: "项目只读", 'project-todos': '清单只读', 'file-shares': '可下载', transfer: '可复制和下载', mock: '可查看接口', whiteboard: '可查看和导出', nginx: "配置只读", http: "接口定义只读", jar: '实例设置只读', monitor: '监控只读', logs: '日志只读', 'lan-hosts': '主机清单只读' }[
              page
            ],
        page === 'git' && services.git.sync ? '可同步远端' : '',
        page === "nginx" && services.nginx.control ? "可管理运行" : "",
        page === 'jar' && services.jar.control ? (services.logs.enabled && services.logs.jar ? '可管理运行与控制台输入' : '可管理运行') : '',
        page === 'monitor' && services.monitor.control ? '可启停与立即检测' : '',
        page === 'lan-hosts' && services['lan-hosts'].terminal ? '可使用 SSH 终端' : '',
        page === 'lan-hosts' && services['lan-hosts'].rdp ? '可连接远程桌面' : '',
        page === 'lan-hosts' && services['lan-hosts'].files ? '可用 SFTP' : '',
        page === 'lan-hosts' && services['lan-hosts'].diagnose ? '可诊断连接' : '',
        page === 'lan-hosts' && services['lan-hosts'].discover ? '可发现主机' : '',
        page === 'lan-hosts' && services['lan-hosts'].wake ? '可唤醒主机' : '',
        page === 'logs' && services.logs.export ? '可导出日志' : '',
        page === 'logs' && services.logs.raw ? '可读原始日志' : '',
        page === "http" && services.http.send ? "可发送请求" : "",
        page === "projects" && services.projects.probe ? "可检测入口" : "",
      ]
        .filter(Boolean)
        .join(" · ");
  const loginForm = (
    <form onSubmit={(event) => void login(event)}>
      <label>访客名称（共享口令登录可留空）<TextInput autoComplete="username" maxLength={48} value={visitor} onChange={event => setVisitor(event.target.value)} /></label>
      <div className="portal-password"><label htmlFor="visitor-login-password">访问口令</label>
        <div className="password-entry"><TextInput id="visitor-login-password" type={showPassword ? "text" : "password"} autoComplete="current-password"
          required value={password} onChange={event => setPassword(event.target.value)} />
          <button type="button" className="text-button" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? "隐藏口令" : "显示口令"}</button></div>
      </div>
      <button type="submit" className="run-button" disabled={busy}>
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
        <div className="portal-current"><strong>{session?.authenticated ? modules.find(item => item.id === page)?.name || '共享工作台' : 'DevKit 共享工作台'}</strong>{session?.authenticated && <small><span title={summary}>{summary}</span>{session.visitor && <span title={session.visitor}>{session.visitor}</span>}</small>}</div>
        <div className="portal-account">
          {session?.authenticated && <button data-search-capsule className="secondary-button" aria-label="搜索共享资源" onClick={event => { event.currentTarget.focus({ preventScroll: true }); setSearchOpen(true); }}><Search size={16} /></button>}
          {session?.authenticated && services.jar.enabled && services.jar.edit && <ConfigStorage key={workspaceEpoch} portal />}
          <PortalTheme mode={mode} setMode={setMode} />
          {session?.authenticated && (
            <button
              className="text-button portal-logout"
              onClick={() => void logout()}
            >
              <LogOut size={15} />
              <span>退出登录</span>
            </button>
          )}
        </div>
      </header>
      {session?.authenticated && <CommandPalette key={workspaceEpoch} open={searchOpen} onClose={() => setSearchOpen(false)} pages={available.map(item => item.id)} />}
      {session?.authenticated && <>
        <aside className="portal-sidebar"><div className="portal-nav-heading"><span className="portal-nav-caption">共享工作台</span>{sortAction}</div><PortalNavigation modules={available} page={page} navigate={navigate} /><p>共享主机 <strong>{location.host}</strong></p></aside>
        <NavigationSheet open={drawerOpen} close={() => setDrawerOpen(false)}><header><strong>共享工作台</strong>{sortAction}<button className="secondary-button" aria-label="关闭共享导航" onClick={() => setDrawerOpen(false)}><X size={18} /></button></header><PortalNavigation modules={available} page={page} navigate={navigate} /></NavigationSheet>
        {orderTrigger && <SharedWorkspaceOrder modules={available} defaultModules={modules.filter(item => services[item.id].enabled)}
          onClose={() => { setOrderTrigger(null); orderTrigger.focus(); }}
          onSave={sorted => {
            let index = 0;
            const next = order.map(id => services[id].enabled ? sorted[index++] : id);
            remember('devkit:portal-order', JSON.stringify(next));
            setOrder(next);
          }} />}
      </>}
      <div key={workspaceEpoch} data-page={page} className={`portal-content ${page === 'projects' ? 'portal-projects-content' : ''}`} ref={attachContent}>
        {!session?.authenticated ? (
          <section className="portal-login">
            <h1>登录共享工作台</h1>
            <p>输入主机设置的访问口令，登录后只展示已开放的服务。</p>
            {loginForm}
          </section>
        ) : (
          <WorkspaceFeedback>
            {active?.enabled && <div className="portal-context-row"><details className="portal-access">
              <summary>主机与权限 <span>{location.host}</span></summary>
              <p>{summary}。{{
                projects: '从当前浏览器打开入口，检测由共享主机发起。',
                git: '仓库与上游凭据位于共享主机。',
                knowledge: '文档和历史版本保存在共享主机。',
                'project-todos': '清单保存在共享主机。',
                transfer: '文件、文字和链接经共享收件箱传送，受保护内容需输入取件密码。',
                mock: '从共享主机查看模拟接口、调用地址和近期记录。',
                whiteboard: '从共享主机查看白板、截图和全部标注。',
                'file-shares': '从共享主机下载已发布的文件。',
                'lan-hosts': '连接由共享主机发起，目标地址见各连接。',
                logs: '只读追踪来源，导出能力由主机授权。',
                monitor: '共享主机执行定时检测。',
                jar: '路径和进程属于选中的实例主机。',
                nginx: '配置和运行操作作用于选中的实例主机。',
                http: '由共享主机发送请求；快速请求集合保存在当前浏览器。',
              }[page]}</p>
            </details><div className="portal-module-actions" ref={setCollaborationActions} /></div>}
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
                <ProjectCenter visible={page === 'projects'} portal portalSession={session} />
              </div>
            )}
            {services.knowledge?.enabled && <div className="portal-page" hidden={page !== 'knowledge'} inert={page !== 'knowledge'}><KnowledgeBase active={page === 'knowledge'} portal visitor={session?.visitor || ''} canEdit={services.knowledge.edit} /></div>}
            {services.git.enabled && <div className="portal-page" hidden={page !== 'git'} inert={page !== 'git'}><GitWorkspace active={page === 'git'} portal edit={services.git.edit} sync={services.git.sync} /></div>}
            {services['project-todos'].enabled && <div className="portal-page" hidden={page !== 'project-todos'} inert={page !== 'project-todos'}><TodoLists portal active={page === 'project-todos'} canEdit={services['project-todos'].edit} /></div>}
            {(['transfer', 'mock', 'whiteboard'] as const).map(id => services[id].enabled && <div key={id} className="portal-page" hidden={page !== id} inert={page !== id}><CollaborationPage module={id} active={page === id} edit={services[id].edit} portalActions={collaborationActions} /></div>)}
            {services['file-shares'].enabled && <div className="portal-page" hidden={page !== 'file-shares'} inert={page !== 'file-shares'}><PublishedFileShares active={page === 'file-shares'} /></div>}
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
            {services['lan-hosts'].enabled && <div className="portal-page" hidden={page !== 'lan-hosts'} inert={page !== 'lan-hosts'}><LanHosts portal active={page === 'lan-hosts'} onOpenMonitor={id => openWorkspaceLink('monitor', id)} /></div>}
            {services.http.enabled && (
              <div
                className="portal-page"
                hidden={page !== "http"}
                inert={page !== "http"}
              >
                <HttpWorkbench active={page === 'http'}
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
                  会话已失效。用同一访客和权限重新登录可继续编辑。切换访客或权限后会清除当前草稿与响应。
                </p>
                {loginForm}
              </Modal>
            )}
            {source !== null && (
              <RequestCode source={source} close={() => setSource(null)} />
            )}
          </WorkspaceFeedback>
        )}
      </div>
    </main>
  );
}

function PortalNavigation({ modules, page, navigate }: { modules: { id: Page; name: string }[]; page: Page; navigate: (page: Page) => void }) {
  return <nav className="portal-navigation" aria-label="共享模块">{modules.map(module => {
    const { Icon } = workspaceModuleNav[module.id];
    return <button key={module.id} aria-current={page === module.id ? 'page' : undefined} onClick={() => navigate(module.id)}><Icon size={17} /><span>{module.name}</span></button>;
  })}</nav>;
}
