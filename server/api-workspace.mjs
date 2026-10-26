import { mkdir, readFile, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { initialApiState, validateApiState } from "../shared/api-workspace.mjs";
import { acquireProjectLock } from "./project-lock.mjs";

export async function createApiWorkspace(directory) {
  const folder = path.join(directory, "http");
  await mkdir(folder, { recursive: true });
  const unlock = await acquireProjectLock(folder);
  const filename = path.join(folder, "api-workspace.json");
  async function atomic(data) {
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(data, null, 2));
        await handle.sync();
      } finally {
        await handle.close();
      }
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(temporary, filename);
          break;
        } catch (error) {
          if (
            !["EPERM", "EACCES", "EBUSY"].includes(error.code) ||
            attempt >= 7
          )
            throw error;
          await delay(Math.min(20 * 2 ** attempt, 250));
        }
      }
    } finally {
      await unlink(temporary).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  let envelope;
  try {
    let bytes;
    try {
      bytes = await readFile(filename, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (bytes !== undefined) {
      const parsed = JSON.parse(bytes);
      envelope = {
        current: validateApiState(parsed.current),
        previous:
          parsed.previous === null ? null : validateApiState(parsed.previous),
      };
    } else {
      envelope = { current: initialApiState(), previous: null };
      await atomic(envelope);
    }
  } catch (error) {
    await unlock();
    throw new Error(
      `API工作区无法读取，原文件已保留：${filename}\n${error.message}`,
    );
  }
  let queue = Promise.resolve();
  const transaction = (action) => {
    const next = queue.then(action);
    queue = next.catch(() => {});
    return next;
  };
  const result = () =>
    structuredClone({
      state: envelope.current,
      canRestore: !!envelope.previous,
      directory: folder,
    });
  async function commit(data, revision) {
    if (revision !== envelope.current.revision)
      throw new Error("API工作区已被更新，请刷新后重试；当前草稿仍保留。");
    const next = {
      current: validateApiState({ ...data, revision: revision + 1 }),
      previous: envelope.current,
    };
    await atomic(next);
    envelope = next;
    return result();
  }
  return {
    get: () => transaction(async () => result()),
    save: (data, revision) =>
      transaction(() => commit(validateApiState(data), revision)),
    restore: (revision) =>
      transaction(() => {
        if (!envelope.previous) throw new Error("没有可恢复的上次保存。");
        return commit(envelope.previous, revision);
      }),
    close: async () => {
      await queue;
      await unlock();
    },
  };
}
