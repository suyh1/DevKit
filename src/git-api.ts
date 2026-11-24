import { useEffect, useState } from 'react';
import { desktopRequest } from './planning-share-api';
import { remoteRequest } from './workspace-remote';

declare global {
  interface Window {
    devkitGit?: { request(action: string, value?: unknown): Promise<unknown> };
  }
}
export type GitMode = 'changes' | 'history' | 'refs' | 'stash';
export type RepoLevel = 'none' | 'history' | 'worktree' | 'edit' | 'sync' | 'collaborate';
export type RepoPolicy = { default: RepoLevel; visitors: { name: string; level: RepoLevel }[] };
export type GitSeed = { mode: GitMode; clone?: string; branch?: string; path?: string; staged?: boolean; push?: boolean };
export type Repository = {
  id: string;
  name: string;
  root?: string;
  published: boolean;
  policy?: RepoPolicy;
  access?: { worktree: boolean; edit: boolean; sync: boolean };
};
export type Change = { path: string; index: string; work: string; conflict?: boolean };
export type Commit = { id: string; parents: string[]; author: string; date: string; subject: string; refs: string };
export type Reference = { kind: 'heads' | 'remotes' | 'tags'; name: string; hash: string; upstream?: string; peeled?: string };
export type GitState = {
  branch: string;
  head: string;
  worktree: boolean;
  mergeHead: string;
  snapshot: string;
  upstream: string;
  ahead: number;
  behind: number;
  files: Change[];
  stashes: { id: string; ref: string; message: string; date: string }[];
  revision: string;
  commits: Commit[];
  more: boolean;
  references: Reference[];
  remotes: string[];
};
export type GitMutation = (action: string, payload: Record<string, unknown>, notice: string) => Promise<boolean>;
export const gitRequest = <T>(portal: boolean, action: string, value?: unknown, signal?: AbortSignal) =>
  portal ? remoteRequest<T>('git', action, value, signal) : desktopRequest<T>(window.devkitGit, action, value);

export function useGitRead<T>(
  portal: boolean,
  action: string,
  payload: Record<string, unknown>,
  active: boolean,
  generation: number,
): { data?: T; error?: string; loading: boolean } {
  const params = JSON.stringify(payload);
  const scope = JSON.stringify([portal, action, params, active]);
  const key = JSON.stringify([scope, generation]);
  const [result, setResult] = useState<{ key: string; scope: string; data?: T; error?: string }>();
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    gitRequest<T>(portal, action, JSON.parse(params), controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ key, scope, data });
      },
      (error) => {
        if (!controller.signal.aborted) setResult({ key, scope, error: error.message });
      },
    );
    return () => controller.abort();
  }, [portal, action, params, active, key, scope]);
  return result?.scope === scope ? { ...result, loading: result.key !== key } : { loading: active };
}
