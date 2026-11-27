import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, copyFile, mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createJarManager } from './jar-manager.mjs';
import { createLogCenter } from './log-center.mjs';
import { createMonitorManager } from './monitor-manager.mjs';
import { managedRequest } from './managed-workspace.mjs';
import { inspectJava } from './jar-process.mjs';
import { launchSpec } from './backend-launch.mjs';
import { discoverRuntimes } from './runtime-discovery.mjs';

test('runtime discovery finds inactive installations and merges multiple paths to the same runtime', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'devkit-runtime-list-')));
  const windows = process.platform === 'win32';
  try {
    const dir = path.join(root, windows ? 'nvm/v24.0.0' : '.nvm/versions/node/v24.0.0/bin');
    await mkdir(dir, { recursive: true });
    const node = path.join(dir, windows ? 'node.exe' : 'node');
    await copyFile(process.execPath, node);
    const env = { NVM_HOME: path.join(root, 'nvm'), PATH: '' };
    const list = await discoverRuntimes('node', { env, home: root });
    assert.deepEqual(list.installations.find(row => row.executable === node), { executable: node, version: process.version });
    const alias = path.join(root, 'active');
    await symlink(dir, alias, windows ? 'junction' : 'dir');
    env.PATH = alias;
    const again = await discoverRuntimes('node', { env, home: root, configured: [node] });
    assert.deepEqual(again, list);
    if (!windows) {
      const jdks = path.join(root, '.sdkman/candidates/java');
      for (const version of ['17.0.12', '21.0.4']) {
        const jdk = path.join(jdks, version);
        await mkdir(path.join(jdk, 'bin'), { recursive: true });
        await writeFile(path.join(jdk, 'bin/java'), '#!/bin/sh\nprintf \'openjdk version "' + version + '"\\n\' >&2\n', { mode: 0o755 });
      }
      const java = await discoverRuntimes('java', { env: {}, home: root });
      const fixtures = java.installations.filter(row => row.executable.startsWith(jdks + path.sep));
      assert.deepEqual(fixtures.map(row => row.version), ['21.0.4', '17.0.12']);
    }
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 3 }); }
});

test('form checks resolve the selected runtime and inspect program files without launching them', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'devkit-probes-'));
  const manager = await createJarManager(root);
  try {
    const npm = await manager.request('detect-npm');
    assert.match(npm[0].text, /^Node\.js v\d+\./);
    assert.match(npm[1].text, /^npm \d+\./);
    assert.ok(npm.every(line => line.ok));
    const empty = await manager.request('detect-npm', { searchPath: root });
    assert.ok(empty.every(line => !line.ok && line.text.includes('未找到')));
    const windows = process.platform === 'win32';
    const cli = path.join(root, windows ? 'node_modules/npm/bin/npm-cli.js' : 'npm');
    await mkdir(path.dirname(cli), { recursive: true });
    await writeFile(cli, windows ? 'console.log("10.0.0")' : '#!/bin/sh\necho 10.0.0\n', { mode: 0o755 });
    const partial = await manager.request('detect-npm', { searchPath: root });
    assert.equal(partial[0].ok, false);
    assert.equal(partial[1].ok, !windows);
    assert.ok(partial[1].text.includes(await realpath(cli)));
    const binary = await manager.request('check-program', { program: process.execPath });
    assert.equal(binary[0].ok, true, binary[0].text);
    const check = program => manager.request('check-program', { program });
    assert.match((await check(root))[0].text, /普通程序文件/);
    const file = path.join(root, 'sample.exe');
    assert.match((await check(file))[0].text, /不存在/);
    await writeFile(file, 'plain text');
    if (process.platform !== 'win32') {
      await chmod(file, 0o600);
      assert.match((await check(file))[0].text, /权限/);
      await chmod(file, 0o700);
    }
    assert.equal((await check(file))[0].ok, false);
    if (process.platform !== 'win32') {
      const marker = path.join(root, 'was-started');
      await writeFile(file, '#!/bin/sh\ntouch "' + marker + '"\n');
      assert.equal((await check(file))[0].ok, true);
      await assert.rejects(readFile(marker), { code: 'ENOENT' });
    }
    for (const action of ['check-program', 'detect-npm']) {
      await assert.rejects(managedRequest(manager, 'jar', action, {}, { edit: true, control: true, backend: false }), /权限/);
      await assert.rejects(managedRequest(manager, 'jar', action, {}, { edit: false, control: true, backend: true }), /权限/);
    }
    const editor = { edit: true, control: false, backend: true };
    for (const kind of ['node', 'java']) {
      await assert.rejects(managedRequest(manager, 'jar', 'list-runtimes', { kind }, editor), /权限/);
    }
    const jarOnly = { control: true, edit: true, backend: false };
    await assert.rejects(managedRequest(manager, 'jar', 'list-runtimes', { kind: 'node' }, jarOnly), /权限/);
    assert.ok(Array.isArray((await managedRequest(manager, 'jar', 'list-runtimes', { kind: 'java' }, jarOnly)).installations));
    await assert.rejects(managedRequest(manager, 'jar', 'detect-npm', {}, editor), /权限/);
    assert.equal((await managedRequest(manager, 'jar', 'check-program', { program: process.execPath }, editor))[0].ok, true);
  } finally { await manager.close(); await rm(root, { recursive: true, force: true }); }
});

