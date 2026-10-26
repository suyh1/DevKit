import { canWriteWorkspace, remoteAccess } from './workspace-remote';
import { newProjectId } from './project-api';
import { useEffect, useRef, useState } from "react";
import {
  Folder,
  FolderPlus,
  Plus,
  Search,
  Settings2,
  Copy,
  Trash2,
  Save,
  Download,
  Upload,
  RefreshCw,
  Archive,
  FileText,
  Code2,
  Send,
  BookOpen,
} from "lucide-react";
import type { ApiEndpoint, ApiProject } from "../shared/api-workspace.mjs";
import {
  initialApiState,
  newApiEndpoint,
  validateApiState,
} from "../shared/api-workspace.mjs";
import { apiLibrary } from "./api-library";
import type { ApiLibrary } from "./api-library";
import {
  newApiProject,
  importApiProject,
  exportApiProject,
  exportOpenApi,
  exportApiMarkdown,
} from "./api-formats";
import ApiEndpointEditor from "./ApiEndpointEditor";
import ApiDocumentation from "./ApiDocumentation";
import ApiDebug from "./ApiDebug";
import type { ApiHistory } from "./ApiDebug";
import ApiProjectSettings from "./ApiProjectSettings";
import { Modal, ModalCancel } from "./project-components";
import { useBeforeUnload, useConfirmation } from "./Confirmation";
import { saveText } from "./files";
import "./api-workspace.css";

const readPreference = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writePreference = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* API files remain available when browser preferences cannot be stored. */
  }
};

