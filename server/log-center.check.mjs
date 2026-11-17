import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, appendFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createLogCenter, readLogFile } from './log-center.mjs';
import { createSharedWorkspaces } from './shared-workspaces.mjs';
import { emptySharingServices, sharingServices } from '../shared/sharing.mjs';
import { shareTransport } from './lan-transports.mjs';
import { createServer } from 'node:http';

async function fixture(t) {
  const folder = await mkdtemp(path.join(tmpdir(), 'devkit-logs-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const filename = path.join(folder, 'app.log'); await writeFile(filename, 'INFO 启动\nERROR 失败 password=secret\n');
  let instances = [{ id: 'app', name: '应用', jar: path.join(folder, 'app.jar'), logName: 'app.log', pidName: 'app.pid', logMode: 'file' }, { id: 'console', name: '交互', logMode: 'console' }, { id: 'silent', name: '静默', logMode: 'silent' }];
  let generation = 'run1'; const calls = [];
  const jar = { request: async (action, payload, access) => { calls.push({ action, payload, access }); if (action === 'get') return { instances }; if (action === 'console-read') return { available: true, text: payload.generation === generation ? '' : 'console output\n', generation, cursor: 15, end: 15, reset: payload.generation !== generation, truncated: false }; throw Error('Execution forbidden in log fixture'); } };
  const nginx = { request: async action => action === 'get' ? { instances: [{ id: 'ng', name: '网关' }] } : action === 'inspect' ? { logs: [{ path: filename, kinds: ['error_log'] }], warnings: [] } : assert.fail('Only inspection is allowed') };
  return { folder, filename, calls, logs: createLogCenter({ jar: () => jar, nginx: () => nginx }), remove: () => { instances = []; }, restart: () => { generation = 'run2'; } };
}

test('byte cursors append once, preserve split UTF-8, detect copy-truncate and file replacement', async t => {
  const f = await fixture(t); let result = await readLogFile(f.filename); assert.match(result.text, /启动/);
  assert.equal((await readLogFile(f.filename, result.cursor)).text, '');
  const chinese = Buffer.from('新增'); await appendFile(f.filename, chinese.subarray(0, 2));
  let next = await readLogFile(f.filename, result.cursor); assert.equal(next.text, '');
  await appendFile(f.filename, Buffer.concat([chinese.subarray(2), Buffer.from('\n')]));
  next = await readLogFile(f.filename, next.cursor); assert.equal(next.text, '新增\n'); result = next;
  await writeFile(f.filename, 'rewritten same or larger content; a fresh new line\n');
  next = await readLogFile(f.filename, result.cursor); assert.equal(next.reset, true); assert.match(next.text, /rewritten/);
  await rename(f.filename, f.filename + '.1'); await writeFile(f.filename, 'rotated\n');
  result = await readLogFile(f.filename, next.cursor); assert.equal(result.reset, true); assert.equal(result.text, 'rotated\n');
  await assert.rejects(readLogFile(f.folder), /普通文件|EISDIR|EPERM/);
});

test('classification is enforced on all log reads, console reads and exports; log output masks escaped quotes and prefixed headers', async t => {
  const f = await fixture(t), services = emptySharingServices();
  const log = 'INFO ' + JSON.stringify({ password: 'escaped"and-trailing-secret', status: 'safe-json' }) + '\n[trace] Cookie: first=first-secret; second=second-secret\nheaders[Cookie: third=third-secret; fourth=fourth-secret]\nINFO safe-line\n';
  await writeFile(f.filename, log);
  services.jar = { enabled: true, edit: true, control: true };
  services.nginx = { enabled: true, edit: true, control: true };
  services.logs = { enabled: true, jar: true, nginx: true, export: true, raw: false };
  const manager = { request: async () => ({ text: log, available: true }) };
  const api = createSharedWorkspaces({ jar: () => manager, nginx: () => manager, logs: () => f.logs });
  const request = (module, action, payload) => api.request(module, action, payload, { token: 'guest', settings: { services } });
  const catalog = await request('logs', 'sources');
  const masked = result => {
    assert.doesNotMatch(result.text, /trailing-secret|first-secret|second-secret|third-secret|fourth-secret/);
    assert.match(result.text, /safe-json/);
    assert.match(result.text, /safe-line/);
  };
  masked(await request('jar', 'log-tail', {}));
  masked(await request('jar', 'console-read', {}));
  masked(await request('nginx', 'log-tail', {}));
  assert.equal((await request('nginx', 'log-tail', { query: 'safe-line', lines: 2000 })).text, 'INFO safe-line');
  assert.equal((await request('nginx', 'log-tail', { query: 'second-secret', lines: 2000 })).text, '');
  for (const module of ['jar', 'nginx']) {
    const id = catalog.sources.find(item => item.kind === module && item.mode === 'file').id;
    for (const action of ['read', 'export']) masked((await request('logs', action, { sources: [{ id }] })).results[0]);
    services.logs[module] = false;
    assert.ok(!(await request('logs', 'sources')).sources.some(item => item.kind === module));
    for (const action of ['read', 'export']) assert.match((await request('logs', action, { sources: [{ id }] })).results[0].error, /未授权/);
    await assert.rejects(request(module, 'log-tail', { raw: true }), { status: 403 });
    if (module === 'jar') await assert.rejects(request('jar', 'console-read', { raw: true }), { status: 403 });
    assert.ok(await request(module, 'get'));
    services.logs[module] = true;
  }
  services.logs.enabled = false;
  await assert.rejects(request('logs', 'sources'), { status: 404 });
  await assert.rejects(request('jar', 'console-read', {}), { status: 403 });
  await assert.rejects(request('nginx', 'log-tail', {}), { status: 403 });
});

test('four slow remote requests leave local discovery and live tail capacity available', async t => {
  const f = await fixture(t);
  const hostId = 'a'.repeat(36);
  const slow = Promise.withResolvers();
  const lan = { logTargets: () => [{ id: hostId, modules: { jar: true, nginx: false } }], logs: () => slow.promise };
  const state = await f.logs.request('sources');
  const read = createLogCenter({ jar: () => ({
    request: async () => ({ instances: [{ id: 'app', name: '应用', jar: path.join(f.folder, 'app.jar'), logName: 'app.log', pidName: 'app.pid', logMode: 'file' }] }),
  }), lan: () => lan }).request;
  const remote = Array.from({ length: 4 }, () => read('sources', { hostId }));
  try {
    await assert.rejects(read('sources', { hostId }), { status: 429 });
    const local = state.sources.find(source => source.kind === 'jar' && source.mode === 'file');
    assert.match((await read('read', { sources: [{ id: local.id }] })).results[0].text, /启动/);
  } finally {
    slow.resolve({ warnings: [], sources: [] });
    await Promise.all(remote);
  }
});

test('closing or releasing a log-only visitor releases its connections, including an in-flight request', async () => {
  const released = [], pending = Promise.withResolvers();
  const services = emptySharingServices(); services.logs.enabled = true;
  const api = createSharedWorkspaces({ logs: () => ({ request: () => pending.promise }), lan: () => ({ release: token => released.push(token) }) });
  const active = api.request('logs', 'sources', {}, { token: 'log-only', settings: { services } });
  api.close();
  assert.deepEqual(released, ['log-only']);
  pending.resolve({});
  await active;
  assert.deepEqual(released, ['log-only', 'log-only']);
});

test('closing a DevKit transport during login logs out upstream and cannot restart authentication', { timeout: 5000 }, async t => {
  const accepted = Promise.withResolvers(), proceed = Promise.withResolvers(), logout = Promise.withResolvers();
  const actions = [];
  const server = createServer(async (request, response) => {
    actions.push(request.url);
    if (request.url.endsWith('/login')) {
      accepted.resolve(); await proceed.promise;
      response.setHeader('Set-Cookie', `devkit_project_session=${'a'.repeat(64)}; Path=/; HttpOnly`);
    } else if (request.url.endsWith('/logout')) {
      assert.match(request.headers.cookie, /devkit_project_session/); logout.resolve();
    }
    response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const transport = shareTransport({ address: `http://127.0.0.1:${server.address().port}`, visitor: '' }, 'fixture');
  const request = assert.rejects(transport.request('logs', 'sources', {}), /会话已关闭/);
  await accepted.promise;
  transport.close(); proceed.resolve();
  await request;
  await logout.promise;
  await assert.rejects(transport.request('logs', 'sources', {}), /会话已关闭/);
  assert.deepEqual(actions, ['/api/sharing/login', '/api/sharing/logout']);
});

test('initial reads and exports are bounded; batch failures are isolated and no arbitrary paths are accepted', async t => {
  const f = await fixture(t); await writeFile(f.filename, 'INFO line\n'.repeat(200000));
  const catalog = await f.logs.request('sources'); assert.equal(catalog.sources.length, 3);
  const item = catalog.sources.find(item => item.mode === 'file' && item.kind === 'jar');
  const result = await f.logs.request('read', { sources: [{ id: item.id }, { id: 'a'.repeat(64), path: 'C:/secret.txt' }] });
  assert.ok(Buffer.byteLength(result.results[0].text) <= 128 * 1024); assert.equal(result.results[0].truncated, true); assert.match(result.results[1].error, /未授权/);
  const exported = await f.logs.request('export', { sources: [{ id: item.id }] }); assert.ok(Buffer.byteLength(exported.results[0].text) <= 1024 * 1024);
  await assert.rejects(f.logs.request('read', { sources: [{ id: '../secret' }] }), /已登记/);
  await assert.rejects(f.logs.request('read', { sources: Array(5).fill({ id: item.id }) }), /1–4/);
  await assert.rejects(f.logs.request('command', { command: 'start' }), /未知/);
  f.remove(); assert.match((await f.logs.request('read', { sources: [{ id: item.id }] })).results[0].error, /移除/);
});

test('console generation and cursors only read output and never claim input or renew leases', async t => {
  const f = await fixture(t), source = (await f.logs.request('sources')).sources.find(item => item.mode === 'console');
  let result = (await f.logs.request('read', { sources: [{ id: source.id }] })).results[0]; assert.equal(result.reset, true); assert.match(result.text, /output/);
  result = (await f.logs.request('read', { sources: [{ id: source.id, cursor: result.cursor }] })).results[0]; assert.equal(result.text, '');
  f.restart(); result = (await f.logs.request('read', { sources: [{ id: source.id, cursor: result.cursor }] })).results[0]; assert.equal(result.reset, true);
  assert.ok(f.calls.filter(item => item.action === 'console-read').every(item => item.access.allowControl === false));
  assert.equal(f.calls.some(item => /claim|input|command/.test(item.action)), false);
});

test('standalone log permissions default closed, authorize each source class and export independently', async t => {
  const f = await fixture(t), services = emptySharingServices(), api = createSharedWorkspaces({ logs: () => f.logs });
  const call = (action, payload) => api.request('logs', action, payload, { token: 'log-viewer', settings: { services } });
  const old = { ...services }; delete old.logs; assert.equal(sharingServices({ services: old }).logs.enabled, false);
  await assert.rejects(call('sources'), /未开放/); services.logs.enabled = true;
  assert.deepEqual((await call('sources')).sources, []);
  services.logs.jar = true; const catalog = await call('sources'); assert.equal(catalog.sources.length, 2); assert.ok(catalog.sources.every(item => item.kind === 'jar'));
  const id = catalog.sources[0].id; await assert.rejects(call('export', { sources: [{ id }] }), /导出权限/);
  const request = { raw: true, sources: [{ id }] };
  assert.match((await call('read', request)).results[0].text, /password=\[已隐藏\]/);
  services.logs.raw = true;
  assert.match((await call('read', request)).results[0].text, /password=secret/);
  assert.match((await call('read', { ...request, scope: 'local', logAccess: { jar: true, raw: false } })).results[0].text, /password=\[已隐藏\]/);
  await writeFile(f.filename, 'password=prefix');
  const first = (await call('read', { sources: [{ id }] })).results[0];
  await appendFile(f.filename, 'suffix-secret\nINFO visible\n');
  const next = (await call('read', { sources: [{ id, cursor: first.cursor }] })).results[0];
  assert.doesNotMatch(next.text, /suffix-secret/);
  assert.match(next.text, /INFO visible/);
  services.logs.export = true; assert.ok((await call('export', { sources: [{ id }] })).results[0].text);
  services.logs.jar = false; assert.match((await call('read', { sources: [{ id }] })).results[0].error, /未授权/);
  services.logs.nginx = true; assert.equal((await call('sources')).sources[0].kind, 'nginx');
  assert.equal(services.jar.enabled, false); assert.equal(services.nginx.enabled, false);
});
