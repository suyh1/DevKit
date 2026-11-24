import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { lstat, mkdtemp, mkdir, open, readFile, readdir, realpath, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import ssh from 'ssh2';
import { createLanWorkspaces } from './lan-workspaces.mjs';
import { createJarManager } from './jar-manager.mjs';
import { detectJava } from './jar-process.mjs';
import { createNginxManager } from './nginx-manager.mjs';
import { createProjectHost } from './project-host.mjs';
import { createProjectStore } from './project-store.mjs';
import { emptySharingServices } from '../shared/sharing.mjs';
import { discoverHosts, lanInterfaces, scanRange } from './lan-discovery.mjs';
import { localBroadcast, magicPacket } from './lan-power.mjs';
import { detectSshTarget } from './ssh-workspace-deploy.mjs';
import { createLogCenter } from './log-center.mjs';
import { createMonitorManager } from './monitor-manager.mjs';
import { sharingFromEnvironment } from './sharing-environment.mjs';

async function port() {
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const result = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return result;
}

test('SSH discovers Linux x64 and ARM64 from the target even with a Windows host preference', async () => {
  function target(machine) {
    return { exec(command, callback) {
      const channel = new EventEmitter();
      channel.stderr = new EventEmitter();
      channel.destroy = () => { channel.destroyed = true; };
      channel.end = () => queueMicrotask(() => {
        if (command.startsWith('sh ')) {
          channel.emit('data', Buffer.from(`DEVKIT_ARCH ${machine}\nDEVKIT_HOME /home/测试 用户\n`));
          channel.emit('close', 0);
        } else channel.emit('close', 1);
      });
      callback(null, channel);
    } };
  }
  assert.deepEqual(await detectSshTarget(target('aarch64'), 'win32'), {
    platform: 'linux', arch: 'arm64', home: '/home/测试 用户', key: 'linux-arm64',
  });
  assert.equal((await detectSshTarget(target('x86_64'))).key, 'linux-x64');
});

test('local inventory and a fast host remain accessible while another host is deploying', async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'devkit-inventory-'));
  const gate = Promise.withResolvers(), entered = Promise.withResolvers();
  const state = { revision: 0, platform: process.platform, instances: [] };
  const lan = await createLanWorkspaces(folder, { share: async host => ({
    request: async () => {
      if (host.name === 'slow') { entered.resolve(); await gate.promise; }
      return state;
    },
    close() {},
  }) });
  t.after(async () => { gate.resolve(); lan.close(); await rm(folder, { recursive: true, force: true }); });
  const draft = { mode: 'share', modules: { jar: true }, password: 'test-passphrase' };
  const [slow] = await lan.hostRequest('save', { ...draft, name: 'slow', address: 'http://127.0.0.1:8770' });
  const fast = (await lan.hostRequest('save', { ...draft, name: 'fast', address: 'http://127.0.0.1:8771' }))[1];
  const manager = { request: async () => state };
  const slowRead = lan.request(manager, 'jar', 'get', { scope: 'inventory-host', hostId: slow.id });
  await entered.promise;
  const [local, available] = await Promise.all([
    lan.request(manager, 'jar', 'get', { scope: 'inventory-local' }),
    lan.request(manager, 'jar', 'get', { scope: 'inventory-host', hostId: fast.id }),
  ]);
  assert.equal(local.groups[0].name, '本机');
  assert.equal(available.groups[0].phase, 'ready');
  assert.equal((await lan.request(manager, 'jar', 'get', { scope: 'inventory-progress' })).find(group => group.id === slow.id).phase, 'reading');
  gate.resolve();
  assert.equal((await slowRead).groups[0].phase, 'ready');
});

test('host import previews duplicates and invalid rows, stores metadata and uses the configured RDP endpoint', async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'devkit-lan-import-'));
  const lan = await createLanWorkspaces(folder);
  t.after(async () => { lan.close(); await rm(folder, { recursive: true, force: true }); });
  const ssh = { mode: 'ssh', address: '192.0.2.5', user: 'ops', port: 22, platform: 'win32', name: 'Test host', group: 'Test', tags: ['api', 'api'], pinned: true, mac: '02-AB-34-56-78-90' };
  const rows = [ssh, { ...ssh, name: 'Duplicate' }, { ...ssh, port: 65536 }];
  const preview = await lan.hostRequest('import-preview', rows);
  assert.deepEqual(preview.map(item => !!item.error), [false, true, true]);
  assert.deepEqual(await lan.hostRequest('list'), []);
  const [host] = await lan.hostRequest('import-connections', rows);
  assert.deepEqual([host.group, host.tags, host.pinned, host.mac], ['Test', ['api'], true, '02:ab:34:56:78:90']);
  assert.equal(await lan.hostRequest('rdp-target', { id: host.id }), '192.0.2.5:3389');
  await lan.hostRequest('save', { ...host, rdpPort: 33899 });
  assert.equal(await lan.hostRequest('rdp-target', { id: host.id }), '192.0.2.5:33899');
  await assert.rejects(lan.hostRequest('save', { ...host, mac: 'ff:ff:ff:ff:ff:ff' }), /MAC/);
  const [restored] = await lan.hostRequest('list');
  assert.equal(restored.mac, host.mac);
});

test('scanning stays on the selected interface and distinguishes TCP responses from neighbor cache; WOL uses the subnet broadcast', async () => {
  const [source] = lanInterfaces({ Test: [{ family: 'IPv4', internal: false, cidr: '192.0.2.130/25', address: '192.0.2.130' }] });
  assert.deepEqual(scanRange(source, '192.0.2.255/30'), ['192.0.2.252', '192.0.2.253', '192.0.2.254']);
  assert.throws(() => scanRange(source, '192.0.2.127-192.0.2.131'), /直连/);
  assert.throws(() => scanRange(source, '192.0.0.0/16'), /256/);
  const signal = new AbortController().signal;
  const result = await discoverHosts(source, '192.0.2.131-192.0.2.134', 2222, signal, {
    async probe(address, port, options) {
      assert.equal(port, 2222);
      assert.equal(options.localAddress, source.address);
      if (address.endsWith('.131')) return { ok: true, elapsed: 20 };
      if (address.endsWith('.132')) return { ok: false, code: 'ECONNREFUSED' };
      return { ok: false, code: 'ETIMEDOUT' };
    },
    async neighbors() { return new Map([['192.0.2.133', '02:00:00:00:00:01']]); },
    resolveNames: false,
  });
  assert.equal(result.scanned, 4);
  assert.deepEqual(result.devices.map(item => item.response), ['open', 'refused', 'neighbor']);
  assert.deepEqual(localBroadcast(['192.0.2.135'], [source]), { address: '192.0.2.130', broadcast: '192.0.2.255' });
  assert.throws(() => localBroadcast(['192.0.2.30'], [source]), /直连/);
  assert.equal(magicPacket('02:ab:34:56:78:90').toString('hex'), 'ff'.repeat(6) + '02ab34567890'.repeat(16));
});

