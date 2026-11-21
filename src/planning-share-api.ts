import { remoteRequest } from './workspace-remote';

type DesktopBridge = { request(action: string, value?: unknown): Promise<unknown> };
declare global {
  interface Window {
    devkitFileShares?: DesktopBridge;
    devkitKnowledge?: DesktopBridge;
    devkitProjectTodos?: DesktopBridge;
  }
}

export type PublishedShare = { id: string; name: string; roots: { label: string; directory: boolean }[]; href: string };
export type FileShare = {
  id: string; name: string; roots: { path: string; label: string; directory: boolean }[];
  port: number; lan: boolean; enabled: boolean; published: boolean; running: boolean; error?: string; links: string[];
};
export type FileShareState = { revision: number; shares: FileShare[] };
export type TodoDocument = { id: string; name: string; body: string; published: boolean; revision: number };
type TodoState = { documents: TodoDocument[]; selectedId?: string };

export async function desktopRequest<T>(bridge: DesktopBridge | undefined, action: string, value?: unknown) {
  if (!bridge) throw new Error('请在 DevKit 桌面端打开此栏目。');
  const result = await bridge.request(action, value) as { data: T; error?: string; status?: number };
  if (result.error) throw Object.assign(new Error(result.error), { status: result.status });
  return result.data;
}
export const fileShareRequest = <T,>(action: string, value?: unknown) => desktopRequest<T>(window.devkitFileShares, action, value);
export const publishedShares = () => remoteRequest<{ shares: PublishedShare[] }>('file-shares', 'get');
export const todoRequest = (portal: boolean, action: string, value?: unknown) => portal
  ? remoteRequest<TodoState>('project-todos', action, value)
  : desktopRequest<TodoState>(window.devkitProjectTodos, action, value);
