import type { ProjectState } from "../shared/projects.mjs";

export type ProjectAction =
  | "session"
  | "get"
  | "save"
  | "snapshots"
  | "snapshot"
  | "storage"
  | "open-configs"
  | "backup"
  | "restore"
  | "probe"
  | "login"
  | "logout"
  | "sharing"
  | "start"
  | "stop"
  | "open";
export type Snapshot = {
  id: string;
  name: string;
  createdAt: string;
  projects: number;
  profiles: number;
};
export type Sharing = {
  running: boolean;
  port: number;
  host: string;
  canEdit: boolean;
  autoStart: boolean;
  hasPassword: boolean;
  addresses: string[];
  directory: string;
};
export type ProjectStorage = {
  directory: string;
  portable: boolean;
  migratedFrom: string;
  error?: string;
};
export type Session = {
  authenticated: boolean;
  role: "owner" | "editor" | "viewer";
};
export type Health = {
  id: string;
  state: string;
  status?: number;
  elapsed: number;
  error?: string;
};
declare global {
  interface Window {
    devkitProjects?: {
      request: (action: ProjectAction, payload?: unknown) => Promise<unknown>;
    };
  }
}
export const isProjectDesktop = () => !!window.devkitProjects;
export const newProjectId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
export async function projectRequest<T>(
  action: ProjectAction,
  payload?: unknown,
): Promise<T> {
  if (window.devkitProjects) {
    const response = (await window.devkitProjects.request(action, payload)) as {
      data?: T;
      error?: string;
    };
    if (response.error) throw new Error(response.error);
    return response.data as T;
  }
  const routes: Partial<Record<ProjectAction, [string, string]>> = {
    session: ["session", "GET"],
    get: ["state", "GET"],
    save: ["state", "PUT"],
    snapshots: ["snapshots", "GET"],
    snapshot: ["snapshot", "POST"],
    backup: ["backup", "POST"],
    restore: ["restore", "POST"],
    probe: ["probe", "POST"],
    login: ["login", "POST"],
    logout: ["logout", "POST"],
  };
  const route = routes[action];
  if (!route) throw new Error("此操作仅可在主机桌面端进行。");
  const response = await fetch(`/api/projects/${route[0]}`, {
    method: route[1],
    credentials: "same-origin",
    headers:
      payload === undefined
        ? undefined
        : { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || `请求失败（${response.status}）`);
  return result as T;
}
export const saveProjects = (data: ProjectState, revision: number) =>
  projectRequest<ProjectState>("save", { data, revision });
export async function openProjectUrl(url: string) {
  if (window.devkitProjects) await projectRequest("open", { url });
  else window.open(url, "_blank", "noopener,noreferrer");
}
