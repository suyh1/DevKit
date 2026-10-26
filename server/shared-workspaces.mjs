import { createHttpClient } from "./http-client.mjs";
import { sharingServices } from '../shared/sharing.mjs';

// Reuse the desktop's managers rather than acquiring a second directory lock.
export function createSharedWorkspaces({ nginx, library }) {
  const clients = new Map();
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
    },
    close() {
      for (const client of clients.values()) client.close();
      clients.clear();
    },
    async request(module, action, payload, { token, settings }) {
      const services = sharingServices(settings);
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
