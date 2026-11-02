import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createMonitorManager, normalizeMonitor, probeMonitor } from './monitor-manager.mjs';
import { createSharedWorkspaces } from './shared-workspaces.mjs';
import { emptySharingServices, sharingServices } from '../shared/sharing.mjs';

const config = (extra = {}) => ({ name: '本地检测', type: 'http', url: 'http://127.0.0.1/', enabled: true, interval: 10, timeout: 1, failures: 2, status: 200, ...extra });
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'devkit-monitor-'));
  let manager = await createMonitorManager(directory, { auto: false, ...options });
  t.after(async () => { await manager.close(); await rm(directory, { recursive: true, force: true }); });
  return { get manager() { return manager; }, directory, async reopen(extra = {}) { await manager.close(); manager = await createMonitorManager(directory, { auto: false, ...options, ...extra }); return manager; } };
}
async function add(manager, item) {
  const state = await manager.request('get');
  return (await manager.request('upsert', { revision: state.revision, monitor: config(item) })).monitors.at(-1);
}
const wait = async predicate => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } assert.fail('检测未在预期时间完成'); };

test('real HTTP status, redirects, timeout and TCP are bounded and do not consume bodies', async t => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/' }); res.end(); }
    else if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); res.end(); }
    else if (req.url === '/slow') { /* timeout must destroy the connection */ }
    else { res.writeHead(req.url === '/bad' ? 503 : 200); res.flushHeaders(); res.write('header-only'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await probeMonitor(config({ url: url + '/redirect' }), AbortSignal.timeout(2000)), 'HTTP 200');
  await assert.rejects(probeMonitor(config({ url: url + '/bad' }), AbortSignal.timeout(2000)), /503/);
  await assert.rejects(probeMonitor(config({ url: url + '/loop' }), AbortSignal.timeout(2000)), /重定向/);
  await assert.rejects(probeMonitor(config({ url: url + '/slow' }), AbortSignal.timeout(50)));
  const tcp = net.createServer(socket => socket.end()); tcp.listen(0, '127.0.0.1'); await once(tcp, 'listening'); t.after(() => tcp.close());
  assert.equal(await probeMonitor({ type: 'tcp', host: '127.0.0.1', port: tcp.address().port }, AbortSignal.timeout(1000)), 'TCP 连接成功');
  assert.throws(() => normalizeMonitor(config({ url: 'file:///etc/passwd' })), /HTTP/);
  assert.throws(() => normalizeMonitor(config({ interval: 0 })), /10/);
  assert.throws(() => normalizeMonitor(config({ type: 'tcp', host: '', port: 0 })), /TCP/);
});

test('thresholds create one incident, recovery closes it, persisted history survives restart and stale status expires', async t => {
  let clock = Date.now(), healthy = false;
  const f = await fixture(t, { now: () => clock, probe: async () => { if (!healthy) throw new Error('HTTP 503'); return 'HTTP 200'; } });
  const item = await add(f.manager, {});
  let state = await f.manager.request('check', { id: item.id }); assert.equal(state.monitors[0].state, 'pending');
  clock += 10000;
  state = await f.manager.request('check', { id: item.id }); assert.equal(state.monitors[0].state, 'down'); assert.equal(state.monitors[0].incidents.length, 1);
  await f.manager.request('check', { id: item.id }); assert.equal((await f.manager.request('get')).monitors[0].incidents.length, 1);
  healthy = true; clock += 10000; state = await f.manager.request('check', { id: item.id });
  assert.equal(state.monitors[0].state, 'up'); assert.ok(state.monitors[0].incidents[0].end); assert.equal(state.monitors[0].availability, 25);
  await f.reopen(); state = await f.manager.request('get'); assert.equal(state.monitors[0].samples.length, 4); assert.equal(state.monitors[0].incidents.length, 1);
  clock += 31000; assert.equal((await f.manager.request('get')).monitors[0].state, 'unknown');
  clock += 86400000; assert.equal((await f.manager.request('get')).monitors[0].availability, null);
  assert.ok(JSON.parse(await readFile(path.join(f.directory, 'monitor/monitors.json'), 'utf8')).runtime[item.id]);
});

test('scheduler keeps at most three checks in flight, coalesces manual checks and discards obsolete results', async t => {
  let count = 0, peak = 0; const releases = [];
  const f = await fixture(t, { probe: async () => { count++; peak = Math.max(peak, count); await new Promise(resolve => releases.push(resolve)); count--; return 'ok'; } });
  const items = [];
  for (let i = 0; i < 4; i++) items.push(await add(f.manager, { name: `任务${i}` }));
  await f.manager.tick(); await wait(() => count === 3); assert.equal(peak, 3);
  const coalesced = f.manager.request('check', { id: items[0].id });
  await assert.rejects(f.manager.request('check', { id: items[3].id }), /稍后/);
  const before = await f.manager.request('get');
  await f.manager.request('remove', { id: items[0].id, revision: before.revision });
  for (const release of releases.splice(0)) release(); await coalesced;
  await wait(async () => !(await f.manager.request('get')).monitors.some(item => item.checking));
  assert.equal((await f.manager.request('get')).monitors.length, 3);
  assert.equal(JSON.parse(await readFile(path.join(f.directory, 'monitor/monitors.json'), 'utf8')).runtime[items[0].id], undefined);
});

