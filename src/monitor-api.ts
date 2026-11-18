import { remoteRequest } from './workspace-remote';
export type MonitorSource = { type: 'project'; profileId: string; projectId: string } | { type: 'jar' | 'lan'; id: string };
export type MonitorConfig = { id: string; name: string; type: 'http' | 'tcp'; url: string; host: string; port: number; status: number; enabled: boolean; interval: number; timeout: number; failures: number; source: MonitorSource | null; maintenance: { start: string; end: string } | null; webhook?: { url: string; down: boolean; up: boolean } | null };
export type MonitorSample = { at: string; ok: boolean; elapsed: number; detail: string };
export type Monitor = MonitorConfig & { state: string; detail?: string; checkedAt?: string; executionHost?: string; sourceHost?: string; runRestriction?: string; notification?: { event: 'down' | 'up'; at: string; state: 'pending' | 'failed' | 'sent'; detail: string }; checking: boolean; availability: number | null; average: number | null; sampleCount: number; samples: MonitorSample[]; incidents: { id: string; start: string; end: string | null; detail: string; reason?: string }[] };
export type MonitorState = { revision: number; checkedAt: string; storageError: string; monitors: Monitor[] };
export type MonitorAction = 'get' | 'sources' | 'upsert' | 'remove' | 'check' | 'toggle' | 'lan-statuses';
export type LanMonitorStatus = { hostId: string; id: string; checkedAt?: string; state: string; elapsed?: number };
declare global { interface Window { devkitMonitor?: { request(action: MonitorAction, payload?: unknown): Promise<unknown> } } }
export async function monitorRequest<T>(action: MonitorAction, payload?: unknown): Promise<T> {
  if (!window.devkitMonitor) return remoteRequest<T>('monitor', action, payload);
  const result = await window.devkitMonitor.request(action, payload) as { data: T; error?: string };
  if (result.error) throw new Error(result.error);
  return result.data;
}

export async function ensureLanMonitor(host: { id: string; name: string }) {
  const id = `lan-${host.id}`;
  for (let attempt = 0; ; attempt++) {
    const current = await monitorRequest<MonitorState>('get');
    const existing = current.monitors.find(item => item.source?.type === 'lan' && item.source.id === host.id);
    if (existing) return existing.id;
    try {
      await monitorRequest('upsert', { revision: current.revision, monitor: { id, name: host.name, type: 'tcp', enabled: true, source: { type: 'lan', id: host.id } } });
      return id;
    } catch (failure) {
      if (attempt || !(failure as Error).message.includes('配置已被更新')) throw failure;
    }
  }
}