test('npm lifecycle, executable and simultaneous service trees survive reconnect and stop independently', { timeout: 180000 }, async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'devkit-backend-')));
  const cwd = path.join(root, '中文 service');
  await mkdir(cwd);
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ scripts: {
    prestart: 'node -e "require(\'fs\').writeFileSync(\'prestart\', \'ok\')"',
    start: 'node app.cjs', 'serve:custom': 'node app.cjs',
  } }));
  await writeFile(path.join(cwd, 'app.cjs'), `
    const http = require('node:http'), fs = require('node:fs');
    const label = process.env.SERVICE_LABEL;
    fs.writeFileSync(label + '.node', JSON.stringify({ node: process.execPath, npmNode: process.env.npm_node_execpath, version: process.version }));
    const server = http.createServer((req, res) => res.end(label));
    server.listen(0, '127.0.0.1', () => {
      fs.writeFileSync(label + '.port', String(server.address().port));
      console.log('ready ' + label);
    });`);
  let manager = await createJarManager(root);
  const ids = [];
  const command = (id, command) => manager.request('command', { id, command });
  async function add(kind, name, fields) {
    const { revision } = await manager.request('get');
    const state = await manager.request('upsert', { revision, instance: { kind, name, workDir: cwd,
      logMode: 'file', env: { SERVICE_LABEL: name }, ...fields } });
    const id = state.instances.at(-1).id; ids.push(id); return id;
  }
  async function endpoint(name) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const port = await readFile(path.join(cwd, name + '.port'), 'utf8').catch(() => '');
      if (port) return 'http://127.0.0.1:' + port;
      await delay(100);
    }
    throw new Error('Service never listened: ' + name);
  }
  try {
    const restricted = { control: true, edit: true };
    assert.deepEqual(await manager.request('npm-scripts', { directory: cwd }), ['prestart', 'start', 'serve:custom']);
    await assert.rejects(managedRequest(manager, 'jar', 'npm-scripts', { directory: cwd }, restricted), /权限/);
    const one = await add('npm', 'one', { script: 'start' });
    const automatic = (await manager.request('get')).instances.find(item => item.id === one);
    const spec = await launchSpec(automatic);
    const windows = process.platform === 'win32';
    const bin = path.join(root, 'selected Node');
    await mkdir(bin);
    const chosen = path.join(bin, windows ? 'node.exe' : 'node');
    await copyFile(process.env.DEVKIT_TEST_NODE || process.execPath, chosen);
    const expectedVersion = execFileSync(chosen, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
    const missingNpm = await manager.request('detect-npm', { nodePath: chosen });
    assert.equal(missingNpm[0].ok, true);
    assert.match(missingNpm[1].text, /所选 Node.js 安装中未找到 npm/);
    await assert.rejects(launchSpec({ ...automatic, nodePath: chosen }), /未找到 npm/);
    await assert.rejects(manager.request('detect-npm', { nodePath: path.join(bin, 'missing') }), /找不到指定/);
    if (windows) {
      await mkdir(path.join(bin, 'node_modules'));
      await symlink(path.resolve(spec.args[0], '../..'), path.join(bin, 'node_modules/npm'), 'junction');
    } else await symlink(spec.executable, path.join(bin, 'npm'));
    const detected = await manager.request('detect-npm', { nodePath: chosen });
    assert.equal(detected[0].text, 'Node.js ' + expectedVersion + ' · ' + chosen);
    assert.ok(detected[1].ok, detected[1].text);
    const two = await add('npm', 'two', { script: 'serve:custom', nodePath: chosen });
    const executable = await add('program', 'exe', { program: process.execPath, appArgs: ['app.cjs'] });
    const scriptId = await add('script', 'script', { program: process.execPath, script: path.join(cwd, 'app.cjs'), workDir: '' });
    const script = (await manager.request('get')).instances.find(item => item.id === scriptId);
    assert.equal(script.workDir, cwd);
    assert.deepEqual((await launchSpec(script)).args, [path.join(cwd, 'app.cjs')]);
    const logCenter = createLogCenter({ jar: () => manager });
    const catalog = await logCenter.request('sources');
    assert.deepEqual(new Set(catalog.sources.map(source => source.instanceId)), new Set(ids));
    const monitor = await createMonitorManager(root, { jar: () => manager, auto: false });
    try {
      const sources = await monitor.request('sources');
      assert.deepEqual(new Set(sources.map(item => item.source.id)), new Set(ids));
    } finally { await monitor.close(); }
    assert.equal((await managedRequest(manager, 'jar', 'get', {}, restricted)).instances.length, 0);
    assert.equal((await managedRequest(manager, 'jar', 'get', { scope: 'local', scopeAccess: restricted },
      { ...restricted, backend: true })).backendTypes, false);
    await assert.rejects(managedRequest(manager, 'jar', 'command', { id: one, command: 'start' }, restricted), /权限/);
    for (const id of ids) assert.equal((await command(id, 'start')).status.state, 'running');
    assert.equal(await readFile(path.join(cwd, 'prestart'), 'utf8'), 'ok');
    assert.equal(await (await fetch(await endpoint('script'))).text(), 'script');
    const first = await endpoint('one'), second = await endpoint('two'), third = await endpoint('exe');
    const selectedRuntime = () => readFile(path.join(cwd, 'two.node'), 'utf8').then(JSON.parse);
    const expected = { node: chosen, npmNode: chosen, version: expectedVersion };
    assert.deepEqual(await selectedRuntime(), expected);
    assert.equal(await (await fetch(first)).text(), 'one');
    await manager.close(); manager = await createJarManager(root);
    assert.equal((await manager.request('get')).instances.find(item => item.id === two).nodePath, chosen);
    assert.ok((await manager.request('statuses')).every(s => s.state === 'running'));
    await assert.rejects(command(two, 'start'), /已在运行/);
    await command(one, 'stop');
    await assert.rejects(fetch(first));
    assert.equal(await (await fetch(second)).text(), 'two');
    assert.equal(await (await fetch(third)).text(), 'exe');
    assert.match((await manager.request('log-tail', { id: two })).text, /ready two/);
    await rm(path.join(cwd, 'two.port'));
    await command(two, 'restart');
    assert.equal(await (await fetch(await endpoint('two'))).text(), 'two');
    assert.deepEqual(await selectedRuntime(), expected);
    await command(two, 'stop');
    const saved = await manager.request('get');
    const unpinned = await manager.request('upsert', { revision: saved.revision, instance: { ...saved.instances.find(item => item.id === two), nodePath: '' } });
    assert.equal(unpinned.instances.find(item => item.id === two).nodePath, undefined);
    await rm(path.join(cwd, 'two.port'));
    await command(two, 'start');
    await endpoint('two');
    const automaticRuntime = JSON.parse(await readFile(path.join(cwd, 'one.node'), 'utf8'));
    assert.deepEqual(await selectedRuntime(), automaticRuntime);
    await command(executable, 'force-stop'); await assert.rejects(fetch(third));
  } finally {
    try { for (const id of ids) await command(id, 'force-stop'); }
    finally { await manager.close(); await rm(root, { recursive: true, force: true, maxRetries: 4 }); }
  }
});

