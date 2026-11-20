import { listen, closeListener } from './http-listener.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import http from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { atomicFile } from './atomic-file.mjs';
import { browseFileShare, isInside } from './file-share-browser.mjs';

const portalBase = '/api/file-shares/browse/';
const maxShares = 40;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const addresses = () => ['127.0.0.1', ...new Set(Object.values(networkInterfaces()).flat()
  .filter(item => item?.family === 'IPv4' && !item.internal).map(item => item.address))];
const directBase = share => `/s/${share.token}/`;
const directUrl = (share, host = '127.0.0.1') => `http://${host}:${share.port}${directBase(share)}`;

function directListener(share, active, protectedRoot) {
  const server = http.createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const host = request.headers.host;
      const ips = share.lan ? addresses() : ['127.0.0.1'];
      if (!['localhost', ...ips].some(ip => host === `${ip}:${share.port}`)) fail(403, '请使用主机提供的共享地址。');
      const origin = 'http://' + host;
      const url = new URL(request.url, origin);
      const current = active();
      const base = current && directBase(current);
      if (!current || url.origin !== origin || !url.pathname.startsWith(base)) fail(404, '共享链接无效或已停止。');
      await browseFileShare(current, { request, response, url, base, protectedRoot });
    } catch (error) {
      if (response.destroyed) return;
      if (response.headersSent) { response.destroy(); return; }
      response.removeHeader('Content-Disposition');
      response.removeHeader('Content-Length');
      response.writeHead(error.status || 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error.status ? error.message : '读取共享内容失败。');
    }
  });
  return server;
}

