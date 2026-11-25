import { configGroup } from './config-layout.mjs';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicFile } from './atomic-file.mjs';

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
function folderName(value) {
  if (typeof value !== 'string' || value.length > 240) fail(400, '目录路径最多 240 字符。');
  return value
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');
}
function content(input) {
  const { title, project = '', body, folder = '', tags = input.kind ? [input.kind] : [] } = input;
  if (typeof title !== 'string' || !title.trim() || title.length > 120)
    fail(400, '请输入 1 至 120 字符的文档标题。');
  if (typeof project !== 'string' || project.length > 120) fail(400, '项目名称最多 120 字符。');
  if (
    !Array.isArray(tags) ||
    tags.length > 32 ||
    tags.some((tag) => typeof tag !== 'string' || tag.length > 80)
  )
    fail(400, '最多 32 个标签，每个最多 80 字符。');
  if (typeof body !== 'string' || body.includes('\0') || body.length > 120000)
    fail(400, 'Markdown 正文最多 12 万字符。');
  return {
    title: title.trim(),
    project: project.trim(),
    folder: folderName(folder),
    tags: [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))],
    body: body.replace(/\r\n?/g, '\n'),
  };
}

export async function createKnowledgeBase(directory, section = 'knowledge') {
  const file = path.join(await configGroup(directory, 'planning'), section === 'dev-docs' ? 'dev-docs.json' : 'knowledge.json');
  let pages = [],
    folders = [];
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (![1, 2].includes(data.version) || !Array.isArray(data.pages)) fail(500, '知识库文件格式无效。');
    for (const page of data.pages) {
      if (typeof page.id !== 'string' || !Array.isArray(page.history)) fail(500, '知识库文档格式无效。');
      for (const entry of [page, ...page.history]) {
        Object.assign(entry, content(entry));
        delete entry.kind;
        if (!Number.isSafeInteger(entry.revision) || entry.revision < 1) fail(500, '知识库版本记录无效。');
      }
    }
    pages = data.pages;
    folders = [
      ...new Set([...(data.folders ?? []).map(folderName), ...pages.map((p) => p.folder)].filter(Boolean)),
    ];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (section === 'dev-docs') {
      pages = await (await import('./linux-manual.mjs')).linuxManual();
      folders = [...new Set(pages.map(page => page.folder))];
    }
  }
  const current = ({ history, ...entry }) => entry;
  function requirePage(id) {
    return pages.find((page) => page.id === id) ?? fail(404, '找不到这篇文档，可能已被删除。');
  }
  let queue = Promise.resolve();
  async function update(action, input, { actor = '桌面端', authorize }) {
    authorize?.();
    if (action === 'create-folder') {
      const folder = folderName(input.folder);
      if (!folder) fail(400, '请输入目录名称。');
      if (!folders.includes(folder)) {
        const next = [...folders, folder];
        await persist(pages, next, authorize);
        folders = next;
      }
      return folders;
    }
    const previous = action === 'create' ? undefined : requirePage(input.id);
    if (previous && input.revision !== previous.revision)
      fail(409, '这篇文档已有新版本，请对照后保存或另存副本。');
    let next, page;
    if (action === 'remove') {
      next = pages.filter((item) => item !== previous);
    } else {
      let source = input;
      if (action === 'restore') {
        source = previous.history.find((entry) => entry.revision === input.version);
        if (!source) fail(404, '此历史版本已不存在。');
      }
      page = {
        ...content(source),
        id: previous?.id ?? randomUUID(),
        revision: (previous?.revision ?? 0) + 1,
        actor,
        updated: new Date().toISOString(),
        history: previous ? [current(previous), ...previous.history].slice(0, 20) : [],
      };
      next = previous ? pages.map((item) => (item === previous ? page : item)) : [...pages, page];
    }
    const nextFolders = page?.folder && !folders.includes(page.folder) ? [...folders, page.folder] : folders;
    await persist(next, nextFolders, authorize);
    pages = next;
    folders = nextFolders;
    return page ? current(page) : null;
  }
  async function persist(next, nextFolders, authorize) {
    const json = JSON.stringify({ version: 2, pages: next, folders: nextFolders });
    if (Buffer.byteLength(json) > 32 * 1024 * 1024) fail(413, '知识库的 32 MiB 存储空间已满。');
    await atomicFile(file, json, 0o600, { beforeReplace: authorize });
  }
  return {
    async request(action, input = {}, context = {}) {
      if (action === 'library') return { pages: pages.map(current), folders };
      if (action === 'list')
        return input?.summary === true
          ? pages.map(({ id, title, project, folder, tags }) => ({ id, title, project, folder, tags }))
          : pages.map(current);
      if (action === 'history') return requirePage(input?.id).history;
      if (!['create', 'save', 'restore', 'remove', 'create-folder'].includes(action))
        fail(404, '未知的知识库操作。');
      if (!input || typeof input !== 'object') fail(400, '文档请求无效。');
      const result = queue.then(() => update(action, input, context));
      queue = result.catch(() => {});
      return result;
    },
    close: () => queue,
  };
}
