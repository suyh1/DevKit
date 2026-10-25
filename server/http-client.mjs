import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { gunzip, inflate, brotliDecompress } from 'node:zlib';
import { promisify } from 'node:util';

const MAX_BYTES = 4_000_000;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
export function validateHttpRequest(input) {
  if (!plain(input) || typeof input.url !== 'string' || input.url.length > 12000) throw new Error('请求地址无效。');
  const url = new URL(input.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持 HTTP(S)，地址不能包含用户名或密码。');
  const method = input.method || 'GET';
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) throw new Error('不支持的 HTTP 方法。');
  const headers = Object.create(null);
  if (input.headers !== undefined && !plain(input.headers)) throw new Error('Headers 必须为字符串对象。');
  if (Object.keys(input.headers || {}).length > 100) throw new Error('最多 100 个请求头。');
  let headerBytes = 0;
  for (const [name, value] of Object.entries(input.headers || {})) {
    if (['connection', 'content-length', 'transfer-encoding', 'upgrade', 'expect', 'proxy-connection'].includes(name.toLowerCase())) throw new Error(`请求头 ${name} 由客户端管理。`);
    if (typeof value !== 'string') throw new Error('请求头值必须是字符串。');
    http.validateHeaderName(name); http.validateHeaderValue(name, value);
    if (Object.hasOwn(headers, name.toLowerCase())) throw new Error('请求头名称不能重复（忽略大小写）。');
    headers[name.toLowerCase()] = value;
    headerBytes += Buffer.byteLength(name) + Buffer.byteLength(value);
  }
  if (headerBytes > 64000) throw new Error('请求头超过 64KB。');
  const body = input.body ?? '';
  if (typeof body !== 'string' || Buffer.byteLength(body) > 2_000_000) throw new Error('请求体须为不超过 2MB 的文本。');
  if (body && ['GET', 'HEAD'].includes(method)) throw new Error('GET/HEAD 不支持请求体。');
  const timeout = input.timeout ?? 15000;
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 120000) throw new Error('超时必须是 100–120,000 毫秒。');
  if (body) headers['content-length'] = String(Buffer.byteLength(body));
  headers['accept-encoding'] ??= 'identity';
  return { url, method, headers, body, timeout };
}

async function execute(input, signal) {
  const started = performance.now(), { url, method, headers, body } = input;
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, { method, headers, signal, agent: false, maxHeaderSize: 64000 }, response => {
      void (async () => {
        const chunks = []; let bytes = 0;
        for await (const chunk of response) {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) { response.destroy(); throw new Error('响应超过 4MB，已停止接收。'); }
          chunks.push(chunk);
        }
        let buffer = Buffer.concat(chunks);
        const encoding = String(response.headers['content-encoding'] || '').toLowerCase();
        const decoder = { gzip: gunzip, deflate: inflate, br: brotliDecompress }[encoding];
        if (decoder && buffer.length && method !== 'HEAD') buffer = await promisify(decoder)(buffer, { maxOutputLength: MAX_BYTES });
        if (signal.aborted) throw signal.reason;
        const contentType = String(response.headers['content-type'] || '');
        let text = '', binary = !/^(?:text\/)|json|xml|javascript|x-www-form-urlencoded|^$/.test(contentType.toLowerCase()) || !!encoding && encoding !== 'identity' && !decoder;
        if (!binary) {
          const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1] || 'utf-8';
          try { text = new TextDecoder(charset, { fatal: true }).decode(buffer); if (text.includes('\0')) binary = true; }
          catch { binary = true; }
        }
        resolve({ url: url.href, method, status: response.statusCode, statusText: response.statusMessage || '', headers: response.rawHeaders.reduce((rows, value, index, all) => index % 2 ? rows : [...rows, [value, all[index + 1]]], []), body: binary ? buffer.toString('base64') : text, binary, bytes: buffer.length, transferredBytes: bytes, elapsed: Math.round(performance.now() - started), redirected: false });
      })().catch(error => { request.destroy(); reject(error); });
    });
    request.on('error', reject);
    request.end(body || undefined);
  });
}

export function createHttpClient() {
  const pending = new Map(); let closed = false;
  return {
    async send(id, payload) {
      if (closed) throw new Error('HTTP 客户端已关闭。');
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(id) || pending.has(id)) throw new Error('请求标识无效或重复。');
      if (pending.size >= 4) throw new Error('最多同时发送 4 个请求。');
      const input = validateHttpRequest(payload), controller = new AbortController(); pending.set(id, controller);
      const timer = setTimeout(() => controller.abort(new Error('请求超时。')), input.timeout);
      try { return await execute(input, controller.signal); }
      catch (error) { if (controller.signal.aborted) throw controller.signal.reason; throw error; }
      finally { clearTimeout(timer); pending.delete(id); }
    },
    cancel(id) { const controller = pending.get(id); if (controller) controller.abort(new Error('请求已取消。')); return !!controller; },
    cancelAll() { for (const controller of pending.values()) controller.abort(new Error('请求已取消。')); },
    close() { closed = true; this.cancelAll(); },
  };
}
