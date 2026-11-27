import { createHttpClient } from "./http-client.mjs";
import { sharingServices } from '../shared/sharing.mjs';
import { managedRequest } from './managed-workspace.mjs';
import { redactLogResult } from './log-redaction.mjs';
import { apiSharingView } from './api-sharing-view.mjs';
import { createRdpSessions } from './lan-rdp.mjs';

const lanActions = new Map([
  ['save', 'edit'], ['remove', 'edit'], ['import-preview', 'edit'], ['import-connections', 'edit'],
  ['diagnose', 'diagnose'], ['test', 'diagnose'], ['reset-trust', 'diagnose'],
  ['terminal-open', 'terminal'], ['terminal-read', 'terminal'], ['terminal-input', 'terminal'], ['terminal-resize', 'terminal'], ['terminal-close', 'terminal'],
  ['file-mkdir', 'files'], ['file-rename', 'files'], ['file-remove', 'files'], ['file-cancel', 'files'],
  ['file-open', 'files'], ['file-status', 'files'], ['file-list', 'files'], ['file-upload', 'files'], ['file-download', 'files'],
  ['scan-interfaces', 'discover'], ['scan-start', 'discover'], ['scan-cancel', 'discover'], ['wake', 'wake'],
  ['vnc-open', 'rdp'], ['vnc-input', 'rdp'],
  ['rdp-file-upload', 'files'], ['rdp-open', 'rdp'], ['rdp-input', 'rdp'], ['rdp-clipboard', 'rdp'], ['rdp-close', 'rdp'],
]);
const lanChanges = new Set(['save', 'remove', 'import-connections', 'reset-trust']);

// Reuse the desktop's managers rather than acquiring a second directory lock.
export function createSharedWorkspaces({ nginx, library, jar, monitor, logs, lan }) {
  const clients = new Map();
  const managedSessions = new Map();
  const rdpSessions = createRdpSessions();
  function releaseManaged(token) {
    lan?.()?.release(token);
    rdpSessions.release(token);
    void jar?.()?.releaseSession?.(token)?.catch(() => {});
  }
  async function manage(token, action) {
    const session = managedSessions.get(token) || { closed: false };
    managedSessions.set(token, session);
    try { return await action(session); }
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
      rdpSessions.close();
      for (const client of clients.values()) client.close();
      clients.clear();
      for (const [token, session] of managedSessions) {
        session.closed = true;
        releaseManaged(token);
      }
      managedSessions.clear();
    },
    async request(module, action, payload, { token, settings, file, rdpStream, ensureCurrentSession = () => {} }) {
      const services = sharingServices(settings);
      const allowLan = services['lan-hosts'].enabled;
      if (module === 'lan-hosts') {
        const access = services['lan-hosts'];
        if (!allowLan) fail(404, '未开放局域网主机共享。');
        if (action !== 'list') {
          const permission = lanActions.get(action);
          if (!permission) fail(404, '接口不存在。');
          if (!access[permission] || (permission === 'files' && !access.terminal) ||
            (action === 'reset-trust' || action === 'test' && payload?.fingerprint) && !access.edit) fail(403, '未授予此局域网主机操作权限。');
        }
        const coordinator = lan?.(); if (!coordinator) fail(503, '局域网主机档案不可用。');
        const hosts = () => coordinator.sharedHosts(services.logs, access);
        if (action === 'list') {
          const statuses = services.monitor.enabled ? await monitor?.()?.request('lan-statuses', {}, { allowLan }) || [] : [];
          return { hosts: hosts(), statuses };
        }
        if (action === 'rdp-file-upload') {
          if (!access.rdp) fail(403, '未授予远程桌面权限。');
          return rdpSessions.upload(payload, file, token);
        }
        if (action === 'rdp-clipboard') return rdpSessions.clipboard(payload, token);
        if (action === 'vnc-input') return rdpSessions.vncInput(payload, token);
        if (action === 'rdp-input') return rdpSessions.input(payload, token);
        if (action === 'rdp-close') return rdpSessions.disconnect(payload, token);
        if (action === 'rdp-open' || action === 'vnc-open') {
          if (!rdpStream) fail(400, '缺少远程桌面显示通道。');
          const target = coordinator.rdpTarget(payload?.id);
          const hostId = payload.id;
          return manage(token, session => rdpSessions.open(target, payload, { token, stream: rdpStream, direct: action === 'vnc-open', allowFiles: access.files && access.terminal, verify() {
            if (session.closed) fail(401, '请先登录共享工作台。');
            ensureCurrentSession();
            const current = coordinator.rdpTarget(hostId);
            if (target.address !== current.address || target.port !== current.port || target.protocol !== current.protocol) fail(409, '远程桌面目标已更新，请重新连接。');
          } }));
        }
        return manage(token, async session => {
          const result = await coordinator.hostRequest(action, payload, file, { token, ensureCurrent() {
            if (session.closed) fail(401, '请先登录共享工作台。');
            ensureCurrentSession();
          } });
          return lanChanges.has(action) ? hosts() : result;
        });
      }
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
        return manage(token, () => manager.request(action, payload, { allowProjects: services.projects.enabled, allowJar: services.jar.enabled, allowBackend: services.jar.backend, allowRemoteJar: services.jar.enabled && services.jar.control, session: token, allowLan, allowControl: services.monitor.control, allowWebhook: services.monitor.edit && services.monitor.control }));
      }
      if (module === 'jar' || module === 'nginx') {
        const label = module === 'jar' ? '后端' : 'Nginx';
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
