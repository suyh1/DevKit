import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function prepareDesktop(platform, arch, stageRoot = path.join(root, 'artifacts', 'desktop-staging')) {
  if (!['win32', 'linux', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Unsupported desktop target');
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const staging = path.resolve(stageRoot, `${platform}-${arch}`);
  const relative = path.relative(stageRoot, staging);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe staging directory');
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await cp(path.join(root, 'LICENSE'), path.join(staging, 'LICENSE'));
  await cp(path.join(root, 'docs', 'apache-guacamole-license.md'), path.join(staging, 'apache-guacamole-license.md'));
  for (const name of ['main.cjs', 'preload.cjs', 'policy.cjs', 'desktop-preferences.cjs', 'direct-save.cjs', 'security.json']) await cp(path.join(root, 'electron', name), path.join(staging, name));
  await cp(path.join(root, 'build', 'icons', '128x128.png'), path.join(staging, 'tray-icon.png'));
  for (const name of ['server', 'shared']) await cp(path.join(root, name), path.join(staging, name), { recursive: true, filter: filename => !/\.(?:check|test)\.m?[jt]s$|\.d\.mts$/.test(filename) });
  const packages = JSON.parse(await readFile(new URL('./server-runtime.json', import.meta.url), 'utf8'));
  const serialPackages = ['@serialport/bindings-cpp', '@serialport/stream', '@serialport/bindings-interface', '@serialport/parser-readline', '@serialport/parser-delimiter', 'node-gyp-build', 'debug', 'ms'];
  for (const name of [...packages, ...serialPackages]) {
    const source = path.join(root, 'node_modules', name);
    const excluded = new Set(['node_modules', 'test', 'examples', 'prebuilds']);
    const metadata = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
    if (!/^(?:\.\/)?build\//.test(metadata.main || '')) excluded.add('build');
    await cp(source, path.join(staging, 'node_modules', name), { recursive: true, filter: filename => !path.relative(source, filename).split(path.sep).some(part => excluded.has(part) || part.endsWith('.node')) });
  }
  const prebuild = path.join('node_modules', '@serialport', 'bindings-cpp', 'prebuilds', platform === 'darwin' ? 'darwin-x64+arm64' : `${platform}-${arch}`);
  await cp(path.join(root, prebuild), path.join(staging, prebuild), { recursive: true });
  await cp(path.join(root, 'dist'), path.join(staging, 'dist'), { recursive: true });
  await (await import('./stage-ssh-node.mjs')).stageSshNode(path.join(staging, 'ssh-node'));
  await writeFile(path.join(staging, 'package.json'), JSON.stringify({ name: 'devkit', productName: 'DevKit', version: manifest.version, main: 'main.cjs', description: manifest.description, author: manifest.author, license: manifest.license }, null, 2));
  return { manifest, staging };
}
