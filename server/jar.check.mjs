import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath, stat } from 'node:fs/promises';
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
test('replace stops first, stages ordered chunks, preserves backups and starts only on request', async () => {
  const fake = fakeRuntime();
  let javaAvailable = true;
  fake.dependencies.detect = async () => ({ found: javaAvailable, executable: fake.java, output: 'Java unavailable' });
  await fixture(async ({ add, manager, jar, folder }) => {
    const { id } = (await add()).instances[0];
    const begin = () => manager.request('replace-begin', { id, expectedPath: jar });
    await manager.request('command', { id, command: 'start' });
    await assert.rejects(manager.request('replace-begin', { id, expectedPath: jar }, { allowControl: false }), /权限/);
    await assert.rejects(manager.request('replace-begin', { id, expectedPath: jar }, { allowEdit: false }), /权限/);
    await assert.rejects(manager.request('replace-begin', { id, expectedPath: jar + '.other' }), /路径/);
    assert.equal((await manager.request('statuses'))[0].state, 'running');
    for (const backup of [true, false]) {
      const previous = await readFile(jar);
      const session = { id, ...await begin() };
      assert.equal((await manager.request('statuses'))[0].state, 'stopped');
      await assert.rejects(begin(), /正在替换/);
      await assert.rejects(manager.request('command', { id, command: 'start' }), /替换/);
      const chunk = { ...session, offset: 0, data: Buffer.from('first').toString('base64') };
      await assert.rejects(manager.request('replace-chunk', chunk, { session: 'different' }), /会话/);
      await manager.request('replace-chunk', chunk);
      await assert.rejects(manager.request('replace-chunk', chunk), /位置/);
      await manager.request('replace-chunk', { ...chunk, offset: 5, data: Buffer.from('second').toString('base64') });
      assert.deepEqual(await readFile(jar), previous);
      const result = await manager.request('replace-finish', { ...session, size: 11, backup, start: backup });
      assert.equal(await readFile(jar, 'utf8'), 'firstsecond');
      if (backup) assert.deepEqual(await readFile(result.backup), previous);
      else assert.equal(result.backup, '');
      assert.equal((await manager.request('statuses'))[0].state, backup ? 'running' : 'stopped');
    }
    for (const cancel of [false, true]) {
      const session = { id, ...await begin() };
      await manager.request('replace-chunk', { ...session, offset: 0, data: 'YQ==' });
      if (cancel) await manager.request('replace-cancel', session);
      else await assert.rejects(manager.request('replace-finish', { ...session, size: 4, backup: false, start: true }), /不完整/);
      assert.equal(await readFile(jar, 'utf8'), 'firstsecond');
    }
    assert.equal((await readdir(folder)).filter(name => name.endsWith('.bak')).length, 1);
    assert.equal((await readdir(folder)).some(name => name.endsWith('.tmp')), false);
    const changed = { id, ...await begin() };
    await manager.request('replace-chunk', { ...changed, offset: 0, data: 'YQ==' });
    await writeFile(jar, 'another deployment');
    await assert.rejects(manager.request('replace-finish', { ...changed, size: 1, backup: true, start: true }), /原文件已变化/);
    assert.equal(await readFile(jar, 'utf8'), 'another deployment');
    const failedStart = { id, ...await begin() };
    await manager.request('replace-chunk', { ...failedStart, offset: 0, data: 'YQ==' });
    javaAvailable = false;
    const installed = await manager.request('replace-finish', { ...failedStart, size: 1, backup: true, start: true });
    assert.match(installed.startError, /Java unavailable/);
    assert.equal(await readFile(jar, 'utf8'), 'a');
    assert.equal(await readFile(installed.backup, 'utf8'), 'another deployment');
  }, fake.dependencies);
});

test('restore selects one historical backup, preserves it, and only stops after checking the selection', async () => {
  await fixture(async ({ add, manager, jar, folder, reopen }) => {
    const { id } = (await add()).instances[0], base = { id, expectedPath: jar };
    const old = path.basename(jar) + '.2026-01-02T03-04-05-678Z.0123abcd.bak';
    const newer = old.replace('2026-01', '2026-02');
    const other = 'other.jar' + old.slice(path.basename(jar).length);
    for (const name of [old, newer, other, old + '.tmp']) await writeFile(path.join(folder, name), name);
    manager = await reopen();
    await manager.request('command', { id, command: 'start' });
    assert.deepEqual(await manager.request('replace-backups', base), [newer, old]);
    const restore = { ...base, start: true, backup: true };
    for (const name of [other, '../' + old, old.replace('2026', '2000')]) {
      await assert.rejects(manager.request('replace-restore', { ...restore, name }));
    }
    for (const options of [{ allowControl: false }, { allowEdit: false }]) {
      await assert.rejects(manager.request('replace-restore', { ...restore, name: old }, options), /权限/);
    }
    assert.equal((await manager.request('statuses'))[0].state, 'running');
    const result = await manager.request('replace-restore', { ...restore, name: old });
    assert.equal(result.started, true);
    assert.equal(await readFile(jar, 'utf8'), old);
    assert.equal(await readFile(result.backup, 'utf8'), 'fixture');
    assert.equal(await readFile(path.join(folder, old), 'utf8'), old);
    assert.equal((await manager.request('statuses'))[0].state, 'running');
    const stopped = await manager.request('replace-restore', { ...restore, name: newer, start: false, backup: false });
    assert.equal(stopped.backup, '');
    assert.equal(await readFile(jar, 'utf8'), newer);
    assert.equal((await manager.request('statuses'))[0].state, 'stopped');
    await rm(jar);
    const recovered = await manager.request('replace-restore', { ...restore, name: old });
    assert.equal(recovered.started, true);
    assert.equal(recovered.backup, '');
    assert.equal(await readFile(jar, 'utf8'), old);
  }, fakeRuntime().dependencies);
});

test('replacement targets the script or program entry and respects backend permissions and execution mode', async () => {
  await fixture(async ({ manager, add, folder }) => {
    const script = path.join(folder, 'main.js'), program = path.join(folder, process.platform === 'win32' ? 'app.exe' : 'app');
    for (const [kind, target] of [['script', script], ['program', program]]) {
      await writeFile(target, 'old', { mode: 0o750 });
      const mode = (await stat(target)).mode;
      const state = await add({ kind, workDir: folder, program: kind === 'script' ? process.execPath : program, script });
      const { id } = state.instances.at(-1);
      const begin = { id, expectedPath: target };
      await assert.rejects(manager.request('replace-begin', begin, { allowBackend: false }), /权限/);
      const session = { id, ...await manager.request('replace-begin', begin) };
      await manager.request('replace-chunk', { ...session, offset: 0, data: 'YWJj' });
      await manager.request('replace-finish', { ...session, size: 3, start: false, backup: false });
      assert.equal(await readFile(target, 'utf8'), 'abc');
      assert.equal((await stat(target)).mode, mode);
    }
  }, fakeRuntime().dependencies);
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
    await assert.rejects(manager.request('replace-begin', { id: item.id, expectedPath: item.jar }), /仍未退出/);
    assert.equal(await readFile(item.jar, 'utf8'), 'fixture');
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
