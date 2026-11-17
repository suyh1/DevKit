import { createHttpClient } from "./http-client.mjs";
import { sharingServices } from '../shared/sharing.mjs';
import { managedRequest } from './managed-workspace.mjs';
import { redactLogResult } from './log-redaction.mjs';
import { apiSharingView } from './api-sharing-view.mjs';

// Reuse the desktop's managers rather than acquiring a second directory lock.
export function createSharedWorkspaces({ nginx, library, jar, monitor, logs, lan }) {
  const clients = new Map();
  const managedSessions = new Map();
  function releaseManaged(token) {
    lan?.()?.release(token);
    void jar?.()?.releaseConsoleSession?.(token)?.catch(() => {});
  }
  async function manage(token, action) {
    const session = managedSessions.get(token) || { closed: false };
    managedSessions.set(token, session);
    try { return await action(); }
    finally { if (session.closed) releaseManaged(token); }
  }
  const fail = (status, message) => {
    throw Object.assign(new Error(message), { status });
  };
  return {
    cancel(token, id) {
      return clients.get(token)?.cancel(id) || false;
    },
    release(token) {
      clients.get(token)?.close();
      clients.delete(token);
      const session = managedSessions.get(token);
      if (session) session.closed = true;
      managedSessions.delete(token);
      releaseManaged(token);
    },
    close() {
      for (const client of clients.values()) client.close();
      clients.clear();
      for (const [token, session] of managedSessions) {
        session.closed = true;
        releaseManaged(token);
      }
      managedSessions.clear();
    },
    async request(module, action, payload, { token, settings }) {
      const services = sharingServices(settings);
      if (module === 'logs') {
        if (!services.logs.enabled) fail(404, '未开放日志中心共享。');
        const manager = logs?.(); if (!manager) fail(503, '主机日志中心不可用。');
        if (action === 'export' && !services.logs.export) fail(403, '未授予日志导出权限。');
        const access = { ...services.logs };
        if (payload?.scope === 'local' && payload.logAccess) {
          for (const key of ['jar', 'nginx', 'export', 'raw']) access[key] &&= payload.logAccess[key] === true;
        }
        return manage(token, () => manager.request(action, payload, access, token));
      }
      if (module === 'monitor') {
        if (!services.monitor.enabled) fail(404, '未开放监控中心共享。');
        const manager = monitor?.(); if (!manager) fail(503, '主机监控管理器不可用。');
        if (!['get', 'sources', 'upsert', 'remove', 'toggle', 'check'].includes(action)) fail(404, '接口不存在。');
        if (['upsert', 'remove'].includes(action) && !services.monitor.edit) fail(403, '未授予监控编辑权限。');
        if ((['toggle', 'check'].includes(action) || action === 'upsert' && payload?.monitor?.enabled) && !services.monitor.control) fail(403, '未授予监控运行权限；仅编辑用户请保存为暂停状态。');
        if (action === 'remove' && !services.monitor.control && (await manager.request('get')).monitors.find(item => item.id === payload?.id)?.enabled) fail(403, '移除运行中的监控需要运行权限。');
        return manage(token, () => manager.request(action, payload, { allowProjects: services.projects.enabled, allowJar: services.jar.enabled, allowRemoteJar: services.jar.enabled && services.jar.control, session: token, allowLan: false, allowControl: services.monitor.control, allowWebhook: services.monitor.edit && services.monitor.control }));
      }
      if (module === 'jar' || module === 'nginx') {
        const label = module === 'jar' ? 'JAR' : 'Nginx';
        const access = services[module];
        if (!access.enabled) fail(404, `未开放 ${label} 共享。`);
        const readsLogs = action === 'log-tail' || action === 'console-read';
        if (readsLogs && !(services.logs.enabled && services.logs[module])) fail(403, `未授予 ${label} 日志读取权限。`);
        const manager = (module === 'jar' ? jar : nginx)?.();
        if (!manager) fail(503, `主机 ${label} 管理器不可用。`);
        const coordinator = lan?.();
        const raw = services.logs.raw && services.logs[module] && payload?.raw === true;
        const maskedSearch = !raw && module === 'nginx' && action === 'log-tail' && payload?.query;
        if (maskedSearch && (typeof maskedSearch !== 'string' || maskedSearch.length > 200)) fail(400, '日志筛选参数无效。');
        const query = maskedSearch ? { ...payload, query: '', lines: 2000 } : payload;
        const result = await manage(token, () => coordinator ? coordinator.request(manager, module, action, query, access, token) : managedRequest(manager, module, action, query, access, token));
        if (readsLogs) {
          if (!raw) {
            const masked = redactLogResult(result, { assumePartial: action === 'console-read' && Number(payload?.cursor) > 0, tail: module === 'jar' && action === 'log-tail' });
            if (!maskedSearch) return masked;
            const limit = payload.lines ?? 300;
            if (!Number.isInteger(limit) || limit < 1 || limit > 2000) fail(400, '日志筛选参数无效。');
            return { ...masked, text: masked.text.split('\n').filter(line => line.toLocaleLowerCase().includes(maskedSearch.toLocaleLowerCase())).slice(-limit).join('\n') };
          }
        }
        return result;
      }
      if (module !== "http" || !services.http.enabled)
        fail(404, "未开放 HTTP 共享。");
      if (
        ![
          "get-library",
          "save-library",
          "restore-library",
          "send",
          "cancel",
        ].includes(action)
      )
        fail(404, "接口不存在。");
      if (['send', 'cancel'].includes(action) && !services.http.send) fail(403, '未授予 HTTP 请求发送权限。');
      if (['save-library', 'restore-library'].includes(action) && !services.http.edit) fail(403, '未授予 HTTP 接口编辑权限。');
      if (action.endsWith("library")) {
        const workspace = library();
        if (!workspace) fail(503, "主机 API 工作区不可用。");
        if (action === "get-library") {
          const result = await workspace.get();
          return services.http.edit || services.http.send ? result : apiSharingView(result);
        }
        if (action === "save-library")
          return workspace.save(payload?.data, payload?.revision);
        return workspace.restore(payload?.revision);
      }
      if (action === "cancel")
        return clients.get(token)?.cancel(payload?.id) || false;
      if (!clients.has(token)) clients.set(token, createHttpClient());
      return clients.get(token).send(payload?.id, payload?.request);
    },
  };
}
