import { remoteRequest, remoteAccess } from './workspace-remote';
export type LogSource = { id: string; kind: 'jar' | 'nginx'; instanceId: string; name: string; path: string; mode: 'file' | 'console'; hostId?: string; hostName?: string };
export type LogCursor = { kind: string; identity: string; offset: number; anchor?: string };
export type LogRead = { id: string; text?: string; cursor?: LogCursor | null; reset?: boolean; truncated?: boolean; checkedAt?: string; error?: string; available?: boolean; more?: boolean };
export type LogCatalog = { sources: LogSource[]; warnings: string[]; hosts?: { id: string; name: string }[] };
declare global { interface Window { devkitLogs?: { request(action: string, payload?: unknown): Promise<unknown> } } }
export const canExportLogs = () => !!window.devkitLogs || !!remoteAccess()?.services?.logs.export;
export const canReadRawLogs = () => !!window.devkitLogs || !!remoteAccess()?.services?.logs.raw;
export async function logsRequest<T>(action: 'sources' | 'read' | 'export', payload?: unknown, signal?: AbortSignal): Promise<T> {
  if (!window.devkitLogs) return remoteRequest<T>('logs', action, payload, signal);
  const response = await window.devkitLogs.request(action, payload) as { data: T; error?: string };
  if (response.error) throw new Error(response.error);
  return response.data;
}
export async function eachRemoteLogCatalog(
  hosts: LogCatalog['hosts'], live: () => boolean,
  receive: (host: NonNullable<LogCatalog['hosts']>[number], catalog: LogCatalog) => void,
  failed: (host: NonNullable<LogCatalog['hosts']>[number], error: Error) => void,
) {
  const pending = [...(hosts || [])];
  await Promise.all([0, 1].map(async () => {
    while (pending.length && live()) {
      const host = pending.shift()!;
      try {
        const result = await logsRequest<LogCatalog>('sources', { hostId: host.id });
        if (live()) receive(host, result);
      } catch (error) { if (live()) failed(host, error as Error); }
    }
  }));
}
