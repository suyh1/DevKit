import { execFileSync } from 'node:child_process';
import { access, readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { root } from './desktop-files.mjs';
import { buildFingerprint, releaseTargets, validateIdentity } from './release-integrity.mjs';
import { copyReadme, updateReadme } from './update-readme.mjs';
import { cleanArtifacts } from './clean-artifacts.mjs';

const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const collectOnly = process.argv.includes('--collect-only');
if (process.argv.slice(2).some(argument => argument !== '--collect-only')) throw new Error('Supported option: --collect-only (collect already-built current-version packages)');
await updateReadme();
const targets = releaseTargets(manifest.version);
// Build sequentially: electron-builder and runtime staging use shared build caches.
for (const target of collectOnly ? [] : targets) {
  console.log(`Packaging ${target.folder} (${manifest.version})`);
  execFileSync(process.execPath, [path.join(root, 'scripts/package-desktop.mjs'), `--platform=${target.platform}`, `--arch=${target.arch}`, `--format=${target.format}`, '--defer-cleanup'], { cwd: root, stdio: 'inherit', windowsHide: true });
}
const output = path.join(root, 'artifacts', `release-${manifest.version}`);
const buildSha256 = await buildFingerprint(root);
const checksums = [], files = [], sources = [];
for (const target of targets) {
  let source = path.join(root, 'artifacts', target.folder, target.name);
  if (collectOnly) {
    try { await access(source); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      source = path.join(output, target.name);
    }
  }
  const bytes = await readFile(source), sha256 = createHash('sha256').update(bytes).digest('hex');
  const identity = JSON.parse(await readFile(`${source}.build.json`, 'utf8'));
  validateIdentity(identity, target, manifest.version, bytes, buildSha256);
  if (identity.electron !== manifest.devDependencies.electron) throw new Error(`Wrong Electron version: ${target.name}`);
  sources.push({ source, target });
  checksums.push(`${sha256}  ${target.name}`);
  files.push({ target: target.folder, name: target.name, bytes: bytes.length, sha256, buildSha256 });
}
await mkdir(output, { recursive: true });
for (const { source, target } of sources) {
  const destination = path.join(output, target.name);
  if (source === destination) continue;
  await copyFile(source, destination);
  await copyFile(`${source}.build.json`, `${destination}.build.json`);
}
await writeFile(path.join(output, 'SHA256SUMS'), checksums.join('\n') + '\n');
await writeFile(path.join(output, 'release.json'), JSON.stringify({ version: manifest.version, electron: manifest.devDependencies.electron, buildSha256, files }, null, 2) + '\n');
await copyReadme(output);
await cleanArtifacts({ deduplicate: true });
console.log(`All packages and SHA256SUMS: ${output}`);
