import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { rdpFixture } from '../electron/rdp-fixture.mjs';
import { emptySharingServices } from '../shared/sharing.mjs';
import { createLanWorkspaces } from './lan-workspaces.mjs';
import { createProjectHost } from './project-host.mjs';
import { createProjectStore } from './project-store.mjs';

test('browser RDP selects only saved targets, relays display and input, and revokes isolated sessions', { timeout: 12000 }, async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'devkit-rdp-'));
  const fixture = await rdpFixture();
  const overrides = { DEVKIT_RDP_DRIVE_ROOT: path.join(folder, 'drive-root'), DEVKIT_GUACD_DRIVE_ROOT: '', DEVKIT_GUACD_HOST: '127.0.0.1', DEVKIT_GUACD_PORT: String(fixture.port), DEVKIT_GUACD_TLS: 'false' };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  const store = await createProjectStore(folder), lan = await createLanWorkspaces(folder);
  const cleanup = [];
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
    lan.close(); await store.close(); await fixture.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(folder, { recursive: true, force: true });
  });
  await mkdir(path.join(folder, '.vite'));
  await writeFile(path.join(folder, '.vite', 'manifest.json'), JSON.stringify({ 'portal.html': { file: 'portal.html' } }));
  await writeFile(path.join(folder, 'portal.html'), 'portal');
  const host = await createProjectHost(store, folder, { lan: () => lan });
  cleanup.push(() => host.stop());
  const [target] = await lan.hostRequest('save', { mode: 'ssh', name: 'RDP fixture', address: '192.0.2.32', platform: 'win32', user: 'ssh-placeholder', port: 22, rdpPort: 3390 });
  const services = emptySharingServices(), permitted = emptySharingServices(), unprivileged = emptySharingServices();
  for (const value of [services, permitted, unprivileged]) value['lan-hosts'].enabled = true;
  services['lan-hosts'].rdp = permitted['lan-hosts'].rdp = true;
  for (const value of [services, permitted]) Object.assign(value['lan-hosts'], { files: true, terminal: true });
  const password = 'fixture-rdp-portal-password';
  const settings = { host: '127.0.0.1', password, services, visitors: [
    { name: 'rdp-visitor', password, services: permitted }, { name: 'viewer', password, services: unprivileged },
  ] };
  for (let attempt = 0; ; attempt++) {
    const probe = net.createServer().listen(0, settings.host);
    await once(probe, 'listening');
    settings.port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    try {
      await host.start(settings);
      break;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || attempt === 2) throw error;
    }
  }
  const origin = `http://${settings.host}:${settings.port}`;
  const post = (route, body, cookie = '', headerOrigin = origin) => fetch(`${origin}/api/${route}`, {
    method: 'POST', headers: { Cookie: cookie, Origin: headerOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
  });
  async function login(visitor) {
    const result = await post('sharing/login', { visitor, password });
    assert.equal(result.status, 200);
    return result.headers.get('set-cookie').split(';')[0];
  }
  const denied = await login('viewer'), allowed = await login('rdp-visitor'), other = await login();
  const credentials = { id: target.id, username: '测试🖥️', password: 'one-time-rdp-password', domain: 'FIXTURE', trustCertificate: true, hostname: '198.51.100.17', port: 1111 };
  assert.equal((await post('lan-hosts/rdp-open', credentials)).status, 401);
  assert.equal((await post('lan-hosts/rdp-open', credentials, denied)).status, 403);
  assert.equal((await post('lan-hosts/rdp-open', credentials, allowed, 'http://example.test')).status, 403);
  assert.equal((await post('lan-hosts/rdp-open', { ...credentials, id: 'missing' }, allowed)).status, 404);
  assert.equal(fixture.connections.length, 0);
  const response = await post('lan-hosts/rdp-open', credentials, allowed);
  assert.equal(response.status, 200);
  const id = response.headers.get('x-devkit-rdp-session'), reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  cleanup.push(() => reader.cancel().catch(() => {}));
  assert.ok(id);
  let output = '';
  while (!output.includes('4.sync,4.1000;')) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    output += chunk.value;
  }
  const [upstream] = fixture.connections;
  assert.deepEqual([upstream.hostname, upstream.port, upstream.username, upstream.password, upstream.domain, upstream['cert-tofu']],
    ['192.0.2.32', '3390', credentials.username, credentials.password, 'FIXTURE', 'true']);
  assert.deepEqual([upstream['disable-copy'], upstream['disable-paste']], ['false', 'false']);
  assert.equal(response.headers.get('x-devkit-rdp-drive'), '1');
  const drive = upstream['drive-path'];
  assert.equal(upstream['drive-name'], 'DevKit');
  const bytes = Buffer.from([0,255,0,78,13,10]);
  const upload = (name, cookie) => fetch(origin + '/api/lan-hosts/rdp-file-upload?' + new URLSearchParams({ id, name }), {
    method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/octet-stream' }, body: bytes,
  });
  assert.equal((await upload('other.bin', other)).status, 404);
  assert.equal((await upload('denied.bin', denied)).status, 403);
  assert.equal((await upload('../escape.bin', allowed)).status, 400);
  assert.equal((await upload('传输.bin', allowed)).status, 200);
  assert.deepEqual(await readFile(path.join(drive, '传输.bin')), bytes);
  assert.equal((await upload('传输.bin', allowed)).status, 409);
  const text = '会话剪贴板'.repeat(5000);
  assert.equal((await post('lan-hosts/rdp-clipboard', { id, text }, other)).status, 404);
  assert.equal((await post('lan-hosts/rdp-clipboard', { id, text }, denied)).status, 403);
  assert.equal((await post('lan-hosts/rdp-clipboard', { id, text: '中'.repeat(90000) }, allowed)).status, 400);
  assert.equal((await post('lan-hosts/rdp-clipboard', { id, text }, allowed)).status, 200);
  assert.equal((await post('lan-hosts/rdp-clipboard', { id, text: 'a'.repeat(131072) }, allowed)).status, 400);
  assert.equal(output.includes(credentials.password), false);
  assert.equal((await post('lan-hosts/rdp-input', { id, messages: [['key', '65', '1']] }, other)).status, 404);
  assert.equal((await post('lan-hosts/rdp-close', { id }, other)).status, 404);
  assert.equal((await post('lan-hosts/rdp-input', { id, messages: [['select', 'ssh']] }, allowed)).status, 400);
  assert.equal((await post('lan-hosts/rdp-input', { id, messages: [['key', '65', '1'], ['mouse', '80', '40', '1']] }, allowed)).status, 200);
  for (let attempt = 0; attempt < 25 && !fixture.messages.some(message => message[0] === 'mouse'); attempt++) await delay(20);
  const chunks = fixture.messages.filter(([op]) => op === 'blob').map(row => Buffer.from(row[2], 'base64'));
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(text));
  assert.ok(fixture.messages.some(message => message.join(',') === 'key,65,1'));
  assert.ok(fixture.messages.some(message => message.join(',') === 'mouse,80,40,1'));
  const vnc = (await lan.hostRequest('save', { mode: 'vnc', name: 'VNC', address: '192.0.2.44', port: 5901 })).at(-1);
  const vncResponse = await post('lan-hosts/rdp-open', { id: vnc.id, password: 'test-vnc', protocol: 'rdp' }, allowed);
  assert.equal(vncResponse.status, 200);
  assert.equal(vncResponse.headers.get('x-devkit-rdp-drive'), '0');
  assert.deepEqual(fixture.messages.filter(([command]) => command === 'select').at(-1), ['select', 'vnc']);
  assert.equal(fixture.connections.at(-1).port, '5901');
  await vncResponse.body.cancel();
  await host.start({ ...settings, password: '', visitors: [{ name: 'rdp-visitor', services: unprivileged }, { name: 'viewer', services: unprivileged }] });
  assert.equal((await post('lan-hosts/rdp-input', { id, messages: [['key', '65', '0']] }, allowed)).status, 401);
  assert.equal((await post('lan-hosts/rdp-open', credentials, await login('rdp-visitor'))).status, 403);
  for (let attempt = 0; attempt < 25 && fixture.sockets.size; attempt++) await delay(20);
  assert.equal(fixture.sockets.size, 0);
  // Revocation closes the transport before asynchronous drive cleanup completes.
  for (let attempt = 0; attempt < 60; attempt++) {
    const exists = await readFile(path.join(drive, '传输.bin')).then(() => true, error => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    });
    if (!exists) break;
    await delay(20);
  }
  await assert.rejects(readFile(path.join(drive, '传输.bin')), { code: 'ENOENT' });
  const audit = await host.audit();
  assert.ok(audit.some(item => item.action === 'lan-hosts.rdp-open' && item.visitor === 'rdp-visitor' && item.outcome === 'ok'));
  assert.equal(JSON.stringify(audit).includes(credentials.password), false);
});
