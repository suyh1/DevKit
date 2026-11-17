import { open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function atomicFile(filename, bytes, mode = 0o600, { beforeReplace, owner } = {}) {
  const temporary = path.join(path.dirname(filename), `.devkit-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', mode);
  try {
    try {
      await handle.writeFile(bytes);
      if (owner && process.platform !== 'win32') {
        const created = await handle.stat();
        if (created.uid !== owner.uid || created.gid !== owner.gid) await handle.chown(owner.uid, owner.gid);
        await handle.chmod(mode);
      }
      await handle.sync();
    } finally { await handle.close(); }
    for (let attempt = 0; ; attempt++) {
      await beforeReplace?.();
      try { await rename(temporary, filename); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 7) throw error;
        await delay(Math.min(20 * 2 ** attempt, 250));
      }
    }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
