import {
  mkdir,
  readFile,
  rename,
  open,
  unlink,
  readdir,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { initialState, validateState } from "../shared/projects.mjs";
import { acquireProjectLock } from "./project-lock.mjs";

export const profileFilename = (id) => {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(id))
    throw new Error("档案文件标识无效。");
  // Hex encoding avoids case-insensitive filename collisions on Windows.
  return `profile-${Buffer.from(id).toString("hex")}.json`;
};

export async function readProjectEnvelope(directory) {
  const input = JSON.parse(
    await readFile(path.join(directory, "projects.json"), "utf8"),
  );
  if (input.current?.schemaVersion === 2) {
    if (!Array.isArray(input.current.profiles))
      throw new Error("档案索引无效。");
    input.current.profiles = await Promise.all(
      input.current.profiles.map(async ({ id }) => {
        const profile = await readFile(
          path.join(directory, profileFilename(id)),
          "utf8",
        )
          .then(JSON.parse)
          .catch((error) => {
            throw new Error(`档案 ${id} 无法读取：${error.message}`);
          });
        if (profile.id !== id) throw new Error("档案文件与索引不匹配。");
        return profile;
      }),
    );
  }
  return validateProjectEnvelope(input);
}

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
  const journal = path.join(directory, ".projects-pending.json");
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
  async function materialize(next) {
    const files = new Set();
    for (const profile of next.current.profiles) {
      const name = profileFilename(profile.id);
      files.add(name);
      const file = path.join(directory, name);
      let previous;
      try {
        previous = await readFile(file, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (previous !== JSON.stringify(profile, null, 2))
        await atomic(file, profile);
    }
    await atomic(filename, {
      ...next,
      current: {
        schemaVersion: 2,
        revision: next.current.revision,
        profiles: next.current.profiles.map(({ id }) => ({ id })),
      },
    });
    for (const file of await readdir(directory)) {
      if (
        /^profile-(?:[a-f0-9]{2}){1,80}\.json$/.test(file) &&
        !files.has(file)
      )
        await unlink(path.join(directory, file));
    }
    await unlink(journal);
  }
  let pending;
  async function recover() {
    if (!pending) return;
    await materialize(pending);
    envelope = pending;
    pending = undefined;
  }
  async function persist(next) {
    await atomic(journal, next);
    pending = next;
    await recover();
  }
  try {
    let journalBytes;
    try {
      journalBytes = await readFile(journal, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (journalBytes !== undefined) {
      pending = validateProjectEnvelope(JSON.parse(journalBytes));
      await recover();
    }
    let raw;
    try {
      raw = JSON.parse(await readFile(filename, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(`项目数据无法读取，原文件已保留：${error.message}`);
    }
    if (raw !== undefined) {
      try {
        envelope = await readProjectEnvelope(directory);
        if (raw.current.schemaVersion === 1) {
          await copyFile(
            filename,
            path.join(directory, "projects.v1.backup.json"),
            constants.COPYFILE_EXCL,
          ).catch((error) => {
            if (error.code !== "EEXIST") throw error;
          });
          await persist(envelope);
        }
      } catch (error) {
        throw new Error(`项目数据无法读取，原文件已保留：${error.message}`);
      }
    } else {
      envelope = { current: initialState(), snapshots: [] };
      await persist(envelope);
    }
  } catch (error) {
    await releaseLock();
    throw error;
  }
  let queue = Promise.resolve();
  const clone = (value) => structuredClone(value);
  function transaction(action) {
    const promise = queue.then(async () => {
      await recover();
      return action();
    });
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
    await persist(next);
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
    get: () =>
      transaction(async () => {
        return clone(envelope.current);
      }),
    save: (data, revision) =>
      transaction(async () => {
        checkRevision(revision);
        return commit(validateState(data), "修改前自动备份");
      }),
    snapshots: () =>
      transaction(async () => {
        return envelope.snapshots.map(({ state, ...meta }) => ({
          ...meta,
          projects: state.profiles.reduce(
            (count, profile) => count + profile.projects.length,
            0,
          ),
          profiles: state.profiles.length,
        }));
      }),
    snapshot: (id) =>
      transaction(async () => {
        const snapshot = envelope.snapshots.find((item) => item.id === id);
        if (!snapshot) throw new Error("快照不存在。");
        return clone(snapshot.state);
      }),
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
        await persist(next);
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
