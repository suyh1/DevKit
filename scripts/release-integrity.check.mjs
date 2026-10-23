import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPackage } from '@electron/asar';
import { releaseTargets, sha256, validateIdentity, verifyRuntime } from './release-integrity.mjs';

test('release collection rejects modified, stale and wrong-architecture packages', () => {
  const bytes = Buffer.from('installer'), target = releaseTargets('1.4.0')[2];
  const identity = { ...target, version: '1.4.0', buildSha256: 'build', sha256: sha256(bytes), bytes: bytes.length };
  validateIdentity(identity, target, '1.4.0', bytes, 'build');
  for (const change of [{ arch: 'x64' }, { version: '1.3.0' }, { name: '../wrong.deb' }, { format: 'dir' }, { buildSha256: 'old' }, { bytes: 0 }, { sha256: 'corrupted' }]) assert.throws(() => validateIdentity({ ...identity, ...change }, target, '1.4.0', bytes, 'build'));
  assert.throws(() => validateIdentity(identity, target, '1.4.0', Buffer.from('changed'), 'build'));
});
test('runtime inspection detects stale lazy chunks, desktop source and app versions in real ASAR archives', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'devkit-release-check-'));
  try {
    const stage = path.join(root, 'stage'), archive = path.join(root, 'app.asar');
    await mkdir(path.join(stage, 'dist', 'assets'), { recursive: true });
    await mkdir(path.join(root, 'dist', 'assets'), { recursive: true });
    await mkdir(path.join(root, 'electron'), { recursive: true });
    for (const name of ['server', 'shared']) {
      await mkdir(path.join(root, name)); await mkdir(path.join(stage, name));
      await writeFile(path.join(root, name, 'model.mjs'), name); await writeFile(path.join(stage, name, 'model.mjs'), name);
    }
    await writeFile(path.join(stage, 'package.json'), JSON.stringify({ version: '1.4.0' }));
    for (const [name, content] of [['index.html', 'index'], ['assets/worker.js', 'worker']]) {
      await writeFile(path.join(root, 'dist', name), content); await writeFile(path.join(stage, 'dist', name), content);
    }
    for (const name of ['main.cjs', 'preload.cjs', 'policy.cjs', 'security.json']) {
      await writeFile(path.join(root, 'electron', name), name); await writeFile(path.join(stage, name), name);
    }
    await createPackage(stage, archive);
    assert.match(await verifyRuntime(root, archive, '1.4.0'), /^[a-f0-9]{64}$/);
    await assert.rejects(verifyRuntime(root, archive, '1.3.0'), /version/);
    await writeFile(path.join(root, 'dist', 'assets', 'worker.js'), 'new worker');
    await assert.rejects(verifyRuntime(root, archive, '1.4.0'), /worker.js/);
    await writeFile(path.join(root, 'dist', 'assets', 'worker.js'), 'worker');
    await writeFile(path.join(root, 'server', 'model.mjs'), 'changed server');
    await assert.rejects(verifyRuntime(root, archive, '1.4.0'), /server\/model.mjs/);
    await writeFile(path.join(root, 'server', 'model.mjs'), 'server');
    await writeFile(path.join(root, 'electron', 'preload.cjs'), 'new bridge');
    await assert.rejects(verifyRuntime(root, archive, '1.4.0'), /preload.cjs/);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('devkit-release-check-'));
    await rm(root, { recursive: true, force: true });
  }
});
