import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from "node:path";
import { tmpdir } from "node:os";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
  cp,
} from "node:fs/promises";
import { createProjectHost } from "./project-host.mjs";
import { createProjectStore } from "./project-store.mjs";
import { createNginxManager } from "./nginx-manager.mjs";
import { createApiWorkspace } from "./api-workspace.mjs";

const freePort = async () => {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
};

test('standalone service exposes opt-in workspaces without installed npm dependencies', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'devkit-sharing-server-')));
  let child;
  try {
    const source = path.dirname(fileURLToPath(import.meta.url));
    for (const folder of ['server', 'shared']) await cp(path.join(source, '..', folder), path.join(directory, folder), { recursive: true, filter: file => !/\.(check|test)\.mjs$/.test(file) });
    await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
    await mkdir(path.join(directory, 'dist/.vite'), { recursive: true });
    await writeFile(path.join(directory, 'dist/portal.html'), 'shared portal');
    await writeFile(path.join(directory, 'dist/.vite/manifest.json'), JSON.stringify({ 'portal.html': { file: 'portal.html' } }));
    const origin = `http://127.0.0.1:${await freePort()}`;
    child = spawn(process.execPath, [path.join(directory, 'server/start.mjs')], { cwd: tmpdir(), windowsHide: true, env: { ...process.env, HOST: '127.0.0.1', PORT: new URL(origin).port, DEVKIT_PROJECT_DATA: path.join(directory, 'configs'), DEVKIT_PROJECT_PASSWORD: 'standalone-test-only', DEVKIT_PROJECT_EDIT: 'true', DEVKIT_SHARE_NGINX: 'true', DEVKIT_SHARE_HTTP: 'true', DEVKIT_NGINX_CONTROL: 'false' } });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(output);
      try { ready = (await fetch(origin + '/api/projects/session')).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(ready, true, output);
    const login = await fetch(origin + '/api/projects/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{"password":"standalone-test-only"}' });
    const capabilities = await login.json();
    assert.equal(capabilities.shareNginx, true); assert.equal(capabilities.shareHttp, true); assert.equal(capabilities.nginxControl, false);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    for (const route of ['/api/http/get-library', '/api/nginx/get']) {
      const response = await fetch(origin + route, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 200, await response.text());
    }
    assert.ok((await readFile(path.join(directory, 'configs/sharing.json'), 'utf8')).includes('shareHttp'));
  } finally {
    if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
    assert.equal(path.dirname(directory), await realpath(tmpdir()));
    assert.ok(path.basename(directory).startsWith('devkit-sharing-server-'));
    await rm(directory, { recursive: true, force: true });
  }
});
test("LAN workspaces: opt-in, roles, shared files, conflicts, origin checks and per-session HTTP cancellation", async () => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "devkit-sharing-")),
  );
  const dist = path.join(root, "dist");
  await mkdir(path.join(dist, ".vite"), { recursive: true });
  await writeFile(path.join(dist, "portal.html"), "portal");
  await writeFile(
    path.join(dist, ".vite/manifest.json"),
    JSON.stringify({ "portal.html": { file: "portal.html" } }),
  );
  const store = await createProjectStore(path.join(root, "configs"));
  const nginx = await createNginxManager(path.join(root, "configs"));
  const library = await createApiWorkspace(path.join(root, "configs"));
  const host = await createProjectHost(store, dist, {
    nginx: () => nginx,
    library: () => library,
  });
  const target = http.createServer((req, res) => {
    if (req.url === "/slow") {
      req.on("close", () => res.destroy());
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end('{"id":9007199254740993}');
  });
  await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
  let origin;
  const options = {
    host: "127.0.0.1",
    port: await freePort(),
    password: "sharing-test-only",
    canEdit: false,
  };
  const call = async (route, cookie, payload = {}, source) =>
    fetch(`${origin}${route}`, {
      method: "POST",
      headers: {
        Cookie: cookie || "",
        Origin: source || origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  const start = async (extra) => {
    await host.start({ ...options, ...extra });
    origin = host.status().addresses[0].slice(0, -1);
  };
  const login = async () =>
    (
      await call("/api/projects/login", "", { password: options.password })
    ).headers
      .get("set-cookie")
      .split(";")[0];
  try {
    const conf = path.join(root, "nginx.conf");
    await writeFile(conf, "events {} http {}");
    const state = await nginx.request("get");
    const registered = await nginx.request("upsert", {
      revision: state.revision,
      instance: {
        name: "shared",
        main: conf,
        prefix: root,
        files: [],
        executable: process.env.DEVKIT_NGINX_TEST_EXECUTABLE || "",
        platform: "any",
      },
    });
    const id = registered.instances[0].id;
    await start({});
    let cookie = await login();
    assert.equal((await call("/api/http/get-library", cookie)).status, 404);
    assert.equal((await call("/api/nginx/get", cookie)).status, 404);
    await start({ shareNginx: true, shareHttp: true });
    cookie = await login();
    assert.equal((await call("/api/nginx/get")).status, 401);
    assert.equal(
      (await call("/api/nginx/get", cookie, {}, "http://evil.test")).status,
      403,
    );
    assert.equal(
      (await call("/api/nginx/documents", cookie, { id })).status,
      200,
    );
    assert.equal((await call("/api/http/get-library", cookie)).status, 200);
    for (const route of [
      "/api/http/send",
      "/api/http/save-library",
      "/api/http/restore-library",
      "/api/nginx/save-files",
      "/api/nginx/command",
      ...['create', 'upsert', 'remove', 'detect', 'discover'].map(action => `/api/nginx/${action}`),
    ])
      assert.equal((await call(route, cookie)).status, 403);
    await start({ shareNginx: true, shareHttp: true, canEdit: true });
    cookie = await login();
    for (const action of ["detect", "pick"])
      assert.equal((await call(`/api/nginx/${action}`, cookie)).status, 403);
    const discovered = await call('/api/nginx/discover', cookie, { main: conf });
    assert.equal(discovered.status, 200);
    assert.equal((await discovered.json()).main, conf);
    const original = (await nginx.request('get')).instances[0];
    const revision = (await nginx.request('get')).revision;
    const edited = await call('/api/nginx/upsert', cookie, { revision, instance: { ...original, name: 'remote-host-path' } });
    assert.equal(edited.status, 200);
    assert.equal((await nginx.request('get')).instances[0].name, 'remote-host-path');
    assert.notEqual((await call('/api/nginx/upsert', cookie, { revision, instance: original })).status, 200);
    const destination = path.join(root, 'remote-created');
    await mkdir(destination);
    const created = await call('/api/nginx/create', cookie, { revision: (await nginx.request('get')).revision, name: 'remote-created', platform: 'any', executable: '', directory: destination, mainName: 'nginx.conf', commonName: 'common.conf', port: 8080 });
    assert.equal(created.status, 200);
    const added = (await created.json()).instances.find(instance => instance.name === 'remote-created');
    assert.match(await readFile(path.join(destination, 'nginx.conf'), 'utf8'), /include/);
    const removed = await call('/api/nginx/remove', cookie, { id: added.id, revision: (await nginx.request('get')).revision, forgetOnly: true });
    assert.equal(removed.status, 200);
    assert.match(await readFile(path.join(destination, 'nginx.conf'), 'utf8'), /include/);
    assert.equal(
      (await call("/api/nginx/command", cookie, { id, command: "test" }))
        .status,
      403,
    );
    const files = (
      await (await call("/api/nginx/documents", cookie, { id })).json()
    ).files;
    const changed = files.map((file) => ({
      ...file,
      content: "events {} http { # LAN\n }",
    }));
    assert.equal(
      (await call("/api/nginx/save-files", cookie, { id, files: changed }))
        .status,
      200,
    );
    assert.match(await readFile(conf, "utf8"), /LAN/);
    assert.notEqual(
      (await call("/api/nginx/save-files", cookie, { id, files: changed }))
        .status,
      200,
    );
    const initial = await library.get();
    assert.equal(
      (
        await call("/api/http/save-library", cookie, {
          data: initial.state,
          revision: initial.state.revision,
        })
      ).status,
      200,
    );
    assert.notEqual(
      (
        await call("/api/http/save-library", cookie, {
          data: initial.state,
          revision: initial.state.revision,
        })
      ).status,
      200,
    );
    const base = `http://127.0.0.1:${target.address().port}`;
    const response = await call("/api/http/send", cookie, {
      id: "echo",
      request: { url: base, method: "GET", headers: {}, timeout: 2000 },
    });
    assert.equal(response.status, 200);
    assert.match((await response.json()).body, /9007199254740993/);
    const second = await login();
    const pending = call("/api/http/send", cookie, {
      id: "same-id",
      request: {
        url: base + "/slow",
        method: "GET",
        headers: {},
        timeout: 4000,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(
      await (await call("/api/http/cancel", second, { id: "same-id" })).json(),
      false,
    );
    assert.equal(
      await (await call("/api/http/cancel", cookie, { id: "same-id" })).json(),
      true,
    );
    assert.match((await (await pending).json()).error, /取消/);
    const pendingLogout = call("/api/http/send", cookie, {
      id: "logout",
      request: {
        url: base + "/slow",
        method: "GET",
        headers: {},
        timeout: 4000,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    await call("/api/projects/logout", cookie);
    assert.match((await (await pendingLogout).json()).error, /取消/);
    assert.equal((await call("/api/http/get-library", cookie)).status, 401);
    await start({ shareNginx: true, canEdit: true, nginxControl: true });
    cookie = await login();
    assert.equal(
      (
        await call("/api/nginx/command", cookie, {
          id: "missing",
          command: "test",
        })
      ).status,
      400,
    );
    if (process.env.DEVKIT_NGINX_TEST_EXECUTABLE) {
      for (const command of ["test", "start", "reload", "stop"]) {
        const result = await (
          await call("/api/nginx/command", cookie, { id, command })
        ).json();
        assert.equal(result.ok, true, JSON.stringify(result));
      }
    }
  } finally {
    if (process.env.DEVKIT_NGINX_TEST_EXECUTABLE) {
      const state = await nginx.request("get");
      for (const instance of state.instances)
        await nginx
          .request("command", { id: instance.id, command: "stop" })
          .catch(() => {});
    }
    await host.stop();
    target.closeAllConnections();
    await new Promise((resolve) => target.close(resolve));
    await library.close();
    await nginx.close();
    await store.close();
    assert.equal(path.dirname(root), await realpath(tmpdir()));
    assert.ok(path.basename(root).startsWith("devkit-sharing-"));
    await rm(root, { recursive: true, force: true });
  }
});
