import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from './desktop-files.mjs';
import { sha256, releaseTargets } from './release-integrity.mjs';

const current = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const folder = path.resolve(process.argv[2] || path.join(root, 'artifacts', `release-${current.version}`));
const manifest = JSON.parse(await readFile(path.join(folder, 'release.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.version)) throw new Error('Invalid release version');
const targets = releaseTargets(manifest.version);
if (!/^[a-f0-9]{64}$/.test(manifest.buildSha256) || !Array.isArray(manifest.files) || manifest.files.length !== targets.length) throw new Error('Invalid release manifest');
const checksumLines = [];
for (const target of targets) {
  const entries = manifest.files.filter(file => file.name === target.name && file.target === target.folder);
  if (entries.length !== 1) throw new Error(`Missing / duplicate release target: ${target.folder}`);
  const file = entries[0], bytes = await readFile(path.join(folder, target.name));
  if (file.bytes !== bytes.length || file.sha256 !== sha256(bytes) || file.buildSha256 !== manifest.buildSha256) throw new Error(`Release integrity mismatch: ${target.name}`);
  checksumLines.push(`${file.sha256}  ${file.name}`);
  console.log(`Verified ${target.folder}: ${file.name} (${bytes.length} bytes)`);
}
if ((await readFile(path.join(folder, 'SHA256SUMS'), 'utf8')).trim() !== checksumLines.join('\n')) throw new Error('SHA256SUMS differs from release.json');
console.log(`Release ${manifest.version}: three targets verified, shared build ${manifest.buildSha256}`);
