import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';

export const csp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
export const localAddresses = () => [
  ...new Set([
    '127.0.0.1',
    ...Object.values(networkInterfaces())
      .flat()
      .filter((item) => item && item.family === 'IPv4')
      .map((item) => item.address),
  ]),
];
export async function browserAssets(dist, page) {
  const manifest = JSON.parse(await readFile(path.join(dist, '.vite', 'manifest.json'), 'utf8'));
  const allowed = new Set();
  function include(key) {
    const entry = manifest[key];
    if (!entry || allowed.has(`/${entry.file}`)) return;
    allowed.add(`/${entry.file}`);
    for (const asset of [...(entry.css || []), ...(entry.assets || [])]) allowed.add(`/${asset}`);
    for (const dependency of [...(entry.imports || []), ...(entry.dynamicImports || [])]) include(dependency);
  }
  if (!manifest[page]) throw new Error('缺少共享网页构建，请先构建应用。');
  include(page);
  allowed.delete('/' + page);
  return allowed;
}

export async function serveAsset(dist, file, request, response) {
  const absolute = path.resolve(dist, file),
    relative = path.relative(dist, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative) || file.includes('\\'))
    throw Object.assign(new Error('路径无效。'), { status: 403 });
  const content = await readFile(absolute);
  response.writeHead(200, {
    'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
  });
  response.end(request.method === 'HEAD' ? undefined : content);
}

export async function jsonBody(request, limit = 4_100_000) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || ''))
    throw Object.assign(new Error('需要 JSON 请求。'), { status: 415 });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('请求过大。'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('JSON 格式无效。');
  }
}
