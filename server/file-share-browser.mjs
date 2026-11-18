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

function page(share, base, relative, rows, { name, parent, archive, query = '', page = 1, pages = 1, portal, total = rows.length } = {}) {
  const pageLink = number => escape(base + relative + '?' + new URLSearchParams({ q: query, page: String(number) }));
  const listItems = rows.map(row => `
    <li>
      <span class="item-icon" data-folder="${row.directory}" aria-hidden="true"></span>
      <a class="item-name" href="${escape(row.href)}">${escape(row.label)}</a>
      <span class="item-type">${row.directory ? '文件夹' : '文件'}</span>
      <a class="download" href="${escape(row.href + (row.directory ? '?zip=1' : ''))}" aria-label="${escape('下载 ' + row.label + (row.directory ? ' ZIP' : ''))}">${row.directory ? '下载 ZIP' : '下载'}</a>
    </li>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(name || share.name)} · DevKit 文件共享</title>
<style>
  :root {
    color-scheme: light dark;
    --surface: light-dark(#fff, #1c1e22);
    --canvas: light-dark(#f5f6f8, #141518);
    --line: light-dark(#dce0e7, #34373e);
    --ink: light-dark(#252934, #e8e9ed);
    --muted: light-dark(#616877, #acafb9);
    --link: light-dark(#3d5fad, #a6b8f4);
    --accent-ink: light-dark(#fff, #171d30);
    --wash: light-dark(#f0f2f5, #22252a);
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--canvas); color: var(--ink); font: 13px/1.5 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; }
  main { max-width: 1056px; margin: auto; padding: clamp(12px, 3vw, 32px); }
  a { color: var(--link); text-underline-offset: 3px; }
  :is(a,button,input):focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
  .trail, .heading, .tools, .pages { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .trail { min-height: 28px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
  .trail a { min-width: 0; }
  .heading { min-height: 36px; justify-content: space-between; margin-bottom: 12px; }
  h1 { flex: 1 1 160px; min-width: 0; font-size: clamp(20px, 3vw, 24px); line-height: 1.3; font-weight: 600; margin: 0; overflow-wrap: anywhere; }
  .tools { justify-content: space-between; min-height: 44px; padding: 8px 12px; border-bottom: 1px solid var(--line); }
  .tools h2 { margin: 0; font-size: 14px; font-weight: 600; }
  .tools small { margin-inline-start: 8px; color: var(--muted); font-weight: 450; }
  section { border: 1px solid var(--line); background: var(--surface); border-radius: 10px; }
  ul, p { padding: 0; margin: 0; list-style: none; }
  li { display: grid; grid-template-columns: 16px minmax(0, 1fr) 64px 72px; gap: 8px; align-items: center; min-height: 44px; padding: 4px 12px; }
  li + li { border-top: 1px solid var(--line); }
  li:hover { background: var(--wash); }
  .item-name { min-width: 0; overflow-wrap: anywhere; color: var(--ink); font-weight: 550; text-decoration: none; }
  .item-name:hover { color: var(--link); text-decoration: underline; }
  .item-type, .empty { color: var(--muted); font-size: 12px; }
  .empty { padding: 24px 16px; }
  .item-icon { width: 12px; height: 14px; border: 1.5px solid var(--muted); border-radius: 2px; }
  .item-icon[data-folder="true"] { width: 16px; height: 12px; border-top-width: 3px; color: var(--link); }
  .download { display: inline-flex; align-items: center; justify-self: end; min-height: 32px; font-size: 12px; white-space: nowrap; }
  form { display: flex; gap: 8px; min-width: 0; }
  input, button, .primary { min-height: 32px; font: inherit; font-size: 12px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink); }
  input { min-width: 0; width: 176px; }
  .primary { display: inline-flex; align-items: center; background: var(--link); color: var(--accent-ink); border-color: var(--link); text-decoration: none; }
  button { white-space: nowrap; }
  button, .primary { cursor: pointer; }
  .pages { justify-content: space-between; margin-top: 16px; color: var(--muted); font-variant-numeric: tabular-nums; }
  @media (max-width: 580px) {
    li { grid-template-columns: 16px minmax(0, 1fr) auto; }
    .item-type { display: none; }
    form { width: 100%; }
    input { flex: 1; }
  }
</style>
</head><body><main>
<nav class="trail" aria-label="共享位置">
  ${portal ? '<a href="/#file-shares">共享工作台</a>' : '<span>DevKit 文件共享</span>'}
  ${name ? `<span aria-hidden="true">/</span><a href="${escape(base)}">${escape(share.name)}</a>` : ''}
  ${parent && parent !== base ? `<span aria-hidden="true">/</span><a href="${escape(parent)}">返回上一级</a>` : ''}
</nav>
<header class="heading"><h1>${escape(name || share.name)}</h1>
  ${archive ? `<a class="primary" href="${escape(archive)}">下载当前文件夹 ZIP</a>` : ''}
</header>
<section>
  <header class="tools"><h2>${name ? '文件与文件夹' : '共享内容'} <small>${total} 项</small></h2>
    ${name ? `<form action="${escape(base + relative)}"><input name="q" type="search" maxlength="160" aria-label="筛选当前文件夹" placeholder="筛选文件名" value="${escape(query)}"><button>筛选</button></form>` : ''}
  </header>
  ${listItems ? `<ul>${listItems}</ul>` : '<p class="empty">没有可显示的文件。</p>'}
</section>
${pages > 1 ? `<nav class="pages" aria-label="分页">${page > 1 ? `<a href="${pageLink(page - 1)}">上一页</a>` : ''}<span>第 ${page} / ${pages} 页</span>${page < pages ? `<a href="${pageLink(page + 1)}">下一页</a>` : ''}</nav>` : ''}
</main></body></html>`;
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
    return sendPage(page(share, base, relative, rows, { name: label, parent, archive: base + relative + '?zip=1', query, page: current, pages, portal, total: entries.length }));
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
