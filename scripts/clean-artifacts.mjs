import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, realpath, rm, rmdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './desktop-files.mjs';

const versionPattern = '(\\d+\\.\\d+\\.\\d+(?:-[\\da-zA-Z.-]+)?)';
const releasePattern = new RegExp(`^release-${versionPattern}$`);
const backupPattern = new RegExp(`^previous-release-${versionPattern}-\\d{8}-\\d{6}$`);
const packagePattern = new RegExp(`^DevKit_${versionPattern}(?:_(x64|arm64)-setup\\.exe|-1_(amd64|arm64)\\.deb)$`);
const targetPattern = /^(windows|linux)-(x64|arm64)$/;
const workDirectories = new Set(['desktop-runtime', 'desktop-staging', 'electron-smoke', 'generated-java', 'portal-regression', 'sharing-smoke']);
const targetMetadata = new Set(['docs', 'README.md', 'LICENSE', 'runtime-report.json', 'SHA256SUMS']);
const builderFiles = new Set(['builder-debug.yml', 'builder-effective-config.yaml', 'latest.yml']);
const releaseMetadata = new Set([...targetMetadata, 'ALL-SHA256SUMS', 'PROJECT-SERVER-SHA256SUMS', 'release.json', 'project-server.json', 'project-server-verification.json']);

function compareNumeric(left, right) {
  const a = BigInt(left), b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareVersions(left, right) {
  const parse = version => version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/).slice(1);
  const [aMajor, aMinor, aPatch, aPre] = parse(left);
  const [bMajor, bMinor, bPatch, bPre] = parse(right);
  const core = compareNumeric(aMajor, bMajor) || compareNumeric(aMinor, bMinor) || compareNumeric(aPatch, bPatch);
  if (core || aPre === bPre) return core;
  if (!aPre || !bPre) return aPre ? -1 : 1;
  const a = aPre.split('.'), b = bPre.split('.');
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] === b[index]) continue;
    const aNumeric = /^\d+$/.test(a[index]), bNumeric = /^\d+$/.test(b[index]);
    if (aNumeric && bNumeric) return compareNumeric(a[index], b[index]);
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a[index] < b[index] ? -1 : 1;
  }
  return a.length - b.length;
}

function packageVersion(folder, name) {
  const match = name.match(packagePattern);
  if (!match) return undefined;
  const [, version, windowsArch, debArch] = match;
  const expected = windowsArch ? `windows-${windowsArch}` : `linux-${debArch === 'amd64' ? 'x64' : debArch}`;
  return folder === expected ? version : undefined;
}

function isReleaseOutput(entry, version) {
  return entry.isFile() && (entry.name.match(packagePattern)?.[1] === version
    || entry.name === `DevKit_ProjectCenter_${version}_node24.zip`)
    || entry.isDirectory() && /^DevKit-(win32|linux)-(x64|arm64)$/.test(entry.name);
}

function isReleaseMetadata(entry, version) {
  if (releaseMetadata.has(entry.name)) return !entry.isSymbolicLink();
  return entry.isFile() && entry.name.replace(/\.(build\.json|blockmap)$/, '').match(packagePattern)?.[1] === version;
}

