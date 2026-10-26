import type { ApiState } from "../shared/api-workspace.mjs";
export type ApiLibrary = {
  state: ApiState;
  canRestore: boolean;
  directory: string;
};
export async function apiLibrary(
  action: "get-library" | "save-library" | "restore-library",
  payload?: unknown,
): Promise<ApiLibrary> {
  if (!window.devkitHttp) throw new Error("API项目文件存储需要DevKit桌面端。");
  const result = await window.devkitHttp.request(action, payload);
  if (result.error) throw new Error(result.error);
  return result.data as ApiLibrary;
}
