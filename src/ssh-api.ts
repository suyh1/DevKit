export type ManagedModule = 'jar' | 'nginx';
export type SshHost = { mode: 'ssh'; name: string; address: string; user: string; port: number; platform: 'linux' | 'win32' };
export type SshTarget = { id: string; name: string; path: string; executable: string; args: string[]; files: string[]; prefix: string };
export type SshRequest = { host: SshHost; module: ManagedModule; action: string; target?: SshTarget; payload?: unknown };

export async function sshRequest<T>(value: SshRequest): Promise<T> {
  const result = await window.devkitDesktop?.requestSsh?.(value);
  if (!result || result.error) throw new Error(result?.error || 'SSH 管理暂不可用。');
  return result.data as T;
}
