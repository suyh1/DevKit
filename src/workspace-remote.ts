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
export const canOperateNginx = () => !access || (access.services ? access.services.nginx.enabled && access.services.nginx.control : access.role !== 'viewer' && access.nginxControl === true);
export const canSendHttp = () => !access || (access.services ? access.services.http.enabled && access.services.http.send : access.role !== 'viewer');
export async function remoteRequest<T>(
  module: "http" | "nginx" | "jar" | "monitor" | "logs",
  action: string,
  payload?: unknown,
): Promise<T> {
  const response = await fetch(`/api/${module}/${action}`, {
    method: "POST",
    credentials: "same-origin",
    keepalive: module === 'jar' && action === 'console-release',
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  const result = await response.json();
  if (response.status === 401) window.dispatchEvent(new Event('devkit:session-required'));
  if (!response.ok)
    throw new Error(result.error || `请求失败（${response.status}）`);
  return result as T;
}
