import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createGzip, createGunzip } from 'node:zlib';
import { sshNodeCache, sshNodeRuntimes, sshNodeVersion } from '../server/ssh-node-runtimes.mjs';

const execute = promisify(execFile);
async function digest(file, compressed = false) {
  const hash = createHash('sha256');
  const stages = [createReadStream(file)];
  if (compressed) stages.push(createGunzip());
  await pipeline(...stages, hash);
  return hash.digest('hex');
}

async function prepare(cache, target, release) {
  const binary = path.join(cache, `${target}.gz`), license = path.join(cache, `${target}.LICENSE`);
  const verified = async () => (await digest(binary, true)) === release.sha256 && (await digest(license)) === release.licenseHash;
  if (await verified().catch(() => false)) return;

  const archiveName = `node-v${sshNodeVersion}-${release.archive}`;
  const dist = process.env.DEVKIT_SSH_NODE_DIST_DIR;
  const scratch = await mkdtemp(path.join(cache, '.prepare-'));
  try {
    const archive = dist ? path.resolve(dist, archiveName) : path.join(scratch, archiveName);
    if (!dist) {
      const response = await fetch(`https://nodejs.org/dist/v${sshNodeVersion}/${archiveName}`, { redirect: 'error', signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw new Error(`Node.js ${archiveName} 下载失败 (${response.status})`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, { flags: 'wx' }));
    }
    if (await digest(archive) !== release.archiveHash) throw new Error(`Node.js 发布归档校验失败: ${archiveName}`);
    const folder = archiveName.replace(/\.(?:tar\.xz|zip)$/, '');
    const entries = [`${folder}/${release.binary}`, `${folder}/LICENSE`];
    if (archiveName.endsWith('.zip') && process.platform !== 'win32') {
      await execute('unzip', ['-qq', archive, ...entries, '-d', scratch]);
    } else {
      await execute('tar', ['-xf', archive, '-C', scratch, ...entries], { windowsHide: true });
    }
    const executable = path.join(scratch, folder, release.binary);
    const extractedLicense = path.join(scratch, folder, 'LICENSE');
    if (await digest(executable) !== release.sha256 || await digest(extractedLicense) !== release.licenseHash) throw new Error(`Node.js 文件校验失败: ${target}`);
    const compressed = path.join(scratch, `${target}.gz`);
    await pipeline(createReadStream(executable), createGzip({ level: 6 }), createWriteStream(compressed, { flags: 'wx' }));
    try { await rename(extractedLicense, license); await rename(compressed, binary); }
    catch (error) { if (!await verified().catch(() => false)) throw error; }
  } finally {
    const resolved = await realpath(scratch);
    if (path.dirname(resolved) !== cache || !path.basename(resolved).startsWith('.prepare-')) throw new Error('Unsafe SSH Node build directory');
    await rm(resolved, { recursive: true, force: true, maxRetries: 2 });
  }
}

export async function stageSshNode(destination) {
  const cache = await mkdir(sshNodeCache, { recursive: true, mode: 0o700 }).then(() => realpath(sshNodeCache));
  const results = await Promise.allSettled(Object.entries(sshNodeRuntimes).map(([target, release]) => prepare(cache, target, release)));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  if (!destination) return;
  await mkdir(destination, { recursive: true });
  for (const target of Object.keys(sshNodeRuntimes)) {
    for (const filename of [`${target}.gz`, `${target}.LICENSE`]) {
      const target = path.join(destination, filename);
      const temporary = `${target}.${randomUUID()}.tmp`;
      try { await copyFile(path.join(cache, filename), temporary); await rename(temporary, target); }
      finally { await rm(temporary, { force: true }); }
    }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await stageSshNode(process.argv[2]);
}
