import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { updateReadme } from './update-readme.mjs';
import { root } from './desktop-files.mjs';

const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const template = await readFile(path.join(root, 'docs/README.template.md'), 'utf8');
const execute = promisify(execFile);
const tool = (id, name, description = '本地转换') => ({ id, name, description });
const category = ids => [{ name: '测试分类', description: '测试用途', ids }];

async function fixture(run, projectLocal = false) {
  const parent = projectLocal ? path.join(root, 'artifacts') : tmpdir();
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'devkit-readme-'));
  try {
    await mkdir(path.join(directory, 'src'));
    await mkdir(path.join(directory, 'docs'));
    await writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest));
    await writeFile(path.join(directory, 'docs/README.template.md'), template);
    await writeFile(path.join(directory, 'src/workbench.ts'), 'export const MAX_TASKS = 12;');
    await writeFile(path.join(directory, 'src/catalog.ts'), `export const categories = ${JSON.stringify(category(['one', 'two']))};`);
    // Exercise real imported/spread definitions rather than extracting text with regexes.
    await writeFile(path.join(directory, 'src/more.ts'), `export const more = ${JSON.stringify([tool('two', '旧工具')])};`);
    await writeFile(path.join(directory, 'src/tools.ts'), `import { more } from './more'; export const tools = [${JSON.stringify(tool('one', '首个工具'))}, ...more];`);
    await run(directory);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(parent));
    assert.ok(path.basename(directory).startsWith('devkit-readme-'));
    await rm(directory, { recursive: true, force: true });
  }
}

test('README follows added/removed/renamed tools, categories, descriptions, version and task limits', async () => fixture(async directory => {
  await assert.rejects(updateReadme({ directory, check: true }), /docs:update/);
  assert.equal(await updateReadme({ directory }), true);
  const filename = path.join(directory, 'README.md');
  assert.match(await readFile(filename, 'utf8'), /2 个离线工具/);
  const before = await stat(filename, { bigint: true });
  assert.equal(await updateReadme({ directory }), false);
  assert.equal(await updateReadme({ directory, check: true }), false);
  assert.equal((await stat(filename, { bigint: true })).mtimeNs, before.mtimeNs);

  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ ...manifest, version: '9.8.7', devDependencies: { ...manifest.devDependencies, electron: '99.0.0' } }));
  await writeFile(path.join(directory, 'src/workbench.ts'), 'export const MAX_TASKS = 3;');
  await writeFile(path.join(directory, 'src/more.ts'), `export const more = ${JSON.stringify([tool('two', '重命名工具', '甲 | 乙\n<script> & {{host}}'), tool('three', '新增工具')])};`);
  await writeFile(path.join(directory, 'src/tools.ts'), "export { more as tools } from './more';");
  await writeFile(path.join(directory, 'src/catalog.ts'), `export const categories = ${JSON.stringify(category(['three', 'two']))};`);
  const old = await readFile(filename, 'utf8');
  await assert.rejects(updateReadme({ directory, check: true }), /docs:update/);
  assert.equal(await readFile(filename, 'utf8'), old);
  await updateReadme({ directory });
  const current = await readFile(filename, 'utf8');
  assert.match(current, /DevKit_9\.8\.7_x64-setup\.exe/);
  assert.match(current, /DevKit_9\.8\.7-1_arm64\.deb/);
  assert.match(current, /release-9\.8\.7/);
  assert.match(current, /Electron 99\.0\.0/);
  assert.match(current, /最多 3 个任务/);
  assert.match(current, /甲 &#124; 乙<br>&lt;script&gt; &amp; \{\{host\}\}/);
  assert.ok(current.indexOf('| 新增工具 |') < current.indexOf('| 重命名工具 |'));
  assert.doesNotMatch(current, /首个工具|旧工具/);
}));

test('incomplete or ambiguous registries fail without replacing the previous README', async () => fixture(async directory => {
  await updateReadme({ directory });
  const filename = path.join(directory, 'README.md');
  const previous = await readFile(filename, 'utf8');
  for (const ids of [['one'], ['one', 'two', 'two'], ['one', 'missing']]) {
    await writeFile(path.join(directory, 'src/catalog.ts'), `export const categories = ${JSON.stringify(category(ids))};`);
    await assert.rejects(updateReadme({ directory }), /README/);
    assert.equal(await readFile(filename, 'utf8'), previous);
  }
}));

