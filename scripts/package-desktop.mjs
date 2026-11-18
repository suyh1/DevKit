import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { root, prepareDesktop } from './desktop-files.mjs';
import { sha256, verifyRuntime } from './release-integrity.mjs';
import { copyReadme, updateReadme } from './update-readme.mjs';
import { cleanArtifacts } from './clean-artifacts.mjs';

const argument = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const platform = argument('platform', process.platform), arch = argument('arch', process.arch), format = argument('format', 'dir');
if (!['dir', 'deb', 'nsis'].includes(format) || format === 'deb' && platform !== 'linux' || format === 'nsis' && platform !== 'win32') throw new Error('Unsupported package format');
await updateReadme();
const artifacts = path.join(await realpath(root), 'artifacts');
await mkdir(artifacts, { recursive: true });
if (!(await lstat(artifacts)).isDirectory() || path.relative(artifacts, await realpath(artifacts))) throw new Error('Unsafe artifacts directory');
const scratch = await mkdtemp(path.join(artifacts, 'desktop-package-'));
try {
  const { manifest, staging } = await prepareDesktop(platform, arch, scratch);
  const localZips = process.env.DEVKIT_ELECTRON_ZIP_DIR;
  if (localZips) {
    const name = `electron-v${manifest.devDependencies.electron}-${platform}-${arch}.zip`;
    const sums = await readFile(path.join(localZips, 'SHASUMS256.txt'), 'utf8');
    const expected = sums.split(/\r?\n/).find(line => line.trim().endsWith(`*${name}`) || line.trim().endsWith(` ${name}`))?.split(/\s+/)[0];
    if (!expected || sha256(await readFile(path.join(localZips, name))) !== expected) throw new Error(`Local Electron ZIP checksum mismatch: ${name}`);
    console.log(`Verified local Electron ZIP: ${name}`);
  }
  const output = format === 'dir'
    ? path.join(artifacts, `release-${manifest.version}`)
    : process.env.DEVKIT_KEEP_PACKAGE_RUNTIME === '1'
      ? path.join(artifacts, 'desktop-runtime')
      : path.join(scratch, 'runtime');
  await mkdir(output, { recursive: true });
  if (!(await lstat(output)).isDirectory() || path.relative(output, await realpath(output))) throw new Error('Unsafe runtime output directory');
  const runtime = path.join(output, `DevKit-${platform}-${arch}`);
  const existing = await lstat(runtime).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (existing && (!existing.isDirectory() || path.relative(runtime, await realpath(runtime)))) throw new Error('Unsafe runtime replacement');
  const [destination] = await packager({
    dir: staging, out: output, name: 'DevKit',
    executableName: 'devkit', platform, arch, electronVersion: manifest.devDependencies.electron,
    ...(localZips ? { electronZipDir: localZips } : {}),
    ...(platform === 'win32' ? { icon: path.join(root, 'build', 'icons', 'icon.ico') } : {}),
    asar: true, prune: false, overwrite: true,
  });
  const buildSha256 = await verifyRuntime(root, path.join(destination, 'resources', 'app.asar'), manifest.version);
  await copyReadme(destination, 'LICENSE-DevKit');
  if (format === 'deb') {
    const python = process.env.DEVKIT_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    execFileSync(python, [path.join(root, 'scripts', 'make-deb.py'), destination, manifest.version, arch, '--defer-cleanup'], { stdio: 'inherit', cwd: root });
  } else if (format === 'nsis') {
    const { build, Platform, Arch } = await import('electron-builder');
    await build({ publish: 'never', prepackaged: destination, targets: Platform.WINDOWS.createTarget(['nsis'], arch === 'arm64' ? Arch.arm64 : Arch.x64), config: {
      appId: 'io.devkit.desktop', productName: 'DevKit', directories: { output: path.join(root, 'artifacts', `windows-${arch}`), buildResources: path.join(root, 'build') },
      artifactName: 'DevKit_${version}_${arch}-setup.${ext}', npmRebuild: false,
      win: { icon: path.join(root, 'build', 'icons', 'icon.ico') },
      nsis: { oneClick: false, perMachine: false, differentialPackage: false, useZip: true, allowToChangeInstallationDirectory: true, installerLanguages: ['zh_CN', 'en_US'], include: path.join(root, 'build/preserve-configs.nsh') },
    } });
    const name = `DevKit_${manifest.version}_${arch}-setup.exe`;
    const checksum = sha256(await readFile(path.join(root, 'artifacts', `windows-${arch}`, name)));
    await writeFile(path.join(root, 'artifacts', `windows-${arch}`, 'SHA256SUMS'), `${checksum}  ${name}\n`);
  } else console.log(`Desktop app: ${destination}`);
  if (format !== 'dir') {
    const folder = path.join(root, 'artifacts', `${platform === 'win32' ? 'windows' : 'linux'}-${arch}`);
    await copyReadme(folder);
    const name = format === 'nsis' ? `DevKit_${manifest.version}_${arch}-setup.exe` : `DevKit_${manifest.version}-1_${arch === 'x64' ? 'amd64' : 'arm64'}.deb`;
    const bytes = await readFile(path.join(folder, name));
    await writeFile(path.join(folder, `${name}.build.json`), JSON.stringify({ version: manifest.version, electron: manifest.devDependencies.electron, platform, arch, format, name, bytes: bytes.length, sha256: sha256(bytes), buildSha256 }, null, 2) + '\n');
  }
} finally {
  const resolved = await realpath(scratch);
  if (path.relative(artifacts, path.dirname(resolved)) || !path.basename(resolved).startsWith('desktop-package-')) throw new Error('Unsafe desktop package directory');
  await rm(scratch, { recursive: true, force: true, maxRetries: 2 });
}
if (!process.argv.includes('--defer-cleanup')) await cleanArtifacts();
