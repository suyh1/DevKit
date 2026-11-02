import { remoteRequest, remoteAccess } from './workspace-remote';
export type LogSource = { id: string; kind: 'jar' | 'nginx'; instanceId: string; name: string; path: string; mode: 'file' | 'console' };
export type LogCursor = { kind: string; identity: string; offset: number; anchor?: string };
export type LogRead = { id: string; text?: string; cursor?: LogCursor | null; reset?: boolean; truncated?: boolean; checkedAt?: string; error?: string; available?: boolean; more?: boolean };
export type LogCatalog = { sources: LogSource[]; warnings: string[] };
declare global { interface Window { devkitLogs?: { request(action: string, payload?: unknown): Promise<unknown> } } }
export const canExportLogs = () => !!window.devkitLogs || !!remoteAccess()?.services?.logs.export;
export async function logsRequest<T>(action: 'sources' | 'read' | 'export', payload?: unknown): Promise<T> {
  if (!window.devkitLogs) return remoteRequest<T>('logs', action, payload);
  const response = await window.devkitLogs.request(action, payload) as { data: T; error?: string };
  if (response.error) throw new Error(response.error);
  return response.data;
}
