import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicFile } from './atomic-file.mjs';

const projectLimit = 200, taskLimit = 500;
const statuses = ['todo', 'doing', 'done'];
const priorities = ['low', 'normal', 'high'];
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
function field(value, max, label, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    fail(400, `${label}无效（最多 ${max} 字符）。`);
  return value.trim();
}
function dueDate(value) {
  if (value === '') return value;
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00Z') : null;
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    fail(400, '截止日期无效。');
  return value;
}

export async function createProjectTodos(directory) {
  const filename = path.join(directory, 'project-todos.json');
  let state;
  try { state = JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = { version: 1, projects: [] }; }
  if (state?.version !== 1 || !Array.isArray(state.projects)) fail(500, '项目与待办数据格式无效。');
  let queue = Promise.resolve();
  const view = portal => state.projects.filter(project => !portal || project.published);
  async function mutate(action, input, portal, authorize) {
    authorize?.();
    const { projectId, revision, taskId, value } = input ?? {};
    const current = state.projects.find(project => project.id === projectId && (!portal || project.published));
    if (projectId != null && !current) fail(404, '项目不存在或尚未共享。');
    if (current && revision !== current.revision) fail(409, '此项目已更新，请刷新后重新操作。');
    let project;
    if (action === 'save-project') {
      if (!current && state.projects.length >= projectLimit) fail(400, `最多保存 ${projectLimit} 个项目。`);
      project = {
        id: current?.id ?? randomUUID(),
        name: field(value?.name, 120, '项目名称', true),
        description: field(value?.description ?? '', 4000, '项目说明'),
        published: portal || value?.published === true,
        revision: (current?.revision ?? 0) + 1,
        tasks: current?.tasks ?? [],
      };
    } else {
      if (!current) fail(404, '项目不存在或尚未共享。');
      if (action === 'save-task' || action === 'delete-task') {
        const previous = current.tasks.find(task => task.id === taskId);
        if ((taskId != null || action === 'delete-task') && !previous) fail(404, '待办不存在。');
        if (action === 'save-task' && !previous && current.tasks.length >= taskLimit)
          fail(400, `每个项目最多保存 ${taskLimit} 项待办。`);
        let tasks = current.tasks.filter(task => task !== previous);
        if (action === 'save-task') {
          if (!statuses.includes(value?.status) || !priorities.includes(value?.priority))
            fail(400, '请选择有效的待办状态和优先级。');
          const task = {
            id: previous?.id ?? randomUUID(),
            title: field(value.title, 180, '待办标题', true),
            description: field(value.description ?? '', 4000, '待办说明'),
            assignee: field(value.assignee ?? '', 80, '负责人'),
            due: dueDate(value.due ?? ''),
            status: value.status,
            priority: value.priority,
          };
          tasks = previous ? current.tasks.map(item => item === previous ? task : item) : [...tasks, task];
        }
        project = { ...current, tasks, revision: current.revision + 1 };
      }
    }
    const projects = current
      ? state.projects.flatMap(item => item !== current ? [item] : project ? [project] : [])
      : [...state.projects, project];
    const next = { version: 1, projects };
    const bytes = JSON.stringify(next, null, 2);
    if (Buffer.byteLength(bytes) > 16_000_000) fail(413, '项目与待办共用的 16 MB 存储已满。');
    await atomicFile(filename, bytes, 0o600, { beforeReplace: authorize });
    state = next;
    return { projects: view(portal), selectedId: project?.id };
  }
  return {
    async request(action, input, { portal = false, edit = false, authorize } = {}) {
      if (action === 'get') return { projects: view(portal) };
      if (!['save-project', 'delete-project', 'save-task', 'delete-task'].includes(action)) fail(404, '项目与待办操作不存在。');
      if (portal && !edit) fail(403, '项目与待办为只读模式。');
      const result = queue.then(() => mutate(action, input, portal, authorize));
      queue = result.catch(() => {});
      return result;
    },
    close: () => queue,
  };
}
