import { SharingButton } from './Sharing';
import { useMotionList, useSkeletonMorph, MotionButton, MotionPresence, MotionDetails } from './Motion';
import { buttonFeedback, copyText } from './motion-primitives';
import ProjectComparison from './ProjectComparison';
import './features.css';
import { useEffect, useRef, useState } from "react";
import {
  FolderKanban,
  Plus,
  Search,
  RefreshCw,
  ExternalLink,
  Copy,
  Pencil,
  Trash2,
  Archive,
  Upload,
  Download,
  X,
  ShieldCheck,
  Settings2,
  FolderOpen,
  LayoutGrid,
  List,
  MoreHorizontal,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import {
  exportState,
  importState,
  resolveProject,
  mergeProjectState,
  validateState,
} from "../shared/projects.mjs";
import type { Profile, Project, ProjectState } from "../shared/projects.mjs";
import {
  newProjectId,
  openProjectUrl,
  projectRequest,
  saveProjects,
} from "./project-api";
import type {
  Session,
  Snapshot,
  Health,
  ProjectStorage,
} from "./project-api";
import {
  Modal,
  ModalCancel,
  Field,
  UrlPreview,
  StateChanges,
} from "./project-components";
import { saveText } from "./files";
import Skeleton from "./Skeleton";
import SegmentedControl from "./SegmentedControl";

function projectPreference(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function saveProjectPreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Host project data remains available when browser preferences are blocked. */
  }
}

function upsert<T extends { id: string }>(items: T[], value: T): T[] {
  return items.some((item) => item.id === value.id)
    ? items.map((item) => (item.id === value.id ? value : item))
    : [...items, value];
}

