import { createReadStream, createWriteStream } from 'node:fs';
import { rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { sshCall } from './lan-ssh.mjs';
import { withDeadline } from './lan-probe.mjs';

function remotePath(value, host) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\x00-\x1f]/.test(value)) throw new Error('远程路径无效。');
  if (host.platform !== 'win32') return value.trim();
  return value.trim().replaceAll('\\', '/').replace(/^(\w:)(?=\/|$)/, '/$1');
}

export const webTransferLimit = 128 * 1024 * 1024;

export async function useSftp(client, action, value, host, localFile) {
  const timeout = AbortSignal.timeout(action === 'file-list' ? 15000 : 15 * 60 * 1000);
  const web = typeof localFile === 'object' && localFile;
  const signal = web?.signal ? AbortSignal.any([timeout, web.signal]) : timeout;
  let opening = true;
  const sftp = await withDeadline(sshCall(client, 'sftp').then(channel => {
    if (!opening) channel.end();
    return channel;
  }), 10000, 'SFTP 子系统响应超时').finally(() => { opening = false; });
  const abort = () => sftp.end();
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    const requested = remotePath(value?.path || '.', host);
    const target = await sshCall(sftp, 'realpath', requested);
    if (action === 'file-list') {
      const contents = await sshCall(sftp, 'readdir', target);
      const entries = contents.filter(item => !['.', '..'].includes(item.filename) && !item.filename.includes('/') && !/[\x00-\x1f]/.test(item.filename)).map(item => ({
        name: item.filename, path: path.posix.join(target, item.filename),
        kind: item.attrs.isDirectory() ? 'directory' : item.attrs.isFile() ? 'file' : 'other', size: item.attrs.size,
      }));
      entries.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name, 'zh-CN'));
      const parent = host.platform === 'win32' && /^\/?[a-z]:\/?$/i.test(target) ? target : path.posix.dirname(target);
      return { directory: target, parent, entries: entries.slice(0, 1000), truncated: entries.length > 1000 };
    }
    if (!localFile) throw new Error('请选择本地文件。');
    if (action === 'file-download') {
      const info = await sshCall(sftp, 'stat', target);
      if (!info.isFile()) throw new Error('请选择远程普通文件。');
      if (web) {
        if (!Number.isSafeInteger(info.size) || info.size < 0 || info.size > webTransferLimit) throw Object.assign(new Error('网页单个文件最多 128 MiB。'), { status: 413 });
        const name = path.posix.basename(target);
        const stream = info.size ? sftp.createReadStream(target, { end: info.size - 1 }) : null;
        await web.download(name, stream, signal);
        return { name };
      }
      const temporary = path.join(path.dirname(localFile), `.devkit-${randomUUID()}.part`);
      try {
        await pipeline(sftp.createReadStream(target), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal });
        await rename(temporary, localFile);
      } finally { await unlink(temporary).catch(() => {}); }
      return { name: path.basename(localFile) };
    }
    if (!web && !(await stat(localFile)).isFile()) throw new Error('请选择本地普通文件。');
    const name = web ? web.name : path.basename(localFile);
    if (typeof name !== 'string' || /[\x00-\x1f]/.test(name) || (web && (!name.trim() || name.length > 255 || ['.', '..'].includes(name) || /[/\\]/.test(name))) || (host.platform === 'win32' && /[:*?"<>|\\]/.test(name))) throw new Error('文件名无效。');
    const destination = path.posix.join(target, name);
    try { await sshCall(sftp, 'lstat', destination); throw new Error('目标目录已有同名文件。'); }
    catch (error) { if (error.code !== 2) throw error; }
    const temporary = path.posix.join(target, `.devkit-${randomUUID()}.part`);
    try {
      const output = sftp.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
      if (web) {
        let bytes = 0;
        const limit = new Transform({ transform(chunk, _encoding, next) {
          bytes += chunk.length;
          next(bytes > webTransferLimit ? Object.assign(new Error('网页单个文件最多 128 MiB。'), { status: 413 }) : null, chunk);
        } });
        await pipeline(web.input.iterator({ destroyOnReturn: false }), limit, output, { signal });
      } else await pipeline(createReadStream(localFile), output, { signal });
      await sshCall(sftp, 'rename', temporary, destination);
    } finally { await sshCall(sftp, 'unlink', temporary).catch(() => {}); }
    return { name };
  } finally { signal.removeEventListener('abort', abort); sftp.end(); }
}
