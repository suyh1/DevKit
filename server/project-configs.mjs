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
import { readProjectEnvelope, profileFilename } from "./project-store.mjs";

import { configGroup, organizeConfigs } from './config-layout.mjs';

const exists = async (file) => {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};
const instructions = `DevKit 配置目录

projects/  项目索引、档案、快照、迁移记录与待恢复的保存
sharing/   共享权限、访问口令哈希、审计记录、文件共享与快传链接
planning/  待办清单与知识库
jar/、nginx/、http/、monitor/、lan-hosts/、collaboration/  各栏目的数据

复制前请关闭两台电脑上的 DevKit 或独立服务，备份目标 configs，再复制整个目录。
目录含有共享凭据。仅迁移项目时可使用界面的 JSON 导出和合并导入。
`;

export async function prepareProjectConfigs(directory, legacyDirectories = []) {
  directory = path.resolve(directory);
  let release;
  try {
    await mkdir(directory, { recursive: true });
    release = await acquireProjectLock(directory);
    await organizeConfigs(directory);
    const projects = await configGroup(directory, 'projects');
    const sharing = await configGroup(directory, 'sharing');
    let migratedFrom = "";
    if (
      !(await exists(path.join(projects, "projects.json"))) &&
      !(await exists(path.join(projects, ".projects-pending.json")))
    ) {
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
          const validated = await readProjectEnvelope(legacy);
          if (await exists(path.join(legacy, ".projects-pending.json")))
            throw new Error(
              "来源目录存在待恢复的保存，请先启动来源主机完成恢复，再迁移。",
            );
          if (JSON.parse(bytes.toString("utf8")).current.schemaVersion === 2) {
            for (const profile of validated.current.profiles) {
              const name = profileFilename(profile.id);
              await copyFile(
                path.join(legacy, name),
                path.join(projects, name),
              );
            }
          }
          // Commit projects.json last; a partial migration is retried on next start.
          if (
            (await exists(path.join(legacy, "sharing.json"))) &&
            !(await exists(path.join(sharing, "sharing.json")))
          ) {
            JSON.parse(
              await readFile(path.join(legacy, "sharing.json"), "utf8"),
            );
            await copyFile(
              path.join(legacy, "sharing.json"),
              path.join(sharing, "sharing.json"),
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
              path.join(projects, "migration.json"),
              JSON.stringify(
                { migratedFrom: legacy, migratedAt: new Date().toISOString() },
                null,
                2,
              ),
              { mode: 0o600 },
            );
            await rename(temporary, path.join(projects, "projects.json"));
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
    await writeFile(path.join(directory, "README.txt"), instructions, {
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
