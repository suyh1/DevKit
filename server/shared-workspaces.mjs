import { createHttpClient } from "./http-client.mjs";
import { sharingServices } from '../shared/sharing.mjs';

// Reuse the desktop's managers rather than acquiring a second directory lock.
export function createSharedWorkspaces({ nginx, library, jar, monitor, logs }) {
  const clients = new Map();
  const jarSessions = new Set();
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
      jarSessions.delete(token);
      void jar?.()?.releaseConsoleSession?.(token)?.catch(() => {});
    },
    close() {
      for (const client of clients.values()) client.close();
      clients.clear();
      for (const token of jarSessions) void jar?.()?.releaseConsoleSession?.(token)?.catch(() => {});
      jarSessions.clear();
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
      if (module === 'jar') {
        if (!services.jar.enabled) fail(404, '未开放 JAR 共享。');
        const manager = jar?.();
        if (!manager) fail(503, '主机 JAR 管理器不可用。');
        const reads = ['get', 'statuses', 'log-tail', 'console-read', 'startup-get'];
        const edits = ['upsert', 'remove'];
        const controls = ['command', 'detect', 'health-check', 'console-claim', 'console-input', 'console-eof', 'console-release', 'startup-install', 'startup-remove'];
        if (![...reads, ...edits, ...controls].includes(action)) fail(403, '网页不提供本机文件选择器，请填写共享主机路径。');
        if (edits.includes(action) && !services.jar.edit) fail(403, '未授予 JAR 编辑权限。');
        if (controls.includes(action) && !services.jar.control) fail(403, '未授予 JAR 运行管理权限。');
        if (action.startsWith('console-')) jarSessions.add(token);
        return manager.request(action, payload, { session: token, allowEdit: services.jar.edit, allowControl: services.jar.control });
      }
      if (module === "nginx") {
        if (!services.nginx.enabled) fail(404, "未开放 Nginx 共享。");
        if (!nginx()) fail(503, "主机 Nginx 管理器不可用。");
        const reads = [
          "get",
          "statuses",
          "documents",
          "inspect",
          "log-tail",
          "review",
          "backups",
          "backup-files",
        ];
        if (!reads.includes(action)) {
          if (!["save-files", "command", "create", "upsert", "remove", "discover", "detect"].includes(action))
            fail(403, "网页不提供本机文件选择器，请填写共享主机路径。");
          if (["command", "detect"].includes(action)) {
            if (!services.nginx.control) fail(403, '未授予 Nginx 运行管理权限。');
          } else if (!services.nginx.edit) fail(403, '未授予 Nginx 配置编辑权限。');
        }
        return nginx().request(action, payload, { allowExecution: services.nginx.control });
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