test('LAN gateway shares local and remote registries, confines operations to the selected host and intersects browser permissions', async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'devkit-lan-gateway-'));
  const cleanup = [];
  t.after(async () => { for (const close of cleanup.reverse()) await close(); await rm(folder, { recursive: true, force: true }); });
  await mkdir(path.join(folder, '.vite'));
  await writeFile(path.join(folder, '.vite', 'manifest.json'), JSON.stringify({ 'portal.html': { file: 'portal.html' } }));
  await writeFile(path.join(folder, 'portal.html'), '<!doctype html><title>fixture</title>');
  async function endpoint(name, grants) {
    const directory = path.join(folder, name);
    const store = await createProjectStore(directory), jar = await createJarManager(directory), nginx = await createNginxManager(directory);
    const lan = await createLanWorkspaces(directory);
    const logs = createLogCenter({ jar: () => jar, nginx: () => nginx, lan: () => lan });
    const host = await createProjectHost(store, folder, { jar: () => jar, nginx: () => nginx, lan: () => lan, logs: () => logs });
    cleanup.push(async () => { await host.stop(); lan.close(); await nginx.close(); await jar.close(); await store.close(); });
    const services = emptySharingServices();
    for (const module of ['jar', 'nginx']) services[module] = { enabled: true, ...grants };
    services.logs = { enabled: true, jar: true, nginx: false, export: name === 'gateway', raw: name === 'gateway' };
    const listening = await port(), password = `${name}-workspaces-fixture`;
    await host.start({ host: '127.0.0.1', port: listening, password, services });
    async function enableJarControl() {
      services.jar.control = true;
      await host.start({ host: '127.0.0.1', port: listening, password, services });
    }
    return { directory, lan, jar, nginx, address: `http://127.0.0.1:${listening}`, password, enableJarControl };
  }
  const target = await endpoint('target', { edit: true, control: false });
  const gateway = await endpoint('gateway', { edit: true, control: true });
  const [{ id: hostId }] = await gateway.lan.hostRequest('save', { ...target, name: 'Test host', mode: 'share', modules: { jar: true, nginx: true } });
  const diagnostics = await gateway.lan.hostRequest('diagnose', { id: hostId });
  assert.deepEqual(diagnostics.checks.map(item => item.state), Array(5).fill('pass'));
  assert.equal(diagnostics.checks[3].detail, '查看、编辑');
  const source = path.join(folder, 'service.jar'), config = path.join(folder, 'nginx.conf');
  await writeFile(source, 'fixture');
  const canonicalSource = await realpath(source);
  await writeFile(config, 'events {}\nhttp {}\n');
  const access = await fetch(`${gateway.address}/api/sharing/login`, { method: 'POST', headers: { Origin: gateway.address, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: gateway.password }) });
  const cookie = access.headers.get('set-cookie').split(';')[0];
  async function api(module, action, value) {
    const response = await fetch(`${gateway.address}/api/${module}/${action}`, { method: 'POST', headers: { Cookie: cookie, Origin: gateway.address, 'Content-Type': 'application/json' }, body: JSON.stringify(value || {}) });
    return { status: response.status, data: await response.json() };
  }
  const listed = await api('jar', 'get', { scope: 'inventory' });
  assert.deepEqual(listed.data.groups.map(group => [group.id, group.edit, group.control]), [['', true, true], [hostId, true, false]]);
  const initial = await api('jar', 'get', { scope: 'inventory-local' });
  assert.deepEqual(initial.data.instances, []);
  assert.equal(initial.data.groups.find(group => group.id === hostId).edit, false);
  const browse = await api('jar', 'browse', { hostId, kind: 'jar', directory: folder });
  assert.deepEqual(browse.data.entries.filter(item => !item.directory).map(item => item.path), [canonicalSource]);
  const saved = await api('jar', 'upsert', { hostId, revision: 0, instance: { name: 'Service', jar: source, logMode: 'console', env: { PRIVATE_SETTING: 'fixture-value' } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const [instance] = saved.data.instances;
  assert.ok(instance.id.startsWith(`${hostId}:`));
  assert.equal((await gateway.jar.request('get')).instances.length, 0);
  assert.equal((await target.jar.request('get')).instances[0].jar, canonicalSource);
  assert.equal((await api('jar', 'command', { id: instance.id, command: 'start' })).status, 403);
  const selection = { id: instance.id, expectedPath: instance.jar };
  assert.equal((await api('jar', 'replace-begin', selection)).status, 403);
  assert.equal((await api('jar', 'replace-backups', selection)).status, 403);
  assert.equal((await api('jar', 'replace-restore', selection)).status, 403);
  assert.equal((await api('jar', 'get', { hostId, scope: 'local' })).status, 400);
  assert.deepEqual((await api('jar', 'statuses', { scope: 'inventory' })).data.map(status => status.id), [instance.id]);
  const viewer = await gateway.lan.request(gateway.jar, 'jar', 'get', { scope: 'inventory' }, { edit: false, control: false }, 'viewer');
  assert.deepEqual(viewer.instances[0].env, {});
  assert.equal((await api('lan-hosts', 'list')).status, 404);
  assert.equal((await gateway.lan.hostRequest('list'))[0].password, undefined);
  assert.equal((await readFile(path.join(gateway.directory, 'lan-hosts', 'connections.json'), 'utf8')).includes(target.password), false);
  const group = (await api('jar', 'get', { scope: 'inventory-host', hostId })).data;
  assert.deepEqual(group.instances.map(item => item.id), [instance.id]);
  assert.ok(group.groups[0].checkedAt);
  const logSources = (await api('logs', 'sources', { hostId })).data.sources;
  assert.equal(logSources[0].instanceId, instance.id);
  const exported = (await api('logs', 'export', { raw: true, sources: [{ id: logSources[0].id }] })).data.results[0];
  assert.match(exported.error, /导出权限/);
  await target.enableJarControl();
  const begin = await api('jar', 'replace-begin', selection);
  assert.equal(begin.status, 200, JSON.stringify(begin.data));
  const upload = { id: instance.id, token: begin.data.token };
  assert.equal((await api('jar', 'replace-chunk', { ...upload, offset: 0, data: 'YWJj' })).status, 200);
  const finished = await api('jar', 'replace-finish', { ...upload, size: 3, backup: true, start: false });
  assert.equal(finished.status, 200, JSON.stringify(finished.data));
  assert.equal(await readFile(canonicalSource, 'utf8'), 'abc');
  assert.equal(await readFile(finished.data.backup, 'utf8'), 'fixture');
  const history = await api('jar', 'replace-backups', selection);
  assert.deepEqual(history.data, [path.basename(finished.data.backup)]);
  const recovered = await api('jar', 'replace-restore', { ...selection, name: history.data[0], backup: true, start: false });
  assert.equal(recovered.status, 200, JSON.stringify(recovered.data));
  assert.equal(await readFile(canonicalSource, 'utf8'), 'fixture');
  assert.equal(await readFile(recovered.data.backup, 'utf8'), 'abc');

  const installed = await api('nginx', 'upsert', { hostId, revision: 0, instance: { name: 'Proxy', platform: 'any', main: config, prefix: folder, files: [] } });
  assert.equal(installed.status, 200, JSON.stringify(installed.data));
  const nginxId = installed.data.instances[0].id;
  const { data: document } = await api('nginx', 'documents', { id: nginxId });
  const updated = await api('nginx', 'save-files', { id: nginxId, files: document.files.map(item => ({ ...item, content: 'events {}\nhttp { server { listen 8080; } }\n' })) });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.match(await readFile(config, 'utf8'), /listen 8080/);
  assert.equal((await api('nginx', 'review', { id: nginxId })).data.impacts[0].id, nginxId);
  assert.equal((await api('nginx', 'backups', { id: nginxId })).data.length, 1);
  const reopened = await createLanWorkspaces(gateway.directory);
  try { assert.equal((await reopened.request(gateway.jar, 'jar', 'get', { hostId })).instances[0].id, instance.id); }
  finally { reopened.close(); }
});

test('shared LAN inventory omits connection secrets and combines per-visitor host, monitor and log permissions', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'devkit-shared-hosts-'));
  const closes = [];
  t.after(async () => {
    for (const close of closes.reverse()) await close();
    await rm(directory, { recursive: true, force: true });
  });
  const store = await createProjectStore(directory);
  closes.push(() => store.close());
  const lan = await createLanWorkspaces(directory);
  closes.push(() => lan.close());
  const password = 'shared-inventory-fixture';
  const hosts = await lan.hostRequest('save', {
    mode: 'ssh', name: 'Saved system', address: '192.0.2.17', port: 2222, user: 'private-login', platform: 'linux',
    auth: 'key', keyPath: path.join(directory, 'private.key'), password, mac: '02:00:00:00:00:01', rdpPort: 3389,
    group: 'Test group', tags: ['staging'], pinned: true, modules: { jar: true },
  });
  const [host] = hosts;
  const source = { type: 'lan', id: host.id };
  const monitor = await createMonitorManager(directory, { auto: false, lan: () => lan, probe: async target => {
    assert.deepEqual([target.type, target.host, target.port], ['tcp', '192.0.2.17', 2222]);
    return 'fixture connected';
  } });
  closes.push(() => monitor.close());
  await mkdir(path.join(directory, '.vite'));
  await writeFile(path.join(directory, '.vite', 'manifest.json'), JSON.stringify({ 'portal.html': { file: 'portal.html' } }));
  await writeFile(path.join(directory, 'portal.html'), '<!doctype html><title>fixture</title>');
  const shared = await createProjectHost(store, directory, { lan: () => lan, monitor: () => monitor });
  closes.push(() => shared.stop());
  const listening = await port(), origin = `http://127.0.0.1:${listening}`;
  const services = sharingFromEnvironment({ DEVKIT_SHARE_LAN_HOSTS: 'true' });
  services.monitor = { enabled: true, edit: true, control: true };
  services.logs = { enabled: true, jar: true, nginx: false, export: false, raw: false };
  const view = emptySharingServices(), monitorOnly = emptySharingServices();
  view['lan-hosts'].enabled = true;
  monitorOnly.monitor = services.monitor;
  const options = { host: '127.0.0.1', port: listening, password, services, visitors: [
    { name: 'inventory', password, services: view }, { name: 'monitor', password, services: monitorOnly },
  ] };
  await shared.start(options);
  const post = (uri, body, cookie = '') => fetch(origin + '/api/' + uri, {
    method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  async function login(visitor) {
    const response = await post('sharing/login', { visitor, password });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  const api = async (uri, cookie, value = {}) => {
    const response = await post(uri, value, cookie);
    return [response.status, await response.json()];
  };
  assert.equal((await api('lan-hosts/list'))[0], 401);
  let full = await login();
  const inventory = await login('inventory'), monitoring = await login('monitor');
  assert.equal((await api('lan-hosts/list', monitoring))[0], 404);
  assert.equal((await api('lan-hosts/save', full, { name: 'unauthorized mutation' }))[0], 403);
  assert.equal((await api('lan-hosts/terminal-open', full, { id: host.id }))[0], 403);
  assert.equal((await api('monitor/sources', inventory))[0], 404);
  assert.deepEqual(await api('monitor/sources', monitoring), [200, []]);
  assert.deepEqual(await api('monitor/sources', full), [200, [{ label: '局域网主机 / Saved system', source }]]);
  assert.deepEqual(await api('lan-hosts/list', inventory), [200, { statuses: [], hosts: [{
    id: host.id, name: host.name, mode: host.mode, address: host.address, port: host.port, group: host.group, tags: host.tags, pinned: true, hasLogs: false,
  }] }]);

  const config = { name: 'Port monitor', type: 'tcp', enabled: true, source };
  assert.equal((await api('monitor/upsert', monitoring, { revision: 0, monitor: { ...config, enabled: false } }))[0], 403);
  const [status, state] = await api('monitor/upsert', full, { revision: 0, monitor: config });
  assert.equal(status, 200);
  const [{ id, sourceHost }] = state.monitors;
  assert.equal(sourceHost, host.name);
  assert.equal((await api('monitor/check', monitoring, { id }))[0], 403);
  assert.equal((await api('monitor/check', full, { id }))[1].monitors[0].state, 'up');
  const [, list] = await api('lan-hosts/list', full);
  assert.equal(list.hosts[0].hasLogs, true);
  assert.deepEqual(list.statuses.map(item => [item.hostId, item.id, item.state]), [[host.id, id, 'up']]);
  assert.deepEqual((await api('lan-hosts/list', inventory))[1].statuses, []);
  const [paused, pauseState] = await api('monitor/toggle', monitoring, { id, revision: state.revision, enabled: false });
  assert.equal(paused, 200);
  assert.equal((await api('monitor/toggle', monitoring, { id, revision: pauseState.revision, enabled: true }))[0], 403);
  assert.equal((await api('monitor/upsert', monitoring, { revision: pauseState.revision, monitor: { ...config, id } }))[0], 403);

  const old = { ...services };
  delete old['lan-hosts'];
  await shared.start({ ...options, services: old, visitors: [] });
  assert.equal((await api('lan-hosts/list', full))[0], 401);
  full = await login();
  assert.equal((await api('lan-hosts/list', full))[0], 404);
  await shared.start({ ...options, services: sharingFromEnvironment({ DEVKIT_SHARE_LAN_HOSTS: 'true' }), visitors: [] });
  full = await login();
  const [onlyStatus, onlyList] = await api('lan-hosts/list', full);
  assert.equal(onlyStatus, 200);
  assert.equal(onlyList.hosts[0].id, host.id);
  assert.deepEqual(onlyList.statuses, []);
  assert.equal((await api('monitor/get', full))[0], 404);
});

function sftpFixture(stream, folder, onWrite) {
  const { STATUS_CODE, OPEN_MODE } = ssh.utils.sftp;
  const handles = new Map();
  let counter = 0;
  const target = filename => {
    const mounted = folder.replaceAll('\\', '/');
    const rooted = `${mounted.startsWith('/') ? '' : '/'}${mounted}/`;
    if (filename.startsWith(rooted)) filename = filename.slice(rooted.length);
    assert.match(filename, /^(?:\.devkit-ssh|\/files)(?:\/[a-z0-9_.-]+)*$/i);
    assert.ok(filename.split('/').every(part => part !== '..'));
    return path.join(folder, filename);
  };
  const status = (id, action) => action.then(() => stream.status(id, STATUS_CODE.OK), error => stream.status(id, error.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : STATUS_CODE.FAILURE));
  stream.on('STAT', (id, file) => void stat(target(file)).then(info => stream.attrs(id, { mode: info.mode, size: info.size }), () => stream.status(id, STATUS_CODE.NO_SUCH_FILE)));
  stream.on('LSTAT', (id, file) => void lstat(target(file)).then(info => stream.attrs(id, { mode: info.mode, size: info.size }), () => stream.status(id, STATUS_CODE.NO_SUCH_FILE)));
  stream.on('REALPATH', (id, file) => stream.name(id, [{ filename: file === '.' ? '/files' : file }]));
  stream.on('OPENDIR', (id, directory) => {
    const token = Buffer.from(String(++counter)); handles.set(token.toString(), { directory }); stream.handle(id, token);
  });
  stream.on('READDIR', (id, token) => {
    const handle = handles.get(token.toString());
    if (handle.done) { stream.status(id, STATUS_CODE.EOF); return; }
    handle.done = true;
    void readdir(target(handle.directory)).then(names => Promise.all(names.map(async filename => {
      const info = await stat(target(`${handle.directory}/${filename}`));
      return { filename, attrs: { mode: info.mode, size: info.size } };
    }))).then(entries => stream.name(id, entries), () => stream.status(id, STATUS_CODE.FAILURE));
  });
  stream.on('MKDIR', (id, file) => void status(id, mkdir(target(file))));
  stream.on('RENAME', (id, from, to) => void status(id, rename(target(from), target(to))));
  stream.on('REMOVE', (id, file) => void status(id, unlink(target(file))));
  stream.on('OPEN', (id, file, flags) => void open(target(file), flags & OPEN_MODE.EXCL ? 'wx' : flags & OPEN_MODE.WRITE ? 'w' : 'r').then(handle => {
    if (flags & OPEN_MODE.WRITE) onWrite?.(file);
    const token = Buffer.from(String(++counter)); handles.set(token.toString(), handle); stream.handle(id, token);
  }, () => stream.status(id, STATUS_CODE.FAILURE)));
  stream.on('WRITE', (id, token, offset, data) => void status(id, handles.get(token.toString()).write(data, 0, data.length, offset)));
  stream.on('READ', (id, token, offset, length) => {
    const buffer = Buffer.alloc(length);
    void handles.get(token.toString()).read(buffer, 0, length, offset).then(({ bytesRead }) => {
      if (bytesRead) stream.data(id, buffer.subarray(0, bytesRead)); else stream.status(id, STATUS_CODE.EOF);
    }, () => stream.status(id, STATUS_CODE.FAILURE));
  });
  stream.on('CLOSE', (id, token) => { const handle = handles.get(token.toString()); handles.delete(token.toString()); void status(id, handle.close?.() || Promise.resolve()); });
}

test('shared host editing and SSH/SFTP use write-only credentials and private sessions', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'devkit-web-ssh-'));
  const closes = [];
  t.after(async () => {
    for (const close of closes.reverse()) await close();
    await rm(directory, { recursive: true, force: true });
  });
  await mkdir(path.join(directory, 'files'));
  const rsa = options => generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs1', ...options }, publicKeyEncoding: { format: 'pem', type: 'spki' } }).privateKey;
  const password = 'fixture-key-passphrase', privateKey = rsa({ cipher: 'aes-256-cbc', passphrase: password });
  const expectedKey = ssh.utils.parseKey(privateKey, password);
  const clients = new Set();
  const target = new ssh.Server({ hostKeys: [rsa()] }, client => {
    clients.add(client);
    client.on('close', () => clients.delete(client));
    client.on('error', () => {});
    client.on('authentication', auth => {
      if (auth.username === 'operator' && auth.method === 'publickey' && auth.key.data.equals(expectedKey.getPublicSSH()) && (!auth.signature || expectedKey.verify(auth.blob, auth.signature, auth.hashAlgo) === true)) auth.accept();
      else auth.reject(['publickey']);
    });
    client.on('session', accept => {
      const session = accept();
      session.on('pty', accept => accept());
      session.on('shell', accept => { const stream = accept(); stream.write('terminal fixture\n'); stream.on('data', bytes => stream.write(bytes)); });
      session.on('sftp', accept => sftpFixture(accept(), directory, () => {}));
    });
  }).listen(0, '127.0.0.1');
  await once(target, 'listening');
  closes.push(() => new Promise(resolve => { for (const client of clients) client.end(); target.close(resolve); }));
  const store = await createProjectStore(directory), lan = await createLanWorkspaces(directory);
  closes.push(() => store.close(), () => lan.close());
  await mkdir(path.join(directory, '.vite'));
  await writeFile(path.join(directory, '.vite', 'manifest.json'), JSON.stringify({ 'portal.html': { file: 'portal.html' } }));
  await writeFile(path.join(directory, 'portal.html'), '<!doctype html><title>fixture</title>');
  const shared = await createProjectHost(store, directory, { lan: () => lan });
  closes.push(() => shared.stop());
  const listening = await port(), origin = `http://127.0.0.1:${listening}`;
  const services = emptySharingServices(), visitor = emptySharingServices();
  for (const key of Object.keys(services['lan-hosts'])) services['lan-hosts'][key] = true;
  Object.assign(visitor['lan-hosts'], { enabled: true, terminal: true });
  const sharingPassword = 'test-only-shared-ssh', options = { host: '127.0.0.1', port: listening, password: sharingPassword, services, visitors: [{ name: 'terminal', password: sharingPassword, services: visitor }] };
  await shared.start(options);
  const post = (route, cookie, body, contentType = 'application/json') => fetch(`${origin}/api/${route}`, {
    method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': contentType },
    body: contentType === 'application/json' ? JSON.stringify(body) : body,
  });
  async function login(visitor) {
    const response = await post('sharing/login', '', { visitor, password: sharingPassword });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  const admin = await login(), guest = await login('terminal');
  const request = (action, payload = {}, cookie = admin) => post('lan-hosts/' + action, cookie, payload);
  const data = async (action, payload, cookie) => {
    const response = await request(action, payload, cookie), result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  const original = { name: 'Web SSH', address: '127.0.0.1', port: target.address().port, platform: process.platform === 'win32' ? 'win32' : 'linux', mode: 'ssh', user: 'operator', auth: 'key', privateKey, password };
  assert.equal((await request('save', original, guest)).status, 403);
  assert.equal((await request('save', { ...original, keyPath: path.join(directory, 'forbidden') })).status, 400);
  const [host] = await data('save', original);
  assert.equal(host.hasStoredKey, true);
  assert.equal(host.hasPassword, true);
  for (const field of ['privateKey', 'password', 'secret', 'encryptedKey', 'keyPath']) assert.equal(Object.hasOwn(host, field), false);
  const persisted = await readFile(path.join(directory, 'lan-hosts', 'connections.json'), 'utf8');
  assert.ok(!persisted.includes(password) && !persisted.includes('BEGIN RSA PRIVATE KEY'));
  const [edited] = await data('save', { ...host, name: 'Renamed SSH' });
  assert.equal(edited.hasStoredKey, true);
  assert.equal((await request('save', { ...host, name: 'Stale edit' })).status, 409);
  assert.equal((await request('terminal-open', { id: host.id })).status, 400);
  const { fingerprint } = await data('test', { id: host.id });
  await data('test', { id: host.id, fingerprint });
  const shell = await data('terminal-open', { id: host.id, cols: 80, rows: 24 });
  assert.equal((await request('terminal-read', shell, guest)).status, 404);
  await data('terminal-close', shell, guest);
  const guestShell = await data('terminal-open', { id: host.id }, guest);
  assert.equal((await request('file-list', guestShell, guest)).status, 403);
  await data('terminal-input', { ...shell, text: 'echo-fixTURE\r' });
  let output = '';
  for (let attempt = 0; attempt < 30 && !output.includes('echo-fixTURE'); attempt++) {
    output += Buffer.from((await data('terminal-read', shell)).data, 'base64').toString();
    if (!output.includes('echo-fixTURE')) await delay(30);
  }
  assert.match(output, /echo-fixTURE/);
  const desktopShell = await lan.hostRequest('terminal-open', { id: host.id });
  await lan.hostRequest('terminal-close', desktopShell);
  const bytes = Buffer.from([0, 1, 22, 255]);
  const upload = await post(`lan-hosts/file-upload?${new URLSearchParams({ id: shell.id, path: '.', name: 'web.bin' })}`, admin, bytes, 'application/octet-stream');
  assert.equal(upload.status, 200, await upload.text());
  const listing = await data('file-list', { ...shell, path: '.' });
  assert.equal(listing.entries[0].name, 'web.bin');
  const download = await request('file-download', { ...shell, path: listing.entries[0].path });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  const revoked = emptySharingServices(); revoked['lan-hosts'].enabled = true;
  await shared.start({ ...options, password: '', visitors: [{ name: 'terminal', services: revoked }] });
  assert.equal((await request('terminal-read', guestShell, guest)).status, 401);
  assert.equal((await request('terminal-open', { id: host.id }, await login('terminal'))).status, 403);
  await data('terminal-read', shell);
  const { hosts: [current] } = await data('list');
  await data('remove', { id: host.id, revision: current.revision });
  assert.equal((await request('terminal-read', shell)).status, 404);
  assert.deepEqual((await data('list')).hosts, []);
});