export default function ProjectCenter({
  portal = false,
  portalSession,
}: {
  portal?: boolean;
  portalSession?: Session;
}) {
  const [loadedSession, setSession] = useState<Session | null>(null),
    [data, setData] = useState<ProjectState | null>(null);
  const [active, setActive] = useState(
      () => projectPreference("devkit:project-profile") || "",
    ),
    [search, setSearch] = useState(""),
    [group, setGroup] = useState(""),
    [filter, setFilter] = useState("all");
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [password, setPassword] = useState("");
  const [entry, setEntry] = useState<Project | null>(null),
    [profileDraft, setProfileDraft] = useState<Profile | null>(null);
  const [imported, setImported] = useState<ProjectState | null>(null),
    [history, setHistory] = useState<Snapshot[] | null>(null);
  const [health, setHealth] = useState<Record<string, Health>>({});
  const [storage, setStorage] = useState<ProjectStorage | null>(null),
    [storageOpen, setStorageOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]),
    [sort, setSort] = useState("manual");
  const [view, setView] = useState<'grid' | 'list'>(() =>
    projectPreference("devkit:project-view") === "list" ? "list" : "grid",
  );
  const [importMode, setImportMode] = useState("merge");
  const [restoring, setRestoring] = useState<{
    meta: Snapshot;
    data: ProjectState;
  } | null>(null);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [snapshotName, setSnapshotName] = useState("");
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    run: (base: ProjectState) => Promise<void>;
  } | null>(null);
  const busyRef = useRef(false),
    allSelected = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const openModalKey = entry
    ? `entry:${entry.id}`
    : profileDraft
      ? `profile:${profileDraft.id}`
      : imported
        ? "import"
        : history
          ? "history"
          : storageOpen
            ? "storage"
            : confirmation
              ? confirmation.title
              : "";
  useEffect(() => {
    if (openModalKey) {
      setError("");
      setMessage("");
    }
  }, [openModalKey]);
  const session = portalSession || loadedSession;
  const canProbe =
    session?.role === "owner" ||
    (session?.services
      ? session.services.projects.enabled && session.services.projects.probe
      : session?.role === "editor");
  const canEdit = session?.role !== "viewer",
    owner = session?.role === "owner";
  const profile =
    data?.profiles.find((item) => item.id === active) || data?.profiles[0];
  async function action(work: () => Promise<void>) {
    if (busyRef.current) return false;
    const feedback = buttonFeedback();
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      feedback(true);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "操作失败。");
      feedback(false);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function load() {
    const auth = await projectRequest<Session>("session");
    if (portal && !auth.authenticated) {
      window.dispatchEvent(new Event("devkit:session-required"));
      throw new Error("共享会话已失效，请重新登录；当前内容和草稿已保留。");
    }
    setSession(auth);
    if (auth.role === "owner")
      setStorage(await projectRequest<ProjectStorage>("storage"));
    if (auth.authenticated) setData(await projectRequest<ProjectState>("get"));
    else setData(null);
  }
  useEffect(() => {
    void action(load);
  }, []);
  useEffect(() => {
    if (portalSession?.authenticated && !data) void action(load);
  }, [portalSession]);
  useEffect(() => {
    if (profile) {
      saveProjectPreference("devkit:project-profile", profile.id);
      setHealth({});
      setSelected([]);
      setGroup("");
    }
  }, [profile?.id]);
  useEffect(() => {
    saveProjectPreference("devkit:project-view", view);
  }, [view]);
  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      document
        .querySelectorAll<HTMLDetailsElement>(".project-center .pc-menu[open]")
        .forEach((menu) => {
          if (event.target instanceof Node && !menu.contains(event.target))
            menu.open = false;
        });
    };
    document.addEventListener("pointerdown", closeMenus);
    return () => document.removeEventListener("pointerdown", closeMenus);
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 7000);
    return () => clearTimeout(timer);
  }, [message]);
  async function persist(next: ProjectState, revision = data!.revision) {
    const saved = await saveProjects(next, revision);
    setData(saved);
    setSelected((current) =>
      current.filter((id) => saved.profiles.find(item => item.id === profile?.id)?.projects.some((item) => item.id === id)),
    );
    setHealth({});
    setMessage(`已保存 · 版本 ${saved.revision}`);
  }
  async function refreshSnapshots() {
    const result = await projectRequest<Snapshot[]>("snapshots");
    setHistory((current) => (current === null ? null : result));
  }
  const projects =
    profile?.projects
      .filter((item) => {
        const result = profile && resolveProject(item, profile),
          needle = search.trim().toLowerCase();
        return (
          (!needle ||
            [item.name, item.code, item.group, item.description, result?.url]
              .join(" ")
              .toLowerCase()
              .includes(needle)) &&
          (!group || item.group === group) &&
          (filter === "all" ||
            (filter === "enabled" && result?.enabled) ||
            (filter === "disabled" && !result?.enabled) ||
            (filter === "invalid" && !!result?.error))
        );
      })
      .sort((a, b) =>
        sort === "name"
          ? a.name.localeCompare(b.name, "zh-CN")
          : sort === "group"
            ? a.group.localeCompare(b.group, "zh-CN") ||
              a.name.localeCompare(b.name, "zh-CN")
            : 0,
      ) || [];
  useEffect(() => {
    if (allSelected.current)
      allSelected.current.indeterminate =
        projects.some((item) => selected.includes(item.id)) &&
        !projects.every((item) => selected.includes(item.id));
  }, [projects, selected]);
  const selectedProjects =
    profile?.projects.filter((item) => selected.includes(item.id)) || [];
  async function setEnabled(enabled: boolean, targets = selectedProjects) {
    const ids = new Set(targets.map((item) => item.id));
    if (!ids.size || !data || !profile) return;
    await persist({
      ...data,
      profiles: data.profiles.map((item) =>
        item.id !== profile.id
          ? item
          : {
              ...item,
              projects: item.projects.map(project => ids.has(project.id) ? { ...project, enabled } : project),
            },
      ),
    });
  }
  async function copy(text: string) {
    try {
      await copyText(text);
      setMessage("已复制。");
    } catch {
      const previous = document.activeElement,
        input = document.createElement("textarea");
      input.value = text;
      input.style.cssText =
        "position:fixed;left:0;top:0;opacity:0;pointer-events:none";
      (document.querySelector("dialog[open]") || document.body).appendChild(
        input,
      );
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      if (previous instanceof HTMLElement) previous.focus();
      setMessage(
        copied ? "已复制。" : "浏览器未开放剪贴板，可选中文字后手动复制。",
      );
    }
  }
  function editEntry(project: Project) {
    setError("");
    setEntry(structuredClone(project));
  }
  function withProjects(projects: Project[]): ProjectState {
    return { ...data!, profiles: data!.profiles.map(item => item.id === profile!.id ? { ...item, projects } : item) };
  }
  async function probe(ids: string[]) {
    const results = await projectRequest<Health[]>("probe", {
      profileId: profile!.id,
      projectIds: ids,
    });
    setHealth((current) => ({
      ...current,
      ...Object.fromEntries(
        results.map((item) => [`${profile!.id}:${item.id}`, item]),
      ),
    }));
  }
  const grid = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null);
  useSkeletonMorph(stage, !!data && !!profile);
  useMotionList(grid, projects.map(project => project.id).join('|') + view, !!search);
  const errorBox = error && (
    <div className="pc-error" role="alert">
      <span>{error}</span>
      <MotionButton outcome={error ? "error" : ""} busy={busy}
        type="button"
        className="text-button"
        disabled={busy}
        onClick={() => void action(load)}
      >
        刷新共享数据
      </MotionButton>
    </div>
  );
  if (!session && !error) return <section ref={stage} className="project-center"><Skeleton kind="projects" /></section>;
  if (!session?.authenticated)
    return (
      <section className="project-center pc-login">
        <FolderKanban size={36} />
        <h1>DevKit 项目中心</h1>
        <p>输入主机设置的访问口令，查看项目与配置档案。</p>
        {errorBox}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void action(async () => {
              await projectRequest("login", { password });
              setPassword("");
              await load();
            });
          }}
        >
          <Field label="访问口令">
            <input
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <MotionButton outcome={error ? "error" : ""} busy={busy} className="run-button" disabled={busy}>
            {busy ? "正在连接…" : "进入项目中心"}
          </MotionButton>
        </form>
        <small>仅用于可信局域网。HTTP 连接不加密，请勿复用重要账号密码。</small>
      </section>
    );
  if (!data || !profile)
    return (
      <section ref={stage} className="project-center">
        {errorBox}
        {error ? <p>项目中心暂不可用，请处理上面的配置目录问题后重新启动。其他工具仍可使用。</p> : <Skeleton kind="projects" />}
        {storage && (
          <div className="pc-path">
            <code>{storage.directory}</code>
            <button
              className="secondary-button"
              onClick={() =>
                void action(async () => {
                  await projectRequest("open-configs");
                })
              }
            >
              <FolderOpen size={15} />
              打开 configs 目录
            </button>
          </div>
        )}
      </section>
    );
  const groups = [...new Set(profile.projects.map((item) => item.group))]
    .filter(Boolean)
    .sort();
  const modalOpen =
    !!entry ||
    !!profileDraft ||
    !!imported ||
    !!history ||
    storageOpen ||
    !!confirmation;
  const resolved = profile.projects.map((item) => resolveProject(item, profile));
  let importTarget: ProjectState | null = null,
    importError = "";
  if (imported)
    try {
      importTarget =
        importMode === "merge" ? mergeProjectState(data, imported) : imported;
    } catch (failure) {
      importError = (failure as Error).message;
    }
  let draftError = "";
  try {
    if (entry)
      validateState(withProjects(upsert(profile.projects, entry)));
    if (profileDraft)
      validateState({ ...data, profiles: upsert(data.profiles, { ...profileDraft, projects: data.profiles.find(item => item.id === profileDraft.id)?.projects ?? profileDraft.projects }) });
  } catch (failure) {
    draftError = (failure as Error).message;
  }
  return (
    <section
      ref={stage}
      className={`project-center motion-skeleton-content ${portal ? "pc-portal" : ""} ${canEdit ? "" : "pc-viewer"}`}
    >
      <MotionPresence kind="dialog" present={!!(comparisonOpen)}>{comparisonOpen && <ProjectComparison data={data} active={active} close={() => setComparisonOpen(false)} />}</MotionPresence>
      <header className="pc-heading">
        <div className="pc-brand">
          <FolderKanban size={27} />
          <div>
            <h1>项目中心</h1>
            <p>每个档案独立管理项目与变量，按需对比不同方案。</p>
          </div>
        </div>
        <div className="pc-actions"><MotionButton outcome={error ? "error" : ""} busy={busy} className="secondary-button" disabled={busy || data.profiles.length < 2} onClick={() => setComparisonOpen(true)}>对比方案</MotionButton>
          <span className="pc-role">
            <ShieldCheck size={13} />
            {owner ? "主机管理" : canEdit ? "协作编辑" : "只读访问"} · 数据版本
            {data.revision}
          </span>
          <MotionButton outcome={error ? "error" : ""} busy={busy}
            className="secondary-button"
            disabled={busy}
            onClick={() => void action(load)}
          >
            <RefreshCw size={14} />
            刷新
          </MotionButton>
          {owner && (
            <MotionButton outcome={error ? "error" : ""} busy={busy}
              className="secondary-button"
              disabled={busy}
              onClick={() => setStorageOpen(true)}
            >
              <FolderOpen size={14} />
              配置文件
            </MotionButton>
          )}
          {owner && <SharingButton />}
        </div>
      </header>
      {!modalOpen && errorBox}
      {message && (
        <p className="pc-message" role="status">
          {message}
        </p>
      )}
      {busy && (
        <p className="pc-busy" role="status">
          正在处理，请稍候…
        </p>
      )}
      {storage?.migratedFrom && (
        <p className="pc-notice">
          旧版项目数据已迁入安装目录的
          configs，原文件仍保留。可在“配置文件”查看保存位置。
        </p>
      )}
      <div className="pc-shell">
        <aside className="pc-profiles">
          <div className="pc-section-title">
            <strong>配置档案</strong>
            <MotionButton outcome={error ? "error" : ""} busy={busy}
              className="icon-button"
              title="新建配置档案"
              aria-label="新建配置档案"
              disabled={busy || !canEdit}
              onClick={() =>
                setProfileDraft({
                  id: newProjectId(),
                  name: "",
                  description: "",
                  variables: [],
                  projects: [],
                })
              }
            >
              <Plus size={16} />
            </MotionButton>
          </div>
          <p>选择仅影响当前使用者</p>
          {data.profiles.map((item) => (
            <MotionButton outcome={error ? "error" : ""} busy={busy}
              key={item.id}
              className={`pc-profile ${profile.id === item.id ? "selected" : ""}`}
              aria-pressed={profile.id === item.id}
              disabled={busy}
              onClick={() => {
                setActive(item.id);
                setGroup("");
              }}
            >
              <strong>{item.name}</strong>
              <small>
                {item.description ||
                  `${item.projects.length} 个项目 · ${item.variables.length} 个变量`}
              </small>
            </MotionButton>
          ))}
          <div className="pc-profile-tools">
            <MotionButton outcome={error ? "error" : ""} busy={busy}
              className="text-button"
              disabled={busy || !canEdit}
              onClick={() => setProfileDraft(structuredClone(profile))}
            >
              <Settings2 size={14} />
              编辑当前档案
            </MotionButton>
            <MotionButton variant="copy"
              className="text-button"
              disabled={busy || !canEdit}
              onClick={() =>
                setProfileDraft({
                  ...structuredClone(profile),
                  id: newProjectId(),
                  name: (() => {
                    let name = `${profile.name} 副本`,
                      index = 2;
                    while (data.profiles.some((item) => item.name === name))
                      name = `${profile.name} 副本 ${index++}`;
                    return name;
                  })(),
                })
              }
            >
              <Copy size={14} />
              复制档案
            </MotionButton>
            <MotionButton outcome={error ? "error" : ""} busy={busy}
              className="text-button"
              disabled={busy || !canEdit || data.profiles.length <= 1}
              onClick={() =>
                setConfirmation({
                  title: `删除配置档案“${profile.name}”？`,
                  description:
                    "此档案的项目和变量会一起移除，其他档案保留。删除前自动备份。",
                  run: async (base) => {
                    await persist(
                      {
                        ...base,
                        profiles: base.profiles.filter(
                          (item) => item.id !== profile.id,
                        ),
                      },
                      base.revision,
                    );
                    setActive("");
                  },
                })
              }
            >
              <Trash2 size={14} />
              删除档案
            </MotionButton>
          </div>
          <div className="pc-storage">
            <Archive size={15} />
            <span>
              保存与恢复前自动备份
              <br />
              保留最近 30 份快照
            </span>
          </div>
        </aside>
        <div className="pc-content">
          <div className="pc-environment">
            <div>
              <h2>{profile.name}</h2>
              <p>
                {profile.description ||
                  "在档案中填写环境变量，入口模板使用 {{变量名}} 引用。"}
              </p>
            </div>
            <span>
              {profile.projects.length} 个项目 · {profile.variables.length} 个变量
            </span>
          </div>
          <div className="pc-metrics" aria-label="当前档案概况">
            <span>
              <CheckCircle2 size={14} />
              <strong>
                {resolved.filter((item) => item.enabled && !item.error).length}
              </strong>
              可打开
            </span>
            <span>
              <strong>{resolved.filter((item) => !item.enabled).length}</strong>
              已停用
            </span>
            <button
              className={
                resolved.some((item) => item.error) ? "pc-invalid" : ""
              }
              onClick={() => setFilter("invalid")}
            >
              <AlertCircle size={14} />
              <strong>{resolved.filter((item) => item.error).length}</strong>
              配置异常
            </button>
            {canEdit && (
              <button onClick={() => setProfileDraft(structuredClone(profile))}>
                <Settings2 size={14} />
                管理 {profile.name} 变量
              </button>
            )}
          </div>
          <div className="pc-toolbar">
            <label className="pc-search">
              <Search size={15} />
              <input
                aria-label="搜索项目"
                placeholder="搜索名称、编码、分组或地址…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <select
              aria-label="筛选项目分组"
              value={group}
              onChange={(event) => setGroup(event.target.value)}
            >
              <option value="">全部分组</option>
              {groups.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <select
              aria-label="项目排序"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="manual">创建顺序</option>
              <option value="name">按名称</option>
              <option value="group">按分组</option>
            </select>
            <SegmentedControl label="项目显示方式" className="pc-view-toggle" value={view} onChange={setView} options={[{ value: 'grid', label: '卡片视图', content: <LayoutGrid size={16} /> }, { value: 'list', label: '列表视图', content: <List size={16} /> }]} />
            <select
              aria-label="筛选项目状态"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">全部状态</option>
              <option value="enabled">已启用</option>
              <option value="disabled">已停用</option>
              <option value="invalid">配置异常</option>
            </select>
            <MotionButton outcome={error ? "error" : ""} busy={busy}
              className="run-button"
              disabled={busy || !canEdit}
              onClick={() =>
                editEntry({
                  id: newProjectId(),
                  name: "",
                  code: `project-${Date.now().toString(36)}`,
                  group: "",
                  description: "",
                  url: "http://{{host}}:8080/",
                  enabled: true,
                  query: [],
                })
              }
            >
              <Plus size={15} />
              添加项目
            </MotionButton>
          </div>
          <div className="pc-bulk">
            <label className="pc-select-all">
              <input
                ref={allSelected}
                type="checkbox"
                aria-label="选择当前结果"
                checked={
                  !!projects.length &&
                  projects.every((item) => selected.includes(item.id))
                }
                disabled={!projects.length || busy}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [
                          ...new Set([
                            ...current,
                            ...projects.map((item) => item.id),
                          ]),
                        ]
                      : current.filter(
                          (id) => !projects.some((item) => item.id === id),
                        ),
                  )
                }
              />
              选择当前结果
            </label>
            <span>
              {projects.length} 项结果 · 已选 {selectedProjects.length} 项
              {selectedProjects.some(
                (item) => !projects.some((visible) => visible.id === item.id),
              )
                ? "（含筛选外项目）"
                : ""}
            </span>
            {selected.length > 0 && (
              <button onClick={() => setSelected([])}>清除选择</button>
            )}
            {canEdit && (
              <>
                <MotionButton outcome={error ? "error" : ""} busy={busy}
                  disabled={busy || !selectedProjects.length}
                  onClick={() => void action(() => setEnabled(true))}
                >
                  启用所选
                </MotionButton>
                <MotionButton outcome={error ? "error" : ""} busy={busy}
                  disabled={busy || !selectedProjects.length}
                  onClick={() => void action(() => setEnabled(false))}
                >
                  停用所选
                </MotionButton>

              </>
            )}
            {canProbe && (
                <MotionButton outcome={error ? "error" : ""} busy={busy}
                  disabled={
                    busy ||
                    !selectedProjects.some(
                      (item) =>
                        resolveProject(item, profile).enabled &&
                        !resolveProject(item, profile).error,
                    )
                  }
                  onClick={() =>
                    void action(async () => {
                      await probe(
                        selectedProjects
                          .filter((item) => {
                            const result = resolveProject(item, profile);
                            return result.enabled && !result.error;
                          })
                          .slice(0, 20)
                          .map((item) => item.id),
                      );
                      setMessage(
                        "已从主机检测所选入口（最多 20 项）；状态不代表完整业务可用性。",
                      );
                    })
                  }
                >
                  检测所选入口
                </MotionButton>
            )}
            <button
              disabled={!projects.length && !selectedProjects.length}
              onClick={() =>
                void copy(
                  (selectedProjects.length ? selectedProjects : projects)
                    .map(
                      (item) =>
                        `${item.name}\t${resolveProject(item, profile).url || "配置异常"}`,
                    )
                    .join("\n"),
                )
              }
            >
              {selectedProjects.length ? "复制所选清单" : "复制当前清单"}
            </button>
          </div>
          {!projects.length && (
            <div className="pc-empty">
              <FolderKanban size={34} />
              <h3>
                {profile.projects.length ? "没有匹配的项目" : "添加第一个项目入口"}
              </h3>
              <p>
                {profile.projects.length
                  ? "试试其他关键词或清除分组、状态筛选。"
                  : "在当前档案添加项目。各档案独立保存，地址可引用 {{host}} 等变量。"}
              </p>
              {profile.projects.length > 0 && (
                <button
                  className="secondary-button"
                  onClick={() => {
                    setSearch("");
                    setGroup("");
                    setFilter("all");
                  }}
                >
                  清除筛选
                </button>
              )}
            </div>
          )}
          <div ref={grid} className={`pc-grid ${view === "list" ? "pc-list" : ""}`}>
            {projects.map((project) => {
              const result = resolveProject(project, profile),
                probeResult = health[`${profile.id}:${project.id}`];
              return (
                <article
                  className={`pc-card ${!result.enabled ? "disabled" : ""} ${selected.includes(project.id) ? "is-selected" : ""}`}
                  key={project.id}
                  data-motion-key={project.id}
                >
                  <div className="pc-card-top">
                    <label className="pc-card-select">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${project.name}`}
                        disabled={busy}
                        checked={selected.includes(project.id)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, project.id]
                              : current.filter((id) => id !== project.id),
                          )
                        }
                      />
                      <span>{project.group || "未分组"}</span>
                    </label>
                    <small className="pc-code" title={project.code}>
                      {project.code}
                    </small>
                    <span>当前方案</span>
                  </div>
                  <div className="pc-card-identity">
                    <h3 title={project.name}>{project.name}</h3>
                    <MotionButton outcome={error ? "error" : ""} busy={busy}
                      className={`pc-status ${result.enabled ? "enabled" : ""}`}
                      disabled={busy || !canEdit}
                      aria-label={`${result.enabled ? "停用" : "启用"} ${project.name}（仅当前档案）`}
                      onClick={() =>
                        void action(() =>
                          setEnabled(!result.enabled, [project]),
                        )
                      }
                    >
                      {result.enabled ? "已启用" : "已停用"}
                    </MotionButton>
                  </div>
                  {project.description && (
                    <p
                      className="pc-card-description"
                      title={project.description}
                    >
                      {project.description}
                    </p>
                  )}
                  <MotionDetails className="pc-address">
                    <summary
                      aria-label={`展开 ${project.name} 完整地址`}
                      title={result.error || result.url}
                    >
                      <code className={result.error ? "pc-invalid" : ""}>
                        {result.error || result.url}
                      </code>
                      <ChevronDown size={13} />
                    </summary>
                    <div>
                      <code>{result.error || result.url}</code>
                    </div>
                  </MotionDetails>
                  {portal && result.localOnly && (
                    <small className="pc-invalid">
                      此地址指向访问者自己的电脑；共享服务请使用主机局域网 IP。
                    </small>
                  )}
                  {probeResult && (
                    <small
                      className={
                        probeResult.state === "online" ? "pc-ok" : "pc-invalid"
                      }
                    >
                      {probeResult.status
                        ? `HTTP ${probeResult.status}`
                        : probeResult.error}{" "}
                      · {probeResult.elapsed} ms（主机检测）
                    </small>
                  )}
                  <div className="pc-card-actions">
                    <button
                      className="secondary-button"
                      disabled={!result.enabled || !!result.error}
                      onClick={() =>
                        void action(async () => {
                          await openProjectUrl(result.url);
                        })
                      }
                    >
                      <ExternalLink size={14} />
                      {result.enabled ? "打开入口" : "已停用"}
                    </button>
                    <MotionButton variant="copy"
                      className="icon-button"
                      aria-label={`复制 ${project.name} 地址`}
                      title="复制最终地址"
                      disabled={!!result.error}
                      onClick={() => void copy(result.url)}
                    >
                      <Copy size={14} />
                    </MotionButton>
                    {canEdit && (
                      <>
                        <MotionButton outcome={error ? "error" : ""} busy={busy}
                          className="icon-button"
                          aria-label={`编辑 ${project.name}`}
                          title="编辑当前方案项目"
                          disabled={busy}
                          onClick={() => editEntry(project)}
                        >
                          <Pencil size={14} />
                        </MotionButton>
                        <MotionButton outcome={error ? "error" : ""} busy={busy}
                          className="icon-button pc-invalid"
                          aria-label={`删除 ${project.name}`}
                          disabled={busy}
                          onClick={() =>
                            setConfirmation({
                              title: `删除项目“${project.name}”？`,
                              description:
                                "仅删除当前档案中的此项目，其他档案不受影响。删除前自动备份，可在“备份与恢复”中找回。",
                              run: async (base) => {
                                await persist(
                                  {
                                    ...base,
                                    profiles: base.profiles.map(item => item.id === profile.id ? {
                                      ...item, projects: item.projects.filter(row => row.id !== project.id),
                                    } : item),
                                  },
                                  base.revision,
                                );
                              },
                            })
                          }
                        >
                          <Trash2 size={14} />
                        </MotionButton>
                        <MotionDetails
                          className="pc-menu"
                          onClick={(event) => {
                            if (
                              event.target instanceof Element &&
                              event.target.closest("button")
                            )
                              event.currentTarget.open = false;
                          }}
                        >
                          <summary
                            aria-label={`${project.name} 更多操作`}
                            title="更多操作"
                          >
                            <MoreHorizontal size={17} />
                          </summary>
                          <div>
                            <MotionButton variant="copy"
                              className="text-button"
                              title="复制项目定义"
                              aria-label={`复制 ${project.name} 定义`}
                              disabled={busy}
                              onClick={() =>
                                editEntry({
                                  ...structuredClone(project),
                                  id: newProjectId(),
                                  name: `${project.name} 副本`,
                                  code: `${project.code}-${Date.now().toString(36)}`,
                                })
                              }
                            >
                              <Plus size={14} />
                              复制定义
                            </MotionButton>
                          </div>
                        </MotionDetails>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <footer className="pc-footer">
            <button
              className="text-button"
              onClick={() =>
                void action(async () => {
                  setMessage(
                    await saveText(
                      exportState(data),
                      "devkit-project-center.json",
                    ),
                  );
                })
              }
            >
              <Download size={14} />
              导出项目与档案
            </button>
            {canEdit && (
              <>
                <MotionButton outcome={error ? "error" : ""} busy={busy}
                  className="text-button"
                  disabled={busy}
                  onClick={() => file.current?.click()}
                >
                  <Upload size={14} />
                  导入预览
                </MotionButton>
                <MotionButton outcome={error ? "error" : ""} busy={busy}
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () =>
                      setHistory(await projectRequest<Snapshot[]>("snapshots")),
                    )
                  }
                >
                  <Archive size={14} />
                  备份与恢复
                </MotionButton>
              </>
            )}
            <span>
              {owner
                ? "项目与档案保存到安装目录的 configs；整目录复制可迁移，导出 JSON 可选择合并导入。"
                : "数据保存在主机；当前档案和视图选择只影响你自己。"}
            </span>
          </footer>
          <input
            ref={file}
            type="file"
            className="sr-only"
            accept=".json"
            aria-label="导入项目中心 JSON"
            onChange={(event) => {
              const selected = event.target.files?.[0];
              event.target.value = "";
              if (selected)
                void action(async () => {
                  if (selected.size > 4_100_000)
                    throw new Error("导入文件过大。");
                  setImportMode("merge");
                  setImported(importState(await selected.text()));
                });
            }}
          />
        </div>
      </div>
      <MotionPresence kind="dialog" present={!!(entry)}>{entry && (
        <Modal
          feedback={message}
          title={`项目定义 · ${profile.name}`}
          close={() => setEntry(null)}
          draft={entry}
          busy={busy}
          wide
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                await persist(withProjects(upsert(profile.projects, entry)));
                setEntry(null);
              });
            }}
          >
            {errorBox}
            <>
                <div className="pc-scope">
                  <Settings2 size={15} />
                  项目仅属于当前档案“{profile.name}”，在此保存、启停或删除。
                </div>
                <div className="pc-form-grid">
                  <Field label="项目名称">
                    <input
                      required
                      maxLength={100}
                      value={entry.name}
                      onChange={(event) =>
                        setEntry({ ...entry, name: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="唯一编码">
                    <input
                      required
                      maxLength={100}
                      value={entry.code}
                      onChange={(event) =>
                        setEntry({ ...entry, code: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="分组">
                    <input
                      maxLength={80}
                      value={entry.group}
                      onChange={(event) =>
                        setEntry({ ...entry, group: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="说明">
                    <input
                      maxLength={1000}
                      value={entry.description}
                      onChange={(event) =>
                        setEntry({ ...entry, description: event.target.value })
                      }
                    />
                  </Field>
                </div>
                <h3 className="pc-form-section">入口地址与参数</h3>
                <Field label="HTTP(S) 地址模板">
                  <input
                    required
                    maxLength={4000}
                    placeholder="http://{{host}}:8080/"
                    value={entry.url}
                    onChange={(event) =>
                      setEntry({ ...entry, url: event.target.value })
                    }
                  />
                </Field>
                <p className="pc-hint">
                  使用 {"{{变量名}}"}{" "}
                  引用档案变量；参数通过下表添加，会自动编码并保留重复项。
                </p>
                <p className="pc-hint">
                  完整地址可包含路径和已有参数，例如 https://{"{{host}}"}
                  /console?lang=zh。下表参数会追加到地址中。
                </p>
                <label className="pc-check">
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    onChange={(event) =>
                      setEntry({ ...entry, enabled: event.target.checked })
                    }
                  />
                  默认启用
                </label>
                <div className="pc-section-title">
                  <strong>查询参数</strong>
                  <button
                    type="button"
                    className="text-button"
                    disabled={entry.query.length >= 100}
                    onClick={() =>
                      setEntry({
                        ...entry,
                        query: [
                          ...entry.query,
                          {
                            id: newProjectId(),
                            key: "",
                            value: "",
                            enabled: true,
                          },
                        ],
                      })
                    }
                  >
                    ＋ 添加参数
                  </button>
                </div>
                {entry.query.length > 0 && (
                  <div className="pc-row-head" aria-hidden="true">
                    <span>启用</span>
                    <span>参数名</span>
                    <span>参数值</span>
                    <span />
                  </div>
                )}
                {entry.query.map((row, index) => (
                  <div
                    className={`pc-row pc-query-row ${!row.enabled ? "is-inactive" : ""}`}
                    key={row.id}
                  >
                    <input
                      aria-label={`参数 ${index + 1} 启用`}
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(event) =>
                        setEntry({
                          ...entry,
                          query: entry.query.map((item) =>
                            item.id === row.id
                              ? { ...item, enabled: event.target.checked }
                              : item,
                          ),
                        })
                      }
                    />
                    <input
                      aria-label={`参数 ${index + 1} 名称`}
                      maxLength={200}
                      value={row.key}
                      onChange={(event) =>
                        setEntry({
                          ...entry,
                          query: entry.query.map((item) =>
                            item.id === row.id
                              ? { ...item, key: event.target.value }
                              : item,
                          ),
                        })
                      }
                      placeholder="名称"
                    />
                    <input
                      aria-label={`参数 ${index + 1} 值`}
                      maxLength={2000}
                      value={row.value}
                      onChange={(event) =>
                        setEntry({
                          ...entry,
                          query: entry.query.map((item) =>
                            item.id === row.id
                              ? { ...item, value: event.target.value }
                              : item,
                          ),
                        })
                      }
                      placeholder="值或 {{变量名}}"
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`删除参数 ${index + 1}`}
                      onClick={() =>
                        setEntry({
                          ...entry,
                          query: entry.query.filter(
                            (item) => item.id !== row.id,
                          ),
                        })
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
            </>
            <UrlPreview project={entry} profile={profile} copy={copy} />
            {draftError && (
              <p className="pc-validation" role="status">
                {draftError}
              </p>
            )}
            <footer>
              <ModalCancel />
              <MotionButton outcome={error ? "error" : ""} busy={busy} className="run-button" disabled={busy || !!draftError}>
                保存项目定义
              </MotionButton>
            </footer>
          </form>
        </Modal>
      )}</MotionPresence>
      <MotionPresence kind="dialog" present={!!(profileDraft)}>{profileDraft && (
        <Modal
          feedback={message}
          title="编辑配置档案"
          close={() => setProfileDraft(null)}
          draft={profileDraft}
          busy={busy}
          wide
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                await persist({
                  ...data,
                  profiles: upsert(data.profiles, { ...profileDraft, projects: data.profiles.find(item => item.id === profileDraft.id)?.projects ?? profileDraft.projects }),
                });
                setActive(profileDraft.id);
                setProfileDraft(null);
              });
            }}
          >
            {errorBox}
            <Field label="档案名称">
              <input
                required
                maxLength={100}
                value={profileDraft.name}
                onChange={(event) =>
                  setProfileDraft({ ...profileDraft, name: event.target.value })
                }
              />
            </Field>
            <Field label="说明">
              <input
                maxLength={1000}
                value={profileDraft.description}
                onChange={(event) =>
                  setProfileDraft({
                    ...profileDraft,
                    description: event.target.value,
                  })
                }
              />
            </Field>
            <div className="pc-section-title">
              <strong>环境变量</strong>
              <button
                type="button"
                className="text-button"
                disabled={profileDraft.variables.length >= 100}
                onClick={() =>
                  setProfileDraft({
                    ...profileDraft,
                    variables: [
                      ...profileDraft.variables,
                      { key: "", value: "" },
                    ],
                  })
                }
              >
                ＋ 添加变量
              </button>
            </div>
            <p className="pc-hint">
              变量会随配置导出和共享。此处不用于保存登录密码或密钥。
            </p>
            {profileDraft.variables.map((row, index) => (
              <div className="pc-row" key={index}>
                <input
                  required
                  aria-label={`变量 ${index + 1} 名称`}
                  maxLength={80}
                  value={row.key}
                  placeholder="host"
                  onChange={(event) =>
                    setProfileDraft({
                      ...profileDraft,
                      variables: profileDraft.variables.map((item, i) =>
                        i === index
                          ? { ...item, key: event.target.value }
                          : item,
                      ),
                    })
                  }
                />
                <input
                  aria-label={`变量 ${index + 1} 值`}
                  maxLength={2000}
                  value={row.value}
                  placeholder="192.168.1.10"
                  onChange={(event) =>
                    setProfileDraft({
                      ...profileDraft,
                      variables: profileDraft.variables.map((item, i) =>
                        i === index
                          ? { ...item, value: event.target.value }
                          : item,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`删除变量 ${index + 1}`}
                  onClick={() =>
                    setProfileDraft({
                      ...profileDraft,
                      variables: profileDraft.variables.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            {!profileDraft.variables.length && (
              <p className="pc-hint">
                暂无环境变量。不使用模板变量时可以留空。
              </p>
            )}
            <MotionDetails className="pc-profile-preview">
              <summary>
                查看此档案的项目地址预览（{profileDraft.projects.length}）
              </summary>
              {profileDraft.projects.map((item) => {
                const result = resolveProject(item, profileDraft);
                return (
                  <div key={item.id}>
                    <strong>{item.name}</strong>
                    <code className={result.error ? "pc-invalid" : ""}>
                      {result.error || result.url}
                    </code>
                  </div>
                );
              })}
            </MotionDetails>
            {draftError && (
              <p className="pc-validation" role="status">
                {draftError}
              </p>
            )}
            <footer>
              <ModalCancel />
              <MotionButton outcome={error ? "error" : ""} busy={busy} className="run-button" disabled={busy || !!draftError}>
                保存配置档案
              </MotionButton>
            </footer>
          </form>
        </Modal>
      )}</MotionPresence>
      <MotionPresence kind="dialog" present={!!(imported)}>{imported && (
        <Modal
          feedback={message}
          title="导入预览"
          close={() => setImported(null)}
          busy={busy}
        >
          {errorBox}
          <p>
            文件包含 {imported.profiles.flatMap(item => item.projects).length} 个项目、
            {imported.profiles.length}{" "}
            个配置档案。确认前不会写入数据；导入前自动备份，访问口令和共享设置不变。
          </p>
          <fieldset className="pc-import-modes">
            <legend>导入方式</legend>
            <label>
              <input
                type="radio"
                name="import-mode"
                value="merge"
                checked={importMode === "merge"}
                onChange={() => setImportMode("merge")}
              />
              <span>
                <strong>合并到当前数据</strong>
                <small>
                  同名档案内按项目编码合并项目、按变量名合并变量；保留文件外的内容。
                </small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="import-mode"
                value="replace"
                checked={importMode === "replace"}
                onChange={() => setImportMode("replace")}
              />
              <span>
                <strong>全部替换</strong>
                <small>项目与档案以文件为准，当前文件外的内容会移除。</small>
              </span>
            </label>
          </fieldset>
          {importTarget && <StateChanges current={data} next={importTarget} />}
          {importError && (
            <p className="pc-error" role="alert">
              {importError}
            </p>
          )}
          <MotionDetails className="pc-profile-preview">
            <summary>查看导入内容</summary>
            <p>
              配置档案：{imported.profiles.map((item) => item.name).join("、")}
            </p>
            <ul>
              {imported.profiles.flatMap(profile => profile.projects.map(item => ({ ...item, profileId: profile.id, profileName: profile.name }))).slice(0, 50).map((item) => (
                <li key={JSON.stringify([item.profileId, item.id])}>
                  {item.profileName} / {item.name} · {item.code} · {item.group || "未分组"}
                </li>
              ))}
            </ul>
            {imported.profiles.flatMap(item => item.projects).length > 50 && (
              <p>仅展示前 50 项，全部内容均参与导入。</p>
            )}
          </MotionDetails>
          <footer>
            <ModalCancel />
            <MotionButton outcome={error ? "error" : ""} busy={busy}
              className="run-button"
              disabled={busy || !importTarget}
              onClick={() =>
                void action(async () => {
                  await persist({ ...importTarget!, revision: data.revision });
                  setImported(null);
                  setSelected([]);
                  setActive(
                    importTarget!.profiles.find(
                      (item) => item.id === profile.id,
                    )?.id ||
                      importTarget!.profiles.find(
                        (item) => item.name === profile.name,
                      )?.id ||
                      importTarget!.profiles[0].id,
                  );
                  setMessage(
                    importMode === "merge"
                      ? "已合并导入；可在备份与恢复中撤销本次修改。"
                      : "已替换导入；可在备份与恢复中找回原数据。",
                  );
                })
              }
            >
              备份当前数据并导入
            </MotionButton>
          </footer>
        </Modal>
      )}</MotionPresence>
      <MotionPresence kind="dialog" present={!!(history)}>{history && (
        <Modal
          feedback={message}
          title={restoring ? "恢复预览" : "备份与恢复"}
          close={() => {
            setHistory(null);
            setRestoring(null);
          }}
          busy={busy}
        >
          {errorBox}
          {restoring ? (
            <>
              <p>
                准备恢复“{restoring.meta.name}”（
                {new Date(restoring.meta.createdAt).toLocaleString()}
                ）。项目和档案将替换为快照内容，当前共享设置和访问口令保持不变。
              </p>
              <StateChanges current={data} next={restoring.data} />
              <MotionDetails className="pc-profile-preview">
                <summary>查看快照内容</summary>
                <p>
                  档案：
                  {restoring.data.profiles.map((item) => item.name).join("、")}
                </p>
                <ul>
                  {restoring.data.profiles.flatMap(profile => profile.projects.map(item => ({ ...item, profileId: profile.id, profileName: profile.name }))).slice(0, 50).map((item) => (
                    <li key={JSON.stringify([item.profileId, item.id])}>
                      {item.profileName} / {item.name} · {item.code}
                    </li>
                  ))}
                </ul>
              </MotionDetails>
              <footer>
                <MotionButton outcome={error ? "error" : ""} busy={busy}
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => setRestoring(null)}
                >
                  返回快照列表
                </MotionButton>
                <MotionButton outcome={error ? "error" : ""} busy={busy}
                  className="run-button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      setData(
                        await projectRequest<ProjectState>("restore", {
                          id: restoring.meta.id,
                          revision: data.revision,
                        }),
                      );
                      setHealth({});
                      setSelected([]);
                      setRestoring(null);
                      await refreshSnapshots();
                      setMessage("已恢复快照，并保留恢复前备份。");
                    })
                  }
                >
                  备份当前数据并恢复
                </MotionButton>
              </footer>
            </>
          ) : (
            <>
              <p>
                自动保留最近 30
                份快照。恢复先预览，再新增版本；恢复前的数据也会备份。
              </p>
              <div className="pc-backup-create">
                <input
                  aria-label="快照名称"
                  maxLength={100}
                  value={snapshotName}
                  placeholder="快照名称（选填）"
                  onChange={(event) => setSnapshotName(event.target.value)}
                />
                <MotionButton outcome={error ? "error" : ""} busy={busy}
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await projectRequest("backup", {
                        name:
                          snapshotName.trim() ||
                          `手动快照 ${new Date().toLocaleString()}`,
                      });
                      setSnapshotName("");
                      await refreshSnapshots();
                      setMessage("已创建快照。");
                    })
                  }
                >
                  <Plus size={14} />
                  创建手动快照
                </MotionButton>
              </div>
              <div className="pc-snapshots">
                {history.map((item) => (
                  <div key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <small>
                        {new Date(item.createdAt).toLocaleString()} ·{" "}
                        {item.projects} 项目 / {item.profiles} 档案
                      </small>
                    </div>
                    <MotionButton outcome={error ? "error" : ""} busy={busy}
                      className="secondary-button"
                      disabled={busy}
                      onClick={() =>
                        void action(async () =>
                          setRestoring({
                            meta: item,
                            data: await projectRequest<ProjectState>(
                              "snapshot",
                              { id: item.id },
                            ),
                          }),
                        )
                      }
                    >
                      预览恢复
                    </MotionButton>
                  </div>
                ))}
              </div>
              {!history.length && (
                <div className="pc-empty">
                  <Archive size={28} />
                  <h3>还没有快照</h3>
                  <p>保存项目时会自动备份，也可以在上方手动创建。</p>
                </div>
              )}
            </>
          )}
        </Modal>
      )}</MotionPresence>
      <MotionPresence kind="dialog" present={!!(confirmation)}>{confirmation && (
        <Modal
          feedback={message}
          title={confirmation.title}
          close={() => setConfirmation(null)}
          busy={busy}
        >
          {errorBox}
          <p>{confirmation.description}</p>
          <footer>
            <ModalCancel />
            <MotionButton outcome={error ? "error" : ""} busy={busy}
              className="pc-danger-button"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await confirmation.run(data);
                  setConfirmation(null);
                })
              }
            >
              确认删除
            </MotionButton>
          </footer>
        </Modal>
      )}</MotionPresence>
      <MotionPresence kind="dialog" present={!!(storageOpen && owner)}>{storageOpen && owner && (
        <Modal
          feedback={message}
          title="配置文件与迁移"
          close={() => setStorageOpen(false)}
          busy={busy}
        >
          {errorBox}
          <p>
            项目中心使用安装目录下的 <strong>configs</strong>{" "}
            文件夹。复制整个文件夹可以带走项目、档案、备份和共享设置。
          </p>
          <div className="pc-path">
            <code>{storage?.directory}</code>
            <div className="pc-actions">
              <button
                className="secondary-button"
                onClick={() =>
                  void action(async () => {
                    await projectRequest("open-configs");
                  })
                }
              >
                <FolderOpen size={15} />
                打开 configs 目录
              </button>
              <MotionButton variant="copy"
                className="secondary-button"
                onClick={() => void copy(storage?.directory || "")}
              >
                <Copy size={14} />
                复制路径
              </MotionButton>
            </div>
          </div>
          <dl className="pc-file-list">
            <div>
              <dt>projects.json</dt>
              <dd>档案索引、版本及最近 30 份快照</dd>
            </div>
            <div>
              <dt>profile-&lt;编码 ID&gt;.json</dt>
              <dd>每个档案独立保存的项目、变量与说明</dd>
            </div>
            <div>
              <dt>sharing.json</dt>
              <dd>共享选项与访问口令哈希</dd>
            </div>
          </dl>
          <h3 className="pc-form-section">整目录迁移</h3>
          <ol className="pc-transfer-steps">
            <li>关闭两台电脑上的 DevKit 或独立服务。</li>
            <li>
              先备份目标电脑的 configs，再将来源 configs
              整个复制到目标安装目录的相同位置。
            </li>
            <li>
              确认当前用户可写，重新启动 DevKit 即可使用。主机 IP
              从新电脑重新获取。
            </li>
          </ol>
          <p>
            复制目录包含访问口令与快照；导出 JSON
            仅包含项目和档案。需要保留两边内容时，使用 JSON 合并导入。
          </p>
          {storage?.migratedFrom && (
            <p className="pc-hint">
              本次启动迁入自：{storage.migratedFrom}。旧目录原件未删除。
            </p>
          )}
          <footer>
            <ModalCancel>知道了</ModalCancel>
          </footer>
        </Modal>
      )}</MotionPresence>
    </section>
  );
}
