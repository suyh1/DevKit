export type ManagedModule = 'jar' | 'nginx';
export type HostGroup = { id: string; name: string; platform: string; revision: number; edit: boolean; control: boolean; error?: string; phase?: 'connecting' | 'deploying' | 'reading' | 'ready' | 'failed'; checkedAt?: string };
export type HostDraft = {
  name: string; address: string; mode: 'ssh' | 'share'; user: string; port: number; platform: 'linux' | 'win32'; auth: 'key' | 'password';
  modules: Record<ManagedModule, boolean>; password?: string; clearPassword?: boolean;
  visitor?: string;
  group?: string; tags?: string[]; pinned?: boolean; mac?: string; keyPath?: string; jumpHostId?: string; rdpPort?: number;
};
export type LanHost = HostDraft & { id: string; fingerprint?: string; hasPassword: boolean };
export type HostDiagnostic = { checkedAt: string; fingerprint?: string; checks: { name: string; state: 'pass' | 'fail' | 'skip'; detail: string }[] };
export type HostImportRow = { index: number; host?: LanHost; error?: string };
export type RemoteDirectory = { directory: string; parent: string; entries: { name: string; path: string; directory: boolean }[]; truncated: boolean };

let hostRevision = 0;
export const lanHostRevision = () => hostRevision;
export async function lanRequest<T>(action: string, value?: unknown): Promise<T> {
  const result = await window.devkitDesktop?.lanHosts?.(action, value);
  if (!result || result.error) throw new Error(result?.error || '请在 DevKit 桌面端管理局域网主机。');
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
