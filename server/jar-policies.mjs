import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

function integer(value, fallback, min, max, label) {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(`${label}需为 ${min}–${max} 的整数。`);
  return result;
}
export function normalizeEnvironment(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 100) throw new Error('环境变量最多 100 项。');
  const result = Object.create(null), keys = new Set();
  for (const [key, content] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || typeof content !== 'string' || content.length > 16000 || content.includes('\0')) throw new Error('环境变量名称或值无效。');
    const normalized = process.platform === 'win32' ? key.toUpperCase() : key;
    if (keys.has(normalized)) throw new Error('Windows 环境变量名称不能仅大小写不同。');
    keys.add(normalized); result[key] = content;
  }
  return result;
}
export function normalizePolicies(item) {
  const h = item.health || {}, l = item.rotation || {}, r = item.restart || {};
  const type = h.type || 'none';
  if (!['none', 'http', 'tcp'].includes(type)) throw new Error('健康检查类型无效。');
  let url = h.url || '', host = h.host || '127.0.0.1';
  if (typeof url !== 'string' || url.length > 8000 || typeof host !== 'string' || host.length > 253 || /[\s\0/\\]/.test(host)) throw new Error('健康检查地址无效。');
  if (type === 'http') {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) throw new Error('健康检查仅支持无用户名密码的 HTTP(S) URL。');
    url = parsed.href;
  }
  const health = { type, url, host, port: integer(h.port, 8080, 1, 65535, 'TCP 端口'), interval: integer(h.interval, 10, 2, 3600, '检测间隔（秒）'), timeout: integer(h.timeout, 3, 1, 60, '检测超时（秒）'), grace: integer(h.grace, 30, 0, 3600, '启动宽限（秒）'), failures: integer(h.failures, 3, 1, 20, '失败阈值'), status: integer(h.status, 200, 100, 599, '预期 HTTP 状态码') };
  const rotation = { enabled: l.enabled !== false, maxMB: integer(l.maxMB, 10, 1, 1024, '单文件大小（MB）'), days: integer(l.days, 7, 1, 3650, '日志保留天数'), files: integer(l.files, 10, 1, 1000, '归档数量') };
  const restart = { enabled: r.enabled === true, maxRetries: integer(r.maxRetries, 5, 1, 100, '重试上限'), delay: integer(r.delay, 2, 1, 3600, '初次重试间隔（秒）'), maxDelay: integer(r.maxDelay, 60, 1, 86400, '最大重试间隔（秒）'), stable: integer(r.stable, 60, 5, 86400, '稳定运行重置时间（秒）') };
  if (restart.maxDelay < restart.delay) throw new Error('最大重试间隔不能小于初次间隔。');
  const profiles = item.profiles ?? [];
  if (!Array.isArray(profiles) || profiles.length > 20) throw new Error('最多 20 个环境档案。');
  const ids = new Set();
  const normalized = profiles.map(profile => {
    if (!profile || typeof profile.id !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(profile.id) || ids.has(profile.id) || typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 100) throw new Error('环境档案名称或标识无效，标识须唯一。');
    ids.add(profile.id); return { id: profile.id, name: profile.name.trim(), env: normalizeEnvironment(profile.env) };
  });
  const profile = item.profile || '';
  if (typeof profile !== 'string' || (profile && !ids.has(profile))) throw new Error('当前环境档案不存在。');
  return { health, rotation, restart, env: normalizeEnvironment(item.env), profiles: normalized, profile };
}
export function effectiveEnvironment(item, inherited = process.env) {
  const result = Object.create(null);
  for (const source of [inherited, item.env || {}, item.profiles?.find(profile => profile.id === item.profile)?.env || {}]) {
    for (const [key, value] of Object.entries(source)) {
      if (process.platform === 'win32') for (const old of Object.keys(result)) if (old.toUpperCase() === key.toUpperCase()) delete result[old];
      result[key] = value;
    }
  }
  return result;
}
export async function probeHealth(config) {
  const at = new Date().toISOString(), started = Date.now();
  if (config.type === 'none') return { state: 'disabled', detail: '未配置健康检查' };
  try {
    const detail = await new Promise((resolve, reject) => {
      let resource, finished = false;
      const finish = (error, detail) => { if (finished) return; finished = true; clearTimeout(timer); resource?.destroy(); error ? reject(error) : resolve(detail); };
      const timer = setTimeout(() => finish(new Error('检测超时')), config.timeout * 1000);
      if (config.type === 'tcp') {
        resource = net.connect({ host: config.host, port: config.port });
        resource.once('connect', () => finish(null, 'TCP 连接成功'));
      } else {
        const url = new URL(config.url);
        resource = (url.protocol === 'https:' ? https : http).get(url, { agent: false, headers: { 'User-Agent': 'DevKit-JAR-Health', Connection: 'close' } }, response => {
          const code = response.statusCode; response.destroy();
          finish(code === config.status ? null : new Error(`HTTP ${code}，预期 ${config.status}`), `HTTP ${code}`);
        });
      }
      resource.once('error', error => finish(error));
    });
    return { state: 'healthy', detail, checkedAt: at, latency: Date.now() - started };
  } catch (error) { return { state: 'unhealthy', detail: error.message, checkedAt: at, latency: Date.now() - started }; }
}
export function retryDecision(policy, attempts, exit, startedAt, now = Date.now()) {
  if (now - startedAt >= policy.stable * 1000) attempts = 0;
  if (!policy.enabled || exit?.code === 0) return { state: 'exited', attempts };
  if (attempts >= policy.maxRetries) return { state: 'exhausted', attempts };
  return { state: 'backoff', attempts: attempts + 1, nextRetryAt: now + Math.min(policy.maxDelay, policy.delay * 2 ** Math.min(attempts, 30)) * 1000 };
}
