import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, realpath, rename, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNginxManager } from './nginx-manager.mjs';

test('log authorization, contextual include impact, rotation, filters and current disk review', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'devkit-inspect-')));
  const manager = await createNginxManager(path.join(root, 'configs'));
  const main = path.join(root, 'nginx.conf'), common = path.join(root, 'shared.conf'), log = path.join(root, 'logs', 'error.log');
  await mkdir(path.dirname(log));
  await writeFile(log, '2026 [notice] started\n2026 [error] upstream 502\n2026 [warn] timeout\n');
  await writeFile(common, 'location /api/ { proxy_pass http://localhost:9000; }\n');
  await writeFile(main, 'error_log logs/error.log;\nevents {}\nhttp { server { listen 8080; server_name first; include shared.conf; } server { listen 8081; server_name second; include shared.conf; } }');
  try {
    let state = await manager.request('get');
    state = await manager.request('upsert', { revision: state.revision, instance: { name: 'one', platform: 'any', main, files: [common], prefix: root, executable: '' } });
    const id = state.instances[0].id;
    const scan = await manager.request('inspect', { id });
    assert.equal(scan.logs[0].path, log); assert.equal(scan.references.length, 2);
    assert.match(scan.references[0].context, /first/); assert.match(scan.references[1].context, /second/);
    const first = await manager.request('log-tail', { id, path: log, level: 'error', lines: 100 });
    assert.equal(first.text, '2026 [error] upstream 502');
    await assert.rejects(manager.request('log-tail', { id, path: main }), /显式指定/);
    await assert.rejects(manager.request('log-tail', { id, path: log, lines: 9999 }), /无效/);
    await rename(log, log + '.1'); await writeFile(log, 'fresh [error] rotated\n');
    const next = await manager.request('log-tail', { id, path: log, query: 'rotated' });
    assert.notEqual(next.identity, first.identity); assert.equal(next.text, 'fresh [error] rotated');
    await writeFile(common, 'location /api/ { proxy_pass http://localhost:9001; }\n');
    const review = await manager.request('review', { id });
    assert.match(review.files.find(file => file.path === common).content, /9001/);
    assert.equal(review.impacts[0].references.length, 2);
    assert.equal(await readFile(log + '.1', 'utf8'), '2026 [notice] started\n2026 [error] upstream 502\n2026 [warn] timeout\n');
  } finally { await manager.close(); await rm(root, { recursive: true, force: true }); }
});
test('shared includes across instances, dynamic targets and bounded log tails', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'devkit-refs-')));
  const manager = await createNginxManager(path.join(root, 'configs'));
  const shared = path.join(root, 'common.conf'), log = path.join(root, 'access.log');
  await writeFile(shared, 'access_log access.log; error_log stderr; access_log off; error_log syslog:server=127.0.0.1; access_log $host.log; include common.conf;');
  await writeFile(log, '中'.repeat(350000) + '\nline1\nline2\n');
  try {
    let state = await manager.request('get');
    for (const name of ['a', 'b']) {
      const main = path.join(root, name + '.conf'); await writeFile(main, 'events {} http { server { include common.conf; } }');
      state = await manager.request('upsert', { revision: state.revision, instance: { name, main, prefix: root, files: [shared], platform: 'any', executable: '' } });
    }
    const id = state.instances[0].id, scan = await manager.request('inspect', { id });
    assert.equal(scan.logs.length, 1); assert.ok(scan.warnings.some(text => text.includes('动态'))); assert.ok(scan.warnings.some(text => text.includes('循环')));
    const tail = await manager.request('log-tail', { id, path: log, lines: 1 });
    assert.equal(tail.text, 'line2'); assert.ok(tail.scannedBytes <= 1_000_000); assert.equal(tail.truncated, true);
    const review = await manager.request('review', { id });
    assert.deepEqual(review.impacts.map(item => item.name), ['a', 'b']);
    assert.ok(review.impacts[1].files.includes(shared));
  } finally { await manager.close(); await rm(root, { recursive: true, force: true }); }
});
