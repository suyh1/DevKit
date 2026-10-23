import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { probeProjects } from "./project-probe.mjs";

const csp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const localAddresses = () => [
  ...new Set([
    "127.0.0.1",
    ...Object.values(networkInterfaces())
      .flat()
      .filter((item) => item && item.family === "IPv4")
      .map((item) => item.address),
  ]),
];
export async function createProjectHost(store, dist) {
  let server,
    settings = await store.settings();
  const sessions = new Map(),
    attempts = new Map();
  const status = () => ({
    running: !!server?.listening,
    port: server?.address()?.port ?? settings.port ?? 8765,
    host: settings.host ?? "0.0.0.0",
    canEdit: settings.canEdit === true,
    autoStart: settings.autoStart === true,
    hasPassword: !!settings.hash,
    addresses: server?.listening
      ? (settings.host === "127.0.0.1" ? ["127.0.0.1"] : localAddresses()).map(
          (ip) => `http://${ip}:${server.address().port}/`,
        )
      : [],
    directory: store.directory,
  });
  async function stop(disableAutoStart = false) {
    const previous = server;
    server = undefined;
    sessions.clear();
    attempts.clear();
    if (previous) {
      previous.closeAllConnections();
      await new Promise((resolve, reject) =>
        previous.close((error) =>
          error && error.code !== "ERR_SERVER_NOT_RUNNING"
            ? reject(error)
            : resolve(),
        ),
      );
    }
    if (disableAutoStart) {
      settings = { ...settings, autoStart: false };
      await store.saveSettings(settings);
    }
    return status();
  }
  async function start(input) {
    if (
      !input ||
      !["0.0.0.0", "127.0.0.1"].includes(input.host) ||
      !Number.isInteger(input.port) ||
      input.port < 1 ||
      input.port > 65535 ||
      typeof input.canEdit !== "boolean"
    )
      throw new Error("监听地址、端口或访问权限无效。");
    let next = {
      ...settings,
      host: input.host,
      port: input.port,
      canEdit: input.canEdit,
      autoStart: input.autoStart === true,
    };
    if (input.password) {
      if (
        typeof input.password !== "string" ||
        input.password.length < 8 ||
        input.password.length > 128
      )
        throw new Error("访问口令需为 8–128 字符。");
      const salt = randomBytes(16).toString("hex");
      next = {
        ...next,
        salt,
        hash: scryptSync(input.password, salt, 32).toString("hex"),
      };
    }
    if (!next.hash) throw new Error("首次开启共享时请设置至少 8 位访问口令。");
    const manifest = JSON.parse(
      await readFile(path.join(dist, ".vite", "manifest.json"), "utf8"),
    );
    const allowed = new Set();
    function include(key) {
      const entry = manifest[key];
      if (!entry || allowed.has(`/${entry.file}`)) return;
      allowed.add(`/${entry.file}`);
      for (const asset of [...(entry.css || []), ...(entry.assets || [])])
        allowed.add(`/${asset}`);
      for (const dependency of [
        ...(entry.imports || []),
        ...(entry.dynamicImports || []),
      ])
        include(dependency);
    }
    if (!manifest["portal.html"])
      throw new Error("缺少项目中心网页构建，请先构建应用。");
    include("portal.html");
    allowed.delete("/portal.html");
    await stop();
    const hosts = new Set(["localhost", ...localAddresses()]);
    const listener = http.createServer(async (request, response) => {
      const json = (code, value) => {
        response.writeHead(code, {
          "Content-Type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(value));
      };
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Content-Security-Policy", csp);
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("X-Frame-Options", "DENY");
      try {
        if (!request.headers.host) return json(403, { error: "Host required" });
        const origin = `http://${request.headers.host}`,
          url = new URL(request.url, origin);
        if (!hosts.has(new URL(origin).hostname) || url.origin !== origin)
          return json(403, {
            error: "未知访问地址，请使用共享面板提供的 IP 地址。",
          });
        if (
          !["GET", "HEAD"].includes(request.method) &&
          request.headers.origin !== origin
        )
          return json(403, { error: "拒绝跨来源操作。" });
        const token =
          /(?:^|;\s*)devkit_project_session=([a-f0-9]{64})(?:;|$)/.exec(
            request.headers.cookie || "",
          )?.[1];
        const session = sessions.get(token);
        const authorized = !!session && session.expires > Date.now();
        if (
          url.pathname === "/api/projects/session" &&
          request.method === "GET"
        )
          return json(200, {
            authenticated: authorized,
            role: authorized && next.canEdit ? "editor" : "viewer",
          });
        async function body() {
          if (
            !/^application\/json(?:;|$)/i.test(
              request.headers["content-type"] || "",
            )
          )
            throw Object.assign(new Error("需要 JSON 请求。"), { status: 415 });
          const chunks = [];
          let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 4_100_000)
              throw Object.assign(new Error("请求过大。"), { status: 413 });
            chunks.push(chunk);
          }
          try {
            return JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            throw new Error("JSON 格式无效。");
          }
        }
        if (
          url.pathname === "/api/projects/login" &&
          request.method === "POST"
        ) {
          const ip = request.socket.remoteAddress,
            now = Date.now();
          if (attempts.size > 1024)
            for (const [key, value] of attempts)
              if (value.until <= now) attempts.delete(key);
          if (attempts.size > 1024 && !attempts.has(ip))
            return json(429, { error: "请求过多，请稍后重试。" });
          const attempt = attempts.get(ip) || { count: 0, until: now + 60_000 };
          if (attempt.until <= now) {
            attempt.count = 0;
            attempt.until = now + 60_000;
          }
          if (attempt.count >= 5)
            return json(429, { error: "口令尝试过多，请一分钟后重试。" });
          attempt.count++;
          attempts.set(ip, attempt);
          const { password } = await body();
          if (
            typeof password !== "string" ||
            password.length > 128 ||
            !timingSafeEqual(
              scryptSync(password, next.salt, 32),
              Buffer.from(next.hash, "hex"),
            )
          )
            return json(401, { error: "访问口令不正确。" });
          attempts.delete(ip);
          for (const [key, value] of sessions)
            if (value.expires <= now) sessions.delete(key);
          if (sessions.size >= 128)
            sessions.delete(sessions.keys().next().value);
          const created = randomBytes(32).toString("hex");
          sessions.set(created, { expires: now + 8 * 60 * 60 * 1000 });
          response.setHeader(
            "Set-Cookie",
            `devkit_project_session=${created}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
          );
          return json(200, {
            authenticated: true,
            role: next.canEdit ? "editor" : "viewer",
          });
        }
        if (url.pathname.startsWith("/api/")) {
          if (!authorized)
            return json(401, { error: "请先输入项目中心访问口令。" });
          if (
            url.pathname === "/api/projects/logout" &&
            request.method === "POST"
          ) {
            sessions.delete(token);
            response.setHeader(
              "Set-Cookie",
              "devkit_project_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
            );
            return json(200, {});
          }
          if (
            url.pathname === "/api/projects/state" &&
            request.method === "GET"
          )
            return json(200, await store.get());
          if (!next.canEdit)
            return json(403, { error: "当前共享为只读模式。" });
          if (
            url.pathname === "/api/projects/state" &&
            request.method === "PUT"
          ) {
            const value = await body();
            return json(200, await store.save(value.data, value.revision));
          }
          if (
            url.pathname === "/api/projects/snapshots" &&
            request.method === "GET"
          )
            return json(200, await store.snapshots());
          if (url.pathname === '/api/projects/snapshot' && request.method === 'POST')
            return json(200, await store.snapshot((await body()).id));
          if (
            url.pathname === "/api/projects/backup" &&
            request.method === "POST"
          )
            return json(200, { id: await store.backup((await body()).name) });
          if (
            url.pathname === "/api/projects/restore" &&
            request.method === "POST"
          ) {
            const value = await body();
            return json(200, await store.restore(value.id, value.revision));
          }
          if (
            url.pathname === "/api/projects/probe" &&
            request.method === "POST"
          )
            return json(200, await probeProjects(store, await body()));
          return json(404, { error: "接口不存在。" });
        }
        if (!["GET", "HEAD"].includes(request.method))
          return json(405, { error: "Method not allowed" });
        const requested = decodeURIComponent(url.pathname);
        if (requested !== "/" && !allowed.has(requested))
          return json(404, { error: "这里只提供项目中心。" });
        const file = requested === "/" ? "portal.html" : requested.slice(1);
        const absolute = path.resolve(dist, file),
          relative = path.relative(dist, absolute);
        if (
          relative.startsWith("..") ||
          path.isAbsolute(relative) ||
          file.includes("\\")
        )
          return json(403, { error: "路径无效。" });
        const content = await readFile(absolute);
        response.writeHead(200, {
          "Content-Type":
            mime[path.extname(file)] || "application/octet-stream",
        });
        response.end(request.method === "HEAD" ? undefined : content);
      } catch (error) {
        if (!response.headersSent)
          json(error.status || 400, { error: error.message || "请求失败。" });
        else response.end();
      }
    });
    listener.requestTimeout = 15_000;
    listener.headersTimeout = 10_000;
    listener.maxRequestsPerSocket = 100;
    await new Promise((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(next.port, next.host, resolve);
    });
    try {
      await store.saveSettings(next);
    } catch (error) {
      listener.closeAllConnections();
      await new Promise((resolve) => listener.close(resolve));
      throw error;
    }
    server = listener;
    settings = next;
    return status();
  }
  return { status, start, stop };
}