test('unknown template tokens and missing packaging commands stop generation', async () => fixture(async directory => {
  await writeFile(path.join(directory, 'docs/README.template.md'), '{{MISSPELLED_TOKEN}}');
  await assert.rejects(updateReadme({ directory }), /MISSPELLED_TOKEN/);
  await writeFile(path.join(directory, 'docs/README.template.md'), template);
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ ...manifest, scripts: {} }));
  await assert.rejects(updateReadme({ directory }), /打包命令不存在/);
}));

test('checked-in README matches the actual application registry and current template', async () => {
  assert.equal(await updateReadme({ check: true }), false);
});

async function copyPackagingScripts(directory) {
  await mkdir(path.join(directory, 'scripts'));
  for (const name of ['desktop-files.mjs', 'release-integrity.mjs', 'update-readme.mjs', 'package-desktop.mjs', 'package-all.mjs', 'package-project-server.mjs', 'package-project-server.py']) {
    await cp(path.join(root, 'scripts', name), path.join(directory, 'scripts', name));
  }
}

test('direct desktop and collect-only entrypoints refresh README and block on invalid features before packaging', async () => fixture(async directory => {
  await copyPackagingScripts(directory);
  for (const args of [
    ['scripts/package-desktop.mjs', '--platform=unsupported', '--format=dir'],
    ['scripts/package-all.mjs', '--collect-only'],
  ]) {
    const filename = path.join(directory, 'README.md');
    await writeFile(filename, 'stale');
    // Deliberately stop after the documentation hook: no runtime downloads or builds.
    await assert.rejects(execute(process.execPath, args, { cwd: directory, windowsHide: true }), error => {
      assert.match(error.stderr, args[0].includes('desktop') ? /Unsupported desktop target/ : /ENOENT/);
      return true;
    });
    assert.match(await readFile(filename, 'utf8'), /2 个离线工具/);
    await writeFile(filename, 'keep previous README');
    await writeFile(path.join(directory, 'src/catalog.ts'), 'export const categories = [];');
    await assert.rejects(execute(process.execPath, args, { cwd: directory, windowsHide: true }), error => {
      assert.match(error.stderr, /README 工具注册表为空/);
      return true;
    });
    assert.equal(await readFile(filename, 'utf8'), 'keep previous README');
    await writeFile(path.join(directory, 'src/catalog.ts'), `export const categories = ${JSON.stringify(category(['one', 'two']))};`);
  }
}, true));

test('Node wrapper and direct Python server packager ship the freshly generated README and guides', async context => {
  const python = process.env.DEVKIT_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  try { await execute(python, ['--version'], { windowsHide: true }); }
  catch { context.skip('Python unavailable; set DEVKIT_PYTHON to exercise ZIP packaging'); return; }
  await fixture(async directory => {
    await copyPackagingScripts(directory);
    for (const folder of ['dist/.vite', 'server', 'shared']) await mkdir(path.join(directory, folder), { recursive: true });
    await writeFile(path.join(directory, 'dist/portal.html'), '<!doctype html><title>Fixture</title>');
    await writeFile(path.join(directory, 'dist/.vite/manifest.json'), JSON.stringify({ 'portal.html': { file: 'portal.html' } }));
    await writeFile(path.join(directory, 'docs/project-center.md'), '# Fixture guide');
    for (const [command, args] of [
      [process.execPath, ['scripts/package-project-server.mjs']],
      [python, ['scripts/package-project-server.py']],
    ]) {
      await writeFile(path.join(directory, 'README.md'), 'outdated');
      await execute(command, args, { cwd: directory, windowsHide: true, env: { ...process.env, DEVKIT_PYTHON: python, DEVKIT_NODE: process.execPath } });
      const release = path.join(directory, `artifacts/release-${manifest.version}`);
      const expected = await readFile(path.join(directory, 'README.md'), 'utf8');
      assert.match(expected, /2 个离线工具/);
      assert.equal(await readFile(path.join(release, 'README.md'), 'utf8'), expected);
      assert.equal(await readFile(path.join(release, 'docs/project-center.md'), 'utf8'), '# Fixture guide');
      const { stdout } = await execute(python, ['-c',
        'import sys,zipfile,json\nfrom pathlib import Path\nroot=Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2]) as z:\n assert z.read("README.md")== (root/"README.md").read_bytes()\n assert z.read("docs/project-center.md")== (root/"docs/project-center.md").read_bytes()\n assert "docs/README.template.md" not in z.namelist()\n assert "dist/index.html" not in z.namelist()\n assert z.testzip() is None\nprint("ZIP verified")',
        directory, path.join(release, `DevKit_ProjectCenter_${manifest.version}_node24.zip`),
      ], { windowsHide: true });
      assert.match(stdout, /ZIP verified/);
    }
  }, true);
});
