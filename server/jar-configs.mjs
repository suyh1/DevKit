import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { atomicFile } from './atomic-file.mjs';
import { pathKey } from './jar-process.mjs';

const maxBytes = 512 * 1024;
const extensions = new Set(['.yml', '.yaml', '.properties', '.json', '.xml', '.toml', '.ini', '.conf', '.cfg']);
const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
const supportedName = name => typeof name === 'string' && name.length <= 255 &&
  !name.startsWith('.') && !/[\\/:\u0000-\u001f]/.test(name) &&
  extensions.has(path.extname(name).toLowerCase()) &&
  !/\.pid\.devkit\.json$|\.supervisor\.json$/i.test(name);

async function readDocument(filename) {
  const entry = await lstat(filename);
  if (!entry.isFile() || entry.nlink !== 1) throw new Error('配置必须是普通文件，不能使用链接。');
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.dev !== entry.dev || info.ino !== entry.ino) throw new Error('配置文件已被替换，请刷新后重试。');
    if (info.size > maxBytes) throw new Error('单个配置文件最多 512 KiB。');
    const buffer = Buffer.alloc(info.size + 1);
    const { bytesRead } = await handle.read(buffer, { length: buffer.length });
    const latest = await handle.stat();
    if (bytesRead !== info.size || latest.size !== info.size || latest.mtimeMs !== info.mtimeMs) throw new Error('配置文件正在变化，请刷新后重试。');
    const bytes = buffer.subarray(0, bytesRead);
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new Error('仅支持 UTF-8 文本配置。'); }
    if (content.includes('\0')) throw new Error('配置不是有效的文本文件。');
    return { bytes, info, content, hash: checksum(bytes) };
  } finally { await handle.close(); }
}

export async function jarConfigs(folder, item, action, value) {
  const directory = path.dirname(item.jar);
  async function checkDirectory() {
    if (pathKey(await realpath(directory)) !== pathKey(directory)) throw new Error('JAR 目录已变化，请重新登记。');
  }
  await checkDirectory();
  const allowed = name => supportedName(name) && pathKey(path.join(directory, name)) !== pathKey(path.join(folder, 'instances.json'));
  if (action === 'config-list') {
    const entries = await readdir(directory, { withFileTypes: true });
    return { directory, files: entries.filter(entry => entry.isFile() && allowed(entry.name)).map(entry => entry.name).sort((a, b) => a.localeCompare(b)) };
  }
  const { name, hash, content } = value;
  if (!allowed(name)) throw new Error('请选择 JAR 同目录下支持的配置文件。');
  const filename = path.join(directory, name);
  const backupDirectory = path.join(folder, 'config-backups');
  const backupFile = path.join(backupDirectory, `${checksum(pathKey(filename))}.bak`);
  async function checkBackupDirectory() {
    if (!(await lstat(backupDirectory)).isDirectory()) throw new Error('配置备份目录不可用。');
  }
  if (action === 'config-backup') {
    try {
      await checkBackupDirectory();
      const backup = await readDocument(backupFile);
      return { name, content: backup.content, hash: backup.hash };
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  const current = await readDocument(filename);
  if (action === 'config-read') return { name, content: current.content, hash: current.hash };
  const conflict = () => new Error('配置文件已被其他操作修改。请先重新读取磁盘版本，再核对并保存。');
  if (hash !== current.hash) throw conflict();
  if (typeof content !== 'string' || !content.isWellFormed() || content.includes('\0') || Buffer.byteLength(content) > maxBytes) throw new Error('配置必须是 512 KiB 以内的 UTF-8 文本。');
  if (content === current.content) return { name, content, hash };

  const bytes = Buffer.from(content, 'utf-8');
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await checkBackupDirectory();
  await atomicFile(backupFile, current.bytes);
  await atomicFile(filename, bytes, current.info.mode & 0o777, {
    owner: current.info,
    async beforeReplace() {
      await checkDirectory();
      const { hash, info } = await readDocument(filename);
      if (hash !== current.hash || info.ino !== current.info.ino || info.dev !== current.info.dev ||
          info.mode !== current.info.mode || info.uid !== current.info.uid || info.gid !== current.info.gid) throw conflict();
    },
  });
  return { name, content, hash: checksum(bytes) };
}
