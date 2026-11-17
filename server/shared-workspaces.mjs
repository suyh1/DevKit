import { createHttpClient } from "./http-client.mjs";
import { sharingServices } from '../shared/sharing.mjs';
import { managedRequest } from './managed-workspace.mjs';

// Reuse the desktop's managers rather than acquiring a second directory lock.
export function createSharedWorkspaces({ nginx, library, jar, monitor, logs, lan }) {
  const clients = new Map();
  const managedSessions = new Set();
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
      managedSessions.delete(token);
      lan?.()?.release(token);
      void jar?.()?.releaseConsoleSession?.(token)?.catch(() => {});
    },
    close() {
      for (const client of clients.values()) client.close();
      clients.clear();
      for (const token of managedSessions) {
        lan?.()?.release(token);
        void jar?.()?.releaseConsoleSession?.(token)?.catch(() => {});
      }
      managedSessions.clear();
    },
    async request(module, action, payload, { token, settings }) {
      const services = sharingServices(settings);
      if (module === 'logs') {
        if (!services.logs.enabled) fail(404, '未开放日志中心共享。');
        const manager = logs?.(); if (!manager) fail(503, '主机日志中心不可用。');
        if (action === 'export' && !services.logs.export) fail(403, '未授予日志导出权限。');
        return manager.request(action, payload, services.logs);
      }
      if (module === 'monitor') {
        if (!services.monitor.enabled) fail(404, '未开放监控中心共享。');
        const manager = monitor?.(); if (!manager) fail(503, '主机监控管理器不可用。');
        if (!['get', 'sources', 'upsert', 'remove', 'toggle', 'check'].includes(action)) fail(404, '接口不存在。');
        if (['upsert', 'remove'].includes(action) && !services.monitor.edit) fail(403, '未授予监控编辑权限。');
        if ((['toggle', 'check'].includes(action) || action === 'upsert' && payload?.monitor?.enabled) && !services.monitor.control) fail(403, '未授予监控运行权限；仅编辑用户请保存为暂停状态。');
        if (action === 'remove' && !services.monitor.control && (await manager.request('get')).monitors.find(item => item.id === payload?.id)?.enabled) fail(403, '移除运行中的监控需要运行权限。');
        return manager.request(action, payload, { allowProjects: services.projects.enabled, allowJar: services.jar.enabled, allowControl: services.monitor.control });
      }
      if (module === 'jar' || module === 'nginx') {
        const label = module === 'jar' ? 'JAR' : 'Nginx';
        const access = services[module];
        if (!access.enabled) fail(404, `未开放 ${label} 共享。`);
        const manager = (module === 'jar' ? jar : nginx)?.();
        if (!manager) fail(503, `主机 ${label} 管理器不可用。`);
        managedSessions.add(token);
        const coordinator = lan?.();
        return coordinator ? coordinator.request(manager, module, action, payload, access, token) : managedRequest(manager, module, action, payload, access, token);
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
        if (action === "get-library") return workspace.get();
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
