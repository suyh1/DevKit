import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';

export const sshNodeVersion = '24.22.3';
const linuxLicense = '5888dbb9a1d2b18f2c3e6c5f6af1b39de658372b402a0577b002777f14c62ace';

// Node.js release SHASUMS256.txt and the hashes of the files extracted from those archives.
export const sshNodeRuntimes = {
  'win32-x64': {
    archive: 'win-x64.zip', binary: 'node.exe',
    archiveHash: 'e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f',
    sha256: '86fc4785327db5f5c7558dc6156c543b433c313e813a222e088086222ab4afa6',
    licenseHash: 'ed34dd8e3f0a78dbaf00d0444ce8e285b015b765379c2e17880455f70370f8e9',
  },
  'linux-x64': {
    archive: 'linux-x64.tar.xz', binary: 'bin/node',
    archiveHash: '4f2b175a6d53a5c617a80dba2676238a0688cef28c6da4eba35c7d844e66fcfb',
    sha256: 'a7ec1b37e6ff9d187e4198c5b6df9a4eb1c74dd31804fb3bac55cc4ceca1ac01', licenseHash: linuxLicense,
  },
  'linux-arm64': {
    archive: 'linux-arm64.tar.xz', binary: 'bin/node',
    archiveHash: '6e51a2ada00f0011cc266f65d98922b403d7ad88f809ca2aa615a5fe1ce6e86c',
    sha256: '8f9c2a55879e9705cb285b6cdd649d95df642c6720f052cb30f300d2677da99f', licenseHash: linuxLicense,
  },
};

export const sshNodeCache = path.resolve(process.platform === 'win32'
  ? process.env.LOCALAPPDATA || homedir()
  : process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache'), 'devkit', 'ssh-node', sshNodeVersion);
const bundled = fileURLToPath(new URL('../ssh-node/', import.meta.url));

export async function sshNodeAsset(target) {
  if (!Object.hasOwn(sshNodeRuntimes, target)) return null;
  for (const folder of [bundled, sshNodeCache]) {
    const file = path.join(folder, `${target}.gz`);
    const info = await stat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (info?.isFile() && info.size > 0) {
      return { ...sshNodeRuntimes[target], stream: () => {
        const source = createReadStream(file), gunzip = createGunzip();
        source.on('error', error => gunzip.destroy(error));
        gunzip.once('close', () => source.destroy());
        return source.pipe(gunzip);
      } };
    }
  }
  throw new Error(`当前 DevKit 缺少 ${target} 的便携 Node.js v${sshNodeVersion}。请使用完整发行包，源码环境可运行 npm run prepare:ssh-node。`);
}
