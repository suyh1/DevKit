import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createPackage } from '@electron/asar';
import { buildFingerprint, releaseTargets, sha256, validateIdentity, verifyRuntime } from './release-integrity.mjs';
import { cleanArtifacts } from './clean-artifacts.mjs';

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
    for (const name of ['main.cjs', 'preload.cjs', 'policy.cjs', 'desktop-preferences.cjs', 'security.json']) {
      await writeFile(path.join(root, 'electron', name), name); await writeFile(path.join(stage, name), name);
    }
    await mkdir(path.join(root, 'build', 'icons'), { recursive: true });
    await writeFile(path.join(root, 'build', 'icons', '128x128.png'), 'icon');
    await writeFile(path.join(stage, 'tray-icon.png'), 'icon');
    const binary = Buffer.from('fixture runtime'), license = Buffer.from('fixture license');
    const runtimeCatalog = `export const sshNodeRuntimes = ${JSON.stringify({ 'linux-arm64': { sha256: sha256(binary), licenseHash: sha256(license) } })};`;
    for (const base of [root, stage]) await writeFile(path.join(base, 'server', 'ssh-node-runtimes.mjs'), runtimeCatalog);
    await mkdir(path.join(stage, 'ssh-node'));
    await writeFile(path.join(stage, 'ssh-node', 'linux-arm64.gz'), gzipSync(binary));
    await writeFile(path.join(stage, 'ssh-node', 'linux-arm64.LICENSE'), license);
    await createPackage(stage, archive);
    const fingerprint = await verifyRuntime(root, archive, '1.4.0');
    assert.match(fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(await buildFingerprint(root), fingerprint);
    await writeFile(path.join(root, 'electron', 'desktop-preferences.cjs'), 'changed settings');
    await assert.rejects(verifyRuntime(root, archive, '1.4.0'), /desktop-preferences.cjs/);
    await writeFile(path.join(root, 'electron', 'desktop-preferences.cjs'), 'desktop-preferences.cjs');
    await writeFile(path.join(root, 'build', 'icons', '128x128.png'), 'changed icon');
    await assert.rejects(verifyRuntime(root, archive, '1.4.0'), /tray-icon.png/);
    await writeFile(path.join(root, 'build', 'icons', '128x128.png'), 'icon');
    await assert.rejects(verifyRuntime(root, archive, '1.3.0'), /version/);
    await writeFile(path.join(root, 'dist', 'assets', 'worker.js'), 'new worker');
    await assert.rejects(verifyRuntime(root, archive, '1.4.0'), /worker.js/);
    assert.notEqual(await buildFingerprint(root), fingerprint);
    await writeFile(path.join(root, 'dist', 'assets', 'worker.js'), 'worker');
    await writeFile(path.join(root, 'server', 'model.mjs'), 'changed server');
    await assert.rejects(verifyRuntime(root, archive, '1.4.0'), /server\/model.mjs/);
    await writeFile(path.join(root, 'server', 'model.mjs'), 'server');
    await writeFile(path.join(root, 'electron', 'preload.cjs'), 'new bridge');
    await assert.rejects(verifyRuntime(root, archive, '1.4.0'), /preload.cjs/);
    await writeFile(path.join(stage, 'ssh-node', 'linux-arm64.gz'), gzipSync('changed binary'));
    const corrupted = path.join(root, 'corrupted.asar');
    await createPackage(stage, corrupted);
    await assert.rejects(verifyRuntime(root, corrupted, '1.4.0'), /Invalid bundled SSH Node.js runtime: linux-arm64/);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('devkit-release-check-'));
    await rm(root, { recursive: true, force: true });
  }
});

test('artifact cleanup keeps the two newest versions and removes only managed outputs', async () => {
  const temp = await realpath(tmpdir());
  const fixture = await mkdtemp(path.join(temp, 'devkit-artifact-check-'));
  const artifacts = path.join(fixture, 'artifacts');
  async function put(relative, content = relative) {
    const filename = path.join(artifacts, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, content);
    return filename;
  }
  try {
    const recent = await put('release-1.10.0/DevKit_1.10.0_x64-setup.exe', 'current binary');
    await put('release-1.10.0/DevKit_1.10.0_x64-setup.exe.build.json', 'current receipt');
    const previous = await put('linux-arm64/DevKit_1.9.0-1_arm64.deb');
    const prerelease = await put('release-1.10.0-rc.1/DevKit_ProjectCenter_1.10.0-rc.1_node24.zip');
    const old = await put('release-1.8.0/DevKit_ProjectCenter_1.8.0_node24.zip');
    const oldBackup = await put('previous-release-1.8.0-20261117-130000/DevKit_ProjectCenter_1.8.0_node24.zip');
    const duplicate = await put('windows-x64/DevKit_1.10.0_x64-setup.exe', 'current binary');
    await put('windows-x64/DevKit_1.10.0_x64-setup.exe.build.json', 'current receipt');
    const unrelated = await put('windows-x64/custom-tools.exe');
    const unknownReleaseFile = await put('release-1.4.0/my-notes.txt');
    const portableData = await put('release-1.3.0/DevKit-win32-x64/configs/projects.json');
    const work = await put('desktop-runtime/DevKit-win32-x64/resources/app.asar');
    const testData = await put('project-server-check-AbC789/first/configs/projects.json');
    const unrecognizedVersion = await put('release-99.0.0/notes.txt');
    const options = { directory: fixture, includeWork: true, deduplicate: true };
    const preview = await cleanArtifacts({ ...options, dryRun: true });
    assert.deepEqual(preview.kept, ['1.10.0', '1.10.0-rc.1']);
    await readFile(old);
    const result = await cleanArtifacts(options);
    assert.deepEqual(result, preview);
    for (const filename of [previous, old, oldBackup, duplicate, work, testData]) {
      await assert.rejects(readFile(filename), { code: 'ENOENT' });
    }
    for (const filename of [recent, prerelease, unrelated, unknownReleaseFile, portableData, unrecognizedVersion]) await readFile(filename);
    assert.deepEqual((await cleanArtifacts(options)).removed, []);

    const linked = path.join(fixture, 'linked-project');
    await mkdir(linked);
    await symlink(artifacts, path.join(linked, 'artifacts'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(cleanArtifacts({ directory: linked }), /Unsafe artifacts directory/);
  } finally {
    const resolved = await realpath(fixture);
    assert.equal(path.relative(temp, path.dirname(resolved)), '');
    assert.ok(path.basename(resolved).startsWith('devkit-artifact-check-'));
    await rm(fixture, { recursive: true, force: true });
  }
});
