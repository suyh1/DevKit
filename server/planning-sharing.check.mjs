import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, readFile, realpath, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { createFileShares } from './file-shares.mjs';
import { createProjectHost } from './project-host.mjs';
import { createProjectStore } from './project-store.mjs';
import { createTodoLists } from './todo-lists.mjs';
import { archiveTodo, changeTodoLine, isTodoDate, parseTodo, planTodoCommand, todoChildIndent, todoGroupAt, todoGroupDefaults, todoReferences } from '../shared/todo-text.mjs';
import { emptySharingServices, sharingServices } from '../shared/sharing.mjs';

async function fixture(work) {
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(path.join(temp, 'devkit-planning-sharing-'));
  try { await work(root); }
  finally {
    assert.equal(path.dirname(root), temp);
    assert.ok(path.basename(root).startsWith('devkit-planning-sharing-'));
    await rm(root, { recursive: true, force: true });
  }
}
async function bind() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { port, close: () => new Promise(resolve => server.close(resolve)) };
}
async function freePort() {
  const server = await bind();
  await server.close();
  return server.port;
}
function zipContents(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0);
  let offset = bytes.readUInt32LE(end + 16);
  const entries = new Map();
  while (offset < end) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const length = bytes.readUInt16LE(offset + 28);
    const local = bytes.readUInt32LE(offset + 42);
    const data = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    assert.equal(bytes.readUInt16LE(local + 8), 0);
    entries.set(bytes.toString('utf8', offset + 46, offset + 46 + length), bytes.toString('utf8', data, data + bytes.readUInt32LE(offset + 20)));
    offset += 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return entries;
}

