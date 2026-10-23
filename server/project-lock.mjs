import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";

export async function acquireProjectLock(directory) {
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, ".lock");
  const identity = { pid: process.pid, host: hostname(), token: randomUUID() };
  let handle;
  try {
    handle = await open(filename, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let previous;
    try {
      const raw = await readFile(filename, "utf8");
      previous = JSON.parse(raw);
      if (typeof previous === "number")
        previous = { pid: previous, host: hostname() };
      if (
        !Number.isInteger(previous?.pid) ||
        previous.pid <= 0 ||
        typeof previous.host !== "string"
      )
        throw new Error("invalid");
    } catch {
      throw new Error(
        "项目数据锁无效，请关闭所有 DevKit 后移除 configs/.lock 再启动。",
      );
    }
    let stale = previous.host !== identity.host;
    if (!stale) {
      try {
        process.kill(previous.pid, 0);
      } catch (failure) {
        if (failure.code === "ESRCH") stale = true;
        else throw new Error("项目配置目录正在使用或锁状态无法确认。");
      }
    }
    if (!stale) throw new Error("项目配置目录正在被另一实例使用，请先关闭它。");
    await unlink(filename);
    handle = await open(filename, "wx", 0o600);
  }
  await handle.writeFile(JSON.stringify(identity));
  let closed = false;
  return async () => {
    if (closed) return;
    closed = true;
    await handle.close();
    try {
      const current = JSON.parse(await readFile(filename, "utf8"));
      if (current.token === identity.token) await unlink(filename);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  };
}
