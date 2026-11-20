import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicFile } from './atomic-file.mjs';
import { browserAssets, csp, jsonBody, localAddresses, serveAsset } from './browser-http.mjs';
import { downloadTransfer } from './transfer-download.mjs';
import { listen, closeListener } from './http-listener.mjs';
import { fail } from './collab-record.mjs';

export const transferLinksFile = 'transfer-links.json';
const page = 'transfer.html';
const validPort = (port) => Number.isInteger(port) && port >= 1 && port <= 65535;
const operations = new Set([
  'list',
  'send',
  'begin',
  'part',
  'finish',
  'cancel',
  'unlock',
  'recall',
  'publish',
  'presence',
  'claim',
  'reply',
  'answer',
  'remove',
]);
const linkPath = (token) => '/t/' + token + '/';

async function openLink({ port, token }, dist, manager, active) {
  const assets = await browserAssets(dist, page);
  const legacyBase = token && linkPath(token);
  const scope = 'quick:' + randomUUID() + ':';
  const abort = new AbortController();
  const authorize = () => {
    if (!active() || abort.signal.aborted) fail(410, '快速链接已停止。');
  };
  const server = http.createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', csp);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    const json = (status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
    };
    try {
      authorize();
      const host = request.headers.host;
      if (!['localhost', ...localAddresses()].some((ip) => host === ip + ':' + port || (port === 80 && host === ip)))
        fail(403, '请使用主机提供的快速链接。');
      const url = new URL(request.url, 'http://' + host);
      const base = legacyBase && url.pathname.startsWith(legacyBase) ? legacyBase : active()?.short ? '/' : undefined;
      if (url.origin !== new URL('http://' + host).origin || !base)
        fail(404, '快速链接无效。');
      const route = url.pathname.slice(base.length);
      // Preserve existing path-scoped sessions. Browsers share root-path cookies across ports.
      const cookieName = base === '/' ? 'devkit_transfer_client_' + port : 'devkit_transfer_client';
      const client = (request.headers.cookie || '').split(';').map(part => part.trim())
        .find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
      const hasClient = /^[a-f0-9]{48}$/.test(client || '');
      if (request.method === 'GET' || request.method === 'HEAD') {
        if (route === '') {
          const identity = hasClient ? client : randomBytes(24).toString('hex');
          response.setHeader('Set-Cookie', cookieName + '=' + identity + '; HttpOnly; SameSite=Strict; Max-Age=604800; Path=' + base);
          return await serveAsset(dist, page, request, response);
        }
        if (assets.has('/' + route)) return await serveAsset(dist, route, request, response);
      }
      const download = /^api\/transfer\/download\/([a-f0-9-]{36})$/.exec(route);
      const action = /^api\/transfer\/([a-z]+)$/.exec(route)?.[1];
      if (!download && !operations.has(action)) fail(404, '快传接口不存在。');
      if (!hasClient) fail(401, '请重新打开快速链接。');
      const access = {
        owner: scope + client,
        publisherSession: 'quick:' + port + ':' + client,
        attemptKey: 'quick:' + request.socket.remoteAddress,
        authorize,
        actor: '快传访客',
        ownDirectOnly: true,
      };
      if (download) {
        if (request.method !== 'GET') fail(405, '需要 GET 请求。');
        return await downloadTransfer(
          manager,
          { id: download[1], ticket: url.searchParams.get('ticket') },
          access,
          response,
          abort.signal,
        );
      }
      if (request.method !== 'POST') fail(405, '需要 POST 请求。');
      if (request.headers.origin !== url.origin) fail(403, '拒绝跨来源操作。');
      const data = await manager.request('transfer', action, await jsonBody(request), access);
      authorize();
      if (data?.publisherKey) response.setHeader('Set-Cookie', cookieName + '=' + client + '; HttpOnly; SameSite=Strict; Max-Age=604800; Path=' + base);
      json(200, data ?? null);
    } catch (error) {
      if (response.headersSent) response.destroy();
      else if (!response.destroyed)
        json(error.status || 400, { error: error.code ? '无法读取快传数据。' : error.message });
    }
  });
  await listen(server, port, '0.0.0.0');
  return async () => {
    abort.abort();
    manager.releaseDirect(scope, true);
    await closeListener(server);
  };
}

export async function createTransferLinks(directory, dist, manager) {
  const filename = path.join(directory, transferLinksFile);
  let links = [];
  try {
    links = JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (
    !Array.isArray(links) ||
    links.some((link) => !validPort(link?.port)
      || (link.short !== undefined && link.short !== true)
      || (link.token === undefined ? !link.short : !/^[a-f0-9]{48}$/.test(link.token))) ||
    new Set(links.map((link) => link.port)).size !== links.length
  )
    throw new Error('快速链接配置无效。');
  const running = new Map(),
    errors = new Map();
  const open = (link) => openLink(link, dist, manager, () => running.get(link.port));
  for (const link of links) {
    try {
      running.set(link.port, { ...link, close: await open(link) });
    } catch (error) {
      errors.set(link.port, error.message);
    }
  }
  const status = () => {
    const ips = localAddresses();
    const lan = ips.filter((ip) => !ip.startsWith('127.'));
    return links.map(({ port, token, short }) => ({
      port,
      short: short === true,
      error: errors.get(port),
      addresses: running.has(port)
        ? (lan.length ? lan : ips).map((ip) => 'http://' + ip + ':' + port + (short ? '' : linkPath(token)))
        : [],
    }));
  };
  let queue = Promise.resolve();
  let closed = false;
  async function apply(settings) {
    const ports = Array.isArray(settings) ? settings : settings?.ports;
    const shorten = Array.isArray(settings) ? [] : settings?.shorten;
    if (!Array.isArray(ports) || !ports.every(validPort) || new Set(ports).size !== ports.length)
      fail(400, '请输入 1 到 65535 之间的端口，端口不能重复。');
    if (!Array.isArray(shorten) || !shorten.every(port => ports.includes(port))) fail(400, '短地址端口必须在监听列表中。');
    const existing = new Map(links.map((link) => [link.port, link]));
    const next = ports.map(port => {
      const link = existing.get(port);
      if (!link) return { port, short: true };
      return shorten.includes(port) ? { ...link, short: true } : link;
    });
    const added = new Map();
    try {
      for (const link of next) if (!running.has(link.port)) added.set(link.port, { ...link, close: await open(link) });
      await atomicFile(filename, JSON.stringify(next), 0o600);
    } catch (error) {
      await Promise.all([...added.values()].map((link) => link.close()));
      throw error;
    }
    links = next;
    errors.clear();
    for (const [port, link] of added) running.set(port, link);
    for (const link of next) running.get(link.port).short = link.short;
    const removed = [...running.values()].filter((link) => !ports.includes(link.port));
    for (const link of removed) running.delete(link.port);
    await Promise.all(removed.map((link) => link.close()));
    return status();
  }
  return {
    status,
    save(ports) {
      if (closed) fail(410, '快速链接服务已关闭。');
      const result = queue.then(() => apply(ports));
      queue = result.catch(() => {});
      return result;
    },
    async close() {
      closed = true;
      await queue;
      const listeners = [...running.values()];
      running.clear();
      await Promise.all(listeners.map((link) => link.close()));
    },
  };
}
