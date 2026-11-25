import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { hostAccessLabel, hostRole } from './lan-api';
import type { HostGroup } from './lan-api';
import { canOperateJar, canOperateNginx, canWriteWorkspace, remoteAccess } from './workspace-remote';

type Inventory = { groups?: HostGroup[]; platform: string; revision: number; instances: { id: string; hostId?: string }[] };
type Request = <T>(action: 'get' | 'statuses', payload: { scope: string; hostId?: string }) => Promise<T>;
const phaseLabel = { connecting: '正在连接', deploying: '正在部署远程管理程序', reading: '正在读取实例', ready: '已连接', failed: '读取失败' };

export function useHostInventory<S extends Inventory, T extends { id: string }>(
  module: 'jar' | 'nginx', request: Request, state: S | null, setState: Dispatch<SetStateAction<S | null>>, setStatuses: Dispatch<SetStateAction<T[]>>,
) {
  const generation = useRef(0);
  const pending = useRef(new Map<string, number>());
  const statusPending = useRef(new Set<string>());
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => () => { generation.current++; pending.current.clear(); }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!pending.current.size || document.hidden) return;
      const revision = generation.current;
      void request<HostGroup[]>('get', { scope: 'inventory-progress' }).then(groups => {
        if (!Array.isArray(groups) || generation.current !== revision) return;
        setState(current => current && { ...current, groups: current.groups?.map(group => {
          const progress = groups.find(item => item.id === group.id);
          return pending.current.get(group.id) === revision && progress ? { ...group, phase: progress.phase } : group;
        }) });
      }).catch(() => {});
    }, 900);
    return () => clearInterval(timer);
  }, [request, setState]);

  async function statuses(id = '', revision = generation.current) {
    const key = `${revision}:${id}`;
    if (statusPending.current.has(key)) return;
    statusPending.current.add(key);
    try {
      const values = await request<T[]>('statuses', id ? { scope: 'inventory-host', hostId: id } : { scope: 'inventory-local' });
      if (generation.current === revision) setStatuses(current => [...current.filter(item => (item.id.includes(':') ? item.id.split(':')[0] : '') !== id), ...values]);
    } catch (failure) {
      if (id && generation.current === revision) {
        setStatuses(current => current.filter(item => !item.id.startsWith(id + ':')));
        setState(prev => prev && { ...prev, groups: prev.groups?.map(group => group.id === id ? { ...group, phase: 'failed', edit: false, control: false, error: (failure as Error).message } : group) });
      }
      throw failure;
    } finally { statusPending.current.delete(key); }
  }

  async function retry(id: string, revision = generation.current) {
    if (pending.current.get(id) === revision) return;
    pending.current.set(id, revision);
    setState(prev => prev && { ...prev, groups: prev.groups?.map(group => group.id === id ? { ...group, phase: 'connecting', error: undefined, control: false, edit: false } : group) });
    try {
      const next = await request<S>('get', { scope: 'inventory-host', hostId: id });
      if (generation.current !== revision) return;
      setState(prev => prev && { ...prev, instances: [...prev.instances.filter(item => item.hostId !== id), ...next.instances], groups: prev.groups?.map(group => group.id === id ? next.groups?.[0] || group : group) });
      if (next.groups?.[0]?.error) setStatuses(current => current.filter(item => !item.id.startsWith(id + ':')));
      else await statuses(id, revision);
    } catch (failure) {
      if (generation.current === revision) setState(prev => prev && { ...prev, groups: prev.groups?.map(group => group.id === id ? { ...group, phase: 'failed', control: false, edit: false, error: (failure as Error).message } : group) });
    } finally { if (pending.current.get(id) === revision) pending.current.delete(id); }
  }

  async function inventory() {
    const revision = ++generation.current;
    pending.current.clear();
    const base = await request<S>('get', { scope: 'inventory-local' });
    if (generation.current !== revision) return base;
    const old = latest.current;
    const groups = base.groups?.length ? base.groups : [{
      id: '', name: remoteAccess() ? '共享主机' : '本机', platform: base.platform, revision: base.revision,
      edit: canWriteWorkspace(module), control: module === 'jar' ? canOperateJar() : canOperateNginx(),
    }];
    const instances = [...base.instances, ...(old?.instances || []).filter(item => item.hostId && base.groups?.some(group => group.id === item.hostId))];
    const next = { ...base, instances, groups };
    setState(next);
    setStatuses(current => current.filter(item => !item.id.includes(':') || base.groups?.some(group => item.id.startsWith(group.id + ':'))));
    for (const group of base.groups || []) if (group.id) void retry(group.id, revision);
    return next;
  }

  async function poll() {
    const revision = generation.current;
    for (const group of latest.current?.groups || []) if (group.id && group.phase === 'ready') void statuses(group.id, revision).catch(() => {});
    await statuses('', revision);
  }
  return { inventory, retry, poll, statuses };
}

export function HostProgress({ groups, retry }: { groups?: HostGroup[]; retry: (id: string) => void }) {
  const remotes = groups?.filter(group => group.id) || [];
  if (!remotes.length) return null;
  const failed = remotes.filter(group => group.phase === 'failed').length;
  const ready = remotes.filter(group => !group.phase || group.phase === 'ready').length;
  const pending = remotes.length - ready - failed;
  return <details className="host-progress">
    <summary>目标主机 {remotes.length} 台<span>已连接 {ready}</span>
      {pending > 0 && <span>连接中 {pending}</span>}
      {failed > 0 && <span className="host-progress-failed">失败 {failed}</span>}
    </summary>
    <ul aria-label="目标主机连接状态">{remotes.map(group => <li key={group.id}>
      <strong>{hostRole(group)}</strong><span role="status">{phaseLabel[group.phase || 'ready']}{group.phase === 'ready' && ` · ${hostAccessLabel(group)}`}{group.error && ` · ${group.error}`}{group.checkedAt && ` · 上次成功 ${new Date(group.checkedAt).toLocaleTimeString()}`}</span>
      {group.phase === 'failed' && <button className="text-button" onClick={() => retry(group.id)}>重试</button>}
    </li>)}</ul>
  </details>;
}