test('file shares persist independently, scope browsing and stream valid folder ZIPs', async () => fixture(async root => {
  const files = path.join(root, '资料'), outside = path.join(root, 'private'), configs = path.join(files, 'configs');
  await mkdir(path.join(files, '空目录'), { recursive: true });
  await mkdir(configs);
  await mkdir(outside);
  await writeFile(path.join(files, '报告 #1.txt'), 'shared document');
  await writeFile(path.join(outside, 'secret.txt'), 'private document');
  await writeFile(path.join(configs, 'private.txt'), 'configuration');
  await symlink(outside, path.join(files, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir');
  let shares = await createFileShares(configs);
  const occupied = await bind();
  try {
    const value = { name: '共享资料', paths: [files, path.join(files, '报告 #1.txt')], enabled: true, published: true, port: await freePort() };
    const result = await shares.request('save', { revision: 0, value });
    const first = result.shares[0], [link] = first.links;
    const second = (await shares.request('save', { revision: result.revision, value: { ...value, name: '另一个共享', port: await freePort(), published: false } })).shares[1];
    assert.equal((await fetch(new URL('/', link))).status, 404);
    assert.match(await (await fetch(link)).text(), /共享资料/);
    const listing = await (await fetch(link + '0/')).text();
    assert.match(listing, /报告 #1\.txt/);
    assert.doesNotMatch(listing, /outside-link|configs/);
    const attachment = await fetch(link + '0/' + encodeURIComponent('报告 #1.txt'));
    assert.match(attachment.headers.get('content-disposition'), /^attachment/);
    assert.equal(await attachment.text(), 'shared document');
    assert.equal(await (await fetch(link + '1')).text(), 'shared document');
    assert.equal((await fetch(link + '0/outside-link/secret.txt')).status, 404);
    assert.equal((await fetch(link + '0/configs/private.txt')).status, 404);
    const zip = await fetch(link + '0/?zip=1');
    assert.equal(zip.headers.get('content-type'), 'application/zip');
    assert.deepEqual(zipContents(Buffer.from(await zip.arrayBuffer())), new Map([
      ['资料/', ''], ['资料/空目录/', ''], ['资料/报告 #1.txt', 'shared document'],
    ]));
    const replaced = path.join(files, '报告 #1.txt');
    await unlink(replaced);
    await mkdir(replaced);
    assert.equal((await fetch(link + '1/?zip=1')).status, 404);
    await rmdir(replaced);
    await writeFile(replaced, 'shared document');
    const revision = shares.get().revision;
    await assert.rejects(shares.request('save', { revision, id: first.id, value: { ...value, port: occupied.port } }), /已被占用/);
    assert.equal(shares.get().revision, revision);
    assert.equal((await fetch(link)).status, 200);
    await shares.request('toggle', { id: first.id, revision, enabled: false });
    assert.equal((await fetch(second.links[0])).status, 200);
    await assert.rejects(fetch(link));
    await shares.close();
    shares = await createFileShares(configs);
    assert.deepEqual(shares.get().shares.map(share => share.running), [false, true]);
    assert.equal((await fetch(second.links[0])).status, 200);
  } finally {
    await shares.close();
    await occupied.close();
  }
}));

test('portal grants download and TODO access independently and serializes concurrent edits', async () => fixture(async root => {
  const configs = path.join(root, 'configs'), dist = path.join(root, 'dist'), file = path.join(root, 'readme.txt');
  await mkdir(path.join(dist, '.vite'), { recursive: true });
  await writeFile(path.join(dist, '.vite/manifest.json'), JSON.stringify({ 'portal.html': { file: 'portal.html' } }));
  await writeFile(file, 'portal download');
  const store = await createProjectStore(configs);
  const todos = await createTodoLists(configs), files = await createFileShares(configs);
  const host = await createProjectHost(store, dist, { fileShares: () => files, projectTodos: () => todos });
  try {
    const { shares: [share] } = await files.request('save', { revision: 0, value: {
      name: '访客共享', paths: [file], port: await freePort(), enabled: true, published: true,
    } });
    const { selectedId: hiddenId } = await todos.request('create', { name: '私有', body: '☐ 主机内部任务' });
    const { selectedId: publishedId } = await todos.request('create', { name: '合作', published: true });
    const services = emptySharingServices(), viewer = emptySharingServices();
    services['project-todos'] = { enabled: true, edit: true };
    services['file-shares'].enabled = true;
    viewer['project-todos'].enabled = true;
    const legacy = { ...services };
    delete legacy['project-todos'];
    delete legacy['file-shares'];
    assert.deepEqual(sharingServices({ services: legacy })['project-todos'], { enabled: false, edit: false });
    const { addresses: [address] } = await host.start({ host: '127.0.0.1', port: await freePort(), password: 'owner-test-only', services,
      visitors: [{ name: 'viewer', password: 'viewer-test-only', services: viewer }],
    });
    const origin = new URL(address).origin;
    const post = (route, value, cookie = '') => fetch(origin + '/api/' + route, {
      method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(value),
    });
    async function login(password, visitor = '') {
      const response = await post('sharing/login', { password, visitor });
      assert.equal(response.status, 200);
      return response.headers.get('set-cookie').split(';')[0];
    }
    const readOnly = await login('viewer-test-only', 'viewer');
    const editor = await login('owner-test-only');
    const browse = origin + '/api/file-shares/browse/' + share.id + '/';
    assert.equal((await fetch(browse)).status, 401);
    assert.equal((await fetch(browse, { headers: { Cookie: readOnly } })).status, 404);
    const published = (await (await post('file-shares/get', {}, editor)).json()).shares[0];
    assert.deepEqual(published.roots, [{ label: 'readme.txt', directory: false }]);
    assert.equal(await (await fetch(browse + '0', { headers: { Cookie: editor } })).text(), 'portal download');
    assert.equal((await post('file-shares/remove', { id: share.id }, editor)).status, 404);
    assert.deepEqual((await (await post('project-todos/get', {}, readOnly)).json()).documents.map(item => item.id), [publishedId]);
    assert.equal((await post('project-todos/create', { name: '未授权' }, readOnly)).status, 403);
    assert.equal((await post('project-todos/remove', { id: hiddenId, revision: 1 }, editor)).status, 404);
    const task = { id: publishedId, revision: 1, body: '发布:\r\n  ☐ 共同待办 @today\r\n' };
    const writes = await Promise.all([post('project-todos/save', task, editor), post('project-todos/save', task, editor)]);
    assert.deepEqual(writes.map(result => result.status).sort(), [200, 409]);
    const renamed = await post('project-todos/settings', { id: publishedId, revision: 2, name: '发布清单', published: false }, editor);
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json()).documents[0].published, true);
    const reloaded = await createTodoLists(configs);
    const documents = (await reloaded.request('get')).documents;
    assert.equal(documents.find(item => item.id === publishedId).body, '发布:\n  ☐ 共同待办 @today\n');
    assert.equal(documents.find(item => item.id === hiddenId).published, false);
    await post('sharing/logout', {}, editor);
    assert.equal((await fetch(browse, { headers: { Cookie: editor } })).status, 401);
  } finally {
    await host.stop();
    await files.close();
    await todos.close();
    await store.close();
  }
}));

test('both legacy formats become text lists with their publication and unmodified originals', async () => fixture(async root => {
  for (const version of [1, 2]) {
    const dir = path.join(root, String(version));
    await mkdir(dir);
    const old = path.join(dir, 'project-todos.json');
    const contents = JSON.stringify({ version, projects: [{
      id: 'project', key: 'DEV', name: '旧项目', description: '项目说明', revision: 4, published: version === 2,
      milestones: [{ id: 'group', title: '发行', due: '2026-12-01' }],
      tasks: [{ id: 'original', number: 3, title: '原有任务', description: '任务说明', assignee: '实施组',
        status: 'done', priority: 'high', due: '2026-12-01', milestoneId: 'group',
        checklist: [{ title: '确认结果', done: false }], comments: [{ actor: '访客', text: '回归备注' }],
      }],
    }] });
    await writeFile(old, contents);
    const manager = await createTodoLists(dir);
    const [converted] = (await manager.request('get')).documents;
    assert.equal(converted.name, '旧项目');
    assert.equal(converted.revision, 4);
    assert.equal(converted.published, version === 2);
    assert.match(converted.body, /发行:/);
    assert.match(converted.body, /✔ 原有任务 @high @due\(2026-12-01\) @owner\(实施组\) @id\(DEV-3\)/);
    assert.match(converted.body, /☐ 确认结果/);
    assert.match(converted.body, /# 回归备注/);
    await manager.request('save', { id: converted.id, revision: 4, body: '新清单:\n  ☐ 持续编辑' });
    await manager.close();
    assert.equal(await readFile(old, 'utf8'), contents);
    const reopened = await createTodoLists(dir);
    assert.equal((await reopened.request('get')).documents[0].body, '新清单:\n  ☐ 持续编辑');
    await reopened.close();
  }
}));

test('Todo+ editing preserves notes, Markdown states and unfinished children when archiving', () => {
  const source = [
    '工作:', '  - [x] 已交付 @done(2026-11-18 09:00)', '    # 历史备注', '  ✔ 仍有子任务',
    '    ☐ 未完成 @today', '  ✘ 已取消', '  升级:', '    - 验证 @due(2026-12-01)', '',
    'Archive:', '  ✔ 已存档', '', '下一组:', '☐ 其他', '',
  ].join('\n');
  const wrapped = archiveTodo(source);
  assert.equal(wrapped.archived, 2);
  assert.match(wrapped.body, /工作:\n  ✔ 仍有子任务\n    ☐ 未完成/);
  assert.match(wrapped.body, /Archive:\n  ✔ 已存档\n  - \[x\] 已交付.*@project\(工作\)\n    # 历史备注\n  ✘ 已取消 @project\(工作\)/);
  assert.equal(parseTodo(wrapped.body).tasks.find(task => task.text === '其他').path, '下一组');
  assert.equal(archiveTodo(wrapped.body).body, wrapped.body);
  const time = '2026-11-18 12:00';
  const finished = changeTodoLine('  ☐ 整理 @today @due(2026-12-01)', 'done', time);
  assert.equal(finished, '  ✔ 整理 @today @due(2026-12-01) @done(2026-11-18 12:00)');
  assert.equal(changeTodoLine(finished, 'done', time), '  ☐ 整理 @today @due(2026-12-01)');
});

test('Todo extensions preserve indentation, named views, reference offsets and archived dependencies', () => {
  const source = [
    ':: 视图 待验收 @tag(验收) @state(open)', '发布:', '  :: 默认 @验收 @owner(旧值) @id(忽略)',
    '  ☐ 验证 [[共享:发布材料]] [[工具:JSON 格式化]] @after(build,auth) @wait(小周) @review(2026-12-01)',
    '    ? [ ] ZIP 完整', '    :: 接着 验证只读访问', '    ☐ 子任务', '      ? [x] 已检查',
    '  测试:', '    :: 默认 @owner(小陈)', '    ☐ 复验 @after(dup,unknown,self) @id(self)',
    '☐ 结束测试 @id(dup)', '  ☐ 另一个编号冲突 @id(dup)', 'Archive:', '  ✔ 已打包 @id(build)', '  ✘ 认证已取消 @id(auth)',
  ].join('\n');
  const model = parseTodo(source);
  const first = model.tasksByLine.get(4), second = model.tasksByLine.get(11);
  assert.equal(first.endLine, 8);
  assert.deepEqual(first.checks.map(check => [check.line, check.checked]), [[5, false]]);
  assert.equal(model.checks.get(8).taskLine, 7);
  assert.equal(first.resume, model.resumesByLine.get(6));
  assert.equal(first.resume.text, '验证只读访问');
  assert.equal(first.resume.endLine, 6);
  assert.deepEqual(first.waiting, { person: '小周', review: '2026-12-01' });
  assert.deepEqual(first.dependencies.map(dep => [dep.id, dep.state, dep.line]), [['build', 'done', 15], ['auth', 'cancelled', 16]]);
  assert.deepEqual(second.dependencies.map(dep => dep.state), ['duplicate', 'missing', 'self']);
  assert.deepEqual(model.views.map(view => [view.name, ...view.filters.map(tag => tag.value)]), [['待验收', '验收', 'open']]);
  assert.deepEqual(todoGroupDefaults(model, todoGroupAt(model, 11)), ['@owner(小陈)', '@验收']);
  assert.deepEqual(todoGroupDefaults(model, todoGroupAt(model, 12)), ['@验收', '@owner(旧值)']);
  assert.deepEqual(todoReferences(first.text).map(ref => [ref.kind, ref.name, first.text.slice(ref.from, ref.to)]), [
    ['share', '发布材料', '[[共享:发布材料]]'], ['tool', 'JSON 格式化', '[[工具:JSON 格式化]]'],
  ]);
  assert.deepEqual(planTodoCommand(model, [5], 'done').edits, [[5, '    ? [x] ZIP 完整']]);
  const note = parseTodo('发布:\n  :: 默认 @验收 @owner(小陈)\n  核对说明 @owner(小周)');
  assert.deepEqual(planTodoCommand(note, [3], 'box').edits, [[3, '  ☐ 核对说明 @owner(小周) @验收']]);
});

test('subtasks can keep nesting beneath resume points and retain their own state', () => {
  const nested = Array.from({ length: 32 }, (_, index) => `${' \t'}${'  '.repeat(index)}☐ 步骤 ${index + 1}`);
  const model = parseTodo(['✔ 发布', ' :: 续做 从只读账号开始', ...nested, ' ☐ 配置', '☐ 下一项'].join('\n'));
  const [parent, ...tasks] = model.tasks;
  const resume = model.resumesByLine.get(2);
  assert.equal(parent.resume, resume);
  assert.equal(resume.taskLine, parent.line);
  assert.equal(resume.endLine, nested.length + 2);
  assert.equal(parent.endLine, resume.endLine + 1);
  assert.equal(todoChildIndent(model, parent), ' ');
  assert.equal(todoChildIndent(model, resume), ' \t');
  assert.equal(tasks[0].level, 2);
  assert.equal(tasks[nested.length - 1].level, nested.length + 1);
  assert.deepEqual(tasks.slice(-2).map(task => task.level), [1, 0]);
  assert.deepEqual(planTodoCommand(model, [3], 'done').edits.map(([line]) => line), [3]);
  assert.equal(archiveTodo(model.lines.join('\n')).archived, 0);
});

test('completing a recurring Todo keeps history, generates one dated successor and resets acceptance', () => {
  const source = [
    '发布:', '  ☐ 验证 @验收 @id(verify) @after(build) @due(2026-11-16) @repeat(每周一) @wait(小周) @review(2026-11-17)',
    '    ? [ ] ZIP 完整', '    :: 接着 验证当前期', '  ☐ 其他', '',
  ].join('\n');
  const date = new Date(2026, 10, 18, 12);
  const apply = (model, plan) => {
    const edits = new Map(plan.edits);
    return model.lines.map((line, index) => edits.get(index + 1) ?? line).join('\n');
  };
  const before = parseTodo(source), plan = planTodoCommand(before, [2, 3], 'done', date);
  assert.equal(planTodoCommand(before, [2], 'done', date).pendingChecks, 1);
  assert.equal(plan.pendingChecks, 0);
  assert.equal(plan.repeated, 1);
  const after = parseTodo(apply(before, plan));
  assert.match(after.lines[1], /✔ 验证 .*@id\(verify\).*@done\(/);
  assert.doesNotMatch(after.lines[1], /@repeat/);
  assert.equal(after.lines[2], '    ? [x] ZIP 完整');
  assert.equal(after.lines[4], '  ☐ 验证 @验收 @repeat(每周一) @due(2026-11-23)');
  assert.equal(after.lines[5], '    ? [ ] ZIP 完整');
  assert.equal(after.lines[6], '  ☐ 其他');
  const reopened = parseTodo(apply(after, planTodoCommand(after, [2], 'done', date)));
  assert.equal(planTodoCommand(reopened, [2], 'done', date).repeated, 0);

  for (const [rule, dateValue, start, expected] of [
    ['每月31日', '2024-01-31', new Date(2024, 0, 31), '2024-02-29'],
    ['每月31日', '2024-02-29', new Date(2024, 1, 29), '2024-03-31'],
    ['每周', '2026-11-06', date, '2026-11-20'],
    ['每天', '', date, '2026-11-19'],
  ]) {
    const model = parseTodo(`☐ 回归 ${dateValue ? `@due(${dateValue}) ` : ''}@repeat(${rule})`);
    const result = planTodoCommand(model, [1], 'done', start);
    assert.match(apply(model, result), new RegExp(`@due\\(${expected}\\)$`));
  }
  const invalid = planTodoCommand(parseTodo('☐ 错误日期 @due(2026-02-30) @repeat(每天)'), [1], 'done', date);
  assert.equal(invalid.invalidRepeats, 1);
  assert.equal(invalid.repeated, 0);
  assert.equal(isTodoDate('2026-02-30'), false);
});

test('shorthand and full-width Todo syntax keep acceptance state and resolve the same directives', () => {
  const body = [
    '：： 自定义视图 待验收 @tag(验收) @state(open)', '发布:', '  :: 分组默认 @验收', '  ☐ 检查下载',
    '    ? ZIP 能解压', '    ？ [✓] 文件名正确', '    :: 续做 改用只读账号',
  ].join('\n');
  const model = parseTodo(body), task = model.tasksByLine.get(4);
  assert.equal(model.views[0].name, '待验收');
  assert.deepEqual([...model.sections[0].defaults.values()], ['@验收']);
  assert.equal(task.resume, model.resumesByLine.get(7));
  assert.equal(task.resume.text, '改用只读账号');
  assert.deepEqual(task.checks.map(check => [check.text, check.checked]), [['ZIP 能解压', false], ['文件名正确', true]]);
  assert.equal(changeTodoLine(model.lines[4], 'done', ''), '    ? [x] ZIP 能解压');
  assert.equal(changeTodoLine(model.lines[5], 'done', ''), '    ？ [ ] 文件名正确');
  assert.equal(changeTodoLine('? 这是旧的普通说明', 'done', ''), '? 这是旧的普通说明');
});
