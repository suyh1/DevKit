import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';
import { createJarManager } from './jar-manager.mjs';
import { createProjectStore } from './project-store.mjs';
import { createProjectHost } from './project-host.mjs';
import { emptySharingServices } from '../shared/sharing.mjs';
import { detectJava } from './jar-process.mjs';

test('shared console: remote/local duplicate prevention, read grants, one writer, session release, reconnect and EOF', { timeout: 150000 }, async context => {
  const java = await detectJava({ executable: process.env.DEVKIT_TEST_JAVA || '' });
  if (!java.found) { context.skip('Java unavailable'); return; }
  const execute = promisify(execFile), suffix = process.platform === 'win32' ? '.exe' : '', bin = path.dirname(java.executable);
  try { await execute(path.join(bin, `javac${suffix}`), ['-version']); } catch { context.skip('JDK unavailable'); return; }
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'devkit-jar-console-'))), folder = path.join(directory, 'java app'); await mkdir(folder);
  const jar = path.join(folder, 'interactive app.jar'), source = path.join(folder, 'ConsoleFixture.java');
  await writeFile(source, `import java.io.*; public class ConsoleFixture { public static void main(String[] a)throws Exception { System.setOut(new PrintStream(System.out,true,"UTF-8")); System.setErr(new PrintStream(System.err,true,"UTF-8"));System.out.println("CONSOLE-READY");System.err.println("STDERR-READY");BufferedReader in=new BufferedReader(new InputStreamReader(System.in,"UTF-8"));String line;while((line=in.readLine())!=null){System.out.println("ECHO:"+line);}System.out.println("INPUT-EOF");while(true)Thread.sleep(100);}}`);
  await execute(path.join(bin, `javac${suffix}`), ['--release', '8', source]);
  await execute(path.join(bin, `jar${suffix}`), ['cfe', jar, 'ConsoleFixture', '-C', folder, 'ConsoleFixture.class']);
  const configs = path.join(directory, 'configs'), dist = path.join(directory, 'dist'); await mkdir(path.join(dist, '.vite'), { recursive: true });
  await writeFile(path.join(dist, 'portal.html'), 'portal'); await writeFile(path.join(dist, '.vite/manifest.json'), '{"portal.html":{"file":"portal.html"}}');
  const store = await createProjectStore(configs); let manager = await createJarManager(configs);
  const host = await createProjectHost(store, dist, { jar: () => manager });
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const origin = `http://127.0.0.1:${port}`, services = emptySharingServices(); services.jar.enabled = true;
  const settings = { host: '127.0.0.1', port, password: 'jar-sharing-test', services };
  const call = (action, cookie, payload = {}, module = 'jar') => fetch(`${origin}/api/${module}/${action}`, { method: 'POST', headers: { Cookie: cookie || '', Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  async function login() { const response = await call('login', '', { password: settings.password }, 'projects'); assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0]; }
  async function invoke(action, cookie, payload = {}) { const response = await call(action, cookie, payload); const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result; }
  let item;
  async function output(cookie, clientId, contains) {
    for (let attempt = 0; attempt < 50; attempt++) { const result = await invoke('console-read', cookie, { id: item.id, clientId }); if (result.text?.includes(contains)) return result; await delay(100); }
    throw new Error('Console output missing: ' + contains);
  }
  try {
    item = (await manager.request('upsert', { revision: 0, instance: { name: '交互测试', jar, executable: java.executable, jvmArgs: ['-Xmx64m', '-Dprivate=test-secret'], appArgs: [], logMode: 'console', env: { TOKEN: 'shared-env-secret' }, profiles: [{ id: 'test', name: '测试', env: { PASSWORD: 'profile-secret' } }], profile: 'test' } })).instances[0];
    await host.start(settings); let a = await login(), b = await login();
    const readonly = await invoke('get', a); assert.equal(JSON.stringify(readonly).includes('test-secret'), false); assert.equal(JSON.stringify(readonly).includes('shared-env-secret'), false); assert.deepEqual(readonly.instances[0].profiles[0].env, {});
    for (const action of ['command', 'detect', 'upsert', 'console-claim', 'console-input', 'startup-install', 'pick']) assert.equal((await call(action, a, { id: item.id, command: 'start' })).status, 403);
    services.jar.control = true; await host.start(settings); a = await login(); b = await login();
    await invoke('command', a, { id: item.id, command: 'start' });
    await assert.rejects(manager.request('command', { id: item.id, command: 'start' }), /已在运行/);
    const clientA = randomUUID(), clientB = randomUUID(), clientLocal = randomUUID();
    const initial = await output(a, clientA, 'CONSOLE-READY'); assert.match(initial.text, /STDERR-READY/);
    const base = { id: item.id, generation: initial.generation };
    const lease = await invoke('console-claim', a, { ...base, clientId: clientA }); assert.equal(lease.lease.mine, true); assert.equal('owner' in lease.lease, false);
    assert.equal((await call('console-claim', b, { ...base, clientId: clientB })).status, 400);
    assert.equal((await call('console-input', b, { ...base, clientId: clientA, text: 'spoof' })).status, 400);
    await invoke('console-input', a, { ...base, clientId: clientA, text: 'hello 中文 = $test' }); await output(b, clientB, 'ECHO:hello 中文 = $test');
    await invoke('console-release', a, { ...base, clientId: clientA }); assert.equal((await manager.request('statuses'))[0].state, 'running');
    await manager.request('console-claim', { ...base, clientId: clientLocal });
    await manager.request('console-input', { ...base, clientId: clientLocal, text: 'local' }); await output(a, clientA, 'ECHO:local');
    await manager.close(); manager = await createJarManager(configs);
    await assert.rejects(manager.request('command', { id: item.id, command: 'start' }), /已在运行/);
    await invoke('console-claim', a, { ...base, clientId: clientA });
    await call('logout', a, {}, 'projects');
    for (let attempt = 0; attempt < 30; attempt++) { const read = await invoke('console-read', b, { ...base, clientId: clientB }); if (!read.lease) break; await delay(50); }
    await invoke('console-claim', b, { ...base, clientId: clientB });
    await invoke('console-eof', b, { ...base, clientId: clientB }); const ended = await output(b, clientB, 'INPUT-EOF'); assert.equal(ended.inputOpen, false);
    assert.equal((await manager.request('statuses'))[0].state, 'running');
    await assert.rejects(stat(path.join(folder, item.logName)), error => error.code === 'ENOENT');
    await invoke('command', b, { id: item.id, command: 'stop' });
    assert.equal((await manager.request('statuses'))[0].state, 'stopped');
    services.jar.enabled = false; services.http.enabled = true; await host.start(settings); b = await login(); assert.equal((await call('get', b)).status, 404);
  } finally {
    if (item) await manager.request('command', { id: item.id, command: 'force-stop' }).catch(() => {});
    await host.stop(); await manager.close(); await store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  }
});