export async function createFileShares(directory) {
  const filename = path.join(directory, 'file-shares.json');
  const protectedRoot = await realpath(directory);
  let state;
  try { state = JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = { version: 1, revision: 0, shares: [] }; }
  if (state?.version !== 1 || !Number.isSafeInteger(state.revision) || !Array.isArray(state.shares))
    fail(500, '本机文件共享配置格式无效。');
  const running = new Map(), errors = new Map();
  let queue = Promise.resolve();
  function get(portal) {
    if (portal) return { shares: state.shares.filter(share => share.published && running.has(share.id)).map(share => ({
      id: share.id, name: share.name, roots: share.roots.map(({ label, directory }) => ({ label, directory })),
      href: portalBase + share.id + '/',
    })) };
    return { revision: state.revision, shares: state.shares.map(({ token, ...share }) => ({
      ...share, running: running.has(share.id), error: errors.get(share.id),
      links: running.has(share.id) ? (share.lan ? addresses() : ['127.0.0.1']).map(host => directUrl({ ...share, token }, host)) : [],
    })) };
  }
  async function normalize(value, previous) {
    const name = typeof value?.name === 'string' ? value.name.trim() : '';
    if (!name || name.length > 120) fail(400, '请输入最多 120 字符的共享名称。');
    if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) fail(400, '端口必须在 1 到 65535 之间。');
    if (state.shares.some(item => item !== previous && item.port === value.port)) fail(409, `端口 ${value.port} 已分配给其他文件共享。`);
    if (!Array.isArray(value.paths) || !value.paths.length || value.paths.length > 32) fail(400, '请选择 1 到 32 个文件或文件夹。');
    const roots = [];
    for (const input of value.paths) {
      if (typeof input !== 'string' || input.length > 4096 || input.includes('\0') || !path.isAbsolute(input))
        fail(400, '请选择有效的文件或文件夹绝对路径。');
      const selected = await lstat(path.normalize(input)).catch(() => fail(400, '找不到选定的共享路径。'));
      if (!selected.isDirectory() && !selected.isFile()) fail(400, '请选择普通文件或文件夹。');
      const canonical = await realpath(input).catch(() => fail(400, '找不到选定的共享路径。'));
      if (isInside(protectedRoot, canonical)) fail(400, 'DevKit 配置目录中的文件不能共享。');
      const stat = await lstat(canonical);
      if (!stat.isDirectory() && !stat.isFile()) fail(400, '只能共享普通文件和文件夹。');
      if (roots.some(root => path.relative(root.path, canonical) === '')) continue;
      const label = path.basename(canonical) || (path.sep === '\\' ? `磁盘 ${canonical[0]}` : '根目录');
      roots.push({ path: canonical, label, directory: stat.isDirectory() });
    }
    const lan = value.lan === true;
    const sameScope = previous?.lan === lan && JSON.stringify(previous.roots) === JSON.stringify(roots);
    return {
      id: previous?.id ?? randomUUID(), name, port: value.port, roots, lan,
      published: value.published === true, enabled: value.enabled === true,
      token: sameScope ? previous.token : randomBytes(24).toString('hex'),
    };
  }
  const start = async share => {
    const server = directListener(share, () => {
      const entry = running.get(share.id);
      return entry?.server === server ? { ...entry.share, signal: entry.abort.signal } : null;
    }, protectedRoot);
    await listen(server, share.port, share.lan ? '0.0.0.0' : '127.0.0.1');
    return server;
  };
  const activate = (share, server) => running.set(share.id, { share, server, abort: new AbortController() });
  for (const share of state.shares.filter(item => item.enabled)) {
    try { activate(share, await start(share)); }
    catch (error) { errors.set(share.id, error.message); }
  }
  async function update(action, input) {
    if (input?.revision !== state.revision) fail(409, '文件共享配置已更新，请刷新后重新操作。');
    const previous = state.shares.find(item => item.id === input.id);
    if ((input.id != null || action !== 'save') && !previous) fail(404, '共享不存在。');
    if (!previous && state.shares.length >= maxShares) fail(400, `最多可以配置 ${maxShares} 个文件共享。`);
    const share = action === 'save' ? await normalize(input.value, previous)
      : action === 'toggle' ? { ...previous, enabled: input.enabled === true } : null;
    const current = running.get(previous?.id);
    const reuse = !!(share?.enabled && current && share.port === previous.port && share.lan === previous.lan);
    const replaceOnSamePort = !!(share?.enabled && current && share.port === previous.port && !reuse);
    let listener;
    if (replaceOnSamePort) {
      current.abort.abort();
      running.delete(previous.id);
      await closeListener(current.server);
    }
    try {
      if (share?.enabled) listener = reuse ? current.server : await start(share);
      const shares = previous
        ? state.shares.flatMap(item => item !== previous ? [item] : share ? [share] : [])
        : [...state.shares, share];
      const next = { ...state, revision: state.revision + 1, shares };
      await atomicFile(filename, JSON.stringify(next, null, 2));
      state = next;
    } catch (error) {
      if (listener && !reuse) await closeListener(listener);
      if (replaceOnSamePort) {
        try { activate(previous, await start(previous)); }
        catch (restoreError) { errors.set(previous.id, restoreError.message); }
      }
      throw error;
    }
    if (current) {
      current.abort.abort();
      running.delete(previous.id);
    }
    if (listener) activate(share, listener);
    if (previous) errors.delete(previous.id);
    if (current && !reuse && !replaceOnSamePort) await closeListener(current.server);
    return get(false);
  }
  return {
    get,
    request(action, input) {
      if (action === 'get') return get(false);
      if (!['save', 'toggle', 'remove'].includes(action)) fail(404, '文件共享操作不存在。');
      const result = queue.then(() => update(action, input));
      queue = result.catch(() => {});
      return result;
    },
    browse({ request, response, url, authorize, sessionSignal }) {
      const id = url.pathname.slice(portalBase.length).split('/')[0];
      const item = running.get(id);
      const base = portalBase + id + '/';
      if (!url.pathname.startsWith(base) || !item?.share.published) fail(404, '文件共享不存在或已停止。');
      return browseFileShare({ ...item.share, signal: item.abort.signal }, {
        request, response, url, base, protectedRoot, portal: true, authorize, sessionSignal,
      });
    },
    async close() {
      await queue;
      await Promise.all([...running.values()].map(item => {
        item.abort.abort();
        return closeListener(item.server);
      }));
      running.clear();
    },
  };
}
