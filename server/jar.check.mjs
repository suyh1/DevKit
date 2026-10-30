import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createJarManager, jarPaths } from './jar-manager.mjs';
import { windowsArguments, detectJava, matchesJar } from './jar-process.mjs';

async function fixture(run, dependencies = {}, { ascii = false } = {}) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'devkit-jar-')));
  const folder = path.join(directory, ascii ? 'java apps' : '中文 apps'); await mkdir(folder);
  const jar = path.join(folder, ascii ? 'order service.jar' : '订单 服务.jar'); await writeFile(jar, 'fixture');
  let manager = await createJarManager(directory, dependencies);
  const instance = { name: '订单服务', jar, logMode: 'file', jvmArgs: ['-Xmx64m'], appArgs: ['--label=hello world'], stopTimeout: 1 };
  const add = async (overrides = {}) => {
    const { revision } = await manager.request('get');
    return manager.request('upsert', { revision, instance: { ...instance, ...overrides } });
  };
  try { await run({ directory, folder, jar, instance, manager, add, reopen: async () => { await manager.close(); manager = await createJarManager(directory, dependencies); return manager; } }); }
  finally { await manager.close(); assert.ok(path.basename(directory).startsWith('devkit-jar-')); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
}
function fakeRuntime() {
  const processes = new Map(), calls = [], java = path.resolve('fake-java.exe'); let pid = 14000;
  return { processes, calls, java, dependencies: { supervised: false,
    delay: async () => {}, detect: async () => ({ found: true, executable: java }),
    inspect: async pid => processes.get(pid) || null,
    launch: async (executable, args, cwd, output) => {
      calls.push({ executable, args, cwd, output }); const next = ++pid;
      processes.set(next, { pid: next, executable, args, created: String(next), uptime: 12, memory: 5 * 1024 * 1024, cpuSeconds: 1 });
      return { pid: next, exit: () => processes.has(next) ? undefined : { code: 7 } };
    },
    signal: async (pid, force) => { calls.push({ signal: pid, force }); processes.delete(pid); },
  } };
}
test('registry persists aliases and rejects duplicate JARs, file collisions and stale revisions', async () => fixture(async ({ add, jar, folder, manager, reopen }) => {
  const state = await add(); assert.equal(state.instances[0].name, '订单服务');
  assert.equal(jarPaths(state.instances[0]).directory, folder);
  await assert.rejects(add(), /已登记|冲突/);
  const other = path.join(folder, 'other.jar'); await writeFile(other, 'other');
  await assert.rejects(add({ jar: other, pidName: state.instances[0].pidName }), /冲突/);
  await assert.rejects(manager.request('remove', { id: state.instances[0].id, revision: 0 }), /刷新/);
  await assert.rejects(add({ jar: other, logName: '../outside.log' }), /文件名/);
  await assert.rejects(add({ jar: other, jvmArgs: ['-jar', jar] }), /JVM/);
  manager = await reopen(); assert.equal((await manager.request('get')).instances[0].jar, jar);
}));
test('start, restart, stop and reopen preserve exact arguments, append logs and do not delete source files', async () => {
  const fake = fakeRuntime();
  await fixture(async ({ add, manager, folder, jar, reopen }) => {
    const state = await add(), item = state.instances[0], paths = jarPaths(item);
    await writeFile(paths.logPath, 'history\n');
    const result = await manager.request('command', { id: item.id, command: 'start' });
    assert.equal(result.status.state, 'running');
    assert.deepEqual(fake.calls[0].args, ['-Xmx64m', '-jar', jar, '--label=hello world']);
    assert.equal(fake.calls[0].cwd, folder);
    assert.equal(await readFile(paths.logPath, 'utf8'), 'history\n');
    assert.equal(Number(await readFile(paths.pidPath, 'utf8')), result.status.pid);
    await assert.rejects(manager.request('command', { id: item.id, command: 'start' }), /已在运行/);
    await assert.rejects(manager.request('remove', { id: item.id, revision: state.revision }), /先停止/);
    manager = await reopen(); assert.equal((await manager.request('statuses'))[0].state, 'running');
    const restarted = await manager.request('command', { id: item.id, command: 'restart' }); assert.notEqual(restarted.status.pid, result.status.pid);
    await manager.request('command', { id: item.id, command: 'stop' });
    assert.equal((await manager.request('statuses'))[0].state, 'stopped');
    await manager.request('remove', { id: item.id, revision: state.revision });
    assert.equal(await readFile(jar, 'utf8'), 'fixture'); assert.equal(await readFile(paths.logPath, 'utf8'), 'history\n');
  }, fake.dependencies);
});
test('PID reuse, missing PID, malformed PID and legacy PID cannot terminate another process', async () => {
  const fake = fakeRuntime();
  await fixture(async ({ add, manager }) => {
    const item = (await add()).instances[0], paths = jarPaths(item);
    await writeFile(paths.pidPath, '12345'); fake.processes.set(12345, { pid: 12345, executable: fake.java, args: ['-jar', item.jar], created: 'new' });
    assert.equal((await manager.request('statuses'))[0].state, 'unknown');
    for (const command of ['stop', 'force-stop', 'start', 'restart']) await assert.rejects(manager.request('command', { id: item.id, command }), /身份/);
    await writeFile(paths.identityPath, JSON.stringify({ pid: 12345, executable: fake.java, jar: item.jar, created: 'old' }));
    assert.equal((await manager.request('statuses'))[0].state, 'unknown');
    await rm(paths.pidPath); assert.equal((await manager.request('statuses'))[0].state, 'unknown');
    await writeFile(paths.pidPath, 'bad'); assert.equal((await manager.request('statuses'))[0].state, 'unknown');
    assert.equal(fake.calls.length, 0);
  }, fake.dependencies);
});
test('stop timeout keeps process and blocks restart until an explicit force stop', async () => {
  const fake = fakeRuntime(), original = fake.dependencies.signal;
  fake.dependencies.signal = async (pid, force) => { if (force) await original(pid, force); };
  await fixture(async ({ add, manager }) => {
    const item = (await add()).instances[0]; await manager.request('command', { id: item.id, command: 'start' });
    await assert.rejects(manager.request('command', { id: item.id, command: 'restart' }), /仍未退出/);
    assert.equal(fake.calls.filter(call => call.args).length, 1);
    assert.equal((await manager.request('statuses'))[0].state, 'running');
    await manager.request('command', { id: item.id, command: 'force-stop' });
    assert.equal((await manager.request('statuses'))[0].state, 'stopped');
  }, fake.dependencies);
});
test('missing Java prevents launch; crashes and bounded log tail are reported', async () => {
  const fake = fakeRuntime(); let available = false;
  fake.dependencies.detect = async () => ({ found: available, executable: fake.java, output: 'Java unavailable' });
  await fixture(async ({ add, manager }) => {
    const item = (await add()).instances[0], paths = jarPaths(item);
    await assert.rejects(manager.request('command', { id: item.id, command: 'start' }), /Java unavailable/);
    assert.equal(fake.calls.length, 0); available = true;
    const started = await manager.request('command', { id: item.id, command: 'start' }); fake.processes.delete(started.status.pid);
    const status = (await manager.request('statuses'))[0]; assert.equal(status.state, 'exited'); assert.equal(status.exitCode, 7);
    await writeFile(paths.logPath, 'old\n'.repeat(40000) + 'latest 中文\n');
    const log = await manager.request('log-tail', { id: item.id });
    assert.equal(log.truncated, true); assert.ok(Buffer.byteLength(log.text) <= 128 * 1024); assert.match(log.text, /latest 中文/);
  }, fake.dependencies);
});
test('silent mode discards output; malformed registries are preserved', async () => {
  const fake = fakeRuntime();
  await fixture(async ({ add, manager, directory }) => {
    const item = (await add({ logMode: 'silent' })).instances[0];
    await manager.request('command', { id: item.id, command: 'start' }); assert.equal(fake.calls[0].output, undefined);
    await manager.request('command', { id: item.id, command: 'stop' });
    await manager.close(); const file = path.join(directory, 'jar/instances.json'); await writeFile(file, '{broken');
    await assert.rejects(createJarManager(directory), /JSON/); assert.equal(await readFile(file, 'utf8'), '{broken');
  }, fake.dependencies);
});
test('Windows command line parsing keeps spaced and escaped -jar paths exact', () => {
  assert.deepEqual(windowsArguments('"C:\\Program Files\\Java\\java.exe" -Xmx64m -jar "D:\\apps\\订单 服务.jar" "--label=hello world"'), ['C:\\Program Files\\Java\\java.exe', '-Xmx64m', '-jar', 'D:\\apps\\订单 服务.jar', '--label=hello world']);
  assert.deepEqual(windowsArguments('java "" "a\\\"b" "C:\\dir\\\\"'), ['java', '', 'a"b', 'C:\\dir\\']);
  const jar = path.resolve('test.jar'), executable = path.resolve('java');
  assert.equal(matchesJar({ jar }, { pid: 123, args: ['-jar', `${jar}.backup`], executable, created: '1' }, { pid: 123, jar, executable, created: '1' }), false);
});

