import { constants } from 'node:fs';
import { copyFile, lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const replacementActions = ['replace-begin', 'replace-chunk', 'replace-finish', 'replace-cancel'];
const chunkLimit = 2 * 1024 * 1024;

// The manager serializes all calls, including expiry and service commands.
export function createReplacements({ enqueue, stop, status, start, targetFor }) {
  const active = new Map();

  async function discard(upload) {
    clearTimeout(upload.timer);
    active.delete(upload.id);
    try { await upload.file.close(); }
    finally { await unlink(upload.temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  function touch(upload) {
    clearTimeout(upload.timer);
    const timer = setTimeout(() => {
      void enqueue(async () => {
        if (active.get(upload.id) === upload && upload.timer === timer) await discard(upload);
      }).catch(() => {});
    }, 15 * 60_000);
    upload.timer = timer.unref();
  }
  function requireStopped(current) {
    if (!['stopped', 'exited'].includes(current.state) || current.supervision?.active)
      throw new Error('尚未确认服务及守护已停止。' + current.detail);
  }
  async function checkOriginal(upload) {
    const info = await lstat(upload.target);
    if (!info.isFile() || await realpath(upload.target) !== upload.target ||
        ['dev', 'ino', 'size', 'ctimeMs'].some(key => info[key] !== upload.original[key]))
      throw new Error('上传期间原文件已变化，请重新核对。');
    return info;
  }
  async function request(action, item, value, session) {
    const id = item.id;
    let upload = active.get(id);
    if (action === 'replace-begin') {
      if (upload) throw new Error('此服务正在替换文件。');
      const target = targetFor(item);
      if (target !== value.expectedPath || await realpath(target) !== target) throw new Error('服务入口路径已变化，请刷新后重试。');
      const original = await lstat(target);
      if (!original.isFile()) throw new Error('服务入口必须是普通文件。');
      const token = randomUUID();
      const temp = path.join(path.dirname(target), '.devkit-upload-' + token + '.tmp');
      const file = await open(temp, 'wx', 0o600);
      upload = { id, session, token, target, original, file, temp, bytes: 0 };
      active.set(id, upload);
      try {
        requireStopped((await stop(item, false)).status);
        touch(upload);
        return { token };
      } catch (error) { await discard(upload); throw error; }
    }
    if (!upload || upload.token !== value.token || upload.session !== session) throw new Error('文件替换会话已失效，请重新操作。');
    touch(upload);
    if (action === 'replace-cancel') { await discard(upload); return {}; }
    if (action === 'replace-chunk') {
      if (value.offset !== upload.bytes || typeof value.data !== 'string' || value.data.length > 4 * Math.ceil(chunkLimit / 3))
        throw new Error('上传位置或分块大小无效。');
      const bytes = Buffer.from(value.data, 'base64');
      if (!bytes.length || bytes.length > chunkLimit || bytes.toString('base64') !== value.data) throw new Error('上传数据无效。');
      try { await upload.file.writeFile(bytes); }
      catch (error) { await discard(upload); throw error; }
      upload.bytes += bytes.length;
      return { bytes: upload.bytes };
    }
    let backup = '';
    try {
      if (!upload.bytes || upload.bytes !== value.size || typeof value.backup !== 'boolean' || typeof value.start !== 'boolean')
        throw new Error('上传文件不完整或替换选项无效。');
      requireStopped(await status(item));
      const target = targetFor(item);
      if (target !== upload.target) throw new Error('服务入口路径已变化，请刷新后重试。');
      const info = await checkOriginal(upload);
      if (process.platform !== 'win32') {
        const created = await upload.file.stat();
        if (info.uid !== created.uid || info.gid !== created.gid) await upload.file.chown(info.uid, info.gid);
        await upload.file.chmod(info.mode & 0o777);
      }
      await upload.file.sync();
      await upload.file.close();
      if (value.backup) {
        backup = target + '.' + new Date().toISOString().replace(/[:.]/g, '-') + '.' + randomUUID().slice(0, 8) + '.bak';
        await copyFile(target, backup, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
      }
      await checkOriginal(upload);
      await rename(upload.temp, target);
    } finally { await discard(upload); }
    if (value.start) {
      try { await start(item); }
      catch (error) { return { ok: false, backup, started: false, startError: error.message }; }
    }
    return { backup, started: value.start };
  }
  return {
    request, busy: id => active.has(id),
    async release(session) {
      for (const upload of active.values()) if (upload.session === session) await discard(upload);
    },
    async close() { for (const upload of active.values()) await discard(upload); },
  };
}
