import {
  mkdir,
  readFile,
  writeFile,
  rename,
  open,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { initialState, validateState } from "../shared/projects.mjs";
import { acquireProjectLock } from "./project-lock.mjs";

export function validateProjectEnvelope(input) {
  if (!input || typeof input !== "object") throw new Error("项目数据无效。");
  const current = validateState(input.current);
  if (!Array.isArray(input.snapshots) || input.snapshots.length > 30)
    throw new Error("快照列表无效。");
  const ids = new Set();
  const snapshots = input.snapshots.map((snapshot) => {
    if (
      !snapshot ||
      typeof snapshot.id !== "string" ||
      ids.has(snapshot.id) ||
      typeof snapshot.name !== "string" ||
      !Number.isFinite(Date.parse(snapshot.createdAt))
    )
      throw new Error("快照元数据无效。");
    ids.add(snapshot.id);
    return {
      id: snapshot.id,
      name: snapshot.name,
      createdAt: snapshot.createdAt,
      state: validateState(snapshot.state),
    };
  });
  return { current, snapshots };
}

export async function createProjectStore(directory) {
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, "projects.json");
  const releaseLock = await acquireProjectLock(directory);
  async function atomic(file, value) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(value, null, 2));
        await handle.sync();
      } finally {
        await handle.close();
      }
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(temporary, file);
          break;
        } catch (error) {
          if (
            !["EPERM", "EBUSY", "EACCES"].includes(error.code) ||
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
    try {
      envelope = validateProjectEnvelope(
        JSON.parse(await readFile(filename, "utf8")),
      );
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(`项目数据无法读取，原文件已保留：${error.message}`);
      envelope = { current: initialState(), snapshots: [] };
      await atomic(filename, envelope);
    }
  } catch (error) {
    await releaseLock();
    throw error;
  }
  let queue = Promise.resolve();
  const clone = (value) => structuredClone(value);
  function transaction(action) {
    const promise = queue.then(action);
    queue = promise.catch(() => {});
    return promise;
  }
  async function commit(data, name) {
    const current = validateState({
      ...data,
      revision: envelope.current.revision + 1,
    });
    const backup = {
      id: randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      state: envelope.current,
    };
    const next = {
      current,
      snapshots: [backup, ...envelope.snapshots].slice(0, 30),
    };
    await atomic(filename, next);
    envelope = next;
    return clone(current);
  }
  function checkRevision(revision) {
    if (revision !== envelope.current.revision) {
      const error = new Error(
        "其他使用者已更新数据。请刷新后合并修改；当前编辑内容仍保留。",
      );
      error.status = 409;
      throw error;
    }
  }
  return {
    directory,
    get: async () => {
      await queue;
      return clone(envelope.current);
    },
    save: (data, revision) =>
      transaction(async () => {
        checkRevision(revision);
        return commit(validateState(data), "修改前自动备份");
      }),
    snapshots: async () => {
      await queue;
      return envelope.snapshots.map(({ state, ...meta }) => ({
        ...meta,
        projects: state.projects.length,
        profiles: state.profiles.length,
      }));
    },
    snapshot: async (id) => {
      await queue;
      const snapshot = envelope.snapshots.find((item) => item.id === id);
      if (!snapshot) throw new Error("快照不存在。");
      return clone(snapshot.state);
    },
    backup: (name) =>
      transaction(async () => {
        if (typeof name !== "string" || !name.trim() || name.length > 100)
          throw new Error("快照名称需为 1–100 字符。");
        const snapshot = {
          id: randomUUID(),
          name: name.trim(),
          createdAt: new Date().toISOString(),
          state: envelope.current,
        };
        const next = {
          ...envelope,
          snapshots: [snapshot, ...envelope.snapshots].slice(0, 30),
        };
        await atomic(filename, next);
        envelope = next;
        return snapshot.id;
      }),
    restore: (id, revision) =>
      transaction(async () => {
        checkRevision(revision);
        const snapshot = envelope.snapshots.find((item) => item.id === id);
        if (!snapshot) throw new Error("快照不存在。");
        return commit(validateState(snapshot.state), "恢复前自动备份");
      }),
    settings: async () => {
      try {
        return JSON.parse(
          await readFile(path.join(directory, "sharing.json"), "utf8"),
        );
      } catch (error) {
        if (error.code === "ENOENT") return {};
        throw error;
      }
    },
    saveSettings: (value) =>
      transaction(() => atomic(path.join(directory, "sharing.json"), value)),
    close: async () => {
      await queue;
      await releaseLock();
    },
  };
}
