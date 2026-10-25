export type NginxInstance = { id: string; name: string; main: string; files: string[]; executable: string; prefix: string; platform: 'win32' | 'linux' | 'any' };
export type NginxState = { schemaVersion: number; revision: number; instances: NginxInstance[]; platform: string; directory: string };
export type NginxDocument = { path: string; content: string; hash: string };
export type NginxStatus = { id: string; state: 'running' | 'stopped' | 'unknown' | 'platform'; pid?: number; pidPath?: string; detail: string };
export type NginxDetection = { found: boolean; executable: string; prefix: string; version: string; output: string; platform: string };
export type NginxCommand = 'test' | 'start' | 'stop' | 'reload';
export type NginxBackup = { id: string; createdAt: string; files: { path: string }[] };
export type NginxFiles = { files: NginxDocument[]; warnings: string[]; backup?: string };
export type NginxCreation = { name: string; platform: NginxInstance['platform']; executable: string; directory: string; mainName: string; commonName: string; port: number };
export type NginxReference = { from: string; to: string; line: number; context: string };
export type NginxInspection = { logs: { path: string; kinds: string[]; sources: { file: string; line: number; context: string }[] }[]; references: NginxReference[]; warnings: string[] };
export type NginxReview = { files: NginxDocument[]; impacts: { id: string; name: string; files: string[]; references: NginxReference[] }[]; warnings: string[] };
export type NginxLog = { path: string; text: string; size: number; modifiedAt: string; identity: string; truncated: boolean; scannedBytes: number };
export type NginxAction = 'inspect' | 'log-tail' | 'review' | 'get' | 'detect' | 'discover' | 'statuses' | 'documents' | 'save-files' | 'upsert' | 'create' | 'remove' | 'command' | 'pick' | 'backups' | 'backup-files';
declare global { interface Window { devkitNginx?: { request: (action: NginxAction, payload?: unknown) => Promise<unknown> } } }
export async function nginxRequest<T>(action: NginxAction, payload?: unknown): Promise<T> {
  if (!window.devkitNginx) throw new Error('Nginx 配置与进程管理需要在 DevKit 桌面端使用。');
  const result = await window.devkitNginx.request(action, payload) as { data?: T; error?: string };
  if (result.error) throw new Error(result.error);
  return result.data as T;
}
