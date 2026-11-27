import { constants, createReadStream, createWriteStream } from 'node:fs';
import { copyFile, rename, lstat, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { childName, conflict } from './sftp-local.mjs';
import { sshCall } from './lan-ssh.mjs';
import { withDeadline } from './lan-probe.mjs';

function remotePath(value, host) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\x00-\x1f]/.test(value)) throw new Error('远程路径无效。');
  if (host.platform !== 'win32') return value;
  return value.replaceAll('\\', '/').replace(/^(\w:)(?=\/|$)/, '/$1');
}

async function replaceUpload(sftp, temporary, destination) {
  try { await sshCall(sftp, 'ext_openssh_rename', temporary, destination); return; }
  catch (error) {
    if (error.code !== 8 && error.message !== 'Server does not support this extended request') throw error;
  }
  // SFTP v3 servers can lack POSIX rename. Keep the original until the new file is installed.
  const backup = temporary + '.bak';
  await sshCall(sftp, 'rename', destination, backup);
  try { await sshCall(sftp, 'rename', temporary, destination); }
  catch (error) {
    try { await sshCall(sftp, 'rename', backup, destination); }
    catch { throw new Error('覆盖中断，原文件备份位置为 ' + backup); }
    throw error;
  }
  await sshCall(sftp, 'unlink', backup).catch(() => { throw new Error('新文件已写入，原文件备份仍在 ' + backup); });
}

export const webTransferLimit = 128 * 1024 * 1024;

export async function useSftp(client, action, value, host, localFile, transfer) {
  const timeout = AbortSignal.timeout(action === 'file-list' ? 15000 : 15 * 60 * 1000);
  const web = typeof localFile === 'object' && localFile;
  const signal = AbortSignal.any([timeout, web?.signal, transfer?.controller.signal].filter(Boolean));
  const meter = new Transform({ transform(chunk, _encoding, next) {
    if (transfer) transfer.bytes += chunk.length;
    next(null, chunk);
  } });
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
    const windows = host.platform === 'win32';
    if (['file-mkdir', 'file-rename', 'file-remove'].includes(action)) {
      const child = path.posix.join(target, childName(value.name, windows));
      if (action === 'file-mkdir') {
        try { await sshCall(sftp, 'mkdir', child); }
        catch (error) {
          if (!value.merge || !(await sshCall(sftp, 'lstat', child)).isDirectory()) throw error;
        }
        return child;
      }
      if (action === 'file-rename') {
        const dest = path.posix.join(target, childName(value.newName, windows));
        await sshCall(sftp, 'lstat', dest).then(() => { throw conflict(); }, error => { if (error.code !== 2) throw error; });
        await sshCall(sftp, 'rename', child, dest);
      } else {
        async function remove(file) {
          signal.throwIfAborted();
          const attrs = await sshCall(sftp, 'lstat', file);
          if (!attrs.isDirectory()) return sshCall(sftp, 'unlink', file);
          for (const item of await sshCall(sftp, 'readdir', file)) {
            if (!['.', '..'].includes(item.filename)) await remove(path.posix.join(file, childName(item.filename, windows)));
          }
          await sshCall(sftp, 'rmdir', file);
        }
        await remove(child);
      }
      return true;
    }
    if (action === 'file-list') {
      const contents = await sshCall(sftp, 'readdir', target);
      const entries = contents.filter(item => !['.', '..'].includes(item.filename) && !item.filename.includes('/') && !/[\x00-\x1f]/.test(item.filename)).map(item => ({
        name: item.filename, path: path.posix.join(target, item.filename),
        kind: item.attrs.isDirectory() ? 'directory' : item.attrs.isFile() ? 'file' : 'other', size: item.attrs.size, modified: item.attrs.mtime * 1000,
      }));
      entries.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name, 'zh-CN'));
      const parent = host.platform === 'win32' && /^\/?[a-z]:\/?$/i.test(target) ? target : path.posix.dirname(target);
      return { directory: target, parent, entries: value.complete === true ? entries : entries.slice(0, 1000), truncated: !value.complete && entries.length > 1000 };
    }
    if (!localFile) throw new Error('请选择本地文件。');
    if (action === 'file-download') {
      const info = await sshCall(sftp, 'lstat', requested);
      if (!info.isFile()) throw new Error('请选择远程普通文件。');
      if (web) {
        if (!Number.isSafeInteger(info.size) || info.size < 0 || info.size > webTransferLimit) throw Object.assign(new Error('网页单个文件最多 128 MiB。'), { status: 413 });
        const name = path.posix.basename(target);
        const stream = info.size ? sftp.createReadStream(target, { end: info.size - 1 }) : null;
        await web.download(name, stream, signal);
        return { name };
      }
      if (transfer && !value.overwrite) {
        await lstat(localFile).then(() => { throw conflict(); }, error => { if (error.code !== 'ENOENT') throw error; });
      }
      const temporary = path.join(path.dirname(localFile), `.devkit-${randomUUID()}.part`);
      try {
        await pipeline(sftp.createReadStream(target), meter, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal });
        signal.throwIfAborted();
        if (transfer && !value.overwrite) {
          try {
            await link(temporary, localFile).catch(error => {
              if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM'].includes(error.code)) throw error;
              return copyFile(temporary, localFile, constants.COPYFILE_EXCL);
            });
          } catch (error) { if (error.code === 'EEXIST') throw conflict(); throw error; }
        } else await rename(temporary, localFile);
      } finally { await unlink(temporary).catch(() => {}); }
      return { name: path.basename(localFile) };
    }
    if (!web && !(await lstat(localFile)).isFile()) throw new Error('请选择本地普通文件。');
    const name = web ? web.name : value.name ?? path.basename(localFile);
    if (typeof name !== 'string' || /[\x00-\x1f]/.test(name) || (web && (!name.trim() || name.length > 255 || ['.', '..'].includes(name) || /[/\\]/.test(name))) || (host.platform === 'win32' && /[:*?"<>|\\]/.test(name))) throw new Error('文件名无效。');
    childName(name, windows);
    const destination = path.posix.join(target, name);
    let replace = false;
    try {
      const attrs = await sshCall(sftp, 'lstat', destination);
      if (value.overwrite !== true || !attrs.isFile()) throw conflict();
      replace = true;
    }
    catch (error) { if (error.code !== 2) throw error; }
    const temporary = path.posix.join(target, `.devkit-${randomUUID()}.part`);
    try {
      signal.removeEventListener('abort', abort);
      const output = sftp.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
      if (web) {
        let bytes = 0;
        const limit = new Transform({ transform(chunk, _encoding, next) {
          bytes += chunk.length;
          next(bytes > webTransferLimit ? Object.assign(new Error('网页单个文件最多 128 MiB。'), { status: 413 }) : null, chunk);
        } });
        await pipeline(web.input.iterator({ destroyOnReturn: false }), limit, meter, output, { signal });
      } else await pipeline(createReadStream(localFile), meter, output, { signal });
      signal.throwIfAborted();
      if (replace) await replaceUpload(sftp, temporary, destination);
      else await sshCall(sftp, 'rename', temporary, destination);
    } finally { await sshCall(sftp, 'unlink', temporary).catch(() => {}); }
    return { name };
  } finally { signal.removeEventListener('abort', abort); sftp.end(); }
}
