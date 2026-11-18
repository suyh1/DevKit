import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const entriesPerPage = 100;
const maxArchiveEntries = 25_000;
const maxDepth = 64;
const collator = new Intl.Collator('zh-CN', { numeric: true });
const denied = () => Object.assign(new Error('文件或文件夹不可访问。'), { status: 404 });
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const isInside = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const samePath = (a, b) => path.relative(a, b) === '';
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
const safeName = name => name && name !== '.' && name !== '..' && !/[\\/:*?"<>|\x00-\x1f]/.test(name)
  && !/[ .]$/.test(name) && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:[ .]|$)/i.test(name);
const canList = entry => (entry.isDirectory() || entry.isFile()) && safeName(entry.name);
const attachment = name => `attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16))}`;

async function inspect(target, protectedRoot) {
  if (isInside(protectedRoot, target)) throw denied();
  const info = await lstat(target, { bigint: true }).catch(() => { throw denied(); });
  if (!info.isDirectory() && !info.isFile()) throw denied();
  const canonical = await realpath(target).catch(() => { throw denied(); });
  if (!samePath(target, canonical) || isInside(protectedRoot, canonical)) throw denied();
  return info;
}

async function list(target, protectedRoot) {
  const before = await inspect(target, protectedRoot);
  const entries = await readdir(target, { withFileTypes: true }).catch(() => { throw denied(); });
  if (!sameFile(before, await inspect(target, protectedRoot))) throw denied();
  return entries.filter(entry => canList(entry) && !isInside(protectedRoot, path.join(target, entry.name)));
}

async function openSharedFile(target, protectedRoot) {
  const before = await inspect(target, protectedRoot);
  if (!before.isFile()) throw denied();
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0))
    .catch(() => { throw denied(); });
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || !sameFile(before, info) || !sameFile(info, await inspect(target, protectedRoot))) throw denied();
    return { handle, info };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function streamArchive(response, target, label, protectedRoot, signal, authorize, method) {
  const { default: yazl } = await import('yazl');
  const archive = new yazl.ZipFile();
  const files = [];
  let entryCount = 0, currentStream;
  async function collect(directory, relative, depth) {
    signal.throwIfAborted();
    if (depth > maxDepth || ++entryCount > maxArchiveEntries)
      throw Object.assign(new Error('文件夹层级或条目过多，请分批下载子文件夹。'), { status: 413 });
    archive.addEmptyDirectory(relative);
    for (const entry of await list(directory, protectedRoot)) {
      const filename = path.join(directory, entry.name), archiveName = relative + '/' + entry.name;
      if (entry.isDirectory()) await collect(filename, archiveName, depth + 1);
      else {
        if (++entryCount > maxArchiveEntries)
          throw Object.assign(new Error('文件夹条目过多，请分批下载子文件夹。'), { status: 413 });
        files.push({ filename, archiveName });
      }
    }
  }
  await collect(target, label, 0);
  authorize();
  response.setHeader('Content-Type', 'application/zip');
  response.setHeader('Content-Disposition', attachment(label + '.zip'));
  if (method === 'HEAD') { response.end(); return; }
  archive.on('error', error => archive.outputStream.destroy(error));
  for (const { filename, archiveName } of files) {
    archive.addReadStreamLazy(archiveName, { compressionLevel: 0 }, callback => {
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        authorize();
        return openSharedFile(filename, protectedRoot);
      }).then(({ handle }) => {
        if (signal.aborted || archive.outputStream.destroyed) {
          void handle.close().catch(() => {});
          return callback(new Error('下载已结束。'));
        }
        const source = handle.createReadStream();
        currentStream = source;
        source.once('error', error => archive.outputStream.destroy(error));
        callback(null, source);
      }, callback);
    });
  }
  try {
    const transfer = pipeline(archive.outputStream, response, { signal });
    archive.end();
    await transfer;
  } finally {
    currentStream?.destroy();
  }
}

function page(share, base, relative, rows, { name, parent, archive, query = '', page = 1, pages = 1, portal } = {}) {
  const pageLink = number => escape(base + relative + '?' + new URLSearchParams({ q: query, page: String(number) }));
  const listItems = rows.map(row => `
    <li>
      <div><small>${row.directory ? '文件夹' : '文件'}</small><a href="${escape(row.href)}">${escape(row.label)}</a></div>
      ${row.directory ? `<a class="download" href="${escape(row.href + '?zip=1')}">下载 ZIP</a>` : ''}
    </li>`).join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(name || share.name)} · DevKit 文件共享</title>
