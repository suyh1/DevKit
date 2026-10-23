import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectStore } from "./project-store.mjs";
import { createProjectHost } from "./project-host.mjs";
import { prepareProjectConfigs } from './project-configs.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = path.resolve(process.env.DEVKIT_PROJECT_DATA || path.join(root, 'configs'));
await prepareProjectConfigs(directory, [path.join(root, 'data/project-center')]);
const store = await createProjectStore(directory);
const host = await createProjectHost(store, path.join(root, "dist"));
try {
  const saved = await store.settings();
  const result = await host.start({
    host: process.env.HOST || "0.0.0.0",
    port: Number(process.env.PORT || 8765),
    canEdit: process.env.DEVKIT_PROJECT_EDIT === "true",
    password:
      process.env.DEVKIT_PROJECT_PASSWORD || (saved.hash ? "" : undefined),
  });
  console.log(
    "DevKit project center:",
    result.addresses.join("\n"),
    "\nData:",
    result.directory,
  );
} catch (error) {
  await store.close();
  console.error(error.message);
  process.exitCode = 1;
}
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await host.stop();
    await store.close();
  });
