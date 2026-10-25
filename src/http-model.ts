import { jsonObjectFields } from './result-model';

export type HttpInput = { url: string; method: string; headers: Record<string, string>; body: string; timeout: number };
export type HttpResponse = { url: string; method: string; status: number; statusText: string; headers: [string, string][]; body: string; binary: boolean; bytes: number; transferredBytes: number; elapsed: number; redirected: boolean };
export type HttpEntry = { id: string; name: string; config: string; timeout: number; sensitive: boolean };
export function parseHttpConfig(text: string, timeout = 15000): HttpInput {
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 120000) throw new Error('超时必须是 100–120,000 毫秒。');
  const fields = jsonObjectFields(text);
  if ([...fields.keys()].some(key => !['url', 'method', 'headers', 'body'].includes(key))) throw new Error('请求配置只支持 url、method、headers、body。');
  const url: unknown = fields.has('url') ? JSON.parse(fields.get('url')!.raw) : '';
  const method: unknown = fields.has('method') ? JSON.parse(fields.get('method')!.raw) : 'GET';
  if (typeof url !== 'string' || typeof method !== 'string') throw new Error('URL 和 method 必须为字符串。');
  const address = new URL(url);
  if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password) throw new Error('仅支持无内嵌凭据的 HTTP(S) 地址。');
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) throw new Error('不支持的 HTTP 方法。');
  const headers: Record<string, string> = {};
  if (fields.has('headers')) {
    const entries = jsonObjectFields(fields.get('headers')!.raw), names = new Set();
    for (const [name, value] of entries) {
      const header: unknown = JSON.parse(value.raw);
      if (typeof header !== 'string') throw new Error('请求头值必须为字符串。');
      if (names.has(name.toLowerCase())) throw new Error('请求头名称重复（忽略大小写）。');
      names.add(name.toLowerCase()); Object.defineProperty(headers, name, { value: header, enumerable: true, configurable: true });
    }
  }
  const node = fields.get('body');
  const body = node ? node.raw.startsWith('"') ? JSON.parse(node.raw) as string : node.raw : '';
  if (node && !node.raw.startsWith('"') && !Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
  if (body && ['GET', 'HEAD'].includes(method)) throw new Error('GET/HEAD 不支持请求体。');
  return { url, method, headers, body, timeout };
}
const secret = /authorization|cookie|token|password|secret|api[-_]?key|signature|session|credential/i;
export function savedHttpConfig(config: string, includeSensitive: boolean): string {
  const request = parseHttpConfig(config);
  if (includeSensitive) return config;
  const url = new URL(request.url);
  for (const key of [...url.searchParams.keys()]) if (secret.test(key)) url.searchParams.delete(key);
  url.hash = '';
  return JSON.stringify({ method: request.method, url: url.href, headers: Object.fromEntries(Object.entries(request.headers).filter(([key]) => !secret.test(key))) }, null, 2);
}
export function readHttpCollection(text: string): HttpEntry[] {
  if (text.length > 4_000_000) throw new Error('请求集合超过 4MB。');
  const source = JSON.parse(text);
  if (source?.format !== 'devkit-http-collection' || source.version !== 1 || !Array.isArray(source.entries) || source.entries.length > 100) throw new Error('请求集合格式无效，最多 100 项。');
  const ids = new Set();
  return source.entries.map((entry: HttpEntry) => {
    if (!entry || typeof entry.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(entry.id) || ids.has(entry.id) || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 100 || typeof entry.config !== 'string' || entry.config.length > 2_000_000 || typeof entry.sensitive !== 'boolean' || !Number.isInteger(entry.timeout) || entry.timeout < 100 || entry.timeout > 120000) throw new Error('请求集合条目无效。');
    ids.add(entry.id); parseHttpConfig(entry.config, entry.timeout);
    return { id: entry.id, name: entry.name.trim(), config: entry.sensitive ? entry.config : savedHttpConfig(entry.config, false), timeout: entry.timeout, sensitive: entry.sensitive };
  });
}
export const collectionText = (entries: HttpEntry[]) => JSON.stringify({ format: 'devkit-http-collection', version: 1, entries }, null, 2);
