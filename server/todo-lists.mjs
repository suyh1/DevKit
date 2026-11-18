import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { todoDefault, todoStorageLimit } from '../shared/todo-text.mjs';
import { atomicFile } from './atomic-file.mjs';

const notFound = '清单不存在或尚未共享。';
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const actions = new Set(['get', 'create', 'save', 'settings', 'remove']);
const read = filename => readFile(filename, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; });
function nameOf(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 120 || /[\x00-\x1f]/.test(value))
    fail(400, '请输入 1 至 120 字符的清单名称。');
  return value.trim();
}
function bodyOf(value) {
  if (typeof value !== 'string' || value.includes('\0')) fail(400, '清单内容必须是纯文本。');
  return value.replace(/\r\n?/g, '\n');
}
function write(filename, documents, authorize) {
  const data = JSON.stringify({ version: 1, documents }, null, 2);
  if (Buffer.byteLength(data) > todoStorageLimit) fail(413, '待办清单的 16 MB 存储空间已满。');
  return atomicFile(filename, data, 0o600, { beforeReplace: authorize });
}

const singleLine = text => typeof text === 'string' ? text.replace(/[\r\n\x00-\x1f]+/g, ' ').trim() : '';
const parameter = value => singleLine(value).replaceAll('(', '（').replaceAll(')', '）');
const tag = (name, value) => value ? `@${name}(${parameter(value)})` : '';
function notes(text, indent) {
  return typeof text === 'string' ? text.split(/\r\n?|\n/).filter(line => line.trim()).map(line => indent + '# ' + line.trim()) : [];
}
function legacyTasks(project, tasks) {
  const ids = new Map(project.tasks.map(task => [task.id, project.key && task.number ? `${project.key}-${task.number}` : task.title]));
  return tasks.flatMap(task => {
    const labels = (task.labels || []).map(label => /^[\p{L}\p{N}_-]+$/u.test(label) ? '@' + label : tag('tag', label));
    const marker = task.status === 'done' ? '✔' : '☐';
    const tags = [
      task.status === 'doing' ? '@started' : ['backlog', 'review'].includes(task.status) ? '@' + task.status : '',
      task.priority === 'urgent' ? '@critical' : ['low', 'high'].includes(task.priority) ? '@' + task.priority : '',
      tag('due', task.due), tag('start', task.start), tag('owner', task.assignee),
      task.type && task.type !== 'task' ? tag('type', task.type) : '',
      project.key && task.number ? tag('id', ids.get(task.id)) : '', ...labels,
    ].filter(Boolean);
    const details = notes(task.description, '    ');
    if (task.blockedBy?.length) details.push('    # 前置任务 ' + task.blockedBy.map(id => singleLine(ids.get(id)) || id).join('、'));
    for (const check of task.checklist || []) {
      details.push(`    ${check.done ? '✔' : '☐'} ${singleLine(check.title)}`);
    }
    for (const comment of task.comments || []) {
      details.push(`    # ${singleLine(comment.actor)} ${singleLine(comment.at)}`.trimEnd(), ...notes(comment.text, '    '));
    }
    return [[`  ${marker} ${singleLine(task.title)}`, ...tags].join(' ').trimEnd(), ...details];
  });
}
function legacyBody(project) {
  const milestones = project.milestones || [];
  const grouped = new Set(milestones.map(item => item.id));
  const metadata = [tag('owner', project.owner), tag('start', project.start), tag('due', project.due), tag('status', project.status)].filter(Boolean);
  const lines = [...notes(project.description, ''), ...(metadata.length ? ['# ' + metadata.join(' ')] : [])];
  const append = (title, tasks, description, dates = []) => {
    if (lines.length) lines.push('');
    const section = title && !/^(?:archive|归档)$/iu.test(title) ? title : '待办';
    lines.push(`${section}:`, ...notes(description, '  '), ...(dates.length ? ['  # ' + dates.join(' ')] : []), ...legacyTasks(project, tasks));
  };
  append('待办', project.tasks.filter(task => !grouped.has(task.milestoneId)));
  for (const milestone of milestones) {
    append(singleLine(milestone.title), project.tasks.filter(task => task.milestoneId === milestone.id), milestone.description,
      [tag('start', milestone.start), tag('due', milestone.due)].filter(Boolean));
  }
  return lines.join('\n') + '\n';
}

async function load(directory, filename) {
  const stored = await read(filename);
  if (stored !== undefined) {
    const value = JSON.parse(stored);
    if (value?.version !== 1 || !Array.isArray(value.documents) || value.documents.some(item =>
      typeof item?.id !== 'string' || typeof item.name !== 'string' || typeof item.body !== 'string' ||
      typeof item.published !== 'boolean' || !Number.isSafeInteger(item.revision) || item.revision < 1))
      fail(500, '待办清单的数据格式无效。');
    return value.documents;
  }
  const legacy = await read(path.join(directory, 'project-todos.json'));
  if (legacy === undefined) return [];
  const value = JSON.parse(legacy);
  if (![1, 2].includes(value?.version) || !Array.isArray(value.projects) || value.projects.some(item =>
    typeof item?.id !== 'string' || typeof item.name !== 'string' || !Array.isArray(item.tasks)))
    fail(500, '旧版待办数据格式无效。');
  const documents = value.projects.map(project => ({
    id: project.id, name: singleLine(project.name) || '待办清单', body: legacyBody(project),
    revision: Number.isSafeInteger(project.revision) && project.revision > 0 ? project.revision : 1, published: project.published === true,
  }));
  // The original is kept for rollback and for metadata that has no equivalent in a text list.
  await write(filename, documents);
  return documents;
}

export async function createTodoLists(directory) {
  const filename = path.join(directory, 'todo-lists.json');
  let documents = await load(directory, filename);
  let queue = Promise.resolve();
  const view = portal => documents.filter(item => !portal || item.published);
  async function mutate(action, input, { portal, authorize }) {
    authorize?.();
    const shown = view(portal);
    const current = action === 'create' ? undefined : shown.find(item => item.id === input?.id);
    if (action !== 'create' && !current) fail(404, notFound);
    if (current && current.revision !== input?.revision) fail(409, '清单已在其他位置更新，请先载入主机版本。');
    let document;
    if (action === 'create') {
      if (documents.length >= 200) fail(400, '最多保存 200 份清单。');
      document = {
        id: randomUUID(), revision: 1, name: nameOf(input?.name),
        body: bodyOf(input?.body ?? todoDefault), published: portal || input?.published === true,
      };
    } else if (action === 'save') {
      document = { ...current, revision: current.revision + 1, body: bodyOf(input?.body) };
    } else if (action === 'settings') {
      document = {
        ...current, revision: current.revision + 1, name: nameOf(input?.name),
        published: portal ? current.published : input?.published === true,
      };
    }
    const next = action === 'create' ? [...documents, document] : documents.flatMap(item => item !== current ? [item] : document ? [document] : []);
    await write(filename, next, authorize);
    documents = next;
    return { documents: view(portal), selectedId: document?.id };
  }
  return {
    async request(action, input, { portal = false, edit = false, authorize } = {}) {
      if (!actions.has(action)) fail(404, '待办清单操作不存在。');
      if (action === 'get') return { documents: view(portal) };
      if (portal && !edit) fail(403, '待办清单为只读模式。');
      const result = queue.then(() => mutate(action, input, { portal, authorize }));
      queue = result.catch(() => {});
      return result;
    },
    close: () => queue,
  };
}
