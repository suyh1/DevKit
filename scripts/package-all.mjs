import { execFileSync } from 'node:child_process';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { root } from './desktop-files.mjs';
import { releaseTargets, validateIdentity, verifyRuntime } from './release-integrity.mjs';
import { copyReadme, updateReadme } from './update-readme.mjs';

const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const collectOnly = process.argv.includes('--collect-only');
if (process.argv.slice(2).some(argument => argument !== '--collect-only')) throw new Error('Supported option: --collect-only (collect already-built current-version packages)');
await updateReadme();
const targets = releaseTargets(manifest.version);
// Build sequentially: electron-builder and runtime staging use shared build caches.
for (const target of collectOnly ? [] : targets) {
  console.log(`Packaging ${target.folder} (${manifest.version})`);
  execFileSync(process.execPath, [path.join(root, 'scripts/package-desktop.mjs'), `--platform=${target.platform}`, `--arch=${target.arch}`, `--format=${target.format}`], { cwd: root, stdio: 'inherit', windowsHide: true });
}
const output = path.join(root, 'artifacts', `release-${manifest.version}`);
await mkdir(output, { recursive: true });
const checksums = [], files = [];
let commonBuild;
for (const target of targets) {
  const source = path.join(root, 'artifacts', target.folder, target.name);
  const bytes = await readFile(source), sha256 = createHash('sha256').update(bytes).digest('hex');
  const runtime = path.join(root, 'artifacts', 'desktop-runtime', `DevKit-${target.platform}-${target.arch}`, 'resources', 'app.asar');
  const buildSha256 = await verifyRuntime(root, runtime, manifest.version);
  if (commonBuild && commonBuild !== buildSha256) throw new Error('Targets contain different builds');
  commonBuild = buildSha256;
  const identity = JSON.parse(await readFile(`${source}.build.json`, 'utf8'));
  validateIdentity(identity, target, manifest.version, bytes, buildSha256);
  if (identity.electron !== manifest.devDependencies.electron) throw new Error(`Wrong Electron version: ${target.name}`);
  await copyFile(source, path.join(output, target.name));
  checksums.push(`${sha256}  ${target.name}`);
  files.push({ target: target.folder, name: target.name, bytes: bytes.length, sha256, buildSha256 });
}
await writeFile(path.join(output, 'SHA256SUMS'), checksums.join('\n') + '\n');
await writeFile(path.join(output, 'release.json'), JSON.stringify({ version: manifest.version, electron: manifest.devDependencies.electron, buildSha256: commonBuild, files }, null, 2) + '\n');
await copyReadme(output);
console.log(`All packages and SHA256SUMS: ${output}`);
