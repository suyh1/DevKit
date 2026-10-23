import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { acquireProjectLock } from "./project-lock.mjs";
import { validateProjectEnvelope } from "./project-store.mjs";

const exists = async (file) => {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};
const instructions = `DevKit project center configs\n\nprojects.json: projects, environment profiles and the latest 30 snapshots.\nsharing.json: host sharing options and salted password hash (no plaintext password).\nmigration.json: optional migration history.\n\nClose DevKit / the Node host on BOTH computers before copying this entire folder.\nCopy configs beside the other installation's executable (or beside server/ in the standalone ZIP).\nKeep the destination folder writable by the user who launches DevKit.\nDo not merge projects.json by hand. Use the UI JSON import to merge projects/profiles.\n.lock and *.tmp are runtime files, never configuration. A clean shutdown removes the lock.\nJSON UI export excludes sharing passwords and snapshot history. Folder copy includes them.\n`;

export async function prepareProjectConfigs(directory, legacyDirectories = []) {
  directory = path.resolve(directory);
  let release;
  try {
    await mkdir(directory, { recursive: true });
    release = await acquireProjectLock(directory);
    let migratedFrom = "";
    if (!(await exists(path.join(directory, "projects.json")))) {
      for (const legacy of legacyDirectories.map((item) =>
        path.resolve(item),
      )) {
        if (
          legacy === directory ||
          !(await exists(path.join(legacy, "projects.json")))
        )
          continue;
        const unlockLegacy = await acquireProjectLock(legacy);
        try {
          const bytes = await readFile(path.join(legacy, "projects.json"));
          validateProjectEnvelope(JSON.parse(bytes.toString("utf8")));
          // Commit projects.json last; a partial migration is retried on next start.
          if (
            (await exists(path.join(legacy, "sharing.json"))) &&
            !(await exists(path.join(directory, "sharing.json")))
          ) {
            JSON.parse(
              await readFile(path.join(legacy, "sharing.json"), "utf8"),
            );
            await copyFile(
              path.join(legacy, "sharing.json"),
              path.join(directory, "sharing.json"),
              constants.COPYFILE_EXCL,
            );
          }
          const temporary = path.join(
            directory,
            `.migration-${randomUUID()}.tmp`,
          );
          try {
            await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
            await writeFile(
              path.join(directory, "migration.json"),
              JSON.stringify(
                { migratedFrom: legacy, migratedAt: new Date().toISOString() },
                null,
                2,
              ),
              { mode: 0o600 },
            );
            await rename(temporary, path.join(directory, "projects.json"));
          } finally {
            await unlink(temporary).catch((error) => {
              if (error.code !== "ENOENT") throw error;
            });
          }
          migratedFrom = legacy;
        } finally {
          await unlockLegacy();
        }
        break;
      }
    }
    if (!(await exists(path.join(directory, "README.txt"))))
      await writeFile(path.join(directory, "README.txt"), instructions, {
        flag: "wx",
        mode: 0o600,
      });
    return { directory, portable: true, migratedFrom };
  } catch (error) {
    if (["EACCES", "EPERM", "EROFS"].includes(error.code))
      throw new Error(
        `配置目录不可写：${directory}\n请将 DevKit 安装到当前用户可写的位置，或由管理员授予当前用户该 configs 目录的写入权限。不会改存到其他目录。`,
      );
    throw new Error(`配置目录：${directory}\n${error.message}`);
  } finally {
    await release?.();
  }
}