test('pause and maintenance suppress checks; revisions reject stale writes and sources resolve current project/JAR settings', async t => {
  const clock = Date.now(), targets = [];
  let host = '127.0.0.1';
  const f = await fixture(t, { now: () => clock, probe: async target => { targets.push(target); return 'ok'; },
    projects: () => ({ get: async () => ({ profiles: [{ id: 'dev', name: '开发', variables: [{ key: 'host', value: host }], projects: [{ id: 'web', name: '网页', url: 'http://{{host}}/', enabled: true, query: [] }] }] }) }),
    jar: () => ({ request: async () => ({ instances: [{ id: 'java', name: 'Java', env: { SECRET: 'never-expose' }, health: { type: 'tcp', host: 'localhost', port: 8080 } }] }) }) });
  const paused = await add(f.manager, { enabled: false });
  const maintained = await add(f.manager, { maintenance: { start: new Date(clock - 1000).toISOString(), end: new Date(clock + 60000).toISOString() } });
  await assert.rejects(f.manager.request('check', { id: paused.id }), /暂停/); await assert.rejects(f.manager.request('check', { id: maintained.id }), /维护/);
  const project = await add(f.manager, { source: { type: 'project', profileId: 'dev', projectId: 'web' } });
  await f.manager.request('check', { id: project.id }); host = 'localhost'; await f.manager.request('check', { id: project.id });
  assert.match(targets[0].url, /127.0.0.1/); assert.match(targets[1].url, /localhost/);
  const java = await add(f.manager, { source: { type: 'jar', id: 'java' } }); await f.manager.request('check', { id: java.id }); assert.equal(targets.at(-1).type, 'tcp');
  const sources = await f.manager.request('sources'); assert.equal(JSON.stringify(sources).includes('never-expose'), false);
  assert.deepEqual(await f.manager.request('sources', {}, { allowProjects: false, allowJar: false }), []);
  await assert.rejects(f.manager.request('remove', { id: paused.id, revision: 0 }), /已被更新/);
});

test('shared monitoring defaults off; read, edit and operation permissions are independent', async t => {
  const f = await fixture(t, { probe: async () => 'ok' }), workspaces = createSharedWorkspaces({ monitor: () => f.manager });
  const services = emptySharingServices(), settings = { services }, call = (action, payload = {}) => workspaces.request('monitor', action, payload, { token: 'test', settings });
  assert.equal(sharingServices({ services: { projects: services.projects, nginx: services.nginx, http: services.http, jar: services.jar } }).monitor.enabled, false);
  await assert.rejects(call('get'), /未开放/); services.monitor.enabled = true;
  assert.equal((await call('get')).monitors.length, 0);
  await assert.rejects(call('upsert', { revision: 0, monitor: config({ enabled: false }) }), /编辑/);
  services.monitor.edit = true;
  let state = await call('upsert', { revision: 0, monitor: config({ enabled: false }) }); const id = state.monitors[0].id;
  await assert.rejects(call('toggle', { id, revision: state.revision, enabled: true }), /运行/);
  await assert.rejects(call('check', { id }), /运行/);
  services.monitor.control = true; state = await call('toggle', { id, revision: state.revision, enabled: true });
  services.monitor.edit = false; await call('check', { id }); await assert.rejects(call('remove', { id, revision: state.revision }), /编辑/);
  services.monitor.edit = true; services.monitor.control = false;
  await assert.rejects(call('upsert', { revision: state.revision, monitor: { ...state.monitors[0], enabled: false } }), /运行/);
  await assert.rejects(call('remove', { id, revision: state.revision }), /运行/);
});

test('retention prunes old samples; locks and invalid storage fail closed, atomic failures keep the prior revision', async t => {
  const clock = Date.now(), f = await fixture(t, { now: () => clock, probe: async () => 'ok' });
  const item = await add(f.manager, {}), filename = path.join(f.directory, 'monitor/monitors.json');
  await assert.rejects(createMonitorManager(f.directory, { auto: false }), /占用|使用|锁/);
  const state = await f.manager.request('get');
  await rename(filename, filename + '.saved'); await mkdir(filename);
  await assert.rejects(f.manager.request('toggle', { id: item.id, revision: state.revision, enabled: false }));
  assert.equal((await f.manager.request('get')).revision, state.revision); assert.equal((await f.manager.request('get')).monitors[0].enabled, true);
  await rm(filename, { recursive: true }); await rename(filename + '.saved', filename);
  await f.manager.close();
  const stored = JSON.parse(await readFile(filename, 'utf8'));
  stored.runtime[item.id] = { state: 'up', streak: 0, checkedAt: new Date(clock).toISOString(), incidents: [], samples: Array.from({ length: 1440 }, (_, i) => ({ at: new Date(clock - (1440 - i) * 1000).toISOString(), ok: true, elapsed: 1 })) };
  stored.runtime[item.id].samples[0].at = new Date(clock - 8 * 86400000).toISOString();
  await writeFile(filename, JSON.stringify(stored)); await f.reopen();
  const result = await f.manager.request('check', { id: item.id }); assert.equal(result.monitors[0].samples.length, 1440); assert.ok(result.monitors[0].samples.every(sample => clock - Date.parse(sample.at) <= 7 * 86400000));
  await f.manager.close(); await writeFile(filename, '{broken');
  await assert.rejects(createMonitorManager(f.directory, { auto: false }), /原文件已保留/);
  assert.equal(await readFile(filename, 'utf8'), '{broken');
  assert.throws(() => normalizeMonitor(config({ id: '__proto__' })), /标识/);
});
