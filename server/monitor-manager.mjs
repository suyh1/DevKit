import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import https from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireProjectLock } from './project-lock.mjs';
import { resolveProject } from '../shared/projects.mjs';

const fail = message => { throw new Error(message); };
const text = (value, max = 200) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f]/.test(value) ? value.trim() : fail('监控文本无效或过长。');
const number = (value, min, max) => Number.isInteger(value) && value >= min && value <= max ? value : fail(`数值范围为 ${min}–${max}。`);
function abortable(promise, signal) {
  if (signal.aborted) { void promise.catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function address(value) {
  const url = new URL(text(value, 4000));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('仅支持不含用户名和密码的 HTTP(S) 地址。');
  return url.href;
}
export function normalizeMonitor(input) {
  if (!input || typeof input !== 'object') fail('监控配置无效。');
  const name = text(input.name, 120); if (!name) fail('请填写监控名称。');
  if (typeof input.enabled !== 'boolean' || !['http', 'tcp'].includes(input.type)) fail('监控类型或启用状态无效。');
  let source = null;
  if (input.source) {
    if (input.source.type === 'project') source = { type: 'project', profileId: text(input.source.profileId), projectId: text(input.source.projectId) };
    else if (input.source.type === 'jar') source = { type: 'jar', id: text(input.source.id) };
    else if (input.source.type === 'lan') source = { type: 'lan', id: text(input.source.id) };
    else fail('关联来源无效。');
    if (Object.values(source).some(value => !value)) fail('关联来源缺少标识。');
  }
  const maintenance = input.maintenance ? { start: new Date(input.maintenance.start).toISOString(), end: new Date(input.maintenance.end).toISOString() } : null;
  if (maintenance && maintenance.end <= maintenance.start) fail('维护结束时间必须晚于开始时间。');
  const id = input.id ? text(input.id, 100) : randomUUID(); if (!id || !/^[\w-]+$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) fail('监控标识无效。');
  const host = source || input.type !== 'tcp' ? '' : text(input.host, 253);
  if (!source && input.type === 'tcp' && (!host || /[\s/\\?#@]/.test(host))) fail('请填写 TCP 主机名或 IP，不包含协议和路径。');
  return { id, name, enabled: input.enabled, type: source?.type === 'lan' ? 'tcp' : input.type, source,
    url: !source && input.type === 'http' ? address(input.url) : '', host,
    port: !source && input.type === 'tcp' ? number(input.port, 1, 65535) : 0,
    status: number(input.status ?? 200, 100, 599), interval: number(input.interval ?? 60, 10, 86400),
    timeout: number(input.timeout ?? 5, 1, 60), failures: number(input.failures ?? 2, 1, 10), maintenance,
    webhook: input.webhook ? { url: address(input.webhook.url), down: input.webhook.down !== false, up: input.webhook.up !== false, certificate: input.webhook.certificate === true } : null };
}

// Only response headers are needed; one deadline covers DNS, connection and redirects.
function httpsHeaders(url, signal, certificate) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { signal, agent: false, headers: { 'User-Agent': 'DevKit-Monitor' } }, response => {
      const peer = response.socket.getPeerCertificate();
      if (peer.valid_to && peer.fingerprint256) certificate?.({ host: new URL(url).host, expires: new Date(peer.valid_to).toISOString(), fingerprint: peer.fingerprint256 });
      const result = { status: response.statusCode, location: response.headers.location };
      response.destroy();
      resolve(result);
    });
    request.on('error', reject);
  });
}
export async function probeMonitor(target, signal, certificate) {
  if (target.type === 'tcp') return new Promise((resolve, reject) => {
    const socket = net.connect({ host: target.host, port: target.port });
    const finish = error => { signal.removeEventListener('abort', abort); socket.destroy(); error ? reject(error) : resolve('TCP 连接成功'); };
    const abort = () => finish(new Error('检测超时或已停止'));
    socket.once('connect', () => finish()); socket.once('error', finish);
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  });
  let url = address(target.url);
  for (let redirects = 0; redirects <= 5; redirects++) {
    let status, location;
    if (url.startsWith('https:')) {
      ({ status, location } = await httpsHeaders(url, signal, redirects === 0 ? certificate : undefined));
    } else {
      const response = await fetch(url, { signal, redirect: 'manual', headers: { 'User-Agent': 'DevKit-Monitor' } });
      await response.body?.cancel();
      status = response.status; location = response.headers.get('location');
    }
    if ([301, 302, 303, 307, 308].includes(status) && location) {
      if (redirects === 5) fail('重定向超过 5 次。');
      url = address(new URL(location, url).href); continue;
    }
    if (status !== target.status) fail(`HTTP ${status}，预期 ${target.status}`);
    return `HTTP ${status}`;
  }
}

export async function createMonitorManager(directory, { projects, jar, lan, auto = true, now = Date.now, probe = probeMonitor, deliver = fetch } = {}) {
  const folder = path.join(directory, 'monitor'); await mkdir(folder, { recursive: true });
  const unlock = await acquireProjectLock(folder), filename = path.join(folder, 'monitors.json');
  let data = { schemaVersion: 1, revision: 0, monitors: [], runtime: {}, notifications: [] }, closed = false, storageError = '';
  try {
    if ((await stat(filename).catch(error => { if (error.code !== 'ENOENT') throw error; }))?.size > 128000000) fail('监控存储超过 128 MB。');
    const raw = await readFile(filename, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (raw !== undefined) {
      const parsed = JSON.parse(raw);
      if (parsed.schemaVersion !== 1 || !Number.isSafeInteger(parsed.revision) || parsed.revision < 0 || !Array.isArray(parsed.monitors) || parsed.monitors.length > 100 || !parsed.runtime || typeof parsed.runtime !== 'object' || Array.isArray(parsed.runtime)) fail('监控存储格式无效。');
      parsed.monitors = parsed.monitors.map(normalizeMonitor);
      parsed.notifications ??= [];
      if (!Array.isArray(parsed.notifications) || parsed.notifications.length > 200 || parsed.notifications.some(item => !item || !['down', 'up','certificate'].includes(item.event) || typeof item.id !== 'string' || !parsed.monitors.some(monitor => monitor.id === item.monitorId) || !Number.isSafeInteger(item.attempts) || item.attempts < 0 || item.attempts > 2 || !Number.isFinite(item.nextAt))) fail('Webhook 通知队列无效。');
      if (new Set(parsed.monitors.map(item => item.id)).size !== parsed.monitors.length) fail('监控标识重复。');
      const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
      for (const [id, value] of Object.entries(parsed.runtime)) {
        if (!parsed.monitors.some(item => item.id === id) || !value || !['up', 'down', 'pending', 'unknown'].includes(value.state) || !Number.isSafeInteger(value.streak) || value.streak < 0 || value.checkedAt !== undefined && !validDate(value.checkedAt) || !Array.isArray(value.samples) || value.samples.length > 1440 || !Array.isArray(value.incidents) || value.incidents.length > 100) fail('监控历史格式无效。');
        if (value.samples.some(sample => !sample || !validDate(sample.at) || typeof sample.ok !== 'boolean' || !Number.isFinite(sample.elapsed) || sample.elapsed < 0) || value.incidents.some(item => !item || typeof item.id !== 'string' || !validDate(item.start) || item.end !== null && !validDate(item.end) || typeof item.detail !== 'string')) fail('监控样本或故障记录无效。');
      }
      data = parsed;
    }
  } catch (error) { await unlock(); throw new Error(`监控存储无法读取，原文件已保留：${error.message}`); }
  let queue = Promise.resolve();
  const transaction = work => { const next = queue.then(work); queue = next.catch(() => {}); return next; };
  async function commit(next) {
    const temp = `${filename}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
      for (let i = 0; ; i++) { try { await rename(temp, filename); break; } catch (error) { if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || i >= 6) throw error; await delay(30 * (i + 1)); } }
      data = next; storageError = '';
    } catch (error) { storageError = error.message; throw error; }
    finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  const running = new Map(), versions = new Map(), due = new Map(), controllers = new Set();
  let delivering;
  const maintenance = monitor => monitor.maintenance && now() >= Date.parse(monitor.maintenance.start) && now() < Date.parse(monitor.maintenance.end);
  const blank = () => ({ state: 'unknown', streak: 0, samples: [], incidents: [] });
  function stateOf(monitor, runtime) {
    if (!monitor.enabled) return 'paused';
    if (maintenance(monitor)) return 'maintenance';
    if (!runtime.checkedAt || now() - Date.parse(runtime.checkedAt) > Math.max(monitor.interval * 3, monitor.timeout + 10) * 1000) return 'unknown';
    return runtime.state;
  }
  async function resolve(monitor) {
    if (!monitor.source) return monitor;
    if (monitor.source.type === 'project') {
      const state = await projects?.()?.get(), profile = state?.profiles.find(item => item.id === monitor.source.profileId), project = profile?.projects.find(item => item.id === monitor.source.projectId);
      if (!project) fail('关联项目或档案已删除。');
      const result = resolveProject(project, profile); if (result.error || !result.enabled) fail(result.error || '关联项目已停用。');
      return { ...monitor, type: 'http', url: result.url };
    }
    if (monitor.source.type === 'lan') {
      const target = lan?.()?.monitorTargets().find(item => item.id === monitor.source.id);
      if (!target) fail('关联的局域网主机已移除或不可用。');
      return { ...monitor, type: 'tcp', host: target.address, port: target.port };
    }
    if (monitor.source.type === 'jar' && monitor.source.id.includes(':')) return { remoteJar: monitor.source.id };
    const state = await jar?.()?.request('get'), item = state?.instances.find(item => item.id === monitor.source.id);
    if (!item) fail('关联 JAR 已删除或管理器不可用。');
    if (!['http', 'tcp'].includes(item.health.type)) fail('请先为关联 JAR 配置 HTTP/TCP 健康检查。');
    return { ...monitor, ...item.health, timeout: monitor.timeout };
  }
  function runRestriction(source, access) {
    if (source?.type === 'lan' && access.allowLan === false) return '运行此端口监控需要局域网主机访问权限。';
    if (source?.type === 'jar' && source.id.includes(':') && access.allowRemoteJar === false) return '运行此远程 JAR 检测需要 JAR 运行权限。';
    return '';
  }
  function authorizeRun(source, access) {
    const reason = runRestriction(source, access);
    if (reason) throw Object.assign(new Error(reason), { status: 403 });
  }
  function view(access = {}) {
    return structuredClone({ revision: data.revision, storageError, checkedAt: new Date(now()).toISOString(), monitors: data.monitors.map(monitor => {
      const runtime = data.runtime[monitor.id] || blank(), samples = runtime.samples.filter(sample => now() - Date.parse(sample.at) <= 86400000);
      const state = stateOf(monitor, runtime);
      const remoteHost = monitor.source?.type === 'jar' && monitor.source.id.includes(':') ? lan?.()?.hostName?.(monitor.source.id.split(':')[0]) || '目标主机' : '';
      const sourceHost = monitor.source?.type === 'lan' && access.allowLan !== false ? lan?.()?.hostName?.(monitor.source.id) : undefined;
      const webhook = access.allowWebhook === false && monitor.webhook ? { ...monitor.webhook, url: '' } : monitor.webhook;
      return { ...monitor, ...runtime, webhook, state, executionHost: remoteHost, sourceHost, runRestriction: runRestriction(monitor.source, access), checking: running.has(monitor.id), samples: runtime.samples.slice(-1440), incidents: runtime.incidents,
        availability: samples.length ? Math.round(samples.filter(item => item.ok).length / samples.length * 10000) / 100 : null,
        sampleCount: samples.length, average: samples.length ? Math.round(samples.reduce((sum, item) => sum + item.elapsed, 0) / samples.length) : null };
    }) });
  }
  function queueNotification(next, monitor, event, incident, at) {
    if (!monitor.webhook?.[event]) return;
    if (next.notifications.length >= 200) {
      next.runtime[monitor.id].notification = { event, at, state: 'failed', detail: '通知队列已满' };
      return;
    }
    next.notifications.push({ id: `${incident.id}-${event}`, monitorId: monitor.id, incidentId: incident.id, ...(incident.certificate ? { certificate: incident.certificate } : {}), at, event, attempts: 0, nextAt: now() });
    next.runtime[monitor.id].notification = { event, at, state: 'pending', detail: '等待 Webhook 投递' };
  }
  function dispatchNotifications() {
    if (closed || delivering) return delivering;
    const item = data.notifications.find(row => row.nextAt <= now() && !data.notifications.some(previous => previous.monitorId === row.monitorId && previous !== row && previous.event === 'down' && previous.incidentId === row.incidentId && row.event === 'up'));
    if (!item) return;
    const monitor = data.monitors.find(row => row.id === item.monitorId);
    const controller = new AbortController(); controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 5000);
    delivering = (async () => {
      let detail = '', retryable = true;
      try {
        if (!monitor?.webhook?.[item.event]) return;
        const response = await deliver(monitor.webhook.url, {
          method: 'POST', signal: controller.signal, redirect: 'error',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': item.id },
          body: JSON.stringify({ id: item.id, event: item.event, at: item.at, monitor: { id: monitor.id, name: monitor.name }, incidentId: item.incidentId, certificate: item.certificate }),
        });
        await response.body?.cancel();
        if (!response.ok) {
          detail = `Webhook HTTP ${response.status}`;
          retryable = response.status === 429 || response.status >= 500;
        }
      } catch (error) { detail = controller.signal.aborted ? 'Webhook 连接超时' : 'Webhook 连接失败'; }
      finally { clearTimeout(timer); controllers.delete(controller); }
      if (closed) return;
      await transaction(async () => {
        const next = structuredClone(data), index = next.notifications.findIndex(row => row.id === item.id);
        if (index === -1) return;
        if (detail && retryable && item.attempts < 2) {
          next.notifications[index] = { ...item, attempts: item.attempts + 1, nextAt: now() + (item.attempts + 1) * 15000 };
        } else {
          next.notifications.splice(index, 1);
          if (next.runtime[item.monitorId]) next.runtime[item.monitorId].notification = { event: item.event, at: new Date(now()).toISOString(), state: detail ? 'failed' : 'sent', detail: detail || 'Webhook 已接收' };
        }
        await commit(next);
      });
    })().catch(error => { storageError = error.message; }).finally(() => { delivering = undefined; });
    return delivering;
  }
  async function check(id) {
    if (closed) fail('监控管理器已停止。');
    if (running.has(id)) return running.get(id);
    const monitor = data.monitors.find(item => item.id === id); if (!monitor) fail('监控不存在。');
    if (!monitor.enabled || maintenance(monitor)) fail('监控已暂停或处于维护窗口。');
    if (running.size >= 3) fail('主机正在检测其他监控，请稍后再试。');
    const version = versions.get(id), controller = new AbortController(); controllers.add(controller);
    const task = (async () => {
      const started = now(), timer = setTimeout(() => controller.abort(), monitor.timeout * 1000); let ok = false, detail, certificate;
      try {
        const target = await resolve(monitor);
        if (target.remoteJar) {
          const resolved = lan?.();
          if (!resolved) fail('目标主机管理器不可用。');
          const result = await abortable(resolved.monitorJar(target.remoteJar, monitor.timeout), controller.signal);
          detail = result.detail;
          ok = result.state === 'healthy';
        } else { detail = await probe(target, controller.signal, observed => { certificate = observed; }); ok = true; }
      }
      catch (error) { detail = controller.signal.aborted ? '检测超时或已停止' : error.cause?.code || error.message; }
      finally { clearTimeout(timer); controllers.delete(controller); }
      if (closed || versions.get(id) !== version || maintenance(monitor)) return;
      await transaction(async () => {
        if (closed || versions.get(id) !== version || !data.monitors.some(item => item.id === id)) return;
        const next = structuredClone(data), runtime = next.runtime[id] ||= blank(), at = new Date(now()).toISOString();
        if (certificate) {
          const previous = runtime.certificate;
          const notified = previous?.fingerprint === certificate.fingerprint && previous.host === certificate.host ? previous.notified : [];
          runtime.certificate = { ...certificate, checkedAt: at, notified };
          const days = Math.ceil((Date.parse(certificate.expires) - now()) / 86400000);
          const threshold = days <= 7 ? 7 : days <= 30 ? 30 : 0;
          if (threshold && monitor.webhook?.certificate && !notified.includes(threshold) && !notified.includes(7)) {
            const payload = { host: certificate.host, expires: certificate.expires, days, threshold };
            queueNotification(next, monitor, 'certificate', { id: randomUUID(), certificate: payload }, at);
            notified.push(threshold);
          }
        }
        if (ok && !certificate) delete runtime.certificate;
        runtime.streak = ok ? 0 : runtime.streak + 1;
        runtime.state = ok ? 'up' : runtime.streak >= monitor.failures ? 'down' : 'pending';
        runtime.detail = String(detail).slice(0, 500); runtime.checkedAt = at;
        runtime.samples = [...runtime.samples.filter(sample => now() - Date.parse(sample.at) < 7 * 86400000), { at, ok, elapsed: Math.max(0, now() - started), detail: runtime.detail }].slice(-1440);
        const incident = runtime.incidents.find(item => !item.end);
        if (runtime.state === 'down' && !incident) {
          const created = { id: randomUUID(), start: at, detail: runtime.detail, end: null, jarId: monitor.source?.type === 'jar' ? monitor.source.id : null };
          runtime.incidents.unshift(created);
          queueNotification(next, monitor, 'down', created, at);
        }
        if (ok && incident) { incident.end = at; queueNotification(next, monitor, 'up', incident, at); }
        runtime.incidents = runtime.incidents.slice(0, 100);
        await commit(next);
      });
    })();
    running.set(id, task);
    try { await task; void dispatchNotifications(); }
    finally { running.delete(id); due.set(id, now() + monitor.interval * 1000); }
  }
  async function sources(access = {}) {
    const result = [];
    if (access.allowProjects !== false) for (const profile of (await projects?.()?.get())?.profiles || []) for (const project of profile.projects) result.push({ label: `${profile.name} / ${project.name}`, source: { type: 'project', profileId: profile.id, projectId: project.id } });
    if (access.allowJar !== false) for (const item of (await jar?.()?.request('get'))?.instances || []) result.push({ label: `JAR / ${item.name}`, source: { type: 'jar', id: item.id } });
    if (access.allowRemoteJar !== false && access.allowJar !== false) result.push(...await lan?.()?.monitorJarSources?.(access.session) || []);
    if (access.allowLan !== false) for (const item of lan?.()?.monitorTargets?.() || []) result.push({ label: `局域网主机 / ${item.name}`, source: { type: 'lan', id: item.id } });
    return result;
  }
  async function tick() {
    if (closed) return;
    const delivery = dispatchNotifications();
    for (const item of data.monitors) if (running.size < 3 && item.enabled && !maintenance(item) && !running.has(item.id) && (due.get(item.id) || 0) <= now()) void check(item.id).catch(error => { storageError = error.message; });
    return delivery;
  }
  const timer = auto ? setInterval(tick, 1000) : null; timer?.unref();
  return {
    async request(action, payload = {}, access = {}) {
      if (closed) fail('监控管理器已停止。');
      if (action === 'get') return view(access);
      if (action === 'lan-statuses' && access.allowLan !== false) return data.monitors.filter(item => item.source?.type === 'lan').map(item => {
        const runtime = data.runtime[item.id] || blank();
        return { hostId: item.source.id, id: item.id, checkedAt: runtime.checkedAt, state: stateOf(item, runtime), elapsed: runtime.samples.at(-1)?.elapsed };
      });
      if (action === 'sources') return sources(access);
      if (action === 'check') {
        const source = data.monitors.find(item => item.id === payload.id)?.source;
        authorizeRun(source, access);
        await check(payload.id); return view(access);
      }
      if (!['upsert', 'remove', 'toggle'].includes(action)) fail('未知监控操作。');
      return transaction(async () => {
        if (closed) fail('监控管理器已停止。');
        if (payload.revision !== data.revision) fail('监控配置已被更新，请刷新后重试；当前草稿仍保留。');
        const next = structuredClone(data); let id = payload.id;
        if (access.allowControl === false && (action === 'toggle' || data.monitors.find(item => item.id === (id || payload.monitor?.id))?.enabled || payload.monitor?.enabled)) fail('修改运行中的监控需要运行权限。');
        if (action === 'upsert') {
          const previous = next.monitors.find(item => item.id === payload.monitor?.id);
          if (access.allowWebhook === false && payload.monitor?.webhook?.url) fail('未授予 Webhook 配置权限。');
          const monitor = normalizeMonitor(access.allowWebhook === false ? { ...payload.monitor, webhook: previous?.webhook } : payload.monitor); id = monitor.id;
          if (monitor.enabled) authorizeRun(monitor.source, access);
          if (JSON.stringify(monitor.webhook) !== JSON.stringify(previous?.webhook || null)) next.notifications = next.notifications.filter(item => item.monitorId !== id);
          const index = next.monitors.findIndex(item => item.id === id);
          // Editing may configure a future target, but does not authorize outbound checks.
          if (monitor.source?.type === 'lan') {
            const retained = index >= 0 && next.monitors[index].source?.type === 'lan' && next.monitors[index].source.id === monitor.source.id;
            if (!retained && access.allowLan === false) throw Object.assign(new Error('关联监控需要局域网主机访问权限。'), { status: 403 });
            if ((!retained || monitor.enabled) && !lan?.()?.monitorTargets().some(item => item.id === monitor.source.id)) fail('关联的局域网主机不存在或不可用。');
          } else if (monitor.source) {
            const remote = monitor.source.type === 'jar' && monitor.source.id.includes(':');
            const candidates = await sources({ ...access, allowRemoteJar: remote && access.allowRemoteJar !== false, allowLan: false });
            if (!candidates.some(item => JSON.stringify(item.source) === JSON.stringify(monitor.source))) fail('关联来源不存在或未开放对应服务。');
          }
          if (index < 0) { if (next.monitors.length >= 100) fail('监控最多 100 项。'); next.monitors.push(monitor); }
          else next.monitors[index] = monitor;
          const previousRuntime = next.runtime[id];
          // Configuration changes begin a new series; keep old incident records as closed history.
          if (previousRuntime) {
            const sameTarget = previous.url === monitor.url && JSON.stringify(previous.source) === JSON.stringify(monitor.source);
            next.runtime[id] = {
              ...blank(),
              ...(sameTarget && previousRuntime.certificate ? { certificate: previousRuntime.certificate } : {}),
              incidents: previousRuntime.incidents.map(item => ({
                jarId: previous.source?.type === 'jar' ? previous.source.id : null, ...item,
                ...(!item.end ? { end: new Date(now()).toISOString(), reason: '配置已变更' } : {}),
              })),
            };
          }
        } else {
          const item = next.monitors.find(item => item.id === id); if (!item) fail('监控不存在。');
          if (action === 'remove') { next.monitors = next.monitors.filter(item => item.id !== id); next.notifications = next.notifications.filter(item => item.monitorId !== id); delete next.runtime[id]; }
          else {
            if (typeof payload.enabled !== 'boolean') fail('启用状态无效。');
            if (payload.enabled) authorizeRun(item.source, access);
            item.enabled = payload.enabled;
          }
        }
        next.revision++; await commit(next); versions.set(id, randomUUID()); due.delete(id); return view(access);
      });
    },
    tick,
    async close() { closed = true; clearInterval(timer); for (const controller of controllers) controller.abort(); await Promise.allSettled([...running.values(), delivering]); await queue; await unlock(); },
  };
}
