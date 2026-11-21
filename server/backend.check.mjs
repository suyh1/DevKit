import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createJarManager } from './jar-manager.mjs';
import { createLogCenter } from './log-center.mjs';
import { createMonitorManager } from './monitor-manager.mjs';
import { managedRequest } from './managed-workspace.mjs';

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
    const two = await add('npm', 'two', { script: 'serve:custom' });
    const executable = await add('program', 'exe', { program: process.execPath, appArgs: ['app.cjs'] });
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
    const first = await endpoint('one'), second = await endpoint('two'), third = await endpoint('exe');
    assert.equal(await (await fetch(first)).text(), 'one');
    await manager.close(); manager = await createJarManager(root);
    assert.ok((await manager.request('statuses')).every(s => s.state === 'running'));
    await assert.rejects(command(two, 'start'), /已在运行/);
    await command(one, 'stop');
    await assert.rejects(fetch(first));
    assert.equal(await (await fetch(second)).text(), 'two');
    assert.equal(await (await fetch(third)).text(), 'exe');
    assert.match((await manager.request('log-tail', { id: two })).text, /ready two/);
    await command(two, 'restart');
    assert.equal(await (await fetch(await endpoint('two'))).text(), 'two');
    await command(executable, 'force-stop'); await assert.rejects(fetch(third));
  } finally {
    try { for (const id of ids) await command(id, 'force-stop'); }
    finally { await manager.close(); await rm(root, { recursive: true, force: true, maxRetries: 4 }); }
  }
});
