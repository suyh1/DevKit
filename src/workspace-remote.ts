import type { SharingServices } from '../shared/sharing.mjs';
export type RemoteAccess = {
  services?: SharingServices;
  role: "viewer" | "editor" | "owner";
  nginxControl?: boolean;
};
let access: RemoteAccess | null = null;
export const setRemoteAccess = (value: RemoteAccess | null) => {
  access = value;
};
export const remoteAccess = () => access;
export const canWriteWorkspace = (module: 'nginx' | 'http' | 'jar' | 'monitor') => !access || (access.services ? access.services[module].enabled && access.services[module].edit : access.role !== 'viewer');
export const canOperateMonitor = () => !access || !!(access.services?.monitor.enabled && access.services.monitor.control);
export const canOperateJar = () => !access || !!(access.services?.jar.enabled && access.services.jar.control);
export const canReadWorkspaceLogs = (module: 'jar' | 'nginx') => !access || !!(access.services?.logs.enabled && access.services.logs[module]);
export const canOperateNginx = () => !access || (access.services ? access.services.nginx.enabled && access.services.nginx.control : access.role !== 'viewer' && access.nginxControl === true);
export const canSendHttp = () => !access || (access.services ? access.services.http.enabled && access.services.http.send : access.role !== 'viewer');
export async function remoteResponse(path: string, options: RequestInit) {
  const requestAccess = access;
  const response = await fetch(path, { ...options, credentials: 'same-origin' });
  if (response.status === 401 && requestAccess === access) window.dispatchEvent(new Event('devkit:session-required'));
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw Object.assign(new Error(result.error || `请求失败（${response.status}）`), { status: response.status });
  }
  return response;
}
export async function remoteRequest<T>(
  module: "git" | "dev-docs" | "knowledge" | "http" | "nginx" | "jar" | "monitor" | "logs" | "lan-hosts" | "file-shares" | "project-todos" | "transfer" | "mock" | "whiteboard" | "relay",
  action: string,
  payload?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const route = module === 'transfer' ? `api/transfer/${action}` : `/api/${module}/${action}`;
  const response = await remoteResponse(route, {
    method: "POST",
    signal,
    keepalive: module === 'transfer' && action === 'remove' || module === 'jar' && action === 'console-release' || module === 'lan-hosts' && ['terminal-close', 'scan-cancel', 'rdp-close'].includes(action),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  return await response.json() as T;
}
