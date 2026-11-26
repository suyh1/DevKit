import { Client } from 'basic-ftp';
import { createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { webTransferLimit } from './lan-sftp.mjs';

const pendingRenames = new Set();
const validName = name => typeof name === 'string' && !!name && !['.', '..'].includes(name) && !/[\/\\\x00-\x1f\x7f]/.test(name);
function limited() {
  let size = 0;
  return new Transform({ transform(bytes, _encoding, done) {
    size += bytes.length;
    done(size > webTransferLimit ? Object.assign(new Error('网页单个文件最多 128 MiB。'), { status: 413 }) : null, bytes);
  } });
}
export async function openFtp(host, password) {
  const client = new Client(15000);
  try {
    await client.access({ host: host.address, port: host.port, user: host.user, password: password || (host.user === 'anonymous' ? 'guest@' : ''),
      secure: host.ftpSecurity === 'implicit' ? 'implicit' : host.ftpSecurity === 'explicit' });
    if (host.startDirectory) await client.cd(host.startDirectory);
    const home = await client.pwd();
    return { client, home, dispose: () => client.close() };
  } catch (error) { client.close(); throw error; }
}
export async function useFtp(entry, action, value, file) {
  const { client, home } = entry;
  const requested = value?.path || '.';
  if (typeof requested !== 'string' || requested.length > 4096 || /[\x00-\x1f\x7f]/.test(requested)) throw new Error('FTP 路径无效。');
  const target = path.posix.resolve(home, requested);
  if (action === 'file-list') {
    const entries = (await client.list(target)).filter(item => validName(item.name)).map(item => ({
      name: item.name, path: path.posix.join(target, item.name), kind: item.isDirectory ? 'directory' : item.isFile ? 'file' : 'other', size: item.size,
    })).sort((a,b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name));
    return { directory: target, parent: path.posix.dirname(target), entries: entries.slice(0, 1000), truncated: entries.length > 1000 };
  }
  if (!file) throw new Error('请选择本地文件。');
  const web = typeof file === 'object';
  const signal = web ? AbortSignal.any([AbortSignal.timeout(900000), file.signal]) : AbortSignal.timeout(900000);
  const abort = () => client.close();
  signal.throwIfAborted();
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (action === 'file-download') {
      const name = path.posix.basename(target);
      if (web) {
        const bytes = await client.size(target).catch(async error => {
          if (![500, 502, 504].includes(error.code)) throw error;
          const info = (await client.list(path.posix.dirname(target))).find(item => item.name === name && item.isFile);
          if (!info) throw new Error('请选择远程普通文件。');
          return info.size;
        });
        if (bytes > webTransferLimit) throw Object.assign(new Error('网页单个文件最多 128 MiB。'), { status: 413 });
        const stream = limited();
        try { await Promise.all([client.downloadTo(stream, target), file.download(name, stream, signal)]); }
        finally { stream.destroy(); }
      } else {
        const temp = path.join(path.dirname(file), '.devkit-' + randomUUID() + '.part');
        try { await client.downloadTo(createWriteStream(temp, { flags: 'wx', mode: 0o600 }), target); await rename(temp, file); }
        finally { await rm(temp, { force: true }); }
      }
      return { name };
    }
    const name = web ? file.name : path.basename(file);
    if (!validName(name) || (!web && !(await stat(file)).isFile())) throw new Error('请选择普通文件。');
    const exists = async () => (await client.list(target)).some(item => item.name === name);
    if (await exists()) throw new Error('目标目录已有同名文件。');
    const temp = path.posix.join(target, '.devkit-' + randomUUID() + '.part');
    try {
      if (web) {
        const stream = limited();
        try { await Promise.all([pipeline(file.input.iterator({ destroyOnReturn: false }), stream, { signal }), client.uploadFrom(stream, temp)]); }
        finally { stream.destroy(); }
      } else await client.uploadFrom(file, temp);
      const destination = path.posix.join(target, name);
      const key = JSON.stringify([entry.host.address, entry.host.port, destination]);
      if (pendingRenames.has(key)) throw new Error('同名文件正在上传。');
      pendingRenames.add(key);
      try {
        if (await exists()) throw new Error('目标目录已有同名文件。');
        await client.rename(temp, destination);
      } finally { pendingRenames.delete(key); }
    } finally { if (!client.closed) await client.remove(temp, true).catch(() => {}); }
    return { name };
  } finally { signal.removeEventListener('abort', abort); }
}
