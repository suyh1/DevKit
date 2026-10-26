import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectStore } from "./project-store.mjs";
import { createProjectHost } from "./project-host.mjs";
import { prepareProjectConfigs } from './project-configs.mjs';
import { createNginxManager } from './nginx-manager.mjs';
import { createApiWorkspace } from './api-workspace.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = path.resolve(process.env.DEVKIT_PROJECT_DATA || path.join(root, 'configs'));
await prepareProjectConfigs(directory, [path.join(root, 'data/project-center')]);
const store = await createProjectStore(directory);
let nginx, library;
const host = await createProjectHost(store, path.join(root, "dist"), { nginx: () => nginx, library: () => library });
try {
  if (process.env.DEVKIT_SHARE_NGINX === 'true') nginx = await createNginxManager(directory);
  if (process.env.DEVKIT_SHARE_HTTP === 'true') library = await createApiWorkspace(directory);
  const saved = await store.settings();
  const result = await host.start({
    host: process.env.HOST || "0.0.0.0",
    port: Number(process.env.PORT || 8765),
    canEdit: process.env.DEVKIT_PROJECT_EDIT === "true",
    shareNginx: process.env.DEVKIT_SHARE_NGINX === 'true',
    shareHttp: process.env.DEVKIT_SHARE_HTTP === 'true',
    nginxControl: process.env.DEVKIT_NGINX_CONTROL === 'true',
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
  await nginx?.close();
  await library?.close();
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
    await nginx?.close();
    await library?.close();
    await store.close();
  });
