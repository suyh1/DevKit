import { createWriteStream } from 'node:fs';
import { chmod, mkdir, link, mkdtemp, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { webTransferLimit } from './lan-sftp.mjs';

function reject(status, message) { throw Object.assign(new Error(message), { status }); }

// The administrator supplies a directory shared with guacd. Only the per-session
// "drive" child is exported. Partial uploads stay outside the redirected drive.
export async function openDrive(env) {
  const root = env.DEVKIT_RDP_DRIVE_ROOT;
  if (!root) return;
  if (!path.isAbsolute(root)) reject(503, 'RDP 中转目录必须为绝对路径。');
  if (env.DEVKIT_GUACD_DRIVE_ROOT && !path.posix.isAbsolute(env.DEVKIT_GUACD_DRIVE_ROOT)) reject(503, 'guacd 中转目录必须为绝对路径。');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'session-'));
  const drive = path.join(directory, 'drive');
  try {
    await mkdir(drive);
    // Match the administrator's group access on a shared POSIX volume.
    if (process.platform !== 'win32') {
      await chmod(directory, 0o2710); await chmod(drive, 0o2770);
    }
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  const gatewayPath = env.DEVKIT_GUACD_DRIVE_ROOT
    ? path.posix.join(env.DEVKIT_GUACD_DRIVE_ROOT, path.basename(directory), 'drive') : drive;
  let active;
  return {
    options: { 'enable-drive': 'true', 'drive-name': 'DevKit', 'drive-path': gatewayPath, 'create-drive-path': 'false' },
    async upload(file, sessionSignal, verify) {
      if (active) reject(409, '当前会话正在上传文件。');
      const name = file?.name;
      if (typeof name !== 'string' || !name || name.length > 180 || /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
          /[ .]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) reject(400, '文件名无法用于远端 Windows 磁盘。');
      if (name.toLowerCase() === 'download') reject(400, 'Download 是中转盘的保留目录名。');
      const temp = path.join(directory, randomUUID());
      const signal = AbortSignal.any([sessionSignal, file.signal]);
      active = (async () => {
        let size = 0;
        try {
          await pipeline(file.input.iterator({ destroyOnReturn: false }), async function* (chunks) {
            for await (const chunk of chunks) {
              size += chunk.length;
              if (size > webTransferLimit) reject(413, '单个文件最多 128 MiB。');
              yield chunk;
            }
          }, createWriteStream(temp, { flags: 'wx', mode: 0o660 }), { signal });
          if (process.platform !== 'win32') await chmod(temp, 0o660);
          signal.throwIfAborted(); verify();
          // Publishing by hard link is atomic and never replaces an existing file.
          try { await link(temp, path.join(drive, name)); }
          catch (error) { if (error.code === 'EEXIST') reject(409, '远端中转盘已有同名文件，请重命名后重试。'); throw error; }
          return { name, size };
        } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      })();
      try { return await active; } finally { active = undefined; }
    },
    async close() {
      await active?.catch(() => {});
      await rm(directory, { force: true, recursive: true, maxRetries: 3 });
    },
  };
}
