export type NginxInstance = { id: string; name: string; main: string; files: string[]; executable: string; prefix: string; platform: 'win32' | 'linux' | 'any' };
export type NginxState = { schemaVersion: number; revision: number; instances: NginxInstance[]; platform: string; directory: string };
export type NginxDocument = { path: string; content: string; hash: string };
export type NginxStatus = { id: string; state: 'running' | 'stopped' | 'unknown' | 'platform'; pid?: number; pidPath?: string; detail: string };
export type NginxDetection = { found: boolean; executable: string; prefix: string; version: string; output: string; platform: string };
export type NginxCommand = 'test' | 'start' | 'stop' | 'reload';
export type NginxBackup = { id: string; createdAt: string; files: { path: string }[] };
export type NginxFiles = { files: NginxDocument[]; warnings: string[]; backup?: string };
export type NginxAction = 'get' | 'detect' | 'discover' | 'statuses' | 'documents' | 'save-files' | 'upsert' | 'remove' | 'command' | 'pick' | 'backups' | 'backup-files';
declare global { interface Window { devkitNginx?: { request: (action: NginxAction, payload?: unknown) => Promise<unknown> } } }
export async function nginxRequest<T>(action: NginxAction, payload?: unknown): Promise<T> {
  if (!window.devkitNginx) throw new Error('Nginx 配置与进程管理需要在 DevKit 桌面端使用。');
  const result = await window.devkitNginx.request(action, payload) as { data?: T; error?: string };
  if (result.error) throw new Error(result.error);
  return result.data as T;
}
