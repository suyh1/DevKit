import { constants } from 'node:fs';
import { copyFile, link, lstat, open, opendir, realpath, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const replacementActions = ['replace-begin', 'replace-chunk', 'replace-finish', 'replace-cancel', 'replace-backups', 'replace-restore'];
const chunkLimit = 2 * 1024 * 1024;
function isBackup(target, name) {
  const prefix = path.basename(target) + '.';
  return typeof name === 'string' && name.startsWith(prefix) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.[a-f0-9]{8}\.bak$/.test(name.slice(prefix.length)) &&
    path.basename(name) === name && !/[\r\n]/.test(name);
}

async function listBackups(target) {
  const names = [];
  for await (const entry of await opendir(path.dirname(target))) {
    if (entry.isFile() && isBackup(target, entry.name)) names.push(entry.name);
  }
  return names.sort().reverse();
}

async function entryInfo(target) {
  try { return await lstat(target); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function openBackup(target, name) {
  if (!isBackup(target, name)) throw new Error('请选择当前服务的备份。');
  const filename = path.join(path.dirname(target), name);
  const info = await entryInfo(filename);
  if (!info) throw new Error('所选备份已不存在，请重新选择。');
  if (!info.isFile() || !info.size || await realpath(filename) !== filename) throw new Error('备份不是可恢复的普通文件。');
  const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const source = await file.stat();
    if (!source.isFile() || source.ino !== info.ino || source.dev !== info.dev) throw new Error('备份已变化，请重新选择。');
    return { file, source };
  } catch (error) { await file.close(); throw error; }
}

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
    const info = await entryInfo(upload.target);
    if (!info && !upload.original && await realpath(path.dirname(upload.target)) === path.dirname(upload.target)) return null;
    if (!info?.isFile() || !upload.original || await realpath(upload.target) !== upload.target ||
        ['dev', 'ino', 'size', 'ctimeMs'].some(key => info[key] !== upload.original[key]))
      throw new Error('上传期间原文件已变化，请重新核对。');
    return info;
  }
  async function begin(item, expectedPath, session, allowMissing = false) {
    const id = item.id;
    if (active.has(id)) throw new Error('此服务正在替换文件。');
    const target = targetFor(item);
    if (target !== expectedPath || await realpath(path.dirname(target)) !== path.dirname(target)) throw new Error('服务入口路径已变化，请刷新后重试。');
    const original = await entryInfo(target);
    if (original ? !original.isFile() : !allowMissing) throw new Error('服务入口必须是普通文件。');
    const token = randomUUID();
    const temp = path.join(path.dirname(target), '.devkit-upload-' + token + '.tmp');
    const file = await open(temp, 'wx', 0o600);
    const upload = { id, session, token, target, original, file, temp, bytes: 0 };
    active.set(id, upload);
    try {
      requireStopped((await stop(item, false)).status);
      touch(upload);
      return upload;
    } catch (error) { await discard(upload); throw error; }
  }
  async function request(action, item, value, session) {
    if (action === 'replace-backups') return listBackups(targetFor(item));
    if (action === 'replace-restore') return restore(item, value, session);
    if (action === 'replace-begin') {
      const { token } = await begin(item, value.expectedPath, session);
      return { token };
    }
    const upload = active.get(item.id);
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
    return finish(item, upload, value);
  }
  async function restore(item, value, session) {
    const target = targetFor(item);
    if (value.expectedPath !== target || typeof value.backup !== 'boolean' || typeof value.start !== 'boolean')
      throw new Error('服务入口或恢复选项已变化，请重新核对。');
    const { file, source } = await openBackup(target, value.name);
    try {
      const upload = await begin(item, target, session, true);
      try {
        const buffer = Buffer.allocUnsafe(Math.min(source.size, chunkLimit));
        while (upload.bytes < source.size) {
          const { bytesRead } = await file.read(buffer);
          if (!bytesRead) break;
          await upload.file.writeFile(buffer.subarray(0, bytesRead));
          upload.bytes += bytesRead;
        }
        if (upload.bytes !== source.size || (await file.stat()).ctimeMs !== source.ctimeMs)
          throw new Error('恢复期间备份文件已变化，请重新选择。');
      } catch (error) { await discard(upload); throw error; }
      return await finish(item, upload, { ...value, size: source.size }, source);
    } finally { await file.close(); }
  }
  async function finish(item, upload, value, source) {
    let backup = '';
    try {
      if (!upload.bytes || upload.bytes !== value.size || typeof value.backup !== 'boolean' || typeof value.start !== 'boolean')
        throw new Error('上传文件不完整或替换选项无效。');
      requireStopped(await status(item));
      const target = targetFor(item);
      if (target !== upload.target) throw new Error('服务入口路径已变化，请刷新后重试。');
      const info = await checkOriginal(upload);
      if (process.platform !== 'win32') {
        const owner = info ?? source;
        const created = await upload.file.stat();
        if (owner.uid !== created.uid || owner.gid !== created.gid) await upload.file.chown(owner.uid, owner.gid);
        await upload.file.chmod(owner.mode & 0o777);
      }
      await upload.file.sync();
      await upload.file.close();
      if (value.backup && info) {
        backup = target + '.' + new Date().toISOString().replace(/[:.]/g, '-') + '.' + randomUUID().slice(0, 8) + '.bak';
        await copyFile(target, backup, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
      }
      await checkOriginal(upload);
      if (info) await rename(upload.temp, target);
      else await link(upload.temp, target);
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
