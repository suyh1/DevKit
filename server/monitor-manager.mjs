import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireProjectLock } from './project-lock.mjs';
import { resolveProject } from '../shared/projects.mjs';

const fail = message => { throw new Error(message); };
const text = (value, max = 200) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f]/.test(value) ? value.trim() : fail('监控文本无效或过长。');
const number = (value, min, max) => Number.isInteger(value) && value >= min && value <= max ? value : fail(`数值范围为 ${min}–${max}。`);
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
    else fail('关联来源无效。');
    if (Object.values(source).some(value => !value)) fail('关联来源缺少标识。');
  }
  const maintenance = input.maintenance ? { start: new Date(input.maintenance.start).toISOString(), end: new Date(input.maintenance.end).toISOString() } : null;
  if (maintenance && maintenance.end <= maintenance.start) fail('维护结束时间必须晚于开始时间。');
  const id = input.id ? text(input.id, 100) : randomUUID(); if (!id || !/^[\w-]+$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) fail('监控标识无效。');
  const host = source || input.type !== 'tcp' ? '' : text(input.host, 253);
  if (!source && input.type === 'tcp' && (!host || /[\s/\\?#@]/.test(host))) fail('请填写 TCP 主机名或 IP，不包含协议和路径。');
  return { id, name, enabled: input.enabled, type: input.type, source,
    url: !source && input.type === 'http' ? address(input.url) : '', host,
    port: !source && input.type === 'tcp' ? number(input.port, 1, 65535) : 0,
    status: number(input.status ?? 200, 100, 599), interval: number(input.interval ?? 60, 10, 86400),
    timeout: number(input.timeout ?? 5, 1, 60), failures: number(input.failures ?? 2, 1, 10), maintenance };
}

// Only response headers are needed; one deadline covers DNS, connection and redirects.
export async function probeMonitor(target, signal) {
  if (target.type === 'tcp') return new Promise((resolve, reject) => {
    const socket = net.connect({ host: target.host, port: target.port });
    const finish = error => { signal.removeEventListener('abort', abort); socket.destroy(); error ? reject(error) : resolve('TCP 连接成功'); };
    const abort = () => finish(new Error('检测超时或已停止'));
    socket.once('connect', () => finish()); socket.once('error', finish);
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  });
  let url = address(target.url);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(url, { signal, redirect: 'manual', headers: { 'User-Agent': 'DevKit-Monitor' } });
    await response.body?.cancel();
    const location = response.headers.get('location');
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      if (redirects === 5) fail('重定向超过 5 次。');
      url = address(new URL(location, url).href); continue;
    }
    if (response.status !== target.status) fail(`HTTP ${response.status}，预期 ${target.status}`);
    return `HTTP ${response.status}`;
  }
}

