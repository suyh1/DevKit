import { privateField } from '../shared/mock-request.mjs';
import { fail } from './collab-record.mjs';

export async function readMockInput(req) {
  const type = String(req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const json = type === 'application/json' || type.endsWith('+json');
  if (!json)
    return { omitted: !!req.headers['transfer-encoding'] || Number(req.headers['content-length']) > 0 };
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) fail(413, 'Mock 请求 JSON 最多 64 KiB。');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const walk = (value, depth) => {
      if (depth > 32) fail(400, '请求 JSON 嵌套超过 32 层。');
      if (value && typeof value === 'object')
        for (const child of Object.values(value)) walk(child, depth + 1);
    };
    walk(body, 0);
    return { body };
  } catch (error) {
    fail(400, error.status ? error.message : '请求正文不是有效 JSON。');
  }
}
export function journalInput(request, pathname, url, input) {
  const query = new URLSearchParams();
  const headers = {};
  let omitted = !!input.omitted;
  for (const [key, value] of url.searchParams) {
    if (privateField(key)) omitted = true;
    else query.append(key, value);
  }
  for (const [key, value] of Object.entries(request.headers)) {
    if (privateField(key)) {
      omitted = true;
      continue;
    }
    if (['content-type', 'accept', 'accept-language'].includes(key) || key.startsWith('x-')) {
      const text = String(value);
      headers[key] = text.slice(0, 512);
      if (text.length > 512) omitted = true;
    }
  }
  let body;
  if (input.body !== undefined) {
    const clean = JSON.stringify(input.body, (key, value) => {
      if (privateField(key)) {
        omitted = true;
        return undefined;
      }
      return value;
    });
    if (clean.length <= 4096) body = clean;
    else omitted = true;
  }
  const suffix = pathname + (query.size ? '?' + query : '');
  if (suffix.length > 4096 || JSON.stringify(headers).length > 4096)
    return { path: pathname.slice(0, 512), omitted: true, replayable: false };
  return { path: suffix, headers, body, omitted, replayable: true };
}
