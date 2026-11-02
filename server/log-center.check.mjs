import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, appendFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createLogCenter, readLogFile } from './log-center.mjs';
import { createSharedWorkspaces } from './shared-workspaces.mjs';
import { emptySharingServices, sharingServices } from '../shared/sharing.mjs';

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
  services.logs.export = true; assert.ok((await call('export', { sources: [{ id }] })).results[0].text);
  services.logs.jar = false; assert.match((await call('read', { sources: [{ id }] })).results[0].error, /未授权/);
  services.logs.nginx = true; assert.equal((await call('sources')).sources[0].kind, 'nginx');
  assert.equal(services.jar.enabled, false); assert.equal(services.nginx.enabled, false);
});
