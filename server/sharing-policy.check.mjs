import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { createProjectStore } from "./project-store.mjs";
import { createProjectHost } from "./project-host.mjs";
import { createNginxManager } from "./nginx-manager.mjs";
import { emptySharingServices, sharingServices } from "../shared/sharing.mjs";
import { sharingFromEnvironment } from "./sharing-environment.mjs";

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function fixture(work) {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "devkit-policy-")),
  );
  let store, host, echo;
  try {
    const dist = path.join(root, "dist");
    await mkdir(path.join(dist, ".vite"), { recursive: true });
    await writeFile(path.join(dist, "portal.html"), "portal");
    await writeFile(
      path.join(dist, ".vite/manifest.json"),
      JSON.stringify({ "portal.html": { file: "portal.html" } }),
    );
    store = await createProjectStore(path.join(root, "configs"));
    let failSave = false;
    const calls = [],
      nginx = {
        request: async (action, payload, options) => {
          calls.push({ action, payload, options });
          return { action };
        },
      },
      library = {
        get: async () => ({ state: { revision: 0 } }),
        save: async () => ({ saved: true }),
        restore: async () => ({ restored: true }),
      };
    host = await createProjectHost(
      {
        ...store,
        saveSettings: (value) =>
          failSave
            ? Promise.reject(new Error("fixture settings write failed"))
            : store.saveSettings(value),
      },
      dist,
      { nginx: () => nginx, library: () => library },
    );
    echo = http.createServer((_req, res) => {
      res.setHeader("Content-Type", "text/plain");
      res.end("host response");
    });
    await new Promise((resolve) => echo.listen(0, "127.0.0.1", resolve));
    let origin, cookie;
    const options = {
      host: "127.0.0.1",
      port: await freePort(),
      password: "policy-test-only",
    };
    const call = (
      route,
      payload,
      method = payload === undefined ? "GET" : "POST",
      token = cookie,
    ) =>
      fetch(origin + route, {
        method,
        headers: {
          Cookie: token || "",
          Connection: "close",
          Origin: origin,
          ...(payload !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
    const start = async (services) => {
      await host.start({ ...options, services });
      origin = host.status().addresses[0].slice(0, -1);
      const login = await call("/api/sharing/login", {
        password: options.password,
      });
      assert.equal(login.status, 200);
      cookie = login.headers.get("set-cookie").split(";")[0];
      return login.json();
    };
    await work({
      root,
      store,
      host,
      calls,
      options,
      call,
      start,
      echoUrl: `http://127.0.0.1:${echo.address().port}`,
      failSave: (value) => {
        failSave = value;
      },
    });
  } finally {
    await host?.stop();
    if (echo) {
      echo.closeAllConnections();
      await new Promise((resolve) => echo.close(resolve));
    }
    await store?.close();
    assert.equal(path.dirname(root), await realpath(tmpdir()));
    assert.ok(path.basename(root).startsWith("devkit-policy-"));
    await rm(root, { recursive: true, force: true });
  }
}

test("fresh defaults, migration and environment overrides never grant hidden service permissions", () => {
  assert.deepEqual(sharingServices(), emptySharingServices());
  const old = sharingServices({
    canEdit: true,
    shareNginx: true,
    shareHttp: false,
    nginxControl: true,
  });
  assert.deepEqual(old, {
    projects: { enabled: true, edit: true, probe: true },
    nginx: { enabled: true, edit: true, control: true },
    http: { enabled: false, edit: false, send: false },
  });
  const disabled = emptySharingServices();
  disabled.nginx = { enabled: false, edit: true, control: true };
  assert.deepEqual(sharingServices({ services: disabled }).nginx, {
    enabled: false,
    edit: false,
    control: false,
  });
  assert.equal(
    sharingServices({ canEdit: false, shareNginx: true, nginxControl: true })
      .nginx.control,
    false,
  );
  const cli = sharingFromEnvironment(
    {
      DEVKIT_SHARE_PROJECTS: "false",
      DEVKIT_SHARE_HTTP: "true",
      DEVKIT_HTTP_SEND: "true",
      DEVKIT_HTTP_EDIT: "false",
    },
    { services: old },
  );
  assert.deepEqual(cli.projects, { enabled: false, edit: false, probe: false });
  assert.deepEqual(cli.http, { enabled: true, edit: false, send: true });
  assert.throws(
    () => sharingFromEnvironment({ DEVKIT_HTTP_SEND: "yes" }),
    /true.*false/,
  );
  assert.throws(
    () =>
      sharingServices({
        services: {
          ...emptySharingServices(),
          http: { enabled: true, send: "true" },
        },
      }),
    /布尔值/,
  );
});

test("each service can be the only service and disabled routes remain inaccessible after login", () =>
  fixture(async ({ host, start, call, options }) => {
    assert.deepEqual(host.status().services, emptySharingServices());
    await assert.rejects(
      host.start({ ...options, services: emptySharingServices() }),
      /至少/,
    );
    for (const id of ["projects", "nginx", "http"]) {
      const services = emptySharingServices();
      services[id].enabled = true;
      const auth = await start(services);
      assert.deepEqual(auth.services, services);
      assert.equal(
        (await call("/api/projects/state")).status,
        id === "projects" ? 200 : 404,
      );
      assert.equal(
        (await call("/api/nginx/get", {})).status,
        id === "nginx" ? 200 : 404,
      );
      assert.equal(
        (await call("/api/http/get-library", {})).status,
        id === "http" ? 200 : 404,
      );
      for (const [service, route] of [
        ["projects", "state"],
        ["projects", "snapshots"],
        ["projects", "restore"],
        ["projects", "probe"],
        ["nginx", "command"],
        ["http", "send"],
      ])
        if (service !== id)
          assert.equal(
            (await call(`/api/${service}/${route}`, {})).status,
            404,
          );
      assert.equal((await call("/api/sharing/session")).status, 200);
      assert.equal((await call("/api/sharing/logout", {})).status, 200);
      assert.equal(
        (await call("/api/sharing/session")).headers.get("set-cookie"),
        null,
      );
    }
  }));

test("edit, probe, HTTP send and Nginx operation are independently enforced on the host", () =>
  fixture(async ({ start, call, calls, echoUrl, store }) => {
    const data = await store.get();
    data.profiles[0].projects.push({
      id: "probe",
      code: "probe",
      name: "probe",
      group: "",
      description: "",
      url: echoUrl,
      query: [],
      enabled: true,
    });
    await store.save(data, data.revision);
    let services = emptySharingServices();
    services.projects = { enabled: true, edit: false, probe: true };
    await start(services);
    assert.equal(
      (
        await call("/api/projects/probe", {
          profileId: data.profiles[0].id,
          projectIds: ["probe"],
        })
      ).status,
      200,
    );
    assert.equal(
      (await call("/api/projects/state", { data, revision: 1 }, "PUT")).status,
      403,
    );
    services = emptySharingServices();
    services.http = { enabled: true, edit: false, send: true };
    await start(services);
    const sent = await call("/api/http/send", {
      id: "send-only",
      request: { url: echoUrl },
    });
    assert.equal(sent.status, 200);
    assert.equal((await sent.json()).body, "host response");
    assert.equal((await call("/api/http/save-library", {})).status, 403);
    services.http = { enabled: true, edit: true, send: false };
    await start(services);
    assert.equal((await call("/api/http/save-library", {})).status, 200);
    assert.equal(
      (
        await call("/api/http/send", {
          id: "no-send",
          request: { url: echoUrl },
        })
      ).status,
      403,
    );
    services = emptySharingServices();
    services.nginx = { enabled: true, edit: false, control: true };
    await start(services);
    assert.equal(
      (await call("/api/nginx/command", { command: "test" })).status,
      200,
    );
    assert.equal((await call("/api/nginx/upsert", {})).status, 403);
    services.nginx = { enabled: true, edit: true, control: false };
    await start(services);
    assert.equal((await call("/api/nginx/upsert", {})).status, 200);
    assert.equal((await call("/api/nginx/detect", {})).status, 403);
    assert.equal((await call("/api/nginx/command", {})).status, 403);
    await call("/api/nginx/statuses", {});
    assert.equal(calls.at(-1).options.allowExecution, false);
  }));

test("failed rebind, empty selections and failed persistence keep the previous host and sessions intact", () =>
  fixture(async ({ start, call, host, options, store, failSave }) => {
    const services = emptySharingServices();
    services.projects.enabled = true;
    await start(services);
    const before = await store.settings();
    const occupied = net.createServer();
    await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    try {
      await assert.rejects(
        host.start({ ...options, port: occupied.address().port, services }),
        /EADDRINUSE/,
      );
      assert.equal(host.status().running, true);
      assert.equal(host.status().port, options.port);
      assert.equal((await call("/api/projects/state")).status, 200);
      await assert.rejects(
        host.start({ ...options, services: emptySharingServices() }),
        /至少/,
      );
      failSave(true);
      const changed = structuredClone(services);
      changed.projects.edit = true;
      await assert.rejects(
        host.start({ ...options, services: changed }),
        /fixture settings/,
      );
      await assert.rejects(
        host.start({ ...options, port: await freePort(), services: changed }),
        /fixture settings/,
      );
      assert.equal((await call("/api/projects/state")).status, 200);
      assert.equal(host.status().services.projects.edit, false);
      assert.deepEqual(await store.settings(), before);
      await assert.rejects(host.start({...options,host:'0.0.0.0',services:changed}), /fixture settings/);
      assert.equal(host.status().host,'127.0.0.1');
      assert.equal(host.status().running,true);
      assert.equal((await call('/api/projects/state')).status,200);
      assert.deepEqual(await store.settings(),before);
      failSave(false);
      await host.start({...options,host:'0.0.0.0',services});
      assert.equal(host.status().host,'0.0.0.0');
      assert.equal(host.status().port,options.port);
      assert.equal((await call('/api/projects/state')).status,401);
      await start(services);
      assert.equal(host.status().host,'127.0.0.1');
      assert.equal((await call('/api/projects/state')).status,200);
    } finally {
      failSave(false);
      await new Promise((resolve) => occupied.close(resolve));
    }
  }));

test("Nginx read-only inspection never launches the configured executable and cannot bypass execution grants", async () => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "devkit-policy-")),
  );
  let manager,
    detections = 0;
  try {
    const main = path.join(root, "nginx.conf"),
      executable = path.join(
        root,
        process.platform === "win32" ? "fake.exe" : "fake",
      );
    await writeFile(main, "events {} http {}");
    await writeFile(executable, "not executable");
    manager = await createNginxManager(path.join(root, "configs"), {
      detect: async () => {
        detections++;
        return { found: false, output: "fixture no binary" };
      },
    });
    const registered = await manager.request(
      "upsert",
      {
        revision: 0,
        instance: {
          name: "read-only",
          main,
          executable,
          prefix: root,
          files: [],
          platform: "any",
        },
      },
      { allowExecution: false },
    );
    const status = await manager.request(
      "statuses",
      {},
      { allowExecution: false },
    );
    assert.equal(status[0].state, "unknown");
    assert.equal(detections, 0);
    await assert.rejects(
      manager.request("detect", {}, { allowExecution: false }),
      /运行管理权限/,
    );
    const document = (
      await manager.request("documents", { id: registered.instances[0].id })
    ).files[0];
    await assert.rejects(
      manager.request(
        "save-files",
        {
          id: registered.instances[0].id,
          files: [
            { ...document, content: "pid logs/new.pid; events {} http {}" },
          ],
        },
        { allowExecution: false },
      ),
      /未确认停止/,
    );
    assert.equal(detections, 0);
    assert.equal(await readFile(main, "utf8"), "events {} http {}");
    await manager.request("statuses");
    assert.equal(detections, 1);
  } finally {
    await manager?.close();
    assert.equal(path.dirname(root), await realpath(tmpdir()));
    assert.ok(path.basename(root).startsWith("devkit-policy-"));
    await rm(root, { recursive: true, force: true });
  }
});

test('logout is idempotent for anonymous and invalidated sessions, including closed projects and old route aliases', () => fixture(async ({start,call,host,options}) => {
  const services=emptySharingServices(); services.http.enabled=true;
  await start(services);
  await host.start({...options,services});
  for(const route of ['/api/sharing/logout','/api/projects/logout']) {
    const result=await call(route,{},'POST');
    assert.equal(result.status,200);
    assert.match(result.headers.get('set-cookie'),/Max-Age=0/);
  }
  const anonymous=await call('/api/sharing/logout',{},'POST','');
  assert.equal(anonymous.status,200);
  assert.equal((await (await call('/api/sharing/session')).json()).authenticated,false);
}));
