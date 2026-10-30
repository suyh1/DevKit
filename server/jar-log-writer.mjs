import { open, lstat, rename, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function createJarLogWriter(filename, policy) {
  let handle, size = 0, queue = Promise.resolve(), failure = '', closed = false, lastArchive = 0;
  const limit = policy.maxBytes || policy.maxMB * 1024 * 1024;
  const prefix = path.basename(filename) + '.devkit-';
  const directory = path.dirname(filename);
  async function connect() {
    try { if (!(await lstat(filename)).isFile()) throw new Error('日志路径不是普通文件。'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    handle = await open(filename, 'a', 0o600); size = (await handle.stat()).size;
  }
  async function prune() {
    if (!policy.enabled) return;
    const files = [];
    for (const name of await readdir(directory)) {
      if (!name.startsWith(prefix) || !/\.devkit-\d{13}-[a-f0-9-]{36}\.log$/.test(name)) continue;
      const target = path.join(directory, name), info = await lstat(target);
      if (info.isFile()) files.push({ target, at: info.mtimeMs, name });
    }
    files.sort((a, b) => b.name.localeCompare(a.name));
    for (const [index, file] of files.entries()) if (index >= policy.files || file.at < Date.now() - policy.days * 86400000) await unlink(file.target);
  }
  async function rotate() {
    await handle.close(); handle = null;
    lastArchive = Math.max(Date.now(), lastArchive + 1);
    await rename(filename, `${filename}.devkit-${lastArchive}-${randomUUID()}.log`);
    await connect(); await prune();
  }
  await connect(); await prune();
  return {
    write(bytes) {
      if (closed) return Promise.reject(new Error('日志写入已关闭。'));
      const pending = queue.then(async () => {
        if (failure) throw new Error(failure);
        let offset = 0;
        while (offset < bytes.length) {
          if (policy.enabled && size >= limit) await rotate();
          const count = policy.enabled ? Math.min(bytes.length - offset, limit - size) : bytes.length - offset;
          // FileHandle.write may perform a short write. Retry the remainder.
          const { bytesWritten } = await handle.write(bytes, offset, count, null);
          if (!bytesWritten) throw new Error('日志写入未完成。');
          offset += bytesWritten; size += bytesWritten;
        }
      });
      queue = pending.catch(error => { failure = error.message; }); return pending;
    },
    prune() { const pending = queue.then(prune); queue = pending.catch(error => { failure = error.message; }); return pending; },
    error: () => failure,
    async close() { closed = true; await queue; await handle?.close(); },
  };
}
