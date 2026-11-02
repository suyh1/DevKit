import { remoteRequest } from './workspace-remote';
export type MonitorSource = { type: 'project'; profileId: string; projectId: string } | { type: 'jar'; id: string };
export type MonitorConfig = { id: string; name: string; type: 'http' | 'tcp'; url: string; host: string; port: number; status: number; enabled: boolean; interval: number; timeout: number; failures: number; source: MonitorSource | null; maintenance: { start: string; end: string } | null };
export type MonitorSample = { at: string; ok: boolean; elapsed: number; detail: string };
export type Monitor = MonitorConfig & { state: string; detail?: string; checkedAt?: string; checking: boolean; availability: number | null; average: number | null; sampleCount: number; samples: MonitorSample[]; incidents: { id: string; start: string; end: string | null; detail: string; reason?: string }[] };
export type MonitorState = { revision: number; checkedAt: string; storageError: string; monitors: Monitor[] };
export type MonitorAction = 'get' | 'sources' | 'upsert' | 'remove' | 'check' | 'toggle';
declare global { interface Window { devkitMonitor?: { request(action: MonitorAction, payload?: unknown): Promise<unknown> } } }
export async function monitorRequest<T>(action: MonitorAction, payload?: unknown): Promise<T> {
  if (!window.devkitMonitor) return remoteRequest<T>('monitor', action, payload);
  const result = await window.devkitMonitor.request(action, payload) as { data: T; error?: string };
  if (result.error) throw new Error(result.error);
  return result.data;
}