test('real Java lifecycle on the current OS, including manager reopen and spaced paths', { timeout: 120000 }, async context => {
  const java = await detectJava({ executable: process.env.DEVKIT_TEST_JAVA || '' });
  if (!java.found) { context.skip('Java not installed; run with JAVA_HOME/PATH or DEVKIT_TEST_JAVA'); return; }
  const execute = promisify(execFile), bin = path.dirname(java.executable), extension = process.platform === 'win32' ? '.exe' : '';
  const javac = path.join(bin, `javac${extension}`), jarTool = path.join(bin, `jar${extension}`);
  try { await execute(javac, ['-version']); } catch { context.skip('JDK compiler unavailable'); return; }
  await fixture(async ({ folder, jar, add, manager, reopen }) => {
    const source = path.join(folder, 'JarFixture.java');
    await writeFile(source, 'public class JarFixture { public static void main(String[] args) throws Exception { System.out.println("fixture:" + String.join("|", args)); System.out.flush(); if (args.length > 0 && args[0].equals("exit")) System.exit(7); while(true) Thread.sleep(100); } }');
    await execute(javac, ['--release', '8', '-encoding', 'UTF-8', source], { timeout: 20000 });
    await execute(jarTool, ['cfe', jar, 'JarFixture', '-C', folder, 'JarFixture.class'], { timeout: 20000 });
    const item = (await add({ executable: java.executable })).instances[0];
    try {
      await manager.request('command', { id: item.id, command: 'start' });
      assert.match((await manager.request('log-tail', { id: item.id })).text, /fixture:--label=hello world/);
      manager = await reopen(); assert.equal((await manager.request('statuses'))[0].state, 'running');
      await manager.request('command', { id: item.id, command: 'restart' });
      await manager.request('command', { id: item.id, command: 'stop' });
      assert.equal((await manager.request('statuses'))[0].state, 'stopped');
      const state = await manager.request('get');
      await manager.request('upsert', { revision: state.revision, instance: { ...item, appArgs: ['exit'] } });
      await assert.rejects(manager.request('command', { id: item.id, command: 'start' }), /启动/);
      assert.equal((await manager.request('statuses'))[0].state, 'exited');
    } finally { await manager.request('command', { id: item.id, command: 'force-stop' }).catch(() => {}); }
  }, {}, { ascii: process.platform === 'win32' });
});