export default function ApiWorkspace({
  onBusy,
  onGenerate,
  onNotice,
}: {
  onBusy: (busy: boolean) => void;
  onGenerate: (config: string) => void;
  onNotice: (message: string) => void;
}) {
  const [library, setLibrary] = useState<ApiLibrary | null>(null),
    [projectId, setProjectId] = useState(""),
    [draft, setDraft] = useState<ApiEndpoint | null>(null),
    [projectDraft, setProjectDraft] = useState<ApiProject | null>(null),
    [environmentId, setEnvironmentId] = useState(""),
    [view, setView] = useState<"design" | "docs" | "debug">("docs"),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [sending, setSending] = useState(false),
    [imported, setImported] = useState<ReturnType<
      typeof importApiProject
    > | null>(null),
    [history, setHistory] = useState<ApiHistory[]>([]);
  const main = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null),
    lock = useRef(false),
    sendRef = useRef(false),
    confirm = useConfirmation();
  const state = library?.state || initialApiState(),
    project = state.projects.find((item) => item.id === projectId),
    saved = project?.endpoints.find((item) => item.id === draft?.id),
    dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved),
    environment = project?.environments.find(
      (item) => item.id === environmentId,
    );
  useBeforeUnload(dirty || sending);
  useEffect(() => {
    if (main.current) main.current.scrollTop = 0;
  }, [view, draft?.id]);
  useEffect(() => {
    onBusy(busy || sending);
  }, [busy, sending, onBusy]);
  useEffect(() => {
    let alive = true;
    void apiLibrary("get-library")
      .then((result) => {
        if (!alive) return;
        const id = readPreference("devkit:api-project"),
          item =
            result.state.projects.find((item) => item.id === id) ||
            result.state.projects[0];
        setLibrary(result);
        setProjectId(item?.id || "");
        setDraft(
          item?.endpoints[0] ? structuredClone(item.endpoints[0]) : null,
        );
        setEnvironmentId(
          item ? readPreference(`devkit:api-env:${item.id}`) || "" : "",
        );
      })
      .catch((error) => {
        if (alive) setError(String(error));
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (projectId) writePreference("devkit:api-project", projectId);
  }, [projectId]);
  useEffect(() => {
    if (projectId)
      writePreference(`devkit:api-env:${projectId}`, environmentId);
  }, [projectId, environmentId]);
  function adopt(
    result: ApiLibrary,
    nextProject = projectId,
    nextEndpoint = draft?.id,
  ) {
    const selected =
      result.state.projects.find((item) => item.id === nextProject) ||
      result.state.projects[0];
    const endpoint =
      selected?.endpoints.find((item) => item.id === nextEndpoint) ||
      selected?.endpoints[0];
    setLibrary(result);
    setProjectId(selected?.id || "");
    setDraft(endpoint ? structuredClone(endpoint) : null);
    if (!selected?.environments.some((item) => item.id === environmentId))
      setEnvironmentId("");
  }
  async function action(work: () => Promise<void>) {
    if (lock.current || sendRef.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (error) {
      setError(String(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function allowChange() {
    if (sendRef.current || lock.current) {
      onNotice("请先取消或等待当前操作完成。");
      return false;
    }
    return (
      !dirty ||
      (await confirm({
        title: "放弃接口草稿？",
        detail: "接口定义尚未保存。放弃后载入所选内容，已保存的项目不会变化。",
        confirm: "放弃草稿",
        cancel: "继续编辑",
        context: "API工作台",
      }))
    );
  }
  async function commit(
    projects: ApiProject[],
    nextProject = projectId,
    nextEndpoint = draft?.id,
  ) {
    if (!canWriteWorkspace()) throw new Error("当前共享为只读模式。");
    const data = validateApiState({ ...state, projects });
    const result = await apiLibrary("save-library", {
      data,
      revision: state.revision,
    });
    adopt(result, nextProject, nextEndpoint);
    onNotice(`API工作区已保存 · 版本${result.state.revision}`);
  }
  function selectProject(item: ApiProject) {
    void allowChange().then((allowed) => {
      if (allowed) {
        setProjectId(item.id);
        setDraft(item.endpoints[0] ? structuredClone(item.endpoints[0]) : null);
        setEnvironmentId(readPreference(`devkit:api-env:${item.id}`) || "");
        setSearch("");
        setError("");
      }
    });
  }
  function selectEndpoint(endpoint: ApiEndpoint) {
    void allowChange().then((allowed) => {
      if (allowed) {
        setDraft(structuredClone(endpoint));
        setError("");
      }
    });
  }
  function addEndpoint(group = "") {
    void allowChange().then((allowed) => {
      if (!allowed || !project) return;
      const endpoint = newApiEndpoint(newProjectId(), group);
      let i = 1;
      while (project.endpoints.some((item) => item.path === endpoint.path))
        endpoint.path = `/new-endpoint-${i++}`;
      setDraft(endpoint);
      setView("design");
      setError("");
    });
  }
  function openProject(item?: ApiProject) {
    void allowChange().then((allowed) => {
      if (allowed) {
        setDraft(saved ? structuredClone(saved) : null);
        setProjectDraft(item ? structuredClone(item) : newApiProject());
        setError("");
      }
    });
  }
  async function saveEndpoint() {
    if (!project || !draft) return;
    await commit(
      state.projects.map((item) =>
        item.id === project.id
          ? {
              ...item,
              endpoints: item.endpoints.some((row) => row.id === draft.id)
                ? item.endpoints.map((row) =>
                    row.id === draft.id ? draft : row,
                  )
                : [...item.endpoints, draft],
            }
          : item,
      ),
    );
  }
  function stageImport(text: string) {
    const result = importApiProject(text),
      original = result.project.name;
    let name = original,
      index = 1;
    while (state.projects.some((item) => item.name === name)) {
      const suffix = ` 导入${index++}`;
      name = original.slice(0, 100 - suffix.length) + suffix;
    }
    setImported({ ...result, project: { ...result.project, name } });
  }
  function onSending(value: boolean) {
    sendRef.current = value;
    setSending(value);
  }
  const visible =
    project?.endpoints.filter((item) =>
      `${item.name} ${item.method} ${item.path} ${item.group}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    ) || [];
  const unsaved = !!draft && !saved;
  return (
    <section className="api-workspace" aria-busy={busy}>
      <div className="api-topline">
        <div>
          <div className="eyebrow">LOCAL API WORKSPACE</div>
          <h1>接口工作台</h1>
          <p>设计接口、维护文档与调试，共用一份本地项目定义。</p>
        </div>
        <div className="api-actions">
          <button
            className="secondary-button"
            disabled={!canWriteWorkspace() || busy || sending || (!window.devkitHttp && !remoteAccess())}
            onClick={() => openProject()}
          >
            <FolderPlus size={15} />
            新建API项目
          </button>
          <button
            className="secondary-button"
            disabled={!canWriteWorkspace() || busy || sending}
            onClick={() => file.current?.click()}
          >
            <Upload size={15} />
            导入
          </button>
          <button
            className="icon-button"
            aria-label="刷新API工作区"
            disabled={busy || sending}
            onClick={() =>
              void action(async () => {
                const result = await apiLibrary("get-library");
                if (dirty)
                  (setLibrary(result),
                    onNotice("已刷新，接口草稿仍保留；请核对后保存。"));
                else adopt(result);
              })
            }
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      {error && (
        <div className="api-error" role="alert">
          <strong>操作未完成</strong>
          <p>{error}</p>
        </div>
      )}
      <input
        ref={file}
        className="sr-only"
        type="file"
        accept=".json,.yaml,.yml"
        aria-label="导入API项目文件"
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          event.target.value = "";
          if (!chosen) return;
          void action(async () => {
            if (chosen.size > 8_000_000) throw new Error("导入文件超过8MB。");
            stageImport(await chosen.text());
          });
        }}
      />
      {!library && (
        <div className="api-blank">
          <BookOpen size={32} />
          <h2>{error ? "API工作区尚未加载" : "正在读取本地接口项目…"}</h2>
          <p>项目、环境、接口和上次保存备份位于安装目录 configs/http。</p>
        </div>
      )}
      {library && (
        <div className="api-shell">
          <aside className="api-sidebar">
            <label className="api-project-select">
              API项目
              <select
                aria-label="选择API项目"
                value={projectId}
                disabled={busy || sending}
                onChange={(event) => {
                  const next = state.projects.find(
                    (item) => item.id === event.target.value,
                  );
                  if (next) selectProject(next);
                }}
              >
                {!state.projects.length && <option value="">尚无项目</option>}
                {state.projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {project && (
              <>
                <div className="api-section-heading">
                  <strong>
                    接口目录 <small>{project.endpoints.length}</small>
                  </strong>
                  <div className="api-actions">
                    <button
                      className="icon-button"
                      aria-label="API项目设置"
                      disabled={!canWriteWorkspace() || busy || sending}
                      onClick={() => openProject(project)}
                    >
                      <Settings2 size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="新增API接口"
                      disabled={!canWriteWorkspace() || busy || sending}
                      onClick={() => addEndpoint()}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
                <label className="api-search">
                  <Search size={14} />
                  <input
                    aria-label="搜索API接口"
                    placeholder="搜索名称、方法或路径"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                {[...new Set(["", ...project.groups])].map((group) => {
                  const rows = visible.filter((item) => item.group === group);
                  return (
                    <details className="api-folder" key={group} open>
                      <summary>
                        <Folder size={14} />
                        <span>{group || "未分组"}</span>
                        <small>{rows.length}</small>
                      </summary>
                      <div>
                        {rows.map((item) => (
                          <button
                            className={`api-tree-item ${draft?.id === item.id ? "selected" : ""}`}
                            aria-pressed={draft?.id === item.id}
                            key={item.id}
                            disabled={busy || sending}
                            onClick={() => selectEndpoint(item)}
                          >
                            <span
                              className={`api-method method-${item.method.toLowerCase()}`}
                            >
                              {item.method}
                            </span>
                            <span>
                              <strong>{item.name}</strong>
                              <small>{item.path}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    </details>
                  );
                })}
                {!visible.length && (
                  <p className="api-empty-note">
                    {search ? "没有匹配的接口。" : "点击 + 添加第一个接口。"}
                  </p>
                )}
                <div className="api-sidebar-actions">
                  <button
                    className="text-button"
                    disabled={busy || sending}
                    onClick={() =>
                      void action(async () => {
                        onNotice(
                          await saveText(
                            exportOpenApi(project),
                            `${project.name.replace(/[\\/:*?"<>|]/g, "_")}.openapi.json`,
                          ),
                        );
                      })
                    }
                  >
                    <Download size={14} />
                    导出OpenAPI
                  </button>
                  <button
                    className="text-button"
                    disabled={busy || sending}
                    onClick={() =>
                      void action(async () => {
                        onNotice(
                          await saveText(
                            exportApiMarkdown(project),
                            "api-documentation.md",
                          ),
                        );
                      })
                    }
                  >
                    <FileText size={14} />
                    导出Markdown文档
                  </button>
                  <button
                    className="text-button"
                    disabled={busy || sending}
                    onClick={() =>
                      void action(async () => {
                        if (
                          await confirm({
                            title: "导出完整API项目？",
                            detail:
                              "文件会包含接口正文、鉴权值及全部环境变量，均为明文。",
                            confirm: "导出项目",
                            context: "API项目备份",
                          })
                        )
                          onNotice(
                            await saveText(
                              exportApiProject(project),
                              "devkit-api-project.json",
                            ),
                          );
                      })
                    }
                  >
                    <Archive size={14} />
                    备份项目
                  </button>
                  <button
                    className="text-button api-danger"
                    disabled={!canWriteWorkspace() || busy || sending}
                    onClick={() => {
                      void allowChange().then((allowed) => {
                        if (allowed)
                          void action(async () => {
                            if (
                              await confirm({
                                title: `删除API项目“${project.name}”？`,
                                detail:
                                  "项目中的全部接口和环境一起移除。可通过“恢复上次保存”找回最近一次操作前的工作区。",
                                confirm: "删除项目",
                                context: "API工作台",
                              })
                            )
                              await commit(
                                state.projects.filter(
                                  (item) => item.id !== project.id,
                                ),
                                "",
                                "",
                              );
                          });
                      });
                    }}
                  >
                    <Trash2 size={14} />
                    删除项目
                  </button>
                </div>
              </>
            )}
            <section className="api-session-history">
              <div className="api-section-heading">
                <h3>
                  会话历史 <small>{history.length}/20</small>
                </h3>
                {history.length > 0 && (
                  <button
                    className="text-button"
                    onClick={() => setHistory([])}
                  >
                    清空
                  </button>
                )}
              </div>
              {history.map((row) => (
                <button
                  key={row.id}
                  disabled={busy || sending}
                  onClick={() =>
                    void allowChange().then((allowed) => {
                      if (!allowed) return;
                      const target = state.projects.find(
                        (item) => item.id === row.projectId,
                      );
                      if (!target) {
                        onNotice("此历史所属项目已删除。");
                        return;
                      }
                      setProjectId(target.id);
                      setDraft(structuredClone(row.endpoint));
                      setEnvironmentId(row.environmentId);
                      setView("debug");
                    })
                  }
                >
                  <strong>
                    {row.endpoint.method} · {row.status}
                  </strong>
                  <span>{row.endpoint.name}</span>
                  <small>{row.time} · 点击恢复请求定义</small>
                </button>
              ))}
              {!history.length && (
                <p className="api-empty-note">发送后记录，仅留在内存。</p>
              )}
            </section>
            <div className="api-storage-note">
              <code>{library.directory}</code>
              <span>版本 {state.revision} · 本机存储</span>
              <button
                className="text-button"
                disabled={!canWriteWorkspace() || !library.canRestore || busy || sending}
                onClick={() =>
                  void action(async () => {
                    if (
                      await confirm({
                        title: "恢复上次保存前的API工作区？",
                        detail:
                          "将恢复整个API工作区的上一个版本，并保留恢复前数据作为新备份；接口草稿将被替换。",
                        confirm: "恢复上次保存",
                        context: "API工作台",
                      })
                    )
                      adopt(
                        await apiLibrary("restore-library", {
                          revision: state.revision,
                        }),
                      );
                  })
                }
              >
                恢复上次保存
              </button>
            </div>
          </aside>
          <div className="api-main" ref={main}>
            {!project && (
              <div className="api-blank">
                <FolderPlus size={36} />
                <h2>建立本地接口项目</h2>
                <p>
                  按目录管理接口，通过环境变量切换服务，设计定义自动生成文档，并可直接调试。
                </p>
                <div className="api-actions">
                  <button className="run-button" onClick={() => openProject()}>
                    新建API项目
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => file.current?.click()}
                  >
                    导入OpenAPI / Swagger / Postman
                  </button>
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    try {
                      const previous = readPreference("devkit:http-collection");
                      if (!previous)
                        throw new Error("没有已保存的旧请求集合。");
                      stageImport(previous);
                    } catch (error) {
                      setError(String(error));
                    }
                  }}
                >
                  迁入原HTTP请求集合
                </button>
              </div>
            )}
            {project && !draft && (
              <div className="api-blank">
                <FileText size={36} />
                <h2>{project.name}</h2>
                <p className="api-prose">
                  {project.description || "这个项目尚未添加接口。"}
                </p>
                <button className="run-button" onClick={() => addEndpoint()}>
                  添加第一个接口
                </button>
              </div>
            )}
            {project && draft && (
              <>
                <div className="api-editor-top">
                  <header className="api-endpoint-header">
                    <div>
                      <small>
                        {project.name} / {draft.group || "未分组"}
                      </small>
                      <h2>
                        {draft.name || "未命名接口"}
                        {dirty && (
                          <span className="api-draft-badge">未保存</span>
                        )}
                      </h2>
                      <code>
                        {draft.method} {draft.path}
                      </code>
                    </div>
                    <div className="api-actions">
                      <button
                        className="icon-button"
                        aria-label="复制API接口"
                        title="复制接口到独立路径"
                        disabled={!canWriteWorkspace() || busy || sending}
                        onClick={() => {
                          void allowChange().then((allowed) => {
                            if (!allowed) return;
                            let path = `${draft.path}-copy`,
                              index = 2;
                            while (
                              project.endpoints.some(
                                (item) =>
                                  item.method === draft.method &&
                                  item.path === path,
                              )
                            )
                              path = `${draft.path}-copy-${index++}`;
                            setDraft({
                              ...structuredClone(draft),
                              id: newProjectId(),
                              name: `${draft.name} 副本`,
                              path,
                            });
                            setView("design");
                          });
                        }}
                      >
                        <Copy size={16} />
                      </button>
                      <button
                        className="icon-button api-danger"
                        aria-label="删除API接口"
                        disabled={!canWriteWorkspace() || busy || sending}
                        onClick={() =>
                          void action(async () => {
                            if (
                              await confirm({
                                title: `删除接口“${draft.name}”？`,
                                detail: unsaved
                                  ? "未保存的新接口草稿将被丢弃。"
                                  : "仅从当前API项目删除该接口，其他项目不受影响；操作前状态会保留为上次保存。",
                                confirm: "删除接口",
                                context: "API工作台",
                              })
                            ) {
                              if (unsaved)
                                setDraft(
                                  project.endpoints[0]
                                    ? structuredClone(project.endpoints[0])
                                    : null,
                                );
                              else
                                await commit(
                                  state.projects.map((item) =>
                                    item.id === project.id
                                      ? {
                                          ...item,
                                          endpoints: item.endpoints.filter(
                                            (row) => row.id !== draft.id,
                                          ),
                                        }
                                      : item,
                                  ),
                                  project.id,
                                  "",
                                );
                            }
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                      <button
                        className="run-button"
                        disabled={!canWriteWorkspace() || busy || sending || !dirty}
                        onClick={() => void action(saveEndpoint)}
                      >
                        <Save size={15} />
                        保存接口
                      </button>
                    </div>
                  </header>
                  <div className="api-view-toolbar">
                    <div
                      className="api-tabs"
                      role="tablist"
                      aria-label="API接口视图"
                    >
                      {[
                        ["docs", "接口文档", BookOpen],
                        ["design", "接口设计", Code2],
                        ["debug", "运行调试", Send],
                      ].map(([id, name, Icon]) => {
                        const Component = Icon as typeof BookOpen;
                        return (
                          <button
                            key={id as string}
                            role="tab"
                            aria-selected={view === id}
                            disabled={sending || (id === "design" && !canWriteWorkspace())}
                            onClick={() => setView(id as typeof view)}
                          >
                            <Component size={15} />
                            {name as string}
                          </button>
                        );
                      })}
                    </div>
                    <label>
                      当前环境
                      <select
                        aria-label="API当前环境"
                        value={environment?.id || ""}
                        disabled={sending}
                        onChange={(event) =>
                          setEnvironmentId(event.target.value)
                        }
                      >
                        <option value="">项目默认</option>
                        {project.environments.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
                {view === "design" && (
                  <ApiEndpointEditor
                    endpoint={draft}
                    groups={project.groups}
                    onChange={setDraft}
                    onError={setError}
                  />
                )}
                {view === "docs" && (
                  <ApiDocumentation project={project} endpoint={draft} />
                )}
                <div hidden={view !== "debug"} inert={view !== "debug"}>
                  <ApiDebug
                    key={`${project.id}:${draft.id}`}
                    project={project}
                    endpoint={draft}
                    environment={environment}
                    onChange={setDraft}
                    onBusy={onSending}
                    onGenerate={onGenerate}
                    onNotice={onNotice}
                    onHistory={(row) =>
                      setHistory((current) => {
                        let size = 0;
                        return [row, ...current]
                          .filter(
                            (item) =>
                              (size += JSON.stringify(item.endpoint).length) <=
                              4_000_000,
                          )
                          .slice(0, 20);
                      })
                    }
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {projectDraft && (
        <ApiProjectSettings
          draft={projectDraft}
          onChange={setProjectDraft}
          onClose={() => setProjectDraft(null)}
          busy={busy}
          error={error}
          onSave={() =>
            void action(async () => {
              const next = projectDraft;
              await commit(
                state.projects.some((item) => item.id === next.id)
                  ? state.projects.map((item) =>
                      item.id === next.id ? next : item,
                    )
                  : [...state.projects, next],
                next.id,
              );
              setProjectDraft(null);
            })
          }
        />
      )}
      {imported && (
        <Modal
          title="API导入预览"
          closeLabel="关闭API导入预览"
          close={() => setImported(null)}
          busy={busy}
          wide
        >
          <h3>{imported.project.name}</h3>
          <p>
            {imported.project.endpoints.length} 个接口 ·{" "}
            {imported.project.groups.length} 个目录 ·{" "}
            {imported.project.environments.length} 个环境
          </p>
          <p>
            将作为独立项目导入，保留现有项目。导入不发送请求，也不执行脚本。文件中的示例、正文和凭据会保存在本机。
          </p>
          {imported.warnings.length > 0 && (
            <ul className="api-import-warnings">
              {imported.warnings.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ul>
          )}
          <ul className="api-import-list">
            {imported.project.endpoints.slice(0, 100).map((item) => (
              <li key={item.id}>
                <span
                  className={`api-method method-${item.method.toLowerCase()}`}
                >
                  {item.method}
                </span>
                <code>{item.path}</code>
                <strong>{item.name}</strong>
              </li>
            ))}
          </ul>
          {error && (
            <p className="api-error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <ModalCancel />
            <button
              className="run-button"
              disabled={!canWriteWorkspace() || busy || sending}
              onClick={() =>
                void allowChange().then((allowed) => {
                  if (allowed)
                    void action(async () => {
                      const next = {
                        ...imported.project,
                        id: newProjectId(),
                      };
                      await commit([...state.projects, next], next.id, "");
                      setImported(null);
                    });
                })
              }
            >
              确认导入API项目
            </button>
          </footer>
        </Modal>
      )}
    </section>
  );
}
