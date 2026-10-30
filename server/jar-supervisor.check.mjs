import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import http from 'node:http';
import { createJarManager, jarPaths } from './jar-manager.mjs';
import { detectJava } from './jar-process.mjs';
import { createJarAutostart } from './jar-autostart.mjs';

const execute = promisify(execFile);
test('independent supervisor: env profiles, live log rotation, health failure, reopen, retry exhaustion and manual cancellation', { timeout: 150000 }, async context => {
  const java = await detectJava({ executable: process.env.DEVKIT_TEST_JAVA || '' });
  if (!java.found) { context.skip('Java unavailable'); return; }
  const suffix = process.platform === 'win32' ? '.exe' : '', bin = path.dirname(java.executable);
  try { await execute(path.join(bin, `javac${suffix}`), ['-version']); } catch { context.skip('JDK unavailable'); return; }
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'devkit-supervisor-'))), folder = path.join(directory, process.platform === 'win32' ? 'java app' : '中文 app'); await mkdir(folder);
  const jar = path.join(folder, 'service.jar'), source = path.join(folder, 'DaemonFixture.java');
  await writeFile(source, `import java.nio.file.*; public class DaemonFixture { public static void main(String[] a) throws Exception { System.out.println("PROFILE:"+System.getenv("APP_MODE")); System.out.println("ARG:"+String.join("|",a)); if(a[0].equals("burst")){String line=new String(new char[1000]).replace('\\0','A');for(int i=0;i<1500;i++)System.out.println(line);System.out.println("BURST-END");} if(a[0].equals("crash")){Path file=Paths.get("crash-count");int n=Files.exists(file)?Integer.parseInt(new String(Files.readAllBytes(file),"UTF-8")):0;Files.write(file,Integer.toString(n+1).getBytes("UTF-8"));System.out.println("CRASH:"+(n+1));Thread.sleep(1200);System.exit(7);} if(a[0].equals("exit"))System.exit(0); while(true)Thread.sleep(100); } }`);
  await execute(path.join(bin, `javac${suffix}`), ['--release', '8', '-encoding', 'UTF-8', source]);
  await execute(path.join(bin, `jar${suffix}`), ['cfe', jar, 'DaemonFixture', '-C', folder, 'DaemonFixture.class']);
  let code = 200;
  const httpServer = http.createServer((_request, response) => { response.writeHead(code); response.end(); });
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  let manager = await createJarManager(directory), item;
  async function save(values) {
    const state = await manager.request('get');
    const next = await manager.request('upsert', { revision: state.revision, instance: { ...item, ...values } }); item = next.instances[0];
  }
  async function wait(predicate, limit = 45000) {
    const deadline = Date.now() + limit; let last;
    while (Date.now() < deadline) { last = (await manager.request('statuses'))[0]; if (await predicate(last)) return last; await delay(150); }
    throw new Error('Supervisor condition failed: ' + JSON.stringify(last));
  }
  try {
    await save({ name: '运行保障测试', jar, executable: java.executable, jvmArgs: ['-Xmx64m'], appArgs: ['burst'], logMode: 'file', stopTimeout: 5, env: { APP_MODE: 'base' }, profiles: [{ id: 'test', name: '测试', env: { APP_MODE: 'test' } }], profile: 'test', health: { type: 'http', url: `http://127.0.0.1:${httpServer.address().port}/`, interval: 60, timeout: 1, grace: 0, failures: 2 }, rotation: { enabled: true, maxMB: 1, days: 1, files: 3 } });
    await manager.request('command', { id: item.id, command: 'start' });
    const first = await wait(status => status.health.state === 'healthy');
    const paths = jarPaths(item);
    await wait(async () => (await manager.request('log-tail', { id: item.id })).text.includes('BURST-END'));
    const archives = (await readdir(folder)).filter(name => name.startsWith(`${item.logName}.devkit-`));
    assert.ok(archives.length > 0); let combined = '';
    for (const name of [...archives, item.logName]) { const file = path.join(folder, name); assert.ok((await stat(file)).size <= 1024 * 1024); combined += await readFile(file, 'utf8'); }
    assert.match(combined, /PROFILE:test/); assert.match(combined, /BURST-END/);
    await manager.close(); manager = await createJarManager(directory);
    const restored = await wait(status => status.health.state === 'healthy'); assert.equal(restored.pid, first.pid);
    code = 503;
    assert.equal((await manager.request('health-check', { id: item.id })).state, 'degraded');
    assert.equal((await manager.request('health-check', { id: item.id })).state, 'unhealthy');
    assert.equal((await manager.request('statuses'))[0].state, 'running');
    code = 200; assert.equal((await manager.request('health-check', { id: item.id })).state, 'healthy');
    await manager.request('command', { id: item.id, command: 'stop' });
    await save({ appArgs: ['crash'], health: { type: 'none' }, restart: { enabled: true, maxRetries: 2, delay: 1, maxDelay: 2, stable: 60 } });
    await manager.request('command', { id: item.id, command: 'start' });
    const exhausted = await wait(status => status.supervision?.state === 'exhausted');
    assert.equal(exhausted.supervision.attempts, 2); assert.equal(await readFile(path.join(folder, 'crash-count'), 'utf8'), '3');
    await assert.rejects(save({ profile: '' }), /先停止/);
    await manager.request('command', { id: item.id, command: 'stop' });
    await save({ restart: { enabled: true, maxRetries: 5, delay: 2, maxDelay: 2, stable: 60 } });
    await manager.request('command', { id: item.id, command: 'start' });
    await wait(status => status.supervision?.state === 'backoff');
    await manager.request('command', { id: item.id, command: 'stop' });
    const count = await readFile(path.join(folder, 'crash-count'), 'utf8'); await delay(2300);
    assert.equal(await readFile(path.join(folder, 'crash-count'), 'utf8'), count);
    assert.equal((await manager.request('statuses'))[0].supervision, undefined);
    await save({ appArgs: ['exit'] });
    await assert.rejects(manager.request('command', { id: item.id, command: 'start' }), /启动/);
    const exited = (await manager.request('statuses'))[0]; assert.equal(exited.supervision.state, 'exited'); assert.equal(exited.supervision.attempts, 0);
  } finally {
    if (item) await manager.request('command', { id: item.id, command: 'force-stop' }).catch(error => context.diagnostic(error.message));
    await manager.close(); httpServer.closeAllConnections(); await new Promise(resolve => httpServer.close(resolve));
    await rm(directory, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
  }
});

test('optional actual Windows tasks: login lifecycle and boot privilege result', { skip: process.platform !== 'win32' || process.env.DEVKIT_TEST_STARTUP !== '1' }, async context => {
  const directory = await mkdtemp(path.join(tmpdir(), 'devkit-task-'));
  const tool = createJarAutostart(path.join(directory, 'instances.json'));
  const item = { id: '00000000-0000-0000-0000-' + String(Date.now()).slice(-12), stopTimeout: 5 };
  try { for (const mode of ['login', 'boot']) await context.test(mode, async child => {
    try { const result = await tool.install(item, mode); assert.equal(result.enabled, true); assert.equal(result.mode, mode); }
    catch (error) { if (mode === 'boot' && /管理员/.test(error.message)) { assert.match((await tool.get(item)).error, /管理员/); child.diagnostic('Boot registration denied by OS; permission error correctly surfaced.'); } else throw error; }
    finally { await tool.remove(item); }
    assert.equal((await tool.get(item)).enabled, false);
  }); }
  finally { await tool.remove(item); await rm(directory, { recursive: true, force: true }); }
});
