import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
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
import { createApiWorkspace } from './api-workspace.mjs';
import { initialApiState, newApiEndpoint } from '../shared/api-workspace.mjs';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
test('TLS listens on the configured endpoint and sends a Secure cookie', { skip: !process.env.DEVKIT_TEST_OPENSSL }, async () => fixture(async ({ root, host, options }) => {
  const key = path.join(root, 'test.key'), cert = path.join(root, 'test.crt');
  execFileSync(process.env.DEVKIT_TEST_OPENSSL, ['req', '-x509', '-newkey', 'rsa:2048', '-noenc', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', cert], { stdio: 'ignore' });
  const services = emptySharingServices(); services.projects.enabled = true;
  const state = await host.start({ ...options, services, tls: { cert, key, hostname: '127.0.0.1' } });
  const [url] = state.addresses;
  assert.match(url, /^https:\/\//);
  const payload = JSON.stringify({ password: options.password }), ca = await readFile(cert);
  const response = await new Promise((resolve, reject) => {
    const req = https.request(new URL('/api/sharing/login', url), { ca, method: 'POST', headers: { Origin: url.slice(0, -1), 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, res => { res.resume(); res.once('end', () => resolve(res)); });
    req.once('error', reject); req.end(payload);
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['set-cookie'][0], /; Secure/);
  assert.ok(response.headers['strict-transport-security']);
}));
async function fixture(work) {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "devkit-policy-")),
  );
  let store, host, echo, library;
  try {
    const dist = path.join(root, "dist");
    await mkdir(path.join(dist, ".vite"), { recursive: true });
    await writeFile(path.join(dist, "portal.html"), "portal");
    await writeFile(
      path.join(dist, ".vite/manifest.json"),
      JSON.stringify({ "portal.html": { file: "portal.html" } }),
    );
    store = await createProjectStore(path.join(root, "configs"));
    let failSave = false, readLog;
    const calls = [],
      nginx = {
        request: async (action, payload, options) => {
          calls.push({ action, payload, options });
          return { action };
        },
      };
    library = await createApiWorkspace(path.join(root, 'configs'));
    host = await createProjectHost(
      {
        ...store,
        saveSettings: (value) =>
          failSave
            ? Promise.reject(new Error("fixture settings write failed"))
            : store.saveSettings(value),
      },
      dist,
      { nginx: () => nginx, logs: () => ({ request: () => readLog() }), library: () => ({
        get: () => library.get(),
        save: async () => ({ saved: true }),
        restore: async () => ({ restored: true }),
      }) },
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
      library,
      calls,
      options,
      call,
      start,
      interceptLogRead: read => { readLog = read; },
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
    await library?.close();
    assert.equal(path.dirname(root), await realpath(tmpdir()));
    assert.ok(path.basename(root).startsWith("devkit-policy-"));
    await rm(root, { recursive: true, force: true });
  }
}

test('revoking a log grant discards the body of an already authorized read', () =>
  fixture(async ({ start, call, host, options, interceptLogRead }) => {
    const services = emptySharingServices();
    services.logs = { ...services.logs, enabled: true, jar: true };
    await start(services);
    const accepted = Promise.withResolvers(), completion = Promise.withResolvers();
    interceptLogRead(() => { accepted.resolve(); return completion.promise; });
    const pending = call('/api/logs/read', { sources: [{ id: 'a'.repeat(64) }] });
    try {
      await accepted.promise;
      services.logs.jar = false;
      await host.start({ ...options, password: '', services });
    } finally {
      completion.resolve({ results: [{ text: 'revoked-pending-secret' }] });
    }
    const response = await pending;
    assert.equal(response.status, 401);
    assert.doesNotMatch(await response.text(), /revoked-pending-secret/);
  }));

test('HTTP documentation-only visitors receive a credential-free library; sending and editing preserve existing access', () =>
  fixture(async ({ start, call, library }) => {
    const endpoint = newApiEndpoint('protected');
    endpoint.name = 'Protected example';
    endpoint.path = '/users';
    endpoint.server = 'https://user:server-secret@example.test/?access_token=query-secret&page=2';
    endpoint.auth = { ...endpoint.auth, type: 'bearer', token: 'bearer-secret', password: 'auth-password', value: 'auth-value' };
    endpoint.parameters = ['session', 'region'].map((name, index) => ({
      id: name, name, location: index ? 'query' : 'cookie', type: 'string', required: false, enabled: true, description: '', example: index ? 'shanghai' : 'cookie-secret',
    }));
    endpoint.bodyKind = 'json';
    endpoint.body = JSON.stringify({ password: 'escaped"body-secret', page: 2 });
    endpoint.requestSchema = JSON.stringify({ type: 'object', properties: { password: { type: 'string', default: 'schema-secret' } } });
    endpoint.responses = [{ id: 'ok', status: '200', description: '', contentType: 'application/json', schema: '', example: '{"token":"response-secret","cookie":{"ignored":"nested-example-secret"},"id":9223372036854775807}' }];
    await library.save({ ...initialApiState(), projects: [{
      id: 'project', name: 'Project', description: '', baseUrl: 'https://example.test/', groups: [], endpoints: [endpoint],
      environments: [{ id: 'prod', name: 'Prod', baseUrl: '', variables: [{ key: 'ACCOUNT', value: 'environment-secret', enabled: true }] }],
    }] }, 0);
    const services = emptySharingServices(); services.http.enabled = true;
    await start(services);
    const view = await (await call('/api/http/get-library', {})).json();
    const safe = view.state.projects[0].endpoints[0];
    assert.doesNotMatch(JSON.stringify(view), /bearer-secret|auth-password|auth-value|server-secret|query-secret|cookie-secret|body-secret|schema-secret|response-secret|environment-secret|nested-example-secret/);
    assert.match(safe.responses[0].example, /9223372036854775807/);
    assert.match(safe.server, /page=2/);
    assert.equal(safe.parameters[1].example, 'shanghai');
    assert.equal(JSON.parse(safe.body).page, 2);
    assert.equal((await call('/api/http/send', {})).status, 403);
    for (const permission of ['edit', 'send']) {
      services.http.edit = permission === 'edit'; services.http.send = permission === 'send';
      await start(services);
      const result = await (await call('/api/http/get-library', {})).json();
      assert.equal(result.state.projects[0].endpoints[0].auth.token, 'bearer-secret');
    }
  }));

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
    'project-todos': { enabled: false, edit: false },
    'file-shares': { enabled: false },
    nginx: { enabled: true, edit: true, control: true },
    http: { enabled: false, edit: false, send: false },
    jar: { enabled: false, edit: false, control: false },
    monitor: { enabled: false, edit: false, control: false },
    logs: { enabled: false, jar: false, nginx: false, export: false, raw: false },
    'lan-hosts': { enabled: false, edit: false, diagnose: false, terminal: false, files: false, discover: false, wake: false, rdp: false },
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
      DEVKIT_SHARE_LAN_HOSTS: "true",
      DEVKIT_SHARE_FILE_SHARES: "true",
      DEVKIT_SHARE_PROJECT_TODOS: "true",
      DEVKIT_PROJECT_TODOS_EDIT: "true",
    },
    { services: old },
  );
  assert.deepEqual(cli.projects, { enabled: false, edit: false, probe: false });
  assert.deepEqual(cli.http, { enabled: true, edit: false, send: true });
  assert.deepEqual(cli['lan-hosts'], { ...old['lan-hosts'], enabled: true });
  assert.deepEqual(cli['file-shares'], { enabled: true });
  assert.deepEqual(cli['project-todos'], { enabled: true, edit: true });
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

test('named grants intersect publication permissions and removing one visitor revokes only that session', async () => fixture(async ({ host, store, options, call, start }) => {
  const global = emptySharingServices();
  global.projects.enabled = true;
  global.http.enabled = true;
  await start(global);
  const project = emptySharingServices(), http = emptySharingServices();
  project.projects = { enabled: true, edit: true, probe: true };
  http.http = { enabled: true, edit: true, send: true };
  const visitors = [
    { name: '访客A', password: 'named-test-A', services: project },
    { name: '访客B', password: 'named-test-B', services: http },
  ];
  await host.start({ ...options, password: '', services: global, allowDefault: false, visitors });
  assert.equal((await call('/api/sharing/login', { password: options.password })).status, 401);
  async function login(visitor) {
    const response = await call('/api/sharing/login', { visitor: visitor.name, password: visitor.password }, 'POST', '');
    assert.equal(response.status, 200);
    return { cookie: response.headers.get('set-cookie').split(';')[0], session: await response.json() };
  }
  const a = await login(visitors[0]), b = await login(visitors[1]);
  assert.equal(a.session.services.projects.edit, false);
  assert.equal(a.session.services.http.enabled, false);
  assert.equal(b.session.services.http.send, false);
  assert.equal((await call('/api/projects/state', undefined, 'GET', b.cookie)).status, 404);
  await host.start({ ...options, password: '', services: global, allowDefault: false, visitors: [{ name: visitors[1].name, services: http }] });
  assert.equal((await call('/api/projects/state', undefined, 'GET', a.cookie)).status, 401);
  assert.equal((await call('/api/http/get-library', {}, 'POST', b.cookie)).status, 200);
  const records = await host.audit();
  assert.ok(records.some(item => item.visitor === visitors[0].name && item.outcome === 'revoked'));
  assert.ok(!JSON.stringify(records).includes(visitors[1].password));
  assert.ok(!JSON.stringify(await store.settings()).includes(visitors[1].password));
}));

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
