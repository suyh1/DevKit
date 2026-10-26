import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { probeProjects } from "./project-probe.mjs";
import { createSharedWorkspaces } from './shared-workspaces.mjs';
import { sharingServices, sharingAliases, hasLegacySharing } from '../shared/sharing.mjs';

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
export async function createProjectHost(store, dist, managers = { nginx: () => null, library: () => null }) {
  const workspaces = createSharedWorkspaces(managers);
  let server, activeContext,
    settings = await store.settings();
  const sessions = new Map(),
    attempts = new Map();
  const status = () => ({
    running: !!server?.listening,
    port: server?.address()?.port ?? settings.port ?? 8765,
    host: settings.host ?? "0.0.0.0",
    ...sharingAliases(sharingServices(settings)),
    services: sharingServices(settings),
    legacyAccess: hasLegacySharing(settings),
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
    workspaces.close();
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
      input.port > 65535
    )
      throw new Error("监听地址、端口或访问权限无效。");
    const services = sharingServices(input);
    if (!Object.values(services).some(service => service.enabled)) throw new Error("请至少开放一个共享服务。");
    let next = {
      ...settings,
      host: input.host,
      port: input.port,
      ...sharingAliases(services),
      services, accessVersion: 2,
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
      throw new Error("缺少共享工作台网页构建，请先构建应用。");
    include("portal.html");
    allowed.delete("/portal.html");
    const hosts = new Set(["localhost", ...localAddresses()]);
    if (server?.listening && settings.host === next.host && server.address().port === next.port) {
      await store.saveSettings(next);
      settings = next; activeContext.settings = next; activeContext.allowed = allowed; activeContext.hosts = hosts;
      sessions.clear(); workspaces.close(); attempts.clear();
      return status();
    }
    const context = { settings: next, allowed, hosts, ready: false };
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
        if (!context.ready) return json(503, { error: "共享设置正在应用，请稍后重试。" });
        const next = context.settings;
        const sessionPath = urlPath => urlPath.replace(/^\/api\/sharing\//, "/api/projects/");
        if (!request.headers.host) return json(403, { error: "Host required" });
        const origin = `http://${request.headers.host}`,
          url = new URL(request.url, origin);
        if (!context.hosts.has(new URL(origin).hostname) || url.origin !== origin)
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
        const capabilities = authorized ? { ...sharingAliases(next.services), services: next.services } : {};
        if (session && !authorized) { workspaces.release(token); sessions.delete(token); }
        if (
          sessionPath(url.pathname) === "/api/projects/session" &&
          request.method === "GET"
        )
          return json(200, {
            authenticated: authorized,
            ...capabilities,
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
            if (size > (url.pathname === "/api/http/save-library" ? 16_100_000 : 4_100_000))
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
          sessionPath(url.pathname) === "/api/projects/login" &&
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
            if (value.expires <= now) { workspaces.release(key); sessions.delete(key); }
          if (sessions.size >= 128) {
            const oldest = sessions.keys().next().value;
            workspaces.release(oldest); sessions.delete(oldest);
          }
          const created = randomBytes(32).toString("hex");
          sessions.set(created, { expires: now + 8 * 60 * 60 * 1000 });
          response.setHeader(
            "Set-Cookie",
            `devkit_project_session=${created}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
          );
          return json(200, {
            authenticated: true,
            ...sharingAliases(next.services), services: next.services,
            role: next.canEdit ? "editor" : "viewer",
          });
        }
        if (url.pathname.startsWith("/api/")) {
          if (!authorized)
            return json(401, { error: "请先登录共享工作台。" });
          if (
            sessionPath(url.pathname) === "/api/projects/logout" &&
            request.method === "POST"
          ) {
            sessions.delete(token);
            workspaces.release(token);
            response.setHeader(
              "Set-Cookie",
              "devkit_project_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
            );
            return json(200, {});
          }
          if (url.pathname.startsWith("/api/projects/") && !next.services.projects.enabled) return json(404, { error: "未开放项目中心共享。" });
          if (
            url.pathname === "/api/projects/state" &&
            request.method === "GET"
          )
            return json(200, await store.get());
          const workspaceRoute = /^\/api\/(nginx|http)\/([a-z-]+)$/.exec(url.pathname);
          if (workspaceRoute) {
            if (request.method !== 'POST') return json(405, { error: '需要 POST 请求。' });
            const payload = await body();
            if (workspaceRoute[1] === 'http' && workspaceRoute[2] === 'send')
              response.once('close', () => { if (!response.writableFinished) workspaces.cancel(token, payload?.id); });
            return json(200, await workspaces.request(workspaceRoute[1], workspaceRoute[2], payload, { token, settings: next }));
          }
          if (url.pathname === "/api/projects/probe" && request.method === "POST") {
            if (!next.services.projects.probe) return json(403, { error: "未授予项目探活权限。" });
            return json(200, await probeProjects(store, await body()));
          }
          if (!next.services.projects.edit)
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
          return json(404, { error: "接口不存在。" });
        }
        if (!["GET", "HEAD"].includes(request.method))
          return json(405, { error: "Method not allowed" });
        const requested = decodeURIComponent(url.pathname);
        if (requested !== "/" && !context.allowed.has(requested))
          return json(404, { error: "这里只提供共享工作台。" });
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
    const previous = server;
    // A scope change on the same port cannot bind while the old socket owns it.
    // Keep authentication/settings until the replacement succeeds, and restore on failure.
    const scopeChange = previous?.listening && previous.address().port === next.port;
    const bind = (target, config) => new Promise((resolve, reject) => {
      const done = () => { target.off('error', failed); resolve(); };
      const failed = error => { target.off('listening', done); reject(error); };
      target.once('error', failed); target.once('listening', done);
      target.listen(config.port, config.host);
    });
    const closeListener = async target => {
      target.closeAllConnections();
      await new Promise(resolve => target.close(resolve));
    };
    if (scopeChange) await closeListener(previous);
    try {
      await bind(listener, next);
      await store.saveSettings(next);
    } catch (error) {
      if (listener.listening) await closeListener(listener);
      if (scopeChange) {
        try { await bind(previous, settings); }
        catch (restoreError) { throw new Error(error.message + '；原监听恢复失败：' + restoreError.message); }
      }
      throw error;
    }
    server = listener; settings = next; activeContext = context; context.ready = true;
    sessions.clear(); workspaces.close(); attempts.clear();
    if (previous?.listening) await closeListener(previous);
    return status();
  }
  let lifecycle = Promise.resolve();
  const serialized = work => { const result = lifecycle.then(work); lifecycle = result.catch(() => {}); return result; };
  return { status, start: input => serialized(() => start(input)), stop: disable => serialized(() => stop(disable)) };
}