<style>
  :root {
    color-scheme: light dark;
    --surface: light-dark(#fff, #171b23);
    --canvas: light-dark(#f4f6fa, #10131a);
    --line: light-dark(#dce1ea, #343d4b);
    --ink: light-dark(#172234, #e5eaf3);
    --muted: light-dark(#526179, #aebad0);
    --link: light-dark(#174da3, #a9caff);
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--canvas); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 960px; margin: auto; padding: clamp(16px, 4vw, 42px); }
  a { color: var(--link); text-underline-offset: 3px; }
  h1 { font-size: clamp(25px, 5vw, 36px); margin: .35em 0; overflow-wrap: anywhere; }
  p { color: var(--muted); }
  header { margin-bottom: 20px; }
  section { border: 1px solid var(--line); background: var(--surface); border-radius: 12px; overflow: hidden; }
  ul { padding: 0; margin: 0; list-style: none; }
  li, .empty { padding: 12px 16px; display: flex; gap: 12px; align-items: center; justify-content: space-between; }
  li + li { border-top: 1px solid var(--line); }
  li > div { min-width: 0; overflow-wrap: anywhere; }
  small { color: var(--muted); margin-right: 10px; }
  .download { white-space: nowrap; }
  nav, form { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin: 14px 0; }
  input, button { font: inherit; padding: 7px 11px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink); }
  input { max-width: 100%; }
  button { cursor: pointer; }
</style>
<main><header>
${portal ? '<a href="/#file-shares">返回共享工作台</a>' : '<span>DevKit 文件共享</span>'}
<h1>${escape(name || share.name)}</h1>
${name ? `<p>${escape(share.name)}</p>` : ''}
<nav>${parent ? `<a href="${escape(parent)}">返回上一级</a>` : ''}${archive ? `<a href="${escape(archive)}">下载当前文件夹 ZIP</a>` : ''}</nav>
${name ? `<form action="${escape(base + relative)}"><input name="q" type="search" maxlength="160" aria-label="筛选当前文件夹" placeholder="筛选当前文件夹" value="${escape(query)}"><button>筛选</button></form>` : ''}
</header><section>${listItems ? `<ul>${listItems}</ul>` : '<p class="empty">没有可显示的文件。</p>'}</section>
${pages > 1 ? `<nav aria-label="分页">${page > 1 ? `<a href="${pageLink(page - 1)}">上一页</a>` : ''}<span>第 ${page} / ${pages} 页</span>${page < pages ? `<a href="${pageLink(page + 1)}">下一页</a>` : ''}</nav>` : ''}
</main></html>`;
}

export async function browseFileShare(share, { request, response, url, base, protectedRoot, portal, authorize, sessionSignal }) {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    throw Object.assign(new Error('仅支持浏览和下载。'), { status: 405 });
  const cancel = new AbortController();
  response.once('close', () => cancel.abort());
  const signal = AbortSignal.any(sessionSignal ? [cancel.signal, share.signal, sessionSignal] : [cancel.signal, share.signal]);
  const check = () => { signal.throwIfAborted(); authorize?.(); };
  check();
  const sendPage = html => {
    check();
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(request.method === 'HEAD' ? undefined : html);
  };
  const parts = url.pathname.slice(base.length).split('/');
  if (parts.at(-1) === '') parts.pop();
  if (!parts.length) return sendPage(page(share, base, '', share.roots.map((root, index) => ({
    label: root.label, directory: root.directory, href: base + index + (root.directory ? '/' : ''),
  })), { portal }));
  const [index, ...encoded] = parts;
  const root = /^(0|[1-9]\d*)$/.test(index) && share.roots[Number(index)];
  if (!root || encoded.length > maxDepth || (!root.directory && encoded.length)) throw denied();
  let names;
  try { names = encoded.map(value => decodeURIComponent(value)); } catch { throw denied(); }
  if (names.some(name => !safeName(name))) throw denied();
  const target = path.join(root.path, ...names);
  const label = names.at(-1) || root.label;
  const rootInfo = await inspect(root.path, protectedRoot);
  if (rootInfo.isDirectory() !== root.directory) throw denied();
  for (let depth = 1; depth < names.length; depth++)
    if (!(await inspect(path.join(root.path, ...names.slice(0, depth)), protectedRoot)).isDirectory()) throw denied();
  const info = names.length ? await inspect(target, protectedRoot) : rootInfo;
  if (info.isDirectory()) {
    if (!safeName(label)) throw denied();
    if (url.searchParams.get('zip') === '1') return streamArchive(response, target, label, protectedRoot, signal, check, request.method);
    const relative = [index, ...encoded].join('/') + '/';
    const query = (url.searchParams.get('q') ?? '').trim().slice(0, 160);
    const entries = (await list(target, protectedRoot)).filter(entry => entry.name.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || collator.compare(a.name, b.name));
    const pages = Math.max(1, Math.ceil(entries.length / entriesPerPage));
    const current = Math.max(1, Math.min(pages, Math.trunc(Number(url.searchParams.get('page'))) || 1));
    const rows = entries.slice((current - 1) * entriesPerPage, current * entriesPerPage).map(entry => ({
      label: entry.name, href: base + relative + encodeURIComponent(entry.name) + (entry.isDirectory() ? '/' : ''), directory: entry.isDirectory(),
    }));
    const parent = names.length ? base + [index, ...encoded.slice(0, -1)].join('/') + '/' : base;
    return sendPage(page(share, base, relative, rows, { name: label, parent, archive: base + relative + '?zip=1', query, page: current, pages, portal }));
  }
  const file = await openSharedFile(target, protectedRoot);
  try {
    check();
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Disposition', attachment(label));
    response.setHeader('Content-Length', file.info.size.toString());
    if (request.method === 'HEAD' || file.info.size === 0n) { response.end(); return; }
    await pipeline(file.handle.createReadStream({ end: Number(file.info.size - 1n), autoClose: false }), response, { signal });
  } finally { await file.handle.close(); }
}
