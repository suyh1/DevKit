import { randomUUID } from 'node:crypto';
import { openSshAgent } from './lan-ssh.mjs';
import { readJsonLines } from './ssh-lines.mjs';

export async function sshTransport(host, _password, connect, stage) {
  if (!host.fingerprint) throw new Error('请在局域网主机中测试连接并确认 SSH 主机指纹。');
  const { client, stream, platform } = await openSshAgent(await connect(), host.platform, { stage });
  const waiting = new Map();
  let closed = false, stderr = '', ready;
  const opened = new Promise((resolve, reject) => { ready = { resolve, reject }; });
  function disconnect(error = new Error('远程管理连接已关闭。')) {
    if (closed) return;
    closed = true;
    ready.reject(error);
    for (const item of waiting.values()) item.finish(error);
    client.destroy();
  }
  const drop = () => disconnect(new Error(`远端管理程序连接已中断。${stderr ? ` ${stderr.trim()}` : ''}`));
  client.once('close', drop);
  stream.once('close', drop);
  stream.on('error', disconnect);
  stream.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-1600); });
  readJsonLines(stream, ({ id, result, error, ready: running }) => {
    if (running) ready.resolve();
    else waiting.get(id)?.finish(error ? new Error(error) : null, result);
  }, disconnect);
  const timer = setTimeout(() => disconnect(new Error('远端管理程序启动超时。')), 15000);
  try { await opened; } finally { clearTimeout(timer); }
  function request(module, action, payload, access, session) {
    if (closed) return Promise.reject(new Error('远程管理连接已断开。'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => disconnect(new Error('远程管理操作超时，请先刷新目标状态。')), 160000);
      waiting.set(id, { finish(error, result) { clearTimeout(timeout); waiting.delete(id); if (error) reject(error); else resolve(result); } });
      stream.write(`${JSON.stringify({ id, module, action, payload, access, session })}\n`, error => { if (error) disconnect(error); });
    });
  }
  return { platform, request, release: session => request('jar', 'release', {}, undefined, session), closed: () => closed, close: () => { stream.end(); } };
}

export function shareTransport(host, password) {
  let authentication, closed = false;
  const lifetime = new AbortController();
  async function call(route, body, cookie, timeout, signal = AbortSignal.timeout(timeout)) {
    const response = await fetch(`${host.address}/api/${route}`, {
      method: 'POST', redirect: 'error', signal,
      headers: { Origin: host.address, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
    });
    return response;
  }
  async function authenticate() {
    if (!password) throw new Error('请在局域网主机中保存目标 DevKit 的共享口令。');
    const response = await call('sharing/login', { visitor: host.visitor, password }, '', 12000);
    if (!response.ok) throw new Error(`目标 DevKit 登录失败（${response.status}）。请检查共享地址和口令。`);
    const cookie = /^devkit_project_session=[a-f0-9]{64}(?=;|$)/.exec(response.headers.get('set-cookie') || '')?.[0];
    if (!cookie) throw new Error('目标 DevKit 未返回有效的共享会话。');
    const session = await response.json();
    return { cookie, services: session.services || {} };
  }
  function login() {
    if (closed) return Promise.reject(new Error('远程共享会话已关闭。'));
    return authentication ??= authenticate().catch(error => { authentication = undefined; throw error; });
  }
  async function request(module, action, payload, access) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const pending = login(), { cookie } = await pending;
      if (closed) throw new Error('远程共享会话已关闭。');
      const timeout = module === 'logs' && action !== 'export' || ['get', 'browse'].includes(action) ? 12000 : 160000;
      const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(timeout)]);
      const response = await call(`${module}/${action}`, { ...payload, scope: 'local', scopeAccess: access && { edit: access.edit, control: access.control } }, cookie, timeout, signal);
      if (response.status === 401 && attempt === 0) { if (authentication === pending) authentication = undefined; continue; }
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.error || `目标 DevKit 请求失败（${response.status}）。`), { status: response.status === 403 ? 403 : 502 });
      return result;
    }
  }
  return {
    request,
    async capabilities(module) {
      const { services } = await login();
      if (closed) throw new Error('远程共享会话已关闭。');
      return { edit: !!services[module]?.edit, control: !!services[module]?.control };
    },
    close() {
      if (closed) return;
      closed = true;
      lifetime.abort();
      const previous = authentication; authentication = undefined;
      void previous?.then(({ cookie }) => call('sharing/logout', {}, cookie, 4000)).catch(() => {});
    },
  };
}
