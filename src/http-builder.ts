import { jsonObjectFields, patchJsonField } from './result-model';

export type HttpRow = { key: string; value: string; enabled: boolean };
export const blankHttpRow = (): HttpRow => ({ key: '', value: '', enabled: true });
function patchRaw(config: string, key: string, raw: string): string {
  config ||= '{}';
  const source = jsonObjectFields(config).has(key) ? config : patchJsonField(config, key, '');
  const node = jsonObjectFields(source).get(key)!;
  return source.slice(0, node.start) + raw + source.slice(node.end);
}
export function queryRows(url: string): HttpRow[] {
  const query = url.split('#')[0].split('?').slice(1).join('?');
  return [...new URLSearchParams(query)].map(([key, value]) => ({ key, value, enabled: true }));
}
export function withQueryRows(url: string, rows: HttpRow[]): string {
  const hash = url.indexOf('#'),
    fragment = hash < 0 ? '' : url.slice(hash);
  const base = (hash < 0 ? url : url.slice(0, hash)).split('?')[0];
  const query = new URLSearchParams(rows.filter((row) => row.enabled && row.key).map((row) => [row.key, row.value])).toString();
  return base + (query ? '?' + query : '') + fragment;
}
export function withHeaderRows(config: string, rows: HttpRow[]): string {
  return patchRaw(config, 'headers', JSON.stringify(httpHeaderEntries(rows), null, 2));
}
export function httpHeaderEntries(rows: HttpRow[]): Record<string, string> {
  const names = new Set<string>();
  const entries = rows
    .filter((row) => row.enabled && row.key)
    .map((row) => {
      if (names.has(row.key.toLowerCase())) throw new Error('请求头名称重复（忽略大小写）。');
      names.add(row.key.toLowerCase());
      return [row.key, row.value];
    });
  return Object.fromEntries(entries);
}
export function withAuthorization(config: string, authorization: string): string {
  const fields = jsonObjectFields(config || '{}'),
    raw = fields.get('headers')?.raw ?? '{}';
  const rows = [...jsonObjectFields(raw)]
    .filter(([key]) => key.toLowerCase() !== 'authorization')
    .map(([key, node]) => ({ key, value: JSON.parse(node.raw) as string, enabled: true }));
  if (authorization) rows.push({ key: 'Authorization', value: authorization, enabled: true });
  return withHeaderRows(config, rows);
}
export function basicAuthorization(username: string, password: string): string {
  if (username.includes(':')) throw new Error('Basic 用户名不能包含冒号。');
  return 'Basic ' + btoa(String.fromCharCode(...new TextEncoder().encode(username + ':' + password)));
}
export function withHttpBody(config: string, body: string, kind: 'json' | 'text' | 'form'): string {
  // Keep the raw JSON span so large numbers never pass through JS Number.
  const fields = jsonObjectFields(config || '{}');
  let raw = JSON.stringify(body);
  if (kind === 'json' && body.trim()) {
    try {
      const parsed: unknown = JSON.parse(body);
      raw = typeof parsed === 'string' ? JSON.stringify(body) : body;
    } catch {
      /* Invalid JSON can be sent verbatim for API validation tests. */
    }
  }
  const next = patchRaw(config, 'body', raw);
  const headers = [...jsonObjectFields(fields.get('headers')?.raw ?? '{}')]
    .filter(([key]) => key.toLowerCase() !== 'content-type')
    .map(([key, value]) => ({ key, value: JSON.parse(value.raw) as string, enabled: true }));
  headers.push({
    key: 'Content-Type',
    value: kind === 'json' ? 'application/json' : kind === 'form' ? 'application/x-www-form-urlencoded' : 'text/plain',
    enabled: true
  });
  return withHeaderRows(next, headers);
}
