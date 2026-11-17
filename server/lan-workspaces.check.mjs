import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, open, readFile, realpath, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import ssh from 'ssh2';
import { createLanWorkspaces } from './lan-workspaces.mjs';
import { createJarManager } from './jar-manager.mjs';
import { createNginxManager } from './nginx-manager.mjs';
import { createProjectHost } from './project-host.mjs';
import { createProjectStore } from './project-store.mjs';
import { emptySharingServices } from '../shared/sharing.mjs';

async function port() {
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const result = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return result;
}

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
    const host = await createProjectHost(store, folder, { jar: () => jar, nginx: () => nginx, lan: () => lan });
    cleanup.push(async () => { await host.stop(); lan.close(); await nginx.close(); await jar.close(); await store.close(); });
    const services = emptySharingServices();
    for (const module of ['jar', 'nginx']) services[module] = { enabled: true, ...grants };
    const listening = await port(), password = `${name}-workspaces-fixture`;
    await host.start({ host: '127.0.0.1', port: listening, password, services });
    return { directory, lan, jar, nginx, address: `http://127.0.0.1:${listening}`, password };
  }
  const target = await endpoint('target', { edit: true, control: false });
  const gateway = await endpoint('gateway', { edit: true, control: true });
  const [{ id: hostId }] = await gateway.lan.hostRequest('save', { ...target, name: 'Test host', mode: 'share', modules: { jar: true, nginx: true } });
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
  const browse = await api('jar', 'browse', { hostId, kind: 'jar', directory: folder });
  assert.deepEqual(browse.data.entries.filter(item => !item.directory).map(item => item.path), [canonicalSource]);
  const saved = await api('jar', 'upsert', { hostId, revision: 0, instance: { name: 'Service', jar: source, logMode: 'console', env: { PRIVATE_SETTING: 'fixture-value' } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const [instance] = saved.data.instances;
  assert.ok(instance.id.startsWith(`${hostId}:`));
  assert.equal((await gateway.jar.request('get')).instances.length, 0);
  assert.equal((await target.jar.request('get')).instances[0].jar, canonicalSource);
  assert.equal((await api('jar', 'command', { id: instance.id, command: 'start' })).status, 403);
  assert.equal((await api('jar', 'get', { hostId, scope: 'local' })).status, 400);
  assert.deepEqual((await api('jar', 'statuses', { scope: 'inventory' })).data.map(status => status.id), [instance.id]);
  const viewer = await gateway.lan.request(gateway.jar, 'jar', 'get', { scope: 'inventory' }, { edit: false, control: false }, 'viewer');
  assert.deepEqual(viewer.instances[0].env, {});
  assert.equal((await api('lan-hosts', 'list')).status, 403);
  assert.equal((await gateway.lan.hostRequest('list'))[0].password, undefined);
  assert.equal((await readFile(path.join(gateway.directory, 'lan-hosts', 'connections.json'), 'utf8')).includes(target.password), false);

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

function sftpFixture(stream, folder) {
  const { STATUS_CODE, OPEN_MODE } = ssh.utils.sftp;
  const handles = new Map();
  let counter = 0;
  const target = filename => {
    assert.match(filename, /^\.devkit-ssh(?:\/[a-z0-9_.-]+)*$/i);
    assert.ok(filename.split('/').every(part => part !== '..'));
    return path.join(folder, filename);
  };
  const status = (id, action) => action.then(() => stream.status(id, STATUS_CODE.OK), error => stream.status(id, error.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : STATUS_CODE.FAILURE));
  stream.on('STAT', (id, file) => void stat(target(file)).then(info => stream.attrs(id, { mode: info.mode, size: info.size }), () => stream.status(id, STATUS_CODE.NO_SUCH_FILE)));
  stream.on('MKDIR', (id, file) => void status(id, mkdir(target(file))));
  stream.on('RENAME', (id, from, to) => void status(id, rename(target(from), target(to))));
  stream.on('REMOVE', (id, file) => void status(id, unlink(target(file))));
  stream.on('OPEN', (id, file, flags) => void open(target(file), flags & OPEN_MODE.EXCL ? 'wx' : 'w').then(handle => {
    const token = Buffer.from(String(++counter)); handles.set(token.toString(), handle); stream.handle(id, token);
  }, () => stream.status(id, STATUS_CODE.FAILURE)));
  stream.on('WRITE', (id, token, offset, data) => void status(id, handles.get(token.toString()).write(data, 0, data.length, offset)));
  stream.on('CLOSE', (id, token) => { const handle = handles.get(token.toString()); handles.delete(token.toString()); void status(id, handle.close()); });
}

test('SSH verifies the host before password auth, hosts a PTY, and runs the bundled managers over SFTP and stdio', { timeout: 50000 }, async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'devkit-lan-ssh-'));
  const lan = await createLanWorkspaces(path.join(folder, 'coordinator'));
  const clients = new Set(), processes = new Set();
  let authentication = 0, resized = false;
  const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs1' }, publicKeyEncoding: { format: 'pem', type: 'spki' } }).privateKey;
  const server = new ssh.Server({ hostKeys: [hostKey] }, client => {
    clients.add(client);
    client.on('error', () => {});
    client.on('close', () => clients.delete(client));
    client.on('authentication', context => {
      authentication++;
      if (context.method === 'password' && context.username === 'operator' && context.password === 'ssh-password-fixture') context.accept();
      else context.reject(['password']);
    });
    client.on('session', accept => {
      const session = accept();
      session.on('pty', (accept, _reject, info) => { assert.equal(info.term, 'xterm-256color'); accept(); });
      session.on('window-change', (_accept, _reject, info) => { resized = info.cols === 100; });
      session.on('shell', accept => { const stream = accept(); stream.write('fixture shell$ '); stream.on('data', bytes => stream.write(bytes)); });
      session.on('sftp', accept => sftpFixture(accept(), folder));
      session.on('exec', (accept, _reject, info) => {
        const match = /^node (\.devkit-ssh\/workspaces\/[a-f0-9]+\/server\/ssh-workspace-agent\.mjs)$/.exec(info.command);
        assert.ok(match, info.command);
        const stream = accept(), child = spawn(process.execPath, [match[1]], { cwd: folder, env: { ...process.env, HOME: folder, USERPROFILE: folder }, windowsHide: true });
        processes.add(child);
        const ended = once(child, 'close');
        child.stdin.on('error', () => {});
        stream.pipe(child.stdin);
        child.stdout.pipe(stream, { end: false });
        child.stderr.pipe(stream.stderr, { end: false });
        stream.on('close', () => child.stdin.end());
        void ended.then(([code]) => { processes.delete(child); stream.exit(code || 0); stream.end(); });
      });
    });
  }).listen(0, '127.0.0.1');
  t.after(async () => {
    lan.close();
    const closed = new Promise(resolve => server.close(resolve));
    for (const client of clients) client.end();
    await Promise.allSettled([...processes].map(child => once(child, 'close')));
    await closed;
    await rm(folder, { recursive: true, force: true });
  });
  await once(server, 'listening');
  const [{ id }] = await lan.hostRequest('save', { mode: 'ssh', name: 'SSH fixture', address: '127.0.0.1', port: server.address().port, user: 'operator', platform: process.platform, auth: 'password', password: 'ssh-password-fixture', modules: { jar: true, nginx: true } });
  const { fingerprint } = await lan.hostRequest('test', { id });
  assert.match(fingerprint, /^SHA256:/);
  assert.equal(authentication, 0);
  await lan.hostRequest('test', { id, fingerprint });
  assert.ok(authentication > 0);
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
  await lan.hostRequest('terminal-close', shell);
  const jar = path.join(folder, 'target.jar');
  await writeFile(jar, 'fixture');
  const registration = await lan.request(null, 'jar', 'upsert', { hostId: id, revision: 0, instance: { name: 'SSH Java', jar, logMode: 'file', jvmArgs: ['-Xmx128m'] } });
  const [application] = registration.instances;
  assert.ok(application.id.startsWith(`${id}:`));
  assert.deepEqual(application.jvmArgs, ['-Xmx128m']);
  assert.deepEqual((await lan.request(null, 'jar', 'get', { hostId: id })).instances, [application]);
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
