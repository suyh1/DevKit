import { resolveProject } from "../shared/projects.mjs";

// Shared by IPC and HTTP calls, including simultaneous visitors.
let active = 0;
const waiting = [];
async function withSlot(work) {
  if (active >= 3) await new Promise(resolve => waiting.push(resolve));
  else active++;
  try { return await work(); }
  finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

async function probeUrl(address) {
  const signal = AbortSignal.timeout(5000);
  let url = new URL(address), method = "HEAD", redirects = 0;
  for (;;) {
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("仅支持不含用户名和密码的 HTTP(S) 地址。");
    const response = await fetch(url, { method, redirect: "manual", signal });
    await response.body?.cancel();
    if (method === "HEAD" && [405, 501].includes(response.status)) {
      method = "GET";
      continue;
    }
    const location = response.headers.get("location");
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      if (redirects++ >= 5) throw new Error("重定向超过 5 次。");
      url = new URL(location, url);
      continue;
    }
    return response.status;
  }
}

function failureMessage(error) {
  if (error.name === "TimeoutError") return "检测超时（5 秒）";
  const code = error.cause?.code || error.code;
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return "DNS 解析失败";
  if (code === "ECONNREFUSED") return "连接被拒绝";
  if (["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) return "连接超时";
  if (/CERT|TLS|SSL|SELF_SIGNED/.test(code || "")) return "HTTPS 证书验证失败";
  return error.cause?.message || error.message;
}

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
          project = profile.projects.find((item) => item.id === id);
        await withSlot(async () => {
          const started = Date.now();
          try {
            if (!project) throw new Error("项目不存在。");
            const target = resolveProject(project, profile);
            if (target.error || !target.enabled)
              throw new Error(target.error || "项目已停用。");
            const status = await probeUrl(target.url);
            results.push({
              id,
              state: status >= 200 && status < 300 ? "online" : "http-error",
              status,
              elapsed: Date.now() - started,
              checkedAt: new Date().toISOString(),
            });
          } catch (error) {
            results.push({
              id,
              state: "error",
              error: failureMessage(error),
              elapsed: Date.now() - started,
              checkedAt: new Date().toISOString(),
            });
          }
        });
      }
    }),
  );
  return results;
}
