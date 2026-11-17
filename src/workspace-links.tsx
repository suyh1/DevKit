import { useState, useSyncExternalStore } from 'react';
import { Link2 } from 'lucide-react';
import { copyText } from './motion-primitives';
import { useSharingStatus } from './Sharing';
import { workspaceModules } from './catalog';
import { jarRequest } from './jar-api';
import type { JarState } from './jar-api';
import { nginxRequest } from './nginx-api';
import type { NginxState } from './nginx-api';
import { apiLibrary } from './api-library';
import { monitorRequest } from './monitor-api';
import type { MonitorState } from './monitor-api';
import { eachRemoteLogCatalog, logsRequest } from './logs-api';
import type { LogCatalog } from './logs-api';
import { projectRequest } from './project-api';
import type { ProjectState } from '../shared/projects.mjs';
import type { HostGroup } from './lan-api';

export type WorkspacePage = typeof workspaceModules[number]['id'];
export type WorkspaceLink = { page: WorkspacePage; id?: string };
export type WorkspaceResult = WorkspaceLink & { label: string; detail: string };
export const workspaceHash = (page: WorkspacePage, id?: string) => `#${page}${id ? '/' + encodeURIComponent(id) : ''}`;
export function parseWorkspaceLink(hash: string): WorkspaceLink | undefined {
  const [name, ...parts] = hash.slice(1).split('/');
  const resource = parts.join('/');
  const page = workspaceModules.find(item => item.id === name)?.id;
  if (!page || !resource) return page ? { page } : undefined;
  try { return { page, id: decodeURIComponent(resource).slice(0, 240) }; }
  catch { return { page, id: resource.slice(0, 240) }; }
}
export const missingResourceLink = (name: string) => `链接中的${name}已移除或当前访客无权访问。`;
export function inventoryLinkStatus(id: string, instances: { id: string }[], groups: HostGroup[] = []) {
  const host = id.includes(':') ? groups.find(group => group.id === id.split(':')[0]) : undefined;
  if (host?.error || host?.phase === 'failed') return 'failed';
  if (host?.phase && host.phase !== 'ready') return 'pending';
  return instances.some(item => item.id === id) ? 'found' : 'missing';
}
function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener);
  window.addEventListener('popstate', listener);
  return () => { window.removeEventListener('hashchange', listener); window.removeEventListener('popstate', listener); };
}
export function useWorkspaceResource(page: WorkspacePage) {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  const link = parseWorkspaceLink(hash);
  return link?.page === page ? link.id : undefined;
}
export function openWorkspaceLink(page: WorkspacePage, id?: string) {
  const hash = workspaceHash(page, id);
  if (location.hash === hash) window.dispatchEvent(new Event('hashchange'));
  else location.hash = hash;
}
export function ResourceLink({ page, id }: { page: WorkspacePage; id: string }) {
  const [status, setStatus] = useState('');
  const sharing = useSharingStatus();
  const addresses = page !== 'lan-hosts' && sharing?.running && sharing.services[page]?.enabled ? sharing.addresses : [];
  return <button type="button" className="text-button" title={status || '复制资源链接'} aria-label={status || '复制资源链接'} onClick={() => {
    const url = new URL(addresses.find(address => !/\/\/(?:127\.0\.0\.1|localhost):/.test(address)) || addresses[0] || location.href);
    url.hash = workspaceHash(page, id);
    void copyText(url.href).then(() => setStatus('链接已复制'), () => setStatus('复制链接失败'));
  }}><Link2 size={14} /><span>{status || '复制链接'}</span></button>;
}

export function workspaceSearch(pages: WorkspacePage[], add: (results: WorkspaceResult[]) => void) {
  const modules = workspaceModules.filter(item => pages.includes(item.id));
  const perModule = (page: WorkspacePage, id: string, label: string, detail: string) => ({ page, id, label, detail });
  add(modules.map(item => ({ page: item.id, label: item.name, detail: item.description })));
  const jobs: Partial<Record<WorkspacePage, () => Promise<void>>> = {
    projects: async () => {
      const state = await projectRequest<ProjectState>('get');
      add(state.profiles.flatMap(profile => profile.projects.map(item => perModule('projects', `${profile.id}:${item.id}`, item.name, profile.name))));
    },
    jar: () => inventory('jar', jarRequest<JarState>),
    nginx: () => inventory('nginx', nginxRequest<NginxState>),
    http: async () => {
      const { state } = await apiLibrary('get-library');
      add(state.projects.flatMap(project => project.endpoints.map(item => perModule('http', `${project.id}:${item.id}`, item.name, `${project.name} · ${item.method} ${item.path}`))));
    },
    monitor: async () => {
      const state = await monitorRequest<MonitorState>('get');
      add(state.monitors.map(item => perModule('monitor', item.id, item.name, `监控 · ${item.executionHost || item.host || item.url}`)));
    },
    logs: async () => {
      const catalog = await logsRequest<LogCatalog>('sources', { scope: 'inventory-local' });
      const publish = (result: LogCatalog) => add(result.sources.map(item => perModule('logs', item.id, item.name, item.hostName || item.path || '日志来源')));
      publish(catalog);
      await eachRemoteLogCatalog(catalog.hosts, () => true, (_host, result) => publish(result), () => {});
    },
  };
  async function inventory(page: 'jar' | 'nginx', request: (action: 'get', value: unknown) => Promise<JarState | NginxState>) {
    const base = await request('get', { scope: 'inventory-local' });
    const publish = (state: JarState | NginxState, host = '') => add(state.instances.map(item => perModule(page, item.id, item.name, [host, 'jar' in item ? item.jar : item.main].filter(Boolean).join(' · '))));
    publish(base);
    await Promise.allSettled((base.groups || []).filter(group => group.id).map(async group => publish(await request('get', { scope: 'inventory-host', hostId: group.id }), group.name)));
  }
  return Promise.allSettled(modules.map(item => jobs[item.id]?.()));
}
