import { workspaceModules, type WorkspaceModuleId } from './catalog';

export type WorkspaceLink = { page: WorkspaceModuleId; id?: string };
export function parseWorkspaceLink(hash: string): WorkspaceLink | undefined {
  const [name, ...parts] = hash.slice(1).split('/');
  const resource = parts.join('/');
  const page = workspaceModules.find(item => item.id === name)?.id;
  if (!page || !resource) return page ? { page } : undefined;
  try { return { page, id: decodeURIComponent(resource).slice(0, 240) }; }
  catch { return { page, id: resource.slice(0, 240) }; }
}
