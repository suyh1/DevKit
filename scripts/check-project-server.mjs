import { readFile, mkdtemp, mkdir, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import assert from "node:assert/strict";
import { root } from "./desktop-files.mjs";
import { sha256 } from "./release-integrity.mjs";
const manifest = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const release = path.join(root, `artifacts/release-${manifest.version}`);
const identity = JSON.parse(
  await readFile(path.join(release, "project-server.json"), "utf8"),
);
assert.equal(
  sha256(await readFile(path.join(release, identity.name))),
  identity.sha256,
);
const folder = await mkdtemp(
  path.join(root, "artifacts/project-server-check-"),
);
const installation = path.join(folder, "first");
await mkdir(installation);
const python =
  process.env.DEVKIT_PYTHON ||
  (process.platform === "win32" ? "python" : "python3");
execFileSync(
  python,
  [
    "-c",
    `import sys,zipfile
from pathlib import Path
target=Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 for name in z.namelist():
  assert chr(92) not in name and (target/name).resolve().is_relative_to(target)
 z.extractall(target)
`,
    path.join(release, identity.name),
    installation,
  ],
  { windowsHide: true },
);
const password = "portable-check-password-only";
async function launch(directory, reusePassword = false) {
  const port = await new Promise((resolve) => {
    const socket = net.createServer();
    socket.listen(0, "127.0.0.1", () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    DEVKIT_PROJECT_PASSWORD: password,
    DEVKIT_PROJECT_EDIT: "true",
    DEVKIT_SHARE_PROJECTS: "true",
    DEVKIT_NGINX_EDIT: "true",
    DEVKIT_HTTP_EDIT: "true",
    DEVKIT_SHARE_NGINX: 'true',
    DEVKIT_SHARE_HTTP: 'true',
    DEVKIT_NGINX_CONTROL: 'false',
  };
  delete env.DEVKIT_PROJECT_DATA;
  if (reusePassword) delete env.DEVKIT_PROJECT_PASSWORD;
  const child = spawn(
    process.execPath,
    [path.join(directory, "server/start.mjs")],
    { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        if ((await fetch(base + "/api/projects/session")).ok) break;
      } catch {}
      if (child.exitCode !== null || attempt > 100)
        throw new Error(output || "Standalone host did not start");
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    const response = await fetch(base + "/api/projects/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ password }),
    });
    assert.equal(response.status, 200);
    const capabilities = await response.json();
    assert.equal(capabilities.shareNginx, true);
    assert.equal(capabilities.shareHttp, true);
    assert.equal(capabilities.nginxControl, false);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const request = async (route, method = "GET", body) => {
      const response = await fetch(base + "/api/projects/" + route, {
        method,
        headers: {
          Cookie: cookie,
          Origin: base,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.ok(
        response.ok,
        `${route}: ${response.status} ${await response.clone().text()}`,
      );
      return response.json();
    };
    const workspace = async (module, action, payload = {}) => {
      const result = await fetch(`${base}/api/${module}/${action}`, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      assert.ok(result.ok, await result.clone().text());
      return result.json();
    };
    return { child, base, request, workspace, output: () => output };
  } catch (error) {
    child.kill();
    throw error;
  }
}
async function stop(host) {
  if (host.child.exitCode !== null) return;
  const exit = once(host.child, "exit");
  host.child.kill();
  await exit;
}
let host;
try {
  host = await launch(installation);
  let state = await host.request("state");
  state.profiles[0].projects.push({
    id: "portable",
    code: "portable",
    name: "目录迁移验收",
    group: "验收",
    description: "",
    url: "https://example.test/project?fixed=yes#route",
    enabled: true,
    query: [],
  });
  state = await host.request("state", "PUT", {
    data: state,
    revision: state.revision,
  });
  await host.request("backup", "POST", { name: "可迁移快照" });
  assert.equal(
    JSON.parse(
      await readFile(path.join(installation, `configs/profile-${Buffer.from(state.profiles[0].id).toString("hex")}.json`), "utf8"),
    ).projects[0].name,
    "目录迁移验收",
  );
  assert.equal((await fetch(host.base + "/index.html")).status, 404);
  assert.equal((await fetch(host.base + "/")).status, 200);
  const build = JSON.parse(
    await readFile(path.join(installation, "dist/.vite/manifest.json"), "utf8"),
  );
  for (const item of Object.values(build))
    for (const asset of [item.file, ...(item.css || []), ...(item.assets || [])])
      assert.equal((await fetch(host.base + "/" + asset)).status, 200);
  const api = await host.workspace('http', 'get-library');
  await host.workspace('http', 'save-library', { revision: api.state.revision, data: api.state });
  const configDirectory = path.join(installation, 'nginx-fixture');
  await mkdir(configDirectory);
  const instances = await host.workspace('nginx', 'get');
  const registered = await host.workspace('nginx', 'create', { revision: instances.revision, name: '远程主机路径验收', platform: 'any', executable: '', directory: configDirectory, mainName: 'nginx.conf', commonName: 'common.conf', port: 8080 });
  assert.equal(registered.instances[0].main, path.join(configDirectory, 'nginx.conf'));
  assert.match(await readFile(registered.instances[0].main, 'utf8'), /include/);
  await stop(host);
  host = null;
  const copied = path.join(folder, "second");
  await cp(installation, copied, { recursive: true, filter: source => path.basename(source) !== 'configs' });
  await cp(path.join(installation,'configs'),path.join(copied,'configs'),{recursive:true});
  host = await launch(copied, true);
  assert.equal((await host.request("state")).profiles[0].projects[0].name, "目录迁移验收");
  assert.equal((await host.request("snapshots"))[0].name, "可迁移快照");
  assert.equal((await host.workspace('http', 'get-library')).state.revision, api.state.revision + 1);
  assert.equal((await host.workspace('nginx', 'get')).instances[0].name, '远程主机路径验收');
  const proof = {
    version: manifest.version,
    zip: identity.name,
    sha256: identity.sha256,
    actualExtractedNodeServer: true,
    defaultConfigsBesideServer: true,
    workingDirectoryIndependent: true,
    copiedConfigsReadable: true,
    snapshotsTransferred: true,
    storedPasswordReused: true,
    allPortalAssets: true,
    schemaWorkerAsset: true,
    httpWorkspaceSavedAndTransferred: true,
    remoteNginxCreatedOnHost: true,
    desktopEntryBlocked: true,
    network: "127.0.0.1 only",
  };
  await writeFile(
    path.join(release, "project-server-verification.json"),
    JSON.stringify(proof, null, 2) + "\n",
  );
  console.log(JSON.stringify(proof, null, 2));
} finally {
  if (host) await stop(host);
}
