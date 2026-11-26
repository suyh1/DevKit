import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { readFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { browserAssets, csp, jsonBody, localAddresses, serveAsset } from './browser-http.mjs';
import { downloadTransfer } from './transfer-download.mjs';
import path from "node:path";
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { probeProjects } from "./project-probe.mjs";
import { createSharedWorkspaces } from './shared-workspaces.mjs';
import { sharingServices, sharingAliases, hasLegacySharing, visitorServices } from '../shared/sharing.mjs';
import { gitReads } from './git-workspace.mjs';
import { createSharingAudit, matchesPassword, passwordRecord, updateVisitors } from './sharing-visitors.mjs';
import { webTransferLimit } from './lan-sftp.mjs';

const auditActions = new Set(['command', 'replace-begin', 'replace-finish', 'replace-restore', 'apply-draft', 'restore-backup', 'restore-disk', 'reload-restored', 'save-files', 'config-save', 'create', 'upsert', 'remove', 'start', 'stop', 'send', 'save-library', 'restore-library', 'startup-install', 'startup-remove', 'console-claim', 'toggle', 'export']);
const lanAuditActions = new Set(['save', 'remove', 'import-connections', 'test', 'diagnose', 'reset-trust', 'terminal-open', 'scan-start', 'wake', 'rdp-open', 'file-upload', 'file-download']);
const sessionCookie = (token, maxAge, secure) => `devkit_project_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
const visitorsFor = settings => settings.visitors || [];
const tlsFor = settings => settings.tls || null;
function normalizeTls(tls) {
  if (!tls) return null;
  if (![tls.cert, tls.key].every(value => typeof value === 'string' && value.length <= 4096 && !/[\x00-\x1f]/.test(value) && path.isAbsolute(value))) throw new Error('请填写 PEM 证书及私钥的绝对路径。');
  const hostname = typeof tls.hostname === 'string' ? tls.hostname.trim().toLowerCase() : '';
  if (hostname && !(isIP(hostname) === 4 || /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(hostname))) throw new Error('HTTPS 域名必须为有效的主机名或 IPv4 地址。');
  return { cert: tls.cert, key: tls.key, hostname };
}

export async function createProjectHost(store, dist, managers = { nginx: () => null, library: () => null }) {
  const workspaces = createSharedWorkspaces(managers);
  const audit = createSharingAudit(store.directory);
  let server, activeContext,
    settings = await store.settings();
  const sessions = new Map(),
    attempts = new Map();
  function revoke(token) {
    managers.collab?.()?.releaseDirect?.(token);
    sessions.get(token)?.abort.abort();
    sessions.delete(token);
    workspaces.release(token);
  }
  function clearSessions() {
    for (const [token, session] of sessions) {
      managers.collab?.()?.releaseDirect?.(token);
      session.abort.abort();
    }
    sessions.clear();
    workspaces.close();
  }
  const status = () => ({
    running: !!server?.listening,
    port: server?.address()?.port ?? settings.port ?? 8765,
    host: settings.host ?? "0.0.0.0",
    ...sharingAliases(sharingServices(settings)),
    services: sharingServices(settings),
    legacyAccess: hasLegacySharing(settings),
    autoStart: settings.autoStart === true,
    hasPassword: !!settings.hash,
    allowDefault: settings.allowDefault !== false,
    tls: tlsFor(settings),
    visitors: visitorsFor(settings).map(({ name, services }) => ({ name, services: sharingServices({ services }), hasPassword: true })),
    addresses: server?.listening
      ? (settings.tls?.hostname ? [settings.tls.hostname] : settings.host === "127.0.0.1" ? ["127.0.0.1"] : localAddresses()).map(
          (ip) => `${settings.tls ? 'https' : 'http'}://${ip}:${server.address().port}/`,
        )
      : [],
    directory: store.directory,
  });
  async function stop(disableAutoStart = false) {
    const previous = server;
    server = undefined;
    clearSessions();
    attempts.clear();
    if (previous) {
      previous.disconnectSockets();
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
    await audit.flush();
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
      allowDefault: input.allowDefault === undefined ? settings.allowDefault !== false : input.allowDefault === true,
      tls: normalizeTls(input.tls === undefined ? settings.tls : input.tls),
      visitors: updateVisitors(input.visitors, visitorsFor(settings)),
    };
    if (input.password) next = { ...next, ...passwordRecord(input.password) };
    if (next.allowDefault && !next.hash) throw new Error("首次开启共享时请设置至少 8 位访问口令。");
    if (!next.allowDefault && !next.visitors.some(visitor => Object.values(visitorServices(services, visitor.services)).some(service => service.enabled))) throw new Error('请给至少一名访客开放一个已启用的共享服务。');
    const tls = next.tls && { cert: await readFile(next.tls.cert), key: await readFile(next.tls.key), minVersion: 'TLSv1.2' };
    const tlsVersion = tls && createHash('sha256').update(tls.cert).update(tls.key).digest('hex');
    const allowed = await browserAssets(dist, "portal.html");
    const hosts = new Set(["localhost", ...localAddresses(), ...(next.tls?.hostname ? [next.tls.hostname] : [])]);
    if (server?.listening && settings.host === next.host && server.address().port === next.port && tlsVersion === activeContext.tlsVersion) {
      await store.saveSettings(next);
      const globalChanged = settings.hash !== next.hash || (settings.allowDefault !== false) !== next.allowDefault || JSON.stringify(sharingServices(settings)) !== JSON.stringify(next.services);
      const updated = new Map(next.visitors.map(visitor => [visitor.name, visitor]));
      const revoked = new Set(visitorsFor(settings).filter(visitor => JSON.stringify(visitor) !== JSON.stringify(updated.get(visitor.name))).map(visitor => visitor.name));
      for (const [token, session] of sessions) if (globalChanged || revoked.has(session.visitor)) revoke(token);
      for (const name of revoked) audit.record(name, 'visitor.update', 'revoked');
      settings = next; activeContext.settings = next; activeContext.allowed = allowed; activeContext.hosts = hosts;
      return status();
    }
    const context = { settings: next, allowed, hosts, ready: false, tlsVersion };
    const handler = async (request, response) => {
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
        const publication = context.settings;
        const secure = !!publication.tls;
        if (secure) response.setHeader('Strict-Transport-Security', 'max-age=86400');
        const sessionPath = urlPath => urlPath.replace(/^\/api\/sharing\//, "/api/projects/");
        if (!request.headers.host) return json(403, { error: "Host required" });
        const origin = `${secure ? 'https' : 'http'}://${request.headers.host}`,
          url = new URL(request.url, origin);
        if (!context.hosts.has(new URL(origin).hostname) || url.origin !== origin)
          return json(403, {
            error: "未知访问地址，请使用共享面板提供的 IP 地址。",
          });
        if (url.pathname.startsWith('/mock/')) {
          const manager = managers.collab?.();
          if (!manager || !publication.services.mock.enabled) return json(404, { error: '模拟服务未开放。' });
          return await manager.serveMock(request, response, url, () => context === activeContext && context.settings.services.mock.enabled);
        }
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
        const visitor = session?.visitor ? visitorsFor(publication).find(item => item.name === session.visitor) : undefined;
        const authorized = !!session && session.expires > Date.now() && (session.visitor ? !!visitor : publication.allowDefault !== false);
        const services = visitor ? visitorServices(publication.services, visitor.services) : publication.services;
        const next = { services, ...sharingAliases(services) };
        const capabilities = authorized ? { ...next, visitor: session.visitor } : {};
        if (session && !authorized) revoke(token);
        function ensureCurrentSession() {
          if (!authorized || sessions.get(token) !== session || session.expires <= Date.now()) throw Object.assign(new Error('请先登录共享工作台。'), { status: 401 });
        }
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
          const largeDocument = ['/api/http/save-library', '/api/project-todos/save', '/api/project-todos/create'].includes(url.pathname);
          const limit = largeDocument ? 16_100_000 : url.pathname === '/api/lan-hosts/rdp-open' ? 16_000 : url.pathname === '/api/lan-hosts/rdp-input' ? 80_000 : 4_100_000;
          return jsonBody(request, limit);
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
          const { password, visitor: entered } = await body();
          if (publication !== context.settings || context !== activeContext) return json(409, { error: '共享设置已变化，请重新提交登录。' });
          const name = typeof entered === 'string' && entered.length <= 48 ? entered.normalize('NFC').trim() : '';
          const account = name ? visitorsFor(publication).find(item => item.name === name) : publication.allowDefault !== false && publication.hash ? publication : undefined;
          if (!matchesPassword(password, account)) {
            audit.record(name && account ? name : '', 'session.login', 'denied');
            return json(401, { error: "访客名称或访问口令不正确。" });
          }
          if (session) revoke(token);
          attempts.delete(ip);
          for (const [key, value] of sessions)
            if (value.expires <= now) revoke(key);
          if (sessions.size >= 128) {
            const oldest = sessions.keys().next().value;
            revoke(oldest);
          }
          const created = randomBytes(32).toString("hex");
          sessions.set(created, { visitor: name, expires: now + 8 * 60 * 60 * 1000, abort: new AbortController() });
          const granted = name ? visitorServices(publication.services, account.services) : publication.services;
          audit.record(name, 'session.login', 'ok');
          response.setHeader(
            "Set-Cookie",
            sessionCookie(created, 28800, secure),
          );
          return json(200, {
            authenticated: true,
            ...sharingAliases(granted), services: granted, visitor: name,
            role: granted.projects.edit ? "editor" : "viewer",
          });
        }
        if (url.pathname.startsWith("/api/")) {
          if (
            sessionPath(url.pathname) === "/api/projects/logout" &&
            request.method === "POST"
          ) {
            revoke(token);
            if (authorized) audit.record(session.visitor, 'session.logout', 'ok');
            response.setHeader(
              "Set-Cookie",
              sessionCookie('', 0, secure),
            );
            return json(200, {});
          }
          if (!authorized)
            return json(401, { error: "请先登录共享工作台。" });
          const download = /^\/api\/transfer\/download\/([a-f0-9-]{36})$/.exec(url.pathname);
          if (download) {
            if (!services.transfer.enabled) return json(404, { error: '局域网快传未开放。' });
            if (request.method !== 'GET') return json(405, { error: '需要 GET 请求。' });
            const manager = managers.collab?.();
            if (!manager) return json(503, { error: '收件箱暂不可用。' });
            return await downloadTransfer(manager, { id: download[1], ticket: url.searchParams.get('ticket') }, { owner: token, authorize: ensureCurrentSession }, response, session.abort.signal);
          }
          const collaboration = /^\/api\/(transfer|mock|whiteboard|relay)\/([a-z]+)$/.exec(url.pathname);
          if (collaboration) {
            const [, module, action] = collaboration;
            if (!services[module].enabled) return json(404, { error: '此栏目未开放。' });
            if (request.method !== 'POST') return json(405, { error: '需要 POST 请求。' });
            const readOnly = ['list', 'read'].includes(action) || module === 'whiteboard' && action === 'image' || module === 'transfer' && ['unlock', 'claim', 'answer'].includes(action);
            const operating = module === 'relay' && ['detect', 'start', 'stop'].includes(action);
            if (operating && !services.relay.control) return json(403, { error: '需要检测与启停转发权限。' });
            if (!readOnly && !operating && !services[module].edit) return json(403, { error: '当前访客只有查看权限。' });
            const manager = managers.collab?.();
            if (!manager) return json(503, { error: '共享工具暂不可用。' });
            const input = await body();
            const data = await manager.request(module, action, input, {
              routingDiscovery: services.relay.edit && services.relay.control,
              sshAllowed: services['lan-hosts'].enabled && services['lan-hosts'].terminal,
              authorize: ensureCurrentSession, actor: session.visitor || '共享访客', owner: token, publisherSession: token,
            });
            ensureCurrentSession();
            if (!readOnly && !['part', 'begin', 'cancel', 'sweep', 'presence', 'reply'].includes(action)) audit.record(session.visitor, module + '.' + action, 'ok');
            return json(200, data ?? null);
          }
          if (url.pathname.startsWith('/api/file-shares/')) {
            if (!services['file-shares'].enabled) return json(404, { error: '未开放本机文件共享。' });
            const shares = managers.fileShares?.();
            if (!shares) return json(503, { error: '本机文件共享暂不可用。' });
            if (url.pathname === '/api/file-shares/get' && request.method === 'POST') return json(200, shares.get(true));
            if (!url.pathname.startsWith('/api/file-shares/browse/')) return json(404, { error: '文件共享接口不存在。' });
            try {
              return await shares.browse({ request, response, url, authorize: ensureCurrentSession, sessionSignal: session.abort.signal });
            } catch (error) {
              if (response.destroyed) return;
              if (response.headersSent) { response.destroy(); return; }
              response.removeHeader('Content-Length');
              response.removeHeader('Content-Disposition');
              return json(error.status || 500, { error: error.status ? error.message : '读取共享内容失败。' });
            }
          }
          if (url.pathname.startsWith('/api/git/')) {
            if (!services.git.enabled) return json(404, { error: '未开放 Git 仓库管理。' });
            if (request.method !== 'POST') return json(405, { error: '需要 POST 请求。' });
            const manager = managers.git?.();
            if (!manager) return json(503, { error: 'Git 工作台暂不可用。' });
            const action = url.pathname.slice('/api/git/'.length);
            const payload = await body();
            const writing = !gitReads.has(action);
            let result;
            try { result = await manager.request(action, payload, { ...services.git, portal: true, visitor:session.visitor || '', authorize: ensureCurrentSession }); }
            catch (error) {
              if (writing) audit.record(session.visitor, 'git.' + action.slice(0, 32), error.status === 403 || error.status === 404 ? 'denied' : 'failed');
              throw error;
            }
            ensureCurrentSession();
            if (writing) audit.record(session.visitor, 'git.' + action, 'ok');
            return json(200, result);
          }
          if (url.pathname.startsWith('/api/knowledge/') || url.pathname.startsWith('/api/dev-docs/')) {
            const section = url.pathname.split('/')[2];
            const name = section === 'knowledge' ? '团队知识库' : '开发文档管理';
            const access = services[section];
            if (!access.enabled) return json(404, { error: '未开放' + name + '共享。' });
            if (request.method !== 'POST') return json(405, { error: '需要 POST 请求。' });
            const knowledge = managers[section]?.();
            if (!knowledge) return json(503, { error: name + '暂不可用。' });
            const action = url.pathname.slice(('/api/' + section + '/').length);
            const writing = !['list', 'library', 'history'].includes(action);
            if (writing && !access.edit) return json(403, { error: name + '为只读模式。' });
            const input = await body();
            ensureCurrentSession();
            const result = await knowledge.request(action, input, { authorize: ensureCurrentSession, actor: session.visitor || '共享访客' });
            ensureCurrentSession();
            if (writing) audit.record(session.visitor, section + '.' + action, 'ok');
            return json(200, result);
          }
          if (url.pathname.startsWith('/api/project-todos/')) {
            const access = services['project-todos'];
            if (!access.enabled) return json(404, { error: '未开放待办清单共享。' });
            if (request.method !== 'POST') return json(405, { error: '需要 POST 请求。' });
            const todos = managers.projectTodos?.();
            if (!todos) return json(503, { error: '待办清单暂不可用。' });
            const action = url.pathname.slice('/api/project-todos/'.length);
            if (action !== 'get' && !access.edit) return json(403, { error: '待办清单为只读模式。' });
            const payload = await body();
            ensureCurrentSession();
            const result = await todos.request(action, payload, { portal: true, edit: access.edit, authorize: ensureCurrentSession });
            if (action !== 'get') audit.record(session.visitor, `project-todos.${action}`, 'ok');
            return json(200, result);
          }
          if (url.pathname.startsWith("/api/projects/") && !next.services.projects.enabled) return json(404, { error: "未开放项目中心共享。" });
          if (
            url.pathname === "/api/projects/state" &&
            request.method === "GET"
          )
            return json(200, await store.get());
          const workspaceRoute = /^\/api\/(nginx|http|jar|monitor|logs|lan-hosts)\/([a-z-]+)$/.exec(url.pathname);
          if (workspaceRoute) {
            if (request.method !== 'POST') return json(405, { error: '需要 POST 请求。' });
            const [, module, action] = workspaceRoute;
            const upload = module === 'lan-hosts' && action === 'file-upload';
            const download = module === 'lan-hosts' && action === 'file-download';
            const rdp = module === 'lan-hosts' && action === 'rdp-open';
            let rdpStream;
            if (rdp) {
              const controller = new AbortController();
              response.once('close', () => { if (!response.writableFinished) controller.abort(); });
              rdpStream = { signal: controller.signal, async write(id, stream, signal) {
                ensureCurrentSession();
                response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-DevKit-RDP-Session': id, 'X-Accel-Buffering': 'no' });
                response.flushHeaders();
                audit.record(session.visitor, 'lan-hosts.rdp-open', 'ok');
                await pipeline(Readable.from(stream), response, { signal });
              } };
            }
            let file;
            if (upload || download) {
              const transfers = new AbortController();
              response.once('close', () => { if (!response.writableFinished) transfers.abort(); });
              file = { signal: transfers.signal };
              if (upload) {
                if (request.headers['content-type'] !== 'application/octet-stream') return json(415, { error: '需要二进制文件请求。' });
                if (Number(request.headers['content-length']) > webTransferLimit) return json(413, { error: '网页单个文件最多 128 MiB。' });
                Object.assign(file, { input: request, name: url.searchParams.get('name') });
              } else file.download = async (name, stream, signal) => {
                ensureCurrentSession();
                const encoded = encodeURIComponent(name).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16));
                response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encoded}` });
                if (stream) await pipeline(stream, response, { signal });
                else response.end();
              };
            }
            const payload = upload ? { id: url.searchParams.get('id'), path: url.searchParams.get('path') } : await body();
            ensureCurrentSession();
            if (module === 'http' && action === 'send')
              response.once('close', () => { if (!response.writableFinished) workspaces.cancel(token, payload?.id); });
            const key = `${module}.${action}`;
            const audited = module === 'lan-hosts' ? lanAuditActions.has(action) : auditActions.has(action) || key === 'logs.read' && payload?.raw === true;
            let result;
            try {
              result = await workspaces.request(module, action, payload, { token, settings: next, file, rdpStream, ensureCurrentSession });
            } catch (error) {
              if (audited && (!rdp || !response.headersSent)) audit.record(session.visitor, key, error.status === 403 || error.status === 404 ? 'denied' : 'failed');
              throw error;
            }
            if (rdp) return;
            if (audited) audit.record(session.visitor, key, result?.ok === false ? 'failed' : 'ok');
            if (download) return;
            ensureCurrentSession();
            return json(200, result);
          }
          if (url.pathname === "/api/projects/probe" && request.method === "POST") {
            if (!next.services.projects.probe) return json(403, { error: "未授予项目探活权限。" });
            const payload = await body();
            ensureCurrentSession();
            return json(200, await probeProjects(store, payload));
          }
          if (!next.services.projects.edit)
            return json(403, { error: "当前共享为只读模式。" });
          if (
            url.pathname === "/api/projects/state" &&
            request.method === "PUT"
          ) {
            const value = await body();
            ensureCurrentSession();
            const saved = await store.save(value.data, value.revision);
            audit.record(session.visitor, 'projects.save', 'ok');
            return json(200, saved);
          }
          if (
            url.pathname === "/api/projects/snapshots" &&
            request.method === "GET"
          )
            return json(200, await store.snapshots());
          if (url.pathname === '/api/projects/snapshot' && request.method === 'POST') {
            const value = await body();
            ensureCurrentSession();
            return json(200, await store.snapshot(value.id));
          }
          if (
            url.pathname === "/api/projects/backup" &&
            request.method === "POST"
          ) {
            const value = await body();
            ensureCurrentSession();
            const id = await store.backup(value.name);
            audit.record(session.visitor, 'projects.backup', 'ok');
            return json(200, { id });
          }
          if (
            url.pathname === "/api/projects/restore" &&
            request.method === "POST"
          ) {
            const value = await body();
            ensureCurrentSession();
            const restored = await store.restore(value.id, value.revision);
            audit.record(session.visitor, 'projects.restore', 'ok');
            return json(200, restored);
          }
          return json(404, { error: "接口不存在。" });
        }
        if (!["GET", "HEAD"].includes(request.method))
          return json(405, { error: "Method not allowed" });
        const requested = decodeURIComponent(url.pathname);
        if (requested !== "/" && !context.allowed.has(requested))
          return json(404, { error: "这里只提供共享工作台。" });
        const file = requested === "/" ? "portal.html" : requested.slice(1);
        await serveAsset(dist, file, request, response);
      } catch (error) {
        if (!response.headersSent)
          json(error.status || 400, { error: error.message || "请求失败。" });
        else response.end();
      }
    };
    const listener = tls ? https.createServer(tls, handler) : http.createServer(handler);
    const sockets = new Set();
    listener.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    listener.disconnectSockets = () => { for (const socket of sockets) socket.destroy(); };
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
      target.disconnectSockets();
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
    clearSessions(); attempts.clear();
    if (previous?.listening) await closeListener(previous);
    return status();
  }
  let lifecycle = Promise.resolve();
  const serialized = work => { const result = lifecycle.then(work); lifecycle = result.catch(() => {}); return result; };
  return { status, audit: audit.recent, start: input => serialized(() => start(input)), stop: disable => serialized(() => stop(disable)) };
}