test('SSH verifies host identity, runs a PTY, and deploys portable Node through SFTP and SSH exec', { timeout: 150000 }, async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'devkit-lan-ssh-'));
  const lan = await createLanWorkspaces(path.join(folder, 'coordinator'));
  const clients = new Set(), processes = new Set();
  const stdioHome = path.join(folder, 'no sftp 测试');
  await mkdir(stdioHome);
  const windows = process.platform === 'win32';
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const commandPath = windows ? [path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'), path.join(systemRoot, 'System32'), systemRoot].join(path.delimiter) : path.join(folder, 'system-commands');
  if (!windows) {
    await mkdir(commandPath);
    for (const name of ['sh', 'uname', 'cat', 'mkdir', 'sha256sum', 'chmod', 'mv', 'rm', 'ps', 'readlink', 'id', 'getconf']) {
      await symlink(await realpath(`/usr/bin/${name}`), path.join(commandPath, name));
    }
  }
  let authentication = 0, resized = false, forwarded = 0, sftpRuntimeUploads = 0, execRuntimeUploads = 0;
  const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs1' }, publicKeyEncoding: { format: 'pem', type: 'spki' } }).privateKey;
  const keyPassphrase = 'secret-fixture-unlock';
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs1', cipher: 'aes-256-cbc', passphrase: keyPassphrase }, publicKeyEncoding: { format: 'pem', type: 'spki' } }).privateKey;
  const key = ssh.utils.parseKey(privateKey, keyPassphrase), keyPath = path.join(folder, 'test-key');
  await writeFile(keyPath, privateKey);
  const server = new ssh.Server({ hostKeys: [hostKey] }, client => {
    let execOnly = false;
    clients.add(client);
    client.on('error', () => {});
    client.on('close', () => clients.delete(client));
    client.on('authentication', context => {
      authentication++;
      if (context.method === 'password' && ['operator', 'stdio-operator'].includes(context.username) && context.password === 'ssh-password-fixture') {
        execOnly = context.username === 'stdio-operator'; context.accept();
      }
      else if (context.method === 'publickey' && context.username === 'key-user' && context.key.data.equals(key.getPublicSSH()) && (!context.signature || key.verify(context.blob, context.signature, context.hashAlgo) === true)) context.accept();
      else context.reject(['password']);
    });
    client.on('tcpip', (accept, reject, info) => {
      if (info.destIP !== 'inside.fixture.invalid' || info.destPort !== server.address().port) { reject(); return; }
      const socket = connect(info.destPort, '127.0.0.1');
      socket.once('error', () => socket.destroy());
      socket.once('connect', () => { forwarded++; const tunnel = accept(); tunnel.on('close', () => socket.destroy()); tunnel.pipe(socket).pipe(tunnel); });
    });
    client.on('session', accept => {
      const session = accept();
      session.on('pty', (accept, _reject, info) => { assert.equal(info.term, 'xterm-256color'); accept(); });
      session.on('window-change', (_accept, _reject, info) => { resized = info.cols === 100; });
      session.on('shell', accept => { const stream = accept(); stream.write('fixture shell$ '); stream.on('data', bytes => stream.write(bytes)); });
      session.on('sftp', (accept, reject) => {
        if (execOnly) { reject(); return; }
        const channel = accept();
        session.once('close', () => channel.end());
        sftpFixture(channel, folder, file => { if (file.includes('/runtimes/')) sftpRuntimeUploads++; });
      });
      session.on('exec', (accept, _reject, info) => {
        if (['java -version', 'nginx -v'].includes(info.command)) {
          const stream = accept(), available = info.command === 'java -version';
          stream.write(available ? 'Java 21\n' : 'nginx unavailable\n');
          stream.exit(available ? 0 : 1); stream.end(); return;
        }
        const encoded = /-EncodedCommand ([\w+/=]+)$/.exec(info.command)?.[1];
        const script = encoded ? Buffer.from(encoded, 'base64').toString('utf16le') : info.command;
        if (/runtimes\/.+\.tmp/.test(script) && /OpenStandardInput|cat >/.test(script)) execRuntimeUploads++;
        const home = execOnly ? stdioHome : folder;
        const environment = { ...process.env, HOME: home, USERPROFILE: home, PATH: commandPath };
        if (windows) delete environment.PSModulePath;
        const stream = accept(), child = spawn(windows ? path.join(systemRoot, 'System32/cmd.exe') : '/bin/sh', windows ? ['/d', '/c', info.command] : ['-c', info.command], {
          cwd: home, env: environment, windowsHide: true,
        });
        processes.add(child);
        const ended = once(child, 'close');
        child.stdin.on('error', () => {});
        stream.on('error', () => {});
        stream.pipe(child.stdin);
        child.stdout.pipe(stream, { end: false });
        child.stderr.pipe(stream.stderr, { end: false });
        stream.on('close', () => child.stdin.end());
        void ended.then(([code]) => { processes.delete(child); stream.exit(code ?? 1); stream.end(); }, () => { processes.delete(child); stream.exit(1); stream.end(); });
      });
    });
  }).listen(0, '127.0.0.1');
  t.after(async () => {
    lan.close();
    const closed = new Promise(resolve => server.close(resolve));
    for (const client of clients) client.end();
    await Promise.allSettled([...processes].map(child => once(child, 'close')));
    await closed;
    await rm(folder, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  });
  await once(server, 'listening');
  const wrongPlatform = windows ? 'linux' : 'win32';
  const hostDraft = { mode: 'ssh', name: 'SSH fixture', address: '127.0.0.1', port: server.address().port, user: 'operator', platform: wrongPlatform, auth: 'password', password: 'ssh-password-fixture', modules: { jar: true, nginx: true } };
  const [{ id }] = await lan.hostRequest('save', hostDraft);
  const { fingerprint } = await lan.hostRequest('test', { id });
  assert.match(fingerprint, /^SHA256:/);
  assert.equal(authentication, 0);
  const firstDiagnosis = await lan.hostRequest('diagnose', { id });
  assert.equal(firstDiagnosis.fingerprint, fingerprint);
  assert.equal(authentication, 0);
  await lan.hostRequest('test', { id, fingerprint });
  assert.ok(authentication > 0);
  const diagnosis = await lan.hostRequest('diagnose', { id });
  assert.deepEqual(diagnosis.checks.map(item => [item.name, item.state]), [
    ['地址解析', 'pass'], ['TCP 端口', 'pass'], ['SSH 主机指纹', 'pass'], ['SSH 登录', 'pass'], ['部署通道', 'pass'], ['远程运行时', 'pass'], ['Java', 'pass'], ['Nginx', 'fail'],
  ]);
  assert.match(diagnosis.checks[5].detail, new RegExp(`${process.platform}-${process.arch}`));
  const shell = await lan.hostRequest('terminal-open', { id, cols: 80, rows: 24 });
  await lan.hostRequest('terminal-resize', { id: shell.id, cols: 100, rows: 33 });
  await lan.hostRequest('terminal-input', { id: shell.id, text: '你好\r' });
  let output = '';
  for (let attempt = 0; attempt < 30 && !output.includes('你好'); attempt++) {
    const result = await lan.hostRequest('terminal-read', shell);
    output += Buffer.from(result.data, 'base64').toString();
    if (!output.includes('你好')) await delay(40);
  }
  assert.match(output, /fixture shell\$ 你好/);
  assert.equal(resized, true);
  const payload = Buffer.from([0, 1, 2, 255]);
  const upload = path.join(folder, 'upload.bin'), download = path.join(folder, 'download.bin');
  await mkdir(path.join(folder, 'files'));
  await writeFile(upload, payload);
  await lan.hostRequest('file-upload', { id: shell.id, path: '.' }, upload);
  await assert.rejects(lan.hostRequest('file-upload', { id: shell.id, path: '.' }, upload), /同名/);
  const listing = await lan.hostRequest('file-list', { id: shell.id, path: '.' });
  assert.deepEqual(listing.entries.map(item => [item.name, item.kind, item.size]), [['upload.bin', 'file', payload.length]]);
  await lan.hostRequest('file-download', { id: shell.id, path: listing.entries[0].path }, download);
  assert.deepEqual(await readFile(download), payload);
  await lan.hostRequest('terminal-close', shell);
  await assert.rejects(lan.hostRequest('file-list', { id: shell.id }), /断开/);

  const [jump, privateHost] = await lan.hostRequest('save', {
    mode: 'ssh', address: 'inside.fixture.invalid', port: server.address().port, user: 'key-user', name: 'Private key fixture',
    platform: process.platform, auth: 'key', keyPath, password: keyPassphrase, jumpHostId: id,
  });
  await assert.rejects(lan.hostRequest('save', { ...jump, jumpHostId: privateHost.id }), /循环/);
  const targetTrust = await lan.hostRequest('test', { id: privateHost.id });
  await lan.hostRequest('test', { id: privateHost.id, fingerprint: targetTrust.fingerprint });
  const keyShell = await lan.hostRequest('terminal-open', { id: privateHost.id });
  assert.ok(forwarded >= 3);
  await lan.hostRequest('terminal-close', keyShell);
  assert.ok(!(await readFile(path.join(folder, 'coordinator/lan-hosts/connections.json'), 'utf8')).includes(keyPassphrase));
  const jar = path.join(folder, 'target.jar');
  await writeFile(jar, 'fixture');
  const registration = await lan.request(null, 'jar', 'upsert', { hostId: id, revision: 0, instance: { name: 'SSH Java', jar, logMode: 'file', jvmArgs: ['-Xmx128m'] } });
  const [application] = registration.instances;
  assert.ok(application.id.startsWith(`${id}:`));
  assert.deepEqual(application.jvmArgs, ['-Xmx128m']);
  assert.deepEqual((await lan.request(null, 'jar', 'get', { hostId: id })).instances, [application]);
  assert.equal(sftpRuntimeUploads, 1);
  assert.equal(execRuntimeUploads, 0);
  const logCenter = createLogCenter({ lan: () => lan });
  await writeFile(path.join(folder, 'target.log'), 'INFO SSH log token=fixture-secret\n');
  const remoteLogs = await logCenter.request('sources', { hostId: id });
  assert.equal(remoteLogs.sources[0].instanceId, application.id);
  const batch = await logCenter.request('read', { sources: [{ id: remoteLogs.sources[0].id }] });
  assert.match(batch.results[0].text, /INFO SSH log token=\[已隐藏\]/);
  const healthSocket = createServer(socket => socket.end()).listen(0, '127.0.0.1');
  await once(healthSocket, 'listening');
  try {
    await lan.request(null, 'jar', 'upsert', { hostId: id, revision: registration.revision, instance: { ...application, health: { type: 'tcp', host: '127.0.0.1', port: healthSocket.address().port } } });
    assert.ok((await lan.monitorJarSources()).some(item => item.source.id === application.id));
    assert.equal((await lan.monitorJar(application.id, 5)).state, 'healthy');
  } finally { await new Promise(resolve => healthSocket.close(resolve)); }

  const stdio = (await lan.hostRequest('save', { ...hostDraft, name: 'SSH exec fixture', user: 'stdio-operator', modules: { jar: true } })).at(-1);
  const stdioTrust = await lan.hostRequest('test', { id: stdio.id });
  await lan.hostRequest('test', { id: stdio.id, fingerprint: stdioTrust.fingerprint });
  const stdioDiagnosis = await lan.hostRequest('diagnose', { id: stdio.id });
  assert.match(stdioDiagnosis.checks[4].detail, /SSH 命令通道/);
  const stdioJar = path.join(stdioHome, 'managed.jar');
  await writeFile(stdioJar, 'exec fixture');
  const execRegistration = await lan.request(null, 'jar', 'upsert', { hostId: stdio.id, revision: 0, instance: { name: 'SSH exec JAR', jar: stdioJar, logMode: 'file' } });
  assert.equal(execRegistration.platform, process.platform);
  assert.equal(execRegistration.instances[0].name, 'SSH exec JAR');
  assert.equal(execRuntimeUploads, 1);
  lan.close();
  assert.equal((await lan.request(null, 'jar', 'get', { hostId: stdio.id })).instances[0].name, 'SSH exec JAR');
  assert.equal(execRuntimeUploads, 1, 'a reconnect reuses the verified target runtime');
  await t.test('the JAR and its portable-Node supervisor survive an SSH disconnection', async context => {
    const java = await detectJava({ executable: process.env.DEVKIT_TEST_JAVA || '' });
    const run = promisify(execFile), suffix = windows ? '.exe' : '', bin = path.dirname(java.executable || '');
    try { await run(path.join(bin, `javac${suffix}`), ['-version']); } catch { context.skip('JDK unavailable'); return; }
    // Keep the deployment home non-ASCII, but avoid JDK 17's native Windows
    // argument decoding limitation in the independent Java lifecycle fixture.
    const javaDirectory = path.join(folder, 'java lifecycle');
    await mkdir(javaDirectory);
    const javaFile = path.join(javaDirectory, 'RemoteFixture.java');
    const runnableJar = path.join(javaDirectory, 'managed.jar');
    await writeFile(javaFile, 'public class RemoteFixture { public static void main(String[] args) throws Exception { System.out.println("REMOTE-READY"); while(true) Thread.sleep(100); }}');
    await run(path.join(bin, `javac${suffix}`), ['--release', '8', path.basename(javaFile)], { cwd: javaDirectory });
    await run(path.join(bin, `jar${suffix}`), ['cfe', path.basename(runnableJar), 'RemoteFixture', 'RemoteFixture.class'], { cwd: javaDirectory });
    const [example] = execRegistration.instances;
    await lan.request(null, 'jar', 'upsert', { hostId: stdio.id, revision: execRegistration.revision, instance: {
      ...example, id: example.id.split(':')[1], jar: runnableJar, executable: java.executable, logMode: 'console', jvmArgs: ['-Xmx64m'],
    } });
    const command = name => lan.request(null, 'jar', 'command', { id: example.id, command: name });
    const clientId = randomUUID();
    try {
      const started = await command('start');
      assert.equal(started.status.state, 'running');
      const waitForOutput = async () => {
        for (let attempt = 0; attempt < 40; attempt++) {
          const result = await lan.request(null, 'jar', 'console-read', { id: example.id, clientId });
          if (result.text?.includes('REMOTE-READY')) return;
          await delay(100);
        }
        assert.fail('The remote Java console did not report readiness');
      };
      await waitForOutput();
      const exits = [...processes].map(child => once(child, 'close'));
      lan.close();
      for (const client of clients) client.destroy?.();
      await Promise.all(exits);
      const [restored] = await lan.request(null, 'jar', 'statuses', { hostId: stdio.id });
      assert.equal(restored.pid, started.status.pid);
      assert.equal(restored.state, 'running');
      await waitForOutput();
      const bytes = await readFile(runnableJar);
      const { token } = await lan.request(null, 'jar', 'replace-begin', { id: example.id, expectedPath: await realpath(runnableJar) });
      const upload = { id: example.id, token };
      await lan.request(null, 'jar', 'replace-chunk', { ...upload, offset: 0, data: bytes.toString('base64') });
      const replacement = await lan.request(null, 'jar', 'replace-finish', { ...upload, size: bytes.length, backup: true, start: true });
      assert.equal(replacement.started, true, replacement.startError);
      assert.deepEqual(await readFile(replacement.backup), bytes);
      await waitForOutput();
      const [name] = await lan.request(null, 'jar', 'replace-backups', { id: example.id });
      assert.equal(name, path.basename(replacement.backup));
      const rollback = await lan.request(null, 'jar', 'replace-restore', {
        id: example.id, expectedPath: await realpath(runnableJar), name, backup: false, start: true,
      });
      assert.equal(rollback.started, true, rollback.startError);
      await waitForOutput();
    } finally { await command('stop'); }
  });
  const main = path.join(folder, 'nginx.conf');
  const executable = process.env.DEVKIT_NGINX_TEST_EXECUTABLE || '';
  const listener = await port();
  const nginxConfig = `error_log logs/error.log;\npid logs/nginx.pid;\nevents {}\nhttp { server { listen 127.0.0.1:${listener}; location / { return 200 "ssh fixture"; } } }\n`;
  await writeFile(main, nginxConfig);
  const remote = await lan.request(null, 'nginx', 'upsert', { hostId: id, revision: 0, instance: { name: 'SSH Proxy', main, prefix: folder, files: [], platform: 'any', executable } });
  const nginxId = remote.instances[0].id;
  assert.equal((await lan.request(null, 'nginx', 'documents', { id: nginxId })).files[0].content, nginxConfig);
  const legacyMain = path.join(folder, 'legacy.conf');
  await writeFile(legacyMain, 'events {}\n');
  const alias = path.join(folder, 'alias');
  await symlink(await realpath(folder), alias, process.platform === 'win32' ? 'junction' : 'dir');
  const legacy = { id, module: 'nginx', target: { id: randomUUID(), name: 'Legacy Nginx', path: path.join(alias, 'legacy.conf'), executable, files: [], prefix: folder } };
  await lan.hostRequest('legacy-import', legacy);
  await lan.hostRequest('legacy-import', legacy);
  const canonicalMain = await realpath(legacyMain);
  assert.equal((await lan.request(null, 'nginx', 'get', { hostId: id })).instances.filter(item => item.main === canonicalMain).length, 1);
  if (executable) {
    const command = kind => lan.request(null, 'nginx', 'command', { id: nginxId, command: kind });
    try {
      for (const kind of ['test', 'start']) {
        const result = await command(kind);
        assert.equal(result.ok, true, result.output);
        assert.equal(result.status.id, nginxId);
      }
      const closing = [...processes].map(child => once(child, 'close'));
      lan.close();
      await Promise.all(closing);
      assert.equal(await (await fetch(`http://127.0.0.1:${listener}`)).text(), 'ssh fixture');
      const reloaded = await command('reload');
      assert.equal(reloaded.ok, true, reloaded.output);
    } finally {
      const stopped = await command('stop');
      assert.equal(stopped.ok, true, stopped.output);
    }
  }
});
