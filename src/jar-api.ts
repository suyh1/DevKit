export type JarHealthConfig = { type: 'none' | 'http' | 'tcp'; url: string; host: string; port: number; interval: number; timeout: number; grace: number; failures: number; status: number };
export type JarPolicies = { health: JarHealthConfig; rotation: { enabled: boolean; maxMB: number; days: number; files: number }; restart: { enabled: boolean; maxRetries: number; delay: number; maxDelay: number; stable: number }; env: Record<string, string>; profiles: { id: string; name: string; env: Record<string, string> }[]; profile: string };
export type JarInstance = JarPolicies & { id: string; name: string; jar: string; executable: string; jvmArgs: string[]; appArgs: string[]; logMode: 'file' | 'silent'; pidName: string; logName: string; stopTimeout: number };
export type JarState = { schemaVersion: number; revision: number; instances: JarInstance[]; platform: string; directory: string };
export type JarHealth = { state: 'disabled' | 'unknown' | 'starting' | 'stopped' | 'healthy' | 'degraded' | 'unhealthy'; detail: string; checkedAt?: string; latency?: number; failures?: number };
export type JarStatus = { id: string; state: 'running' | 'stopped' | 'exited' | 'unknown'; detail: string; checkedAt: string; pid?: number; uptime?: number; memory?: number; cpu?: number; size?: number; fileMissing?: boolean; executable?: string; pidPath: string; logPath: string; startedAt?: string; health?: JarHealth; supervision?: { active: boolean; state: string; attempts: number; nextRetryAt?: string; lastError?: string; logError?: string; profile?: string; pid?: number } };
export type JarStartup = { enabled: boolean; mode: 'login' | 'boot'; platform: string; target?: string; installedAt?: string; error?: string };
export type JavaDetection = { found: boolean; executable: string; version: string; output: string };
export type JarLog = { path: string; text: string; size: number; truncated: boolean };
export type JarCommand = 'start' | 'stop' | 'restart' | 'force-stop';
type JarAction = 'get' | 'detect' | 'statuses' | 'upsert' | 'remove' | 'command' | 'pick' | 'log-tail' | 'health-check' | 'startup-get' | 'startup-install' | 'startup-remove';
declare global { interface Window { devkitJar?: { request: (action: JarAction, payload?: unknown) => Promise<unknown> } } }
export async function jarRequest<T>(action: JarAction, payload?: unknown): Promise<T> {
  if (!window.devkitJar) throw new Error('JAR 管理需要在 Windows / Linux 桌面端使用，文件与进程均位于运行 DevKit 的本机。');
  const result = await window.devkitJar.request(action, payload) as { data?: T; error?: string };
  if (result.error) throw new Error(result.error);
  return result.data as T;
}
