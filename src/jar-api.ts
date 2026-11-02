export type JarHealthConfig = { type: 'none' | 'http' | 'tcp'; url: string; host: string; port: number; interval: number; timeout: number; grace: number; failures: number; status: number };
export type JarPolicies = { health: JarHealthConfig; rotation: { enabled: boolean; maxMB: number; days: number; files: number }; restart: { enabled: boolean; maxRetries: number; delay: number; maxDelay: number; stable: number }; env: Record<string, string>; profiles: { id: string; name: string; env: Record<string, string> }[]; profile: string };
import { remoteRequest } from './workspace-remote';
export function newJarClientId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export type JarInstance = JarPolicies & { id: string; name: string; jar: string; executable: string; jvmArgs: string[]; appArgs: string[]; logMode: 'file' | 'silent' | 'console'; pidName: string; logName: string; stopTimeout: number };
export type JarState = { schemaVersion: number; revision: number; instances: JarInstance[]; platform: string; directory: string };
export type JarHealth = { state: 'disabled' | 'unknown' | 'starting' | 'stopped' | 'healthy' | 'degraded' | 'unhealthy'; detail: string; checkedAt?: string; latency?: number; failures?: number };
export type JarStatus = { id: string; state: 'running' | 'stopped' | 'exited' | 'unknown'; detail: string; checkedAt: string; pid?: number; uptime?: number; memory?: number; cpu?: number; size?: number; fileMissing?: boolean; executable?: string; pidPath: string; logPath: string; startedAt?: string; health?: JarHealth; supervision?: { active: boolean; state: string; attempts: number; nextRetryAt?: string; lastError?: string; logError?: string; profile?: string; pid?: number } };
export type JarStartup = { enabled: boolean; mode: 'login' | 'boot'; platform: string; target?: string; installedAt?: string; error?: string };
export type JavaDetection = { found: boolean; executable: string; version: string; output: string };
export type JarLog = { path: string; text: string; size: number; truncated: boolean };
export type JarCommand = 'start' | 'stop' | 'restart' | 'force-stop';
export type JarConsoleSnapshot = { available: boolean; generation?: string; cursor?: number; end?: number; text?: string; reset?: boolean; truncated?: boolean; inputOpen: boolean; phase?: string; lease: { label: string; expiresAt: number; mine: boolean } | null };
type JarAction = 'get' | 'detect' | 'statuses' | 'upsert' | 'remove' | 'command' | 'pick' | 'log-tail' | 'health-check' | 'startup-get' | 'startup-install' | 'startup-remove' | 'console-read' | 'console-claim' | 'console-input' | 'console-eof' | 'console-release';
declare global { interface Window { devkitJar?: { request: (action: JarAction, payload?: unknown) => Promise<unknown> } } }
export async function jarRequest<T>(action: JarAction, payload?: unknown): Promise<T> {
  if (!window.devkitJar) return remoteRequest<T>('jar', action, payload);
  const result = await window.devkitJar.request(action, payload) as { data?: T; error?: string };
  if (result.error) throw new Error(result.error);
  return result.data as T;
}
