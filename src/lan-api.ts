import { remoteRequest, remoteResponse } from './workspace-remote';
import { downloadBlob } from './files';
import type { LanMonitorStatus } from './monitor-api';

export type ManagedModule = 'jar' | 'nginx';
export type HostGroup = { id: string; name: string; platform: string; revision: number; edit: boolean; control: boolean; backendTypes?: boolean; backendChecks?: boolean; supportsScripts?: boolean; supportsNodePath?: boolean; runtimeDiscovery?: boolean; error?: string; phase?: 'connecting' | 'deploying' | 'reading' | 'ready' | 'failed'; checkedAt?: string };
export type HostDraft = {
  name: string; address: string; mode: 'ssh' | 'share'; user: string; port: number; platform: 'linux' | 'win32'; auth: 'key' | 'password';
  modules: Record<ManagedModule, boolean>; password?: string; clearPassword?: boolean;
  visitor?: string; privateKey?: string; clearKey?: boolean;
  group?: string; tags?: string[]; pinned?: boolean; mac?: string; keyPath?: string; jumpHostId?: string; rdpPort?: number;
};
export type LanHost = HostDraft & { id: string; revision?: string; fingerprint?: string; hasPassword: boolean; hasStoredKey?: boolean; explicitKeyOnly?: boolean; canWake?: boolean; canRdp?: boolean; hasLogs?: boolean };
export type SharedLanHost = Partial<LanHost> & Pick<LanHost, 'id' | 'mode' | 'name' | 'address'>;
export type SharedLanInventory = { hosts: SharedLanHost[]; statuses: LanMonitorStatus[] };
export type HostDiagnostic = { checkedAt: string; fingerprint?: string; checks: { name: string; state: 'pass' | 'fail' | 'skip'; detail: string }[] };
export type HostImportRow = { index: number; host?: LanHost; error?: string };
export type RemoteDirectory = { directory: string; parent: string; entries: { name: string; path: string; directory: boolean }[]; truncated: boolean };

export const sharedLanInventory = (signal?: AbortSignal) => remoteRequest<SharedLanInventory>('lan-hosts', 'list', undefined, signal);
const transferLimit = 128 * 1024 * 1024;
export async function uploadSftp(id: string, path: string, file: File, signal?: AbortSignal) {
  if (file.size > transferLimit) throw new Error('网页单个文件最多 128 MiB。');
  const parameters = new URLSearchParams({ id, path, name: file.name });
  const response = await remoteResponse(`/api/lan-hosts/file-upload?${parameters}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file, signal,
  });
  return await response.json() as { name: string };
}
export async function downloadSftp(id: string, path: string, fallback: string, signal?: AbortSignal) {
  const response = await remoteResponse('/api/lan-hosts/file-download', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, path }), signal,
  });
  const encoded = /filename\*=UTF-8''(.+)/i.exec(response.headers.get('content-disposition') || '')?.[1];
  const name = (encoded ? decodeURIComponent(encoded) : fallback).replace(/[\x00-\x1f/\\]/g, '_');
  return downloadBlob(await response.blob(), name);
}
export const lanMonitorLabels: Record<string, string> = { up: '端口可达', down: '端口不可达', pending: '待确认', unknown: '待检测 / 已过期', paused: '已暂停', maintenance: '维护中' };

export function groupLanHosts<T extends Pick<LanHost, 'name' | 'group' | 'tags' | 'pinned'>>(hosts: T[], query: string, endpoint: (host: T) => string) {
  const search = query.trim().toLowerCase();
  const groups = new Map<string, T[]>();
  for (const host of hosts) {
    if (![host.name, endpoint(host), host.group, ...(host.tags || [])].join(' ').toLowerCase().includes(search)) continue;
    const key = host.pinned ? 'pinned' : `group:${host.group || ''}`;
    const group = groups.get(key) || [];
    group.push(host);
    groups.set(key, group);
  }
  return [...groups].sort(([a], [b]) => Number(a !== 'pinned') - Number(b !== 'pinned') || a.localeCompare(b, 'zh-CN'));
}

let hostRevision = 0;
export const lanHostRevision = () => hostRevision;
export async function lanRequest<T>(action: string, value?: unknown): Promise<T> {
  const result = window.devkitDesktop?.lanHosts
    ? await window.devkitDesktop.lanHosts(action, value)
    : { data: await remoteRequest<T>('lan-hosts', action, value) };
  if (result.error) throw new Error(result.error);
  if (['save', 'import', 'import-connections', 'remove', 'reset-trust'].includes(action) || action === 'test' && value && typeof value === 'object' && 'fingerprint' in value) hostRevision++;
  return result.data as T;
}

let migration: Promise<unknown> | undefined;
export function migrateLanHosts() {
  if (!window.devkitDesktop?.lanHosts) return Promise.resolve();
  return migration ??= Promise.resolve().then(() => {
    const raw = localStorage.getItem('devkit:lan-hosts');
    if (!raw || localStorage.getItem('devkit:lan-hosts-imported')) return;
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return;
    return lanRequest('import', values.map(value => ({ ...value, modules: { jar: value?.mode === 'share', nginx: value?.mode === 'share' } }))).then(() => localStorage.setItem('devkit:lan-hosts-imported', '1'));
  }).catch(() => { migration = undefined; });
}

export const targetGroup = (groups: HostGroup[] | undefined, id?: string) => groups?.find(group => group.id === (id || ''));
export const hostAccessLabel = (group: HostGroup) => group.error ? '连接不可用' : `${group.edit ? '可编辑' : '只读配置'} · ${group.control ? '可运行操作' : '无运行权限'}`;
export const hostRole = (group: HostGroup) => group.id ? `目标主机 · ${group.name}` : group.name;

export function groupInstances<T extends { hostId?: string }>(instances: T[], groups: HostGroup[] = []): (HostGroup & { items: T[] })[] {
  const byHost = new Map<string, T[]>();
  for (const item of instances) {
    const id = item.hostId || '';
    const items = byHost.get(id) || [];
    items.push(item);
    byHost.set(id, items);
  }
  if (!groups.length) return [{ id: '', name: '本机', platform: '', revision: 0, edit: false, control: false, items: instances }];
  return groups.map(group => ({ ...group, items: byHost.get(group.id) || [] }));
}
