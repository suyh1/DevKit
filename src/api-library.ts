import type { ApiState } from "../shared/api-workspace.mjs";
import { remoteRequest } from './workspace-remote';
export type ApiLibrary = {
  state: ApiState;
  canRestore: boolean;
  directory: string;
};
export async function apiLibrary(
  action: "get-library" | "save-library" | "restore-library",
  payload?: unknown,
): Promise<ApiLibrary> {
  if (!window.devkitHttp) return remoteRequest<ApiLibrary>('http', action, payload);
  const result = await window.devkitHttp.request(action, payload);
  if (result.error) throw new Error(result.error);
  return result.data as ApiLibrary;
}
