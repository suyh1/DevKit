import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function prepareDesktop(platform, arch) {
  if (!['win32', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Unsupported desktop target');
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const staging = path.resolve(root, 'artifacts', 'desktop-staging', `${platform}-${arch}`);
  const relative = path.relative(path.join(root, 'artifacts', 'desktop-staging'), staging);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe staging directory');
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  for (const name of ['main.cjs', 'preload.cjs', 'policy.cjs', 'security.json']) await cp(path.join(root, 'electron', name), path.join(staging, name));
  for (const name of ['server', 'shared']) await cp(path.join(root, name), path.join(staging, name), { recursive: true, filter: filename => !/\.(?:check|test)\.m?[jt]s$|\.d\.mts$/.test(filename) });
  await cp(path.join(root, 'dist'), path.join(staging, 'dist'), { recursive: true });
  await writeFile(path.join(staging, 'package.json'), JSON.stringify({ name: 'devkit', productName: 'DevKit', version: manifest.version, main: 'main.cjs', description: 'Offline developer workbench with bundled Chromium', author: 'DevKit maintainers' }, null, 2));
  return { manifest, staging };
}