test('Linux upgrade can reopen and stop services launched by the unlinked runtime', { skip: process.platform !== 'linux' }, async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'devkit-upgrade-')));
  // This suffix is also legal in an actual executable name.
  const binary = path.join(root, 'DevKit (deleted)');
  let manager, launcher, worker, id;
  try {
    await copyFile(process.execPath, binary);
    manager = await createJarManager(root, {
      launchDetached: async (_executable, args, options) => {
        worker = spawn(binary, args, { ...options, detached: true, stdio: 'ignore' });
        await once(worker, 'spawn');
        return () => worker.exitCode !== null || worker.signalCode !== null;
      },
    });
    const state = await manager.request('upsert', { revision: 0, instance: {
      name: 'update test', kind: 'program', program: process.execPath, workDir: root,
      appArgs: ['-e', 'setInterval(() => {}, 1000)'], logMode: 'silent',
    } });
    id = state.instances[0].id;
    const started = await manager.request('command', { id, command: 'start' });
    launcher = started.status.pid;
    assert.equal((await inspectJava(launcher)).executable, binary);
    assert.equal((await inspectJava(launcher)).executableDeleted, false);
    await manager.close(); manager = undefined;
    await copyFile('/bin/true', binary + '.new');
    await rename(binary + '.new', binary);
    manager = await createJarManager(root);
    const [status] = await manager.request('statuses');
    assert.equal(status.state, 'running', status.detail);
    assert.match(status.detail, /更新或移除/);
    assert.equal(status.pid, launcher);
    await assert.rejects(manager.request('command', { id, command: 'start' }), /已在运行/);
    const stopped = await manager.request('command', { id, command: 'stop' });
    assert.equal(stopped.status.state, 'stopped');
    assert.equal(await inspectJava(started.status.businessPid), null);
    assert.equal(await inspectJava(launcher), null);
  } finally {
    if (launcher && (await inspectJava(launcher))?.executable === binary) process.kill(launcher, 'SIGUSR2');
    if (worker && worker.exitCode === null && worker.signalCode === null) worker.kill();
    await manager?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Linux verifies a surviving business group and can force-stop it after its leader exits', { skip: process.platform !== 'linux' }, async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'devkit-orphan-')));
  const dependencies = { supervised: false };
  let manager = await createJarManager(root, dependencies), group;
  try {
    // The entry exits on TERM while its child delays shutdown indefinitely.
    await writeFile(path.join(root, 'child.cjs'), "process.on('SIGTERM', () => {}); require('fs').writeFileSync('ready', String(process.pid)); setInterval(() => {}, 1000)");
    const item = (await manager.request('upsert', { revision: 0, instance: {
      name: 'test', kind: 'program', program: process.execPath, workDir: root, stopTimeout: 1, logMode: 'silent',
      appArgs: ['-e', "require('child_process').spawn(process.execPath, ['child.cjs'], {stdio:'ignore'})"],
    } })).instances[0];
    const command = command => manager.request('command', { id: item.id, command });
    const { status } = await command('start');
    group = status.businessPid;
    const child = Number(await readFile(path.join(root, 'ready'), 'utf8'));
    process.kill(status.pid, 'SIGKILL');
    for (let n = 0; n < 50 && await inspectJava(status.pid); n++) await delay(20);
    const identityFile = status.identityPath, identity = JSON.parse(await readFile(identityFile));
    await writeFile(identityFile, JSON.stringify({ ...identity, serviceId: 'different-service' }));
    assert.equal((await manager.request('statuses'))[0].canStopGroup, undefined);
    await assert.rejects(command('force-stop'));
    await writeFile(identityFile, JSON.stringify(identity));
    const [orphan] = await manager.request('statuses');
    assert.equal(orphan.canStopGroup, true);
    await assert.rejects(command('start'), /已核实业务进程组/);
    await assert.rejects(command('stop'), /仍未退出/);
    assert.equal(await inspectJava(group), null);
    assert.ok(await inspectJava(child));
    await manager.close(); manager = await createJarManager(root, dependencies);
    assert.equal((await manager.request('statuses'))[0].canStopGroup, true);
    assert.equal((await command('force-stop')).status.state, 'stopped');
    assert.equal(await inspectJava(child), null);
    group = undefined;
  } finally {
    if (group) { try { process.kill(-group, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    await manager.close(); await rm(root, { recursive: true, force: true });
  }
});
