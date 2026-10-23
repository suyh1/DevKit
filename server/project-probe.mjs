import { resolveProject } from "../shared/projects.mjs";

export async function probeProjects(store, input) {
  if (
    !input ||
    !Array.isArray(input.projectIds) ||
    input.projectIds.length > 20 ||
    input.projectIds.some((id) => typeof id !== "string")
  )
    throw new Error("每次最多检测 20 个项目。");
  const state = await store.get(),
    profile = state.profiles.find((item) => item.id === input.profileId);
  if (!profile) throw new Error("配置档案不存在。");
  const results = [],
    ids = [...new Set(input.projectIds)];
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, ids.length) }, async () => {
      while (index < ids.length) {
        const id = ids[index++],
          project = state.projects.find((item) => item.id === id),
          started = Date.now();
        try {
          if (!project) throw new Error("项目不存在。");
          const target = resolveProject(project, profile);
          if (target.error || !target.enabled)
            throw new Error(target.error || "项目已停用。");
          const response = await fetch(target.url, {
            method: "HEAD",
            redirect: "manual",
            signal: AbortSignal.timeout(4000),
          });
          await response.body?.cancel();
          results.push({
            id,
            state: response.status < 400 ? "online" : "http-error",
            status: response.status,
            elapsed: Date.now() - started,
          });
        } catch (error) {
          results.push({
            id,
            state: "error",
            error: error.name === "TimeoutError" ? "检测超时" : error.message,
            elapsed: Date.now() - started,
          });
        }
      }
    }),
  );
  return results;
}