async function maybeRead(filename) {
  try { return await readFile(filename, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function digest(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

async function containsPortableData(filename) {
  const entries = await readdir(filename, { withFileTypes: true, recursive: true });
  return entries.some(entry => !entry.isFile() && ['configs', 'data'].includes(entry.name.toLowerCase()));
}

export async function cleanArtifacts({ directory = root, includeWork = false, deduplicate = false, dryRun = false } = {}) {
  const project = await realpath(directory);
  const base = path.join(project, 'artifacts');
  const info = await lstat(base).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!info) return { kept: [], removed: [], protectedPaths: [] };
  if (!info.isDirectory() || path.relative(base, await realpath(base))) throw new Error('Unsafe artifacts directory');

  async function inside(filename) {
    const relative = path.relative(base, await realpath(filename));
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Unsafe cleanup path: ${filename}`);
  }

  const removed = [];
  const protectedPaths = [];
  async function remove(filename, protectPortableData = false) {
    const entry = await lstat(filename).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!entry || entry.isSymbolicLink()) return;
    await inside(filename);
    if (protectPortableData && entry.isDirectory() && await containsPortableData(filename)) {
      protectedPaths.push(path.relative(project, filename));
      return;
    }
    removed.push(path.relative(project, filename));
    if (!dryRun) await rm(filename, { recursive: entry.isDirectory(), force: true, maxRetries: 2 });
  }

  const entries = await readdir(base, { withFileTypes: true });
  const releases = new Map();
  const targets = [];
  const versions = new Set();
  for (const entry of entries.filter(item => item.isDirectory())) {
    const version = entry.name.match(releasePattern)?.[1] ?? entry.name.match(backupPattern)?.[1];
    const filename = path.join(base, entry.name);
    if (version) {
      await inside(filename);
      const files = await readdir(filename, { withFileTypes: true });
      if (files.some(item => isReleaseOutput(item, version))) versions.add(version);
      releases.set(entry.name, { version, files });
    } else if (targetPattern.test(entry.name)) {
      await inside(filename);
      const files = await readdir(filename, { withFileTypes: true });
      const packages = files.filter(file => file.isFile() && packageVersion(entry.name, file.name));
      for (const file of packages) versions.add(packageVersion(entry.name, file.name));
      targets.push({ folder: entry.name, filename, files, packages });
    }
  }

  const kept = [...versions].sort((left, right) => compareVersions(right, left)).slice(0, 2);
  for (const [name, { version, files }] of releases) {
    if (kept.includes(version)) continue;
    if (files.every(item => isReleaseOutput(item, version) || isReleaseMetadata(item, version))) await remove(path.join(base, name), true);
    else protectedPaths.push(path.relative(project, path.join(base, name)));
  }

  for (const target of targets) {
    const deleted = new Set();
    for (const file of target.packages) {
      const version = packageVersion(target.folder, file.name);
      const filename = path.join(target.filename, file.name);
      const duplicate = path.join(base, `release-${version}`, file.name);
      const receipt = `${file.name}.build.json`;
      let redundant = !kept.includes(version);
      if (!redundant && deduplicate && releases.has(`release-${version}`)) {
        await inside(path.dirname(duplicate));
        const aggregateFiles = releases.get(`release-${version}`).files;
        if ([file.name, receipt].every(name => aggregateFiles.some(entry => entry.isFile() && entry.name === name))
            && target.files.some(entry => entry.isFile() && entry.name === receipt)) {
          redundant = await maybeRead(`${duplicate}.build.json`) === await maybeRead(`${filename}.build.json`)
            && await digest(duplicate) === await digest(filename);
        }
      }
      if (!redundant) continue;
      await remove(filename);
      await remove(`${filename}.build.json`);
      deleted.add(file.name);
    }
    for (const file of target.files.filter(item => item.isFile())) {
      if (builderFiles.has(file.name) || (file.name.endsWith('.blockmap') && packageVersion(target.folder, file.name.slice(0, -9)))) await remove(path.join(target.filename, file.name));
    }
    const remaining = target.packages.filter(file => !deleted.has(file.name));
    if (!remaining.length) {
      for (const file of target.files.filter(item => targetMetadata.has(item.name))) await remove(path.join(target.filename, file.name));
      if (!dryRun && !(await readdir(target.filename)).length) {
        await inside(target.filename);
        await rmdir(target.filename);
      }
    } else if ((deleted.size || remaining.length > 1) && !dryRun) {
      const hashes = [];
      for (const file of remaining) hashes.push(`${await digest(path.join(target.filename, file.name))}  ${file.name}`);
      const checksums = path.join(target.filename, 'SHA256SUMS');
      if (!target.files.some(file => file.name === 'SHA256SUMS' && !file.isFile())) await writeFile(checksums, `${hashes.join('\n')}\n`);
    }
  }

  if (includeWork) {
    for (const entry of entries) {
      const generated = workDirectories.has(entry.name) || /^(desktop-package|project-server-check|nsis-configs)-[\da-zA-Z]{6}$/.test(entry.name);
      if ((entry.isDirectory() && generated) || (entry.isFile() && entry.name === 'configs-installer-verification.json')) {
        await remove(path.join(base, entry.name), ['desktop-runtime', 'desktop-staging'].includes(entry.name));
      }
    }
  }
  return { kept, removed, protectedPaths };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--dry-run' && arg !== '--retention-only')) throw new Error('Supported options: --dry-run, --retention-only');
  const full = !args.includes('--retention-only');
  const { kept, removed, protectedPaths } = await cleanArtifacts({ includeWork: full, deduplicate: full, dryRun: args.includes('--dry-run') });
  for (const filename of removed) console.log(`${args.includes('--dry-run') ? 'Would remove' : 'Removed'} ${filename}`);
  for (const filename of protectedPaths) console.log(`Preserved data or unrecognized files in ${filename}`);
  console.log(`Kept package versions: ${kept.join(', ') || 'none'}`);
}
