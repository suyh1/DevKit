import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Radio, RefreshCw, Plus } from "lucide-react";
import { isProjectDesktop, projectRequest } from "./project-api";
import type { Sharing, SharingAudit } from "./project-api";
import { workspaceModules } from './catalog';
import { emptySharingServices, visitorServices } from "../shared/sharing.mjs";
import type { SharingServices } from "../shared/sharing.mjs";
import { Modal, ModalForm, Field } from "./project-components";
import { MotionButton, MotionPresence } from "./Motion";
import { copyText } from "./motion-primitives";
import "./sharing.css";

type SharingContextValue = {
  status: Sharing | null;
  error: string;
  open: () => void;
};
const SharingContext = createContext<SharingContextValue | null>(null);
export const useSharingStatus = () => useContext(SharingContext)?.status;

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
      <Radio size={15} />
      <span>{global ? '局域网共享' : '共享设置'}</span>
      {global && <small>{status?.running && !error ? '运行中' : error ? '状态未知' : !status ? '读取中' : '未开启'}</small>}
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
  const published = useSharingStatus();
  const [draft, setDraft] = useState<Sharing | null>(null),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(true);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [saved, setSaved] = useState(0);
  const [audit, setAudit] = useState<SharingAudit[] | null>(null);
  const locked = useRef(false);
  const panel = useRef<HTMLDivElement>(null),
    ready = draft !== null;
  useEffect(() => {
    if (ready)
      panel.current?.querySelector<HTMLSelectElement>("select")?.focus();
  }, [ready]);
  const fields = draft
    ? {
        host: draft.host,
        port: draft.port,
        services: draft.services,
        autoStart: draft.autoStart,
        password,
        allowDefault: draft.allowDefault !== false,
        visitors: draft.visitors,
        tls: draft.tls,
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
          ? draft.running ? "共享设置已应用。" : "工作台共享已启动。"
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
        <ModalForm
          footer={draft && (
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
                disabled={
                  busy ||
                  !Object.values(draft.services).some(
                    (service) => service.enabled,
                  )
                }
              >
                {draft.running ? "应用设置并重启共享" : "开启共享"}
              </MotionButton>
            </footer>
          )}
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
                {!draft.running && <small>开启后显示可供访客访问的地址。</small>}
                <small>数据目录 <code>{draft.directory}</code></small>
              </div>
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
                <label><input type="checkbox" checked={draft.allowDefault !== false} onChange={event => setDraft({ ...draft, allowDefault: event.target.checked })} />允许使用通用共享口令</label>
                {draft.allowDefault !== false && <Field
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
                </Field>}
                <details className="sharing-production">
                  <summary>HTTPS 与证书</summary>
                  <label><input type="checkbox" checked={!!draft.tls} onChange={event => setDraft({ ...draft, tls: event.target.checked ? { cert: '', key: '', hostname: '' } : null })} />使用 HTTPS</label>
                  {draft.tls && <div className="pc-form-grid">
                    <Field label="PEM 证书绝对路径"><input required value={draft.tls.cert} onChange={event => setDraft({ ...draft, tls: { ...draft.tls!, cert: event.target.value } })} /></Field>
                    <Field label="PEM 私钥绝对路径"><input required value={draft.tls.key} onChange={event => setDraft({ ...draft, tls: { ...draft.tls!, key: event.target.value } })} /></Field>
                    <Field label="证书对应域名或 IPv4"><input placeholder="留空时使用主机 IP" value={draft.tls.hostname} onChange={event => setDraft({ ...draft, tls: { ...draft.tls!, hostname: event.target.value } })} /></Field>
                  </div>}
                </details>
                <div className="sharing-services-heading">
                  <h3>开放栏目</h3>
                  <p className="pc-hint">
                    按需选择服务；开放后默认只允许查看，再分别授予编辑或执行权限。
                  </p>
                </div>
                {draft.legacyAccess && (
                  <p className="pc-hint">
                    已按旧设置转换各服务权限。各服务可独立关闭，尚未配置的 JAR 和监控中心默认不开放，应用后保存为新设置。
                  </p>
                )}
                <div className="sharing-services">
                  {(
                    [
                      {
                        id: "projects",
                        name: "项目中心",
                        description: "项目入口、环境档案与方案对比",
                        permissions: [
                          {
                            key: "edit",
                            label: "编辑项目与档案",
                            detail: "允许新增、修改、删除、导入及备份恢复",
                          },
                          {
                            key: "probe",
                            label: "检测项目入口",
                            detail: "允许由主机探测项目地址的可达性",
                          },
                        ],
                      },
                      {
                        id: 'file-shares', name: '本机文件共享管理', description: '浏览主机已发布的共享，下载文件与文件夹 ZIP',
                        permissions: [],
                      },
                      { id: 'transfer', name: '局域网快传', description: '文件与文字互传',
                        permissions: [{ key: 'edit', label: '发送与移除', detail: '可向共享收件箱发送内容，也可从所有设备的收件箱移除条目。' }] },
                      { id: 'mock', name: '接口模拟服务', description: '多场景响应与调用记录',
                        permissions: [{ key: 'edit', label: '编辑与发布模拟接口', detail: '可维护响应场景、发布或撤下接口，以及更换调用地址。' }] },
                      { id: 'knowledge', name: '团队知识库', description: '查看共享主机上的全部手册与版本历史',
                        permissions: [{ key: 'edit', label: '编辑团队文档', detail: '可创建、编辑、恢复历史版本和删除文档。' }] },
                      { id: 'whiteboard', name: '截图协作白板', description: '截图与多人标注',
                        permissions: [{ key: 'edit', label: '创建与编辑白板', detail: '可上传截图、添加与移除标注，以及重命名或删除画板。' }] },
                      {
                        id: 'project-todos', name: '待办清单', description: '查看已发布的纯文本待办清单',
                        permissions: [
                          { key: 'edit', label: '编辑待办清单', detail: '允许在网页创建共享清单，以及编辑和删除已共享的清单。' },
                        ],
                      },
                      {
                        id: "nginx",
                        name: "Nginx 配置",
                        description: "主机实例、配置文件、日志与备份",
                        permissions: [
                          {
                            key: "edit",
                            label: "编辑配置与实例",
                            detail:
                              "允许填写主机路径、创建和保存文件、维护实例",
                          },
                          {
                            key: "control",
                            label: "运行管理",
                            detail:
                              "允许主机程序检测、配置检查、启动、停止和重载",
                          },
                        ],
                      },
                      {
                        id: 'jar', name: 'JAR 管理', description: '主机 Java 应用、日志和共享控制台',
                        permissions: [
                          { key: 'edit', label: '编辑 JAR 与配置文件', detail: '允许维护实例、启动参数、环境档案以及 JAR 同目录配置文件和备份' },
                          { key: 'control', label: '运行管理与控制台输入', detail: '允许 Java 检测、启动/停止/重启、输入控制及系统自启设置' },
                        ],
                      },
                      {
                        id: "http",
                        name: "HTTP 调试",
                        description: "接口项目、文档与环境",
                        permissions: [
                          {
                            key: "edit",
                            label: "编辑接口项目",
                            detail:
                              "允许保存、导入及恢复主机上的接口定义和环境",
                          },
                          {
                            key: "send",
                            label: "发送调试请求",
                            detail:
                              "允许从主机发送 HTTP(S) 请求及取消自己的请求",
                          },
                        ],
                      },
                      {
                        id: 'monitor', name: '监控中心', description: '主机定时检测、状态趋势与故障恢复记录',
                        permissions: [
                          { key: 'edit', label: '编辑监控配置', detail: '允许维护暂停的监控与关联来源；修改运行中的配置还需运行权限' },
                          { key: 'control', label: '启停与立即检测', detail: '允许启用、暂停、立即检测；不控制被监控的应用进程' },
                        ],
                      },
                      {
                        id: 'logs', name: '日志中心', description: '已登记的文件日志、控制台输出与多窗对照',
                        permissions: [
                          { key: 'jar', label: '读取 JAR 日志与控制台输出', detail: '用于日志中心和 JAR 页面，可读取文件日志及内存输出。控制台输入另需运行权限。' },
                          { key: 'nginx', label: '读取 Nginx 日志', detail: '用于日志中心和 Nginx 页面，可读取实例配置中登记的文件日志。' },
                          { key: 'export', label: '导出日志', detail: '允许导出已授权来源的有界近期内容，不修改原文件' },
                          { key: 'raw', label: '允许读取原始日志', detail: '访客可在日志中心主动关闭主机脱敏，原始内容可能包含凭据' },
                        ],
                      },
                      {
                        id: 'lan-hosts', name: '局域网主机', description: '主机清单、连接档案和远程会话', permissions: [
                          { key: 'edit', label: '管理主机档案', detail: '添加、编辑、移除、置顶和导入主机。可提交连接凭据，已保存的凭据留在共享主机。' },
                          { key: 'diagnose', label: '测试与诊断连接', detail: '验证目标地址、端口和已保存的登录。确认或重置 SSH 指纹还需管理主机档案权限。' },
                          { key: 'terminal', label: '使用 SSH 终端', detail: '使用主机保存的凭据连接已验证指纹的目标，在目标机交互操作。' },
                          { key: 'files', label: 'SFTP 文件', detail: '通过已打开的 SSH 终端浏览、上传和下载远程文件。' },
                          { key: 'discover', label: '发现主机', detail: '从共享主机选定的网卡检测直连网段。' },
                          { key: 'wake', label: '网络唤醒', detail: '从共享主机唤醒配置了 MAC 地址的设备。' },
                          { key: 'rdp', label: '远程桌面连接', detail: '通过共享主机配置的 guacd，在工作台内连接已登记的远程桌面。' },
                        ],
                      },
                    ] as const
                  ).map((service) => {
                    const policy = draft.services[service.id];
                    return (
                      <section
                        className="sharing-service"
                        data-service={service.id}
                        data-enabled={policy.enabled}
                        key={service.id}
                      >
                        <label className="sharing-service-toggle">
                          <input
                            type="checkbox"
                            aria-label={"开放" + service.name}
                            checked={policy.enabled}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                services: {
                                  ...draft.services,
                                  [service.id]: {
                                    ...emptySharingServices()[service.id],
                                    enabled: event.target.checked,
                                  },
                                },
                              })
                            }
                          />
                          <span>
                            <strong>{service.name}</strong>
                            <small>{service.description}</small>
                          </span>
                          <em>{policy.enabled ? "已选择" : "未选择"} · {published?.running && published.services[service.id]?.enabled ? "已发布" : "未发布"}</em>
                        </label>
                        <fieldset
                          className="sharing-service-permissions"
                          hidden={!policy.enabled}
                          disabled={!policy.enabled || busy}
                          aria-label={service.name + "访问权限"}
                        >
                          <p>
                            基础权限：查看
                            {service.id === "nginx"
                              ? "配置和备份，日志在日志中心授权"
                              : service.id === 'logs' ? '日志中心及原页面的日志读取权限，按下方类别授权' : service.id === 'monitor' ? '监控配置、状态、检测历史及故障恢复记录' : service.id === 'jar' ? '应用状态和自启状态，日志和控制台输出在日志中心授权' : service.id === "http"
                                ? "接口文档与环境"
                                : service.id === 'lan-hosts' ? '主机名称、地址、分组与标签'
                                : service.id === 'transfer' ? '收件箱中的条目，受保护内容须凭取件密码领取'
                                : service.id === 'mock' ? '模拟接口、调用地址和近期记录'
                                : service.id === 'whiteboard' ? '白板、截图和全部标注'
                                : service.id === 'file-shares' ? '和下载已发布的文件与文件夹'
                                : service.id === 'knowledge' ? '全部团队文档及历史版本' : service.id === 'project-todos' ? '已发布的待办清单' : "项目与档案"}
                            。
                          </p>
                          {service.permissions.map((permission) => (
                            <label key={permission.key}>
                              <input
                                type="checkbox"
                                checked={
                                  (
                                    policy as unknown as Record<string, boolean>
                                  )[permission.key]
                                }
                                onChange={(event) =>
                                  setDraft({
                                    ...draft,
                                    services: {
                                      ...draft.services,
                                      [service.id]: {
                                        ...policy,
                                        [permission.key]: event.target.checked,
                                      },
                                    } as SharingServices,
                                  })
                                }
                              />
                              <span>
                                <strong>{permission.label}</strong>
                                <small>{permission.detail}</small>
                              </span>
                            </label>
                          ))}
                        </fieldset>
                      </section>
                    );
                  })}
                </div>
                {!Object.values(draft.services).some(
                  (service) => service.enabled,
                ) && (
                  <p className="sharing-empty-hint" role="status">
                    请至少选择一个服务后开启共享。如需关闭所有访问，请使用“停止共享”。
                  </p>
                )}
                <details className="sharing-production">
                  <summary>访客权限{draft.visitors?.length ? `（${draft.visitors.length}）` : ''}</summary>
                  <p>每名访客使用自己的名称和口令。共享服务设置限定访客可获得的权限。</p>
                  {(draft.visitors || []).map((visitor, index) => {
                    const change = (next: typeof visitor) => setDraft({ ...draft, visitors: draft.visitors!.map((row, position) => position === index ? next : row) });
                    const existing = visitor.hasPassword === true;
                    const labels: Record<string, string> = { edit: '编辑', probe: '检测', control: '运行', send: '发送请求', jar: 'JAR 日志', nginx: 'Nginx 日志', export: '导出', raw: '读原始日志', diagnose: '连接诊断', terminal: 'SSH 终端', files: 'SFTP 文件', discover: '发现主机', wake: '网络唤醒', rdp: '远程桌面' };
                    const effective = visitorServices(draft.services, visitor.services);
                    const grants = workspaceModules.flatMap(item => {
                      const service = effective[item.id];
                      if (!service.enabled) return [];
                      const extra = Object.entries(service).filter(([key, granted]) => key !== 'enabled' && granted).map(([key]) => labels[key]);
                      const read = item.id === 'file-shares' ? '下载' : '查看';
                      return [`${item.name}（${[read, ...extra].join('、')}）`];
                    });
                    return <fieldset className="sharing-visitor" key={index}><legend>{visitor.name || '新访客'}</legend>
                      <div className="pc-form-grid">
                        <Field label="访客名称"><input required maxLength={48} value={visitor.name} readOnly={existing} onChange={event => change({ ...visitor, name: event.target.value })} /></Field>
                        <Field label={existing ? '更换口令（留空保留）' : '访问口令（至少 8 位）'}><input type="password" required={!existing} autoComplete="new-password" minLength={8} maxLength={128} value={visitor.password || ''} onChange={event => change({ ...visitor, password: event.target.value || (existing ? undefined : '') })} /><small aria-live="polite">{!visitor.password && existing ? '留空将保留原口令' : `${visitor.password?.length || 0}/128 位 · ${(visitor.password?.length || 0) >= 8 ? '已满足长度要求' : '至少需要 8 位'}`}</small></Field>
                      </div>
                      {workspaceModules.map(item => {
                        const name = item.id, service = visitor.services[name];
                        const patch = (key: string, value: boolean) => change({ ...visitor, services: { ...visitor.services, [name]: { ...service, [key]: value } } });
                        return <div className="sharing-visitor-service" key={name}><label><input type="checkbox" checked={service.enabled} disabled={!draft.services[name].enabled} onChange={event => patch('enabled', event.target.checked)} />{item.name}</label>
                          {service.enabled && Object.entries(service).filter(([key]) => key !== 'enabled').map(([key, granted]) => <label key={key}><input type="checkbox" checked={granted} disabled={!((draft.services[name] as Record<string, boolean>)[key])} onChange={event => patch(key, event.target.checked)} />{labels[key]}</label>)}
                        </div>;
                      })}
                      <p className="sharing-effective"><strong>生效权限</strong> {grants.length ? grants.join('；') : '暂无可访问的栏目'}</p>
                      <button type="button" className="text-button" onClick={() => setDraft({ ...draft, visitors: draft.visitors!.filter((_, position) => position !== index) })}>移除访客</button>
                    </fieldset>;
                  })}
                  <button type="button" className="secondary-button" disabled={(draft.visitors?.length || 0) >= 30} onClick={() => setDraft({ ...draft, visitors: [...(draft.visitors || []), { name: '', password: '', services: emptySharingServices() }] })}><Plus size={14} />添加访客</button>
                </details>
                <details className="sharing-production" onToggle={event => {
                  if (!event.currentTarget.open) return;
                  void projectRequest<SharingAudit[]>('sharing-audit').then(setAudit).catch(failure => setError(failure.message));
                }}><summary>访问记录</summary>
                  {audit ? <ul className="sharing-audit">{audit.map((item, index) => <li key={index}><time>{new Date(item.at).toLocaleString()}</time> · {item.visitor || '通用口令'} · {item.action} · {({ ok: '成功', failed: '失败', denied: '拒绝', revoked: '会话撤销' })[item.outcome] || item.outcome}</li>)}</ul> : <p>正在读取审计记录…</p>}
                  {audit?.length === 0 && <p>暂无访问记录。</p>}
                </details>
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
                {draft.tls ? '已配置 HTTPS，请使用客户端信任且名称匹配的证书。' : 'HTTP 使用明文连接，仅用于可信局域网。'}系统防火墙需允许所选端口入站。
              </p>

            </>
          )}
        </ModalForm>
      </Modal>
    </div>
  );
}
