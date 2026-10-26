import electron from "electron";
import { spawn } from "node:child_process";
import path from "node:path";
import { root } from "./desktop-files.mjs";
const environment = { ...process.env };
if (process.argv.includes('--packaged')) environment.DEVKIT_TEST_APP = path.join(root, 'artifacts', 'desktop-runtime', `DevKit-${process.platform}-${process.arch}`, 'resources/app.asar');
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(root, "electron/sharing-smoke.cjs")], {
  stdio: "inherit",
  windowsHide: true,
  env: environment,
});
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