export async function createMonitorManager(directory, { projects, jar, auto = true, now = Date.now, probe = probeMonitor } = {}) {
  const folder = path.join(directory, 'monitor'); await mkdir(folder, { recursive: true });
  const unlock = await acquireProjectLock(folder), filename = path.join(folder, 'monitors.json');
  let data = { schemaVersion: 1, revision: 0, monitors: [], runtime: {} }, closed = false, storageError = '';
  try {
    if ((await stat(filename).catch(error => { if (error.code !== 'ENOENT') throw error; }))?.size > 128000000) fail('监控存储超过 128 MB。');
    const raw = await readFile(filename, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (raw !== undefined) {
      const parsed = JSON.parse(raw);
      if (parsed.schemaVersion !== 1 || !Number.isSafeInteger(parsed.revision) || parsed.revision < 0 || !Array.isArray(parsed.monitors) || parsed.monitors.length > 100 || !parsed.runtime || typeof parsed.runtime !== 'object' || Array.isArray(parsed.runtime)) fail('监控存储格式无效。');
      parsed.monitors = parsed.monitors.map(normalizeMonitor);
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
  const maintenance = monitor => monitor.maintenance && now() >= Date.parse(monitor.maintenance.start) && now() < Date.parse(monitor.maintenance.end);
  const blank = () => ({ state: 'unknown', streak: 0, samples: [], incidents: [] });
  async function resolve(monitor) {
    if (!monitor.source) return monitor;
    if (monitor.source.type === 'project') {
      const state = await projects?.()?.get(), profile = state?.profiles.find(item => item.id === monitor.source.profileId), project = profile?.projects.find(item => item.id === monitor.source.projectId);
      if (!project) fail('关联项目或档案已删除。');
      const result = resolveProject(project, profile); if (result.error || !result.enabled) fail(result.error || '关联项目已停用。');
      return { ...monitor, type: 'http', url: result.url };
    }
    const state = await jar?.()?.request('get'), item = state?.instances.find(item => item.id === monitor.source.id);
    if (!item) fail('关联 JAR 已删除或管理器不可用。');
    if (!['http', 'tcp'].includes(item.health.type)) fail('请先为关联 JAR 配置 HTTP/TCP 健康检查。');
    return { ...monitor, ...item.health, timeout: monitor.timeout };
  }
  function view() {
    return structuredClone({ revision: data.revision, storageError, checkedAt: new Date(now()).toISOString(), monitors: data.monitors.map(monitor => {
      const runtime = data.runtime[monitor.id] || blank(), samples = runtime.samples.filter(sample => now() - Date.parse(sample.at) <= 86400000);
      const state = !monitor.enabled ? 'paused' : maintenance(monitor) ? 'maintenance' : !runtime.checkedAt || now() - Date.parse(runtime.checkedAt) > Math.max(monitor.interval * 3, monitor.timeout + 10) * 1000 ? 'unknown' : runtime.state;
      return { ...monitor, ...runtime, state, checking: running.has(monitor.id), samples: runtime.samples.slice(-1440), incidents: runtime.incidents,
        availability: samples.length ? Math.round(samples.filter(item => item.ok).length / samples.length * 10000) / 100 : null,
        sampleCount: samples.length, average: samples.length ? Math.round(samples.reduce((sum, item) => sum + item.elapsed, 0) / samples.length) : null };
    }) });
  }
  async function check(id) {
    if (closed) fail('监控管理器已停止。');
    if (running.has(id)) return running.get(id);
    const monitor = data.monitors.find(item => item.id === id); if (!monitor) fail('监控不存在。');
    if (!monitor.enabled || maintenance(monitor)) fail('监控已暂停或处于维护窗口。');
    if (running.size >= 3) fail('主机正在检测其他监控，请稍后再试。');
    const version = versions.get(id), controller = new AbortController(); controllers.add(controller);
    const task = (async () => {
      const started = now(), timer = setTimeout(() => controller.abort(), monitor.timeout * 1000); let ok = false, detail;
      try { detail = await probe(await resolve(monitor), controller.signal); ok = true; }
      catch (error) { detail = controller.signal.aborted ? '检测超时或已停止' : error.cause?.code || error.message; }
      finally { clearTimeout(timer); controllers.delete(controller); }
      if (closed || versions.get(id) !== version || maintenance(monitor)) return;
      await transaction(async () => {
        if (closed || versions.get(id) !== version || !data.monitors.some(item => item.id === id)) return;
        const next = structuredClone(data), runtime = next.runtime[id] ||= blank(), at = new Date(now()).toISOString();
        runtime.streak = ok ? 0 : runtime.streak + 1;
        runtime.state = ok ? 'up' : runtime.streak >= monitor.failures ? 'down' : 'pending';
        runtime.detail = String(detail).slice(0, 500); runtime.checkedAt = at;
        runtime.samples = [...runtime.samples.filter(sample => now() - Date.parse(sample.at) < 7 * 86400000), { at, ok, elapsed: Math.max(0, now() - started), detail: runtime.detail }].slice(-1440);
        const incident = runtime.incidents.find(item => !item.end);
        if (runtime.state === 'down' && !incident) runtime.incidents.unshift({ id: randomUUID(), start: at, detail: runtime.detail, end: null });
        if (ok && incident) incident.end = at;
        runtime.incidents = runtime.incidents.slice(0, 100);
        await commit(next);
      });
    })();
    running.set(id, task);
    try { await task; return view(); }
    finally { running.delete(id); due.set(id, now() + monitor.interval * 1000); }
  }
  async function sources(access = {}) {
    const result = [];
    if (access.allowProjects !== false) for (const profile of (await projects?.()?.get())?.profiles || []) for (const project of profile.projects) result.push({ label: `${profile.name} / ${project.name}`, source: { type: 'project', profileId: profile.id, projectId: project.id } });
    if (access.allowJar !== false) for (const item of (await jar?.()?.request('get'))?.instances || []) result.push({ label: `JAR / ${item.name}`, source: { type: 'jar', id: item.id } });
    return result;
  }
  async function tick() {
    if (closed) return;
    for (const item of data.monitors) if (running.size < 3 && item.enabled && !maintenance(item) && !running.has(item.id) && (due.get(item.id) || 0) <= now()) void check(item.id).catch(error => { storageError = error.message; });
  }
  const timer = auto ? setInterval(tick, 1000) : null; timer?.unref();
  return {
    async request(action, payload = {}, access = {}) {
      if (closed) fail('监控管理器已停止。');
      if (action === 'get') return view();
      if (action === 'sources') return sources(access);
      if (action === 'check') return check(payload.id);
      if (!['upsert', 'remove', 'toggle'].includes(action)) fail('未知监控操作。');
      return transaction(async () => {
        if (closed) fail('监控管理器已停止。');
        if (payload.revision !== data.revision) fail('监控配置已被更新，请刷新后重试；当前草稿仍保留。');
        const next = structuredClone(data); let id = payload.id;
        if (access.allowControl === false && (action === 'toggle' || data.monitors.find(item => item.id === (id || payload.monitor?.id))?.enabled || payload.monitor?.enabled)) fail('修改运行中的监控需要运行权限。');
        if (action === 'upsert') {
          const monitor = normalizeMonitor(payload.monitor); id = monitor.id;
          const index = next.monitors.findIndex(item => item.id === id);
          // Editing may configure a future target, but does not authorize outbound checks.
          if (monitor.source && !(await sources(access)).some(item => JSON.stringify(item.source) === JSON.stringify(monitor.source))) fail('关联来源不存在或未开放对应服务。');
          if (index < 0) { if (next.monitors.length >= 100) fail('监控最多 100 项。'); next.monitors.push(monitor); }
          else next.monitors[index] = monitor;
          const previous = next.runtime[id];
          // Configuration changes begin a new series; keep old incident records as closed history.
          if (previous) next.runtime[id] = { ...blank(), incidents: previous.incidents.map(item => item.end ? item : { ...item, end: new Date(now()).toISOString(), reason: '配置已变更' }) };
        } else {
          const item = next.monitors.find(item => item.id === id); if (!item) fail('监控不存在。');
          if (action === 'remove') { next.monitors = next.monitors.filter(item => item.id !== id); delete next.runtime[id]; }
          else { if (typeof payload.enabled !== 'boolean') fail('启用状态无效。'); item.enabled = payload.enabled; }
        }
        next.revision++; await commit(next); versions.set(id, randomUUID()); due.delete(id); return view();
      });
    },
    tick,
    async close() { closed = true; clearInterval(timer); for (const controller of controllers) controller.abort(); await Promise.allSettled([...running.values()]); await queue; await unlock(); },
  };
}
