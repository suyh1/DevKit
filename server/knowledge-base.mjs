import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicFile } from './atomic-file.mjs';

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
function content(input) {
  const { title, project = '', kind, body } = input;
  if (typeof title !== 'string' || !title.trim() || title.length > 120)
    fail(400, '请输入 1 至 120 字符的文档标题。');
  if (typeof project !== 'string' || project.length > 120) fail(400, '项目名称最多 120 字符。');
  if (!['部署手册', '故障排查', '项目交接'].includes(kind)) fail(400, '请选择文档类型。');
  if (typeof body !== 'string' || body.includes('\0') || body.length > 120000)
    fail(400, 'Markdown 正文最多 12 万字符。');
  return { title: title.trim(), project: project.trim(), kind, body: body.replace(/\r\n?/g, '\n') };
}

export async function createKnowledgeBase(directory) {
  const file = path.join(directory, 'knowledge.json');
  let pages = [];
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.pages)) fail(500, '知识库文件格式无效。');
    for (const page of data.pages) {
      if (typeof page.id !== 'string' || !Array.isArray(page.history)) fail(500, '知识库文档格式无效。');
      for (const entry of [page, ...page.history]) {
        content(entry);
        if (!Number.isSafeInteger(entry.revision) || entry.revision < 1) fail(500, '知识库版本记录无效。');
      }
    }
    pages = data.pages;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const current = ({ history, ...entry }) => entry;
  function requirePage(id) {
    return pages.find((page) => page.id === id) ?? fail(404, '找不到这篇文档，可能已被删除。');
  }
  let queue = Promise.resolve();
  async function update(action, input, { actor = '桌面端', authorize }) {
    authorize?.();
    const previous = action === 'create' ? undefined : requirePage(input.id);
    if (previous && input.revision !== previous.revision)
      fail(409, '这篇文档已被其他人更新。请保留所需草稿，重新打开最新版本后编辑。');
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
    const json = JSON.stringify({ version: 1, pages: next });
    if (Buffer.byteLength(json) > 32 * 1024 * 1024) fail(413, '知识库的 32 MiB 存储空间已满。');
    await atomicFile(file, json, 0o600, { beforeReplace: authorize });
    pages = next;
    return page ? current(page) : null;
  }
  return {
    async request(action, input = {}, context = {}) {
      if (action === 'list')
        return input?.summary === true
          ? pages.map(({ id, title, project, kind }) => ({ id, title, project, kind }))
          : pages.map(current);
      if (action === 'history') return requirePage(input?.id).history;
      if (!['create', 'save', 'restore', 'remove'].includes(action)) fail(404, '未知的知识库操作。');
      if (!input || typeof input !== 'object') fail(400, '文档请求无效。');
      const result = queue.then(() => update(action, input, context));
      queue = result.catch(() => {});
      return result;
    },
    close: () => queue,
  };
}
