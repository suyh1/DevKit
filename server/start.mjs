import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectStore } from "./project-store.mjs";
import { createProjectHost } from "./project-host.mjs";
import { prepareProjectConfigs } from './project-configs.mjs';
import { createNginxManager } from './nginx-manager.mjs';
import { createApiWorkspace } from './api-workspace.mjs';
import { createJarManager } from './jar-manager.mjs';
import { createMonitorManager } from './monitor-manager.mjs';
import { createLogCenter } from './log-center.mjs';
import { sharingFromEnvironment } from './sharing-environment.mjs';
import { createLanWorkspaces } from './lan-workspaces.mjs';
import { createFileShares } from './file-shares.mjs';
import { createProjectTodos } from './project-todos.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = path.resolve(process.env.DEVKIT_PROJECT_DATA || path.join(root, 'configs'));
await prepareProjectConfigs(directory, [path.join(root, 'data/project-center')]);
const store = await createProjectStore(directory);
let nginx, library, jar, monitor, lan, fileShares, projectTodos;
const logs = createLogCenter({ nginx: () => nginx, jar: () => jar, lan: () => lan });
const host = await createProjectHost(store, path.join(root, "dist"), { nginx: () => nginx, library: () => library, jar: () => jar, monitor: () => monitor, logs: () => logs, lan: () => lan, fileShares: () => fileShares, projectTodos: () => projectTodos });
try {
  lan = await createLanWorkspaces(directory);
  const saved = await store.settings();
  const services = sharingFromEnvironment(process.env, saved);
  if (services.nginx.enabled || services.logs.nginx) nginx = await createNginxManager(directory);
  if (services.http.enabled) library = await createApiWorkspace(directory);
  jar = await createJarManager(directory);
  monitor = await createMonitorManager(directory, { projects: () => store, jar: () => jar, lan: () => lan });
  fileShares = await createFileShares(directory).catch(error => console.error(`文件共享配置：${error.message}`));
  if (services['project-todos'].enabled)
    projectTodos = await createProjectTodos(directory).catch(error => console.error(`项目与待办配置：${error.message}`));
  const result = await host.start({
    host: process.env.HOST || "0.0.0.0",
    port: Number(process.env.PORT || 8765),
    services,
    ...(process.env.DEVKIT_SHARE_CERT || process.env.DEVKIT_SHARE_KEY ? { tls: { cert: process.env.DEVKIT_SHARE_CERT, key: process.env.DEVKIT_SHARE_KEY, hostname: process.env.DEVKIT_SHARE_HOSTNAME } } : {}),
    password:
      process.env.DEVKIT_PROJECT_PASSWORD || (saved.hash ? "" : undefined),
  });
  console.log(
    "DevKit shared workspaces:",
    result.addresses.join("\n"),
    "\nData:",
    result.directory,
  );
} catch (error) {
  await fileShares?.close();
  await projectTodos?.close();
  lan?.close();
  await monitor?.close();
  await nginx?.close();
  await library?.close();
  await jar?.close();
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
    await fileShares?.close();
    await projectTodos?.close();
    lan?.close();
    await monitor?.close();
    await nginx?.close();
    await library?.close();
    await jar?.close();
    await store.close();
  });
