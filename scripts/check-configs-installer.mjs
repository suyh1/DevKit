// Exercise the real NSIS cleanup macro in a registry-free, isolated fixture.
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  access,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
import { root } from "./desktop-files.mjs";
if (process.platform !== "win32")
  throw new Error("This NSIS executable check requires Windows");
const cache = path.join(process.env.LOCALAPPDATA, "electron-builder/Cache");
async function find(folder, depth = 0) {
  for (const item of await readdir(folder, { withFileTypes: true })) {
    const target = path.join(folder, item.name);
    if (item.isFile() && item.name.toLowerCase() === "makensis.exe")
      return target;
    if (item.isDirectory() && depth < 3) {
      const match = await find(target, depth + 1);
      if (match) return match;
    }
  }
}
const compiler = process.env.DEVKIT_MAKENSIS || (await find(cache));
if (!compiler)
  throw new Error(
    "Build the Windows package first to populate the NSIS compiler cache",
  );
const folder = await mkdtemp(path.join(root, "artifacts/nsis-configs-"));
const installation = path.resolve(folder, "fixture-install");
assert.equal(path.dirname(installation), folder);
assert.ok(
  path
    .relative(path.join(root, "artifacts"), installation)
    .startsWith("nsis-configs-"),
);
await mkdir(path.join(installation, "configs/nested"), { recursive: true });
const data = '{"project":"配置迁移验收","snapshots":[1,2,3]}';
await writeFile(path.join(installation, "configs/projects.json"), data);
await writeFile(
  path.join(installation, "configs/nested/preserve.txt"),
  "preserve nested data",
);
const source = path.join(folder, "check.nsi");
await writeFile(
  source,
  "\ufeff" +
    `Unicode true
Name "DevKit isolated configs preservation check"
OutFile "${path.join(folder, "check.exe")}"
RequestExecutionLevel user
SilentInstall silent
!include "${path.join(root, "build/preserve-configs.nsh")}"
Section
  StrCpy $INSTDIR "$EXEDIR\\fixture-install"
  !insertmacro customRemoveFiles
SectionEnd
`,
);
execFileSync(compiler, ["/V2", source], {
  cwd: folder,
  windowsHide: true,
  stdio: "pipe",
});
for (const stage of ["upgrade", "uninstall"]) {
  await mkdir(path.join(installation, "resources"), { recursive: true });
  await writeFile(path.join(installation, "resources/app.asar"), "old app");
  await writeFile(path.join(installation, "devkit.exe"), "old executable");
  await writeFile(path.join(installation, ".old-cache"), "stale runtime file");
  execFileSync(path.join(folder, "check.exe"), [], {
    cwd: folder,
    windowsHide: true,
    stdio: "pipe",
  });
  assert.equal(
    await readFile(path.join(installation, "configs/projects.json"), "utf8"),
    data,
  );
  assert.equal(
    await readFile(
      path.join(installation, "configs/nested/preserve.txt"),
      "utf8",
    ),
    "preserve nested data",
  );
  await assert.rejects(access(path.join(installation, "resources")));
  await assert.rejects(access(path.join(installation, "devkit.exe")));
  await assert.rejects(access(path.join(installation, ".old-cache")));
  console.log(
    `NSIS ${stage} cleanup: application removed, configs preserved byte-for-byte`,
  );
}
await writeFile(
  path.join(root, "artifacts/configs-installer-verification.json"),
  JSON.stringify(
    {
      actualNsisMacro: true,
      upgrade: true,
      uninstall: true,
      nestedConfigsPreserved: true,
      registryModified: false,
      fixture: folder,
    },
    null,
    2,
  ) + "\n",
);
