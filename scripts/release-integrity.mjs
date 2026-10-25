import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { extractFile } from '@electron/asar';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function releaseTargets(version) {
  return [
    { platform: 'win32', arch: 'x64', format: 'nsis', folder: 'windows-x64', name: `DevKit_${version}_x64-setup.exe` },
    { platform: 'linux', arch: 'x64', format: 'deb', folder: 'linux-x64', name: `DevKit_${version}-1_amd64.deb` },
    { platform: 'linux', arch: 'arm64', format: 'deb', folder: 'linux-arm64', name: `DevKit_${version}-1_arm64.deb` },
  ];
}
export async function verifyRuntime(root, archive, version) {
  const files = [];
  async function walk(folder, relative = '', prefix = 'dist') {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(folder, entry.name), name, prefix);
      else if (entry.isFile() && !/\.(?:check|test)\.m?[jt]s$|\.d\.mts$/.test(name)) files.push({ source: path.join(folder, entry.name), archive: `${prefix}/${name}` });
      else if (entry.isFile()) continue;
      else throw new Error(`Unsupported build input: ${entry.name}`);
    }
  }
  await walk(path.join(root, 'dist'));
  for (const folder of ['server', 'shared']) {
    try { await walk(path.join(root, folder), '', folder); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const name of ['main.cjs', 'preload.cjs', 'policy.cjs', 'desktop-preferences.cjs', 'security.json']) files.push({ source: path.join(root, 'electron', name), archive: name });
  files.push({ source: path.join(root, 'build', 'icons', '128x128.png'), archive: 'tray-icon.png' });
  const packaged = JSON.parse(extractFile(archive, 'package.json').toString('utf8'));
  if (packaged.version !== version) throw new Error(`Stale runtime version: ${archive}`);
  const hashes = [];
  for (const file of files.sort((a, b) => a.archive.localeCompare(b.archive, 'en'))) {
    const expected = sha256(await readFile(file.source));
    if (sha256(extractFile(archive, file.archive.split('/').join(path.sep))) !== expected) throw new Error(`Stale runtime content: ${archive}: ${file.archive}`);
    hashes.push(`${file.archive}\0${expected}`);
  }
  return sha256(hashes.join('\n'));
}
export function validateIdentity(identity, target, version, bytes, buildSha256) {
  if (identity.version !== version || identity.platform !== target.platform || identity.arch !== target.arch || identity.name !== target.name || identity.format !== target.format) throw new Error(`Wrong package identity: ${target.name}`);
  if (identity.buildSha256 !== buildSha256) throw new Error(`Package contains a different build: ${target.name}`);
  if (identity.sha256 !== sha256(bytes) || identity.bytes !== bytes.length) throw new Error(`Package checksum / size mismatch: ${target.name}`);
}
