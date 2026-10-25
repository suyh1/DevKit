import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  mkdir,
  cp,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import {
  initialState,
  validateState,
  resolveProject,
  exportState,
  importState,
  mergeProjectState,
} from "../shared/projects.mjs";
import { createProjectStore } from "./project-store.mjs";
import { createProjectHost } from "./project-host.mjs";
import { probeProjects } from "./project-probe.mjs";
import { prepareProjectConfigs } from "./project-configs.mjs";

const project = {
  id: "web",
  name: "网站",
  code: "web",
  group: "前端",
  description: "",
  url: "http://{{host}}:8080/path",
  enabled: true,
  query: [
    { id: "one", key: "tag", value: "中文 & {{host}}", enabled: true },
    { id: "two", key: "tag", value: "other", enabled: true },
  ],
};
const fixture = () => ({
  ...initialState(),
  projects: [structuredClone(project)],
});
async function temporary(work) {
  const folder = await mkdtemp(path.join(tmpdir(), "devkit-project-test-"));
  try {
    return await work(folder);
  } finally {
    assert.equal(path.dirname(path.resolve(folder)), path.resolve(tmpdir()));
    assert.ok(path.basename(folder).startsWith("devkit-project-test-"));
    await rm(folder, { recursive: true, force: true });
  }
}
async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
test("environment variables resolve without losing duplicate query rows or mutating project definitions", () => {
  const state = validateState(fixture()),
    profile = state.profiles[0];
  const result = resolveProject(state.projects[0], profile),
    url = new URL(result.url);
  assert.deepEqual(url.searchParams.getAll("tag"), [
    "中文 & 127.0.0.1",
    "other",
  ]);
  assert.equal(result.localOnly, true);
  assert.equal(state.projects[0].url, project.url);
  const other = {
    ...profile,
    variables: [{ key: "host", value: "192.168.2.3" }],
    overrides: [
      { projectId: "web", url: "https://{{host}}/test", enabled: false },
    ],
  };
  assert.equal(resolveProject(project, other).enabled, false);
  assert.match(
    resolveProject(project, other).url,
    /^https:\/\/192\.168\.2\.3\/test/,
  );
});
test("missing variables and invalid schemes/credentials fail closed, templates never execute code", () => {
  const profile = initialState().profiles[0];
  assert.match(
    resolveProject({ ...project, url: "http://{{missing}}/" }, profile).error,
    /缺少变量/,
  );
  for (const url of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:pass@example.com/",
    "http://{{bad-template}}/",
  ])
    assert.ok(resolveProject({ ...project, url }, profile).error);
});

test("URL previews ignore empty rows, validate unnamed values and preserve existing query/path/fragment", () => {
  const profile = initialState().profiles[0];
  const input = {
    ...project,
    url: " https://example.test/console?existing=a%26b#section ",
    query: [
      { id: "empty", key: " ", value: "", enabled: true },
      { id: "disabled", key: "ignored", value: "x", enabled: false },
      { id: "query", key: " q ", value: "中文 & # /", enabled: true },
      { id: "repeat", key: "q", value: "two", enabled: true },
    ],
  };
  const parsed = new URL(resolveProject(input, profile).url);
  assert.equal(parsed.pathname, "/console");
  assert.equal(parsed.hash, "#section");
  assert.equal(parsed.searchParams.get("existing"), "a&b");
  assert.deepEqual(parsed.searchParams.getAll("q"), ["中文 & # /", "two"]);
  assert.equal(parsed.searchParams.has(""), false);
  assert.equal(
    resolveProject(
      {
        ...input,
        url: "http://www.baidu.com",
        query: [{ key: "q", value: "value", enabled: true }],
      },
      profile,
    ).url,
    "http://www.baidu.com/?q=value",
  );
  assert.match(
    resolveProject(
      { ...input, query: [{ key: "", value: "filled", enabled: true }] },
      profile,
    ).error,
    /缺少参数名/,
  );
  assert.throws(
    () =>
      validateState({
        ...initialState(),
        projects: [
          {
            ...input,
            query: [{ id: "bad", key: "", value: "filled", enabled: true }],
          },
        ],
      }),
    /参数名/,
  );
});

test("merge imports by code/name, remap colliding IDs, retain other data and attach overrides correctly", () => {
  const current = validateState(fixture());
  current.profiles[0].variables.push({ key: "keep", value: "retained" });
  const imported = validateState({
    ...initialState(),
    projects: [
      { ...project, id: "remote-web", name: "Updated", query: [] },
      { ...project, id: "web", name: "New", code: "other", query: [] },
    ],
    profiles: [
      {
        ...initialState().profiles[0],
        id: "remote-profile",
        variables: [{ key: "host", value: "192.0.2.55" }],
        overrides: [
          {
            projectId: "remote-web",
            url: "https://{{host}}/override",
            enabled: false,
          },
          { projectId: "web", url: "https://other.test/", enabled: true },
        ],
      },
    ],
  });
  const before = JSON.stringify({ current, imported });
  const merged = mergeProjectState(current, imported);
  assert.equal(merged.projects.length, 2);
  assert.equal(merged.profiles.length, 1);
  assert.equal(merged.projects[0].id, "web");
  assert.equal(merged.projects[0].name, "Updated");
  assert.notEqual(merged.projects[1].id, "web");
  assert.equal(merged.profiles[0].id, "default");
  assert.equal(
    merged.profiles[0].variables.find((item) => item.key === "keep").value,
    "retained",
  );
  assert.equal(
    resolveProject(merged.projects[0], merged.profiles[0]).url,
    "https://192.0.2.55/override",
  );
  assert.equal(
    resolveProject(merged.projects[1], merged.profiles[0]).url,
    "https://other.test/",
  );
  assert.equal(JSON.stringify({ current, imported }), before);
});

test("configs migration preserves snapshots/settings/source, is idempotent and folder copy works on another host", async () =>
  temporary(async (folder) => {
    const legacy = path.join(folder, "legacy"),
      destination = path.join(folder, "install/configs");
    let store = await createProjectStore(legacy);
    await store.save(fixture(), 0);
    await store.backup("transfer snapshot");
    await store.saveSettings({
      host: "0.0.0.0",
      port: 8765,
      autoStart: false,
      hash: "fixture-hash",
      salt: "fixture-salt",
    });
    await store.close();
    const original = await readFile(path.join(legacy, "projects.json"), "utf8");
    const info = await prepareProjectConfigs(destination, [legacy]);
    assert.equal(info.directory, destination);
    assert.equal(info.migratedFrom, legacy);
    assert.equal(
      await readFile(path.join(legacy, "projects.json"), "utf8"),
      original,
    );
    store = await createProjectStore(destination);
    assert.equal((await store.get()).projects[0].id, "web");
    assert.equal((await store.snapshots())[0].name, "transfer snapshot");
    assert.equal((await store.settings()).hash, "fixture-hash");
    const snapshot = await store.snapshot((await store.snapshots())[0].id);
    snapshot.projects[0].name = "outside";
    assert.notEqual((await store.get()).projects[0].name, "outside");
    await store.close();
    await prepareProjectConfigs(destination, [legacy]);
    assert.equal(
      await readFile(path.join(destination, "projects.json"), "utf8"),
      original,
    );
    const copied = path.join(folder, "other-install/configs");
    await cp(destination, copied, { recursive: true });
    await writeFile(
      path.join(copied, ".lock"),
      JSON.stringify({
        pid: process.pid,
        host: "foreign-machine-for-transfer",
        token: "copied",
      }),
    );
    await prepareProjectConfigs(copied);
    store = await createProjectStore(copied);
    assert.equal((await store.get()).projects.length, 1);
    assert.equal((await store.snapshots())[0].name, "transfer snapshot");
    await store.close();
    await assert.rejects(access(path.join(copied, ".lock")));
  }));

test("existing configs win over legacy data; broken legacy is preserved without creating empty projects", async () =>
  temporary(async (folder) => {
    const legacy = path.join(folder, "legacy"),
      destination = path.join(folder, "install/configs");
    await mkdir(legacy);
    await writeFile(path.join(legacy, "projects.json"), "{broken");
    await assert.rejects(
      prepareProjectConfigs(destination, [legacy]),
      /配置目录/,
    );
    await assert.rejects(access(path.join(destination, "projects.json")));
    assert.equal(
      await readFile(path.join(legacy, "projects.json"), "utf8"),
      "{broken",
    );
    const store = await createProjectStore(destination);
    await store.close();
    await prepareProjectConfigs(destination, [legacy]);
    assert.equal(
      JSON.parse(
        await readFile(path.join(destination, "projects.json"), "utf8"),
      ).current.projects.length,
      0,
    );
    await assert.rejects(
      prepareProjectConfigs(path.join(destination, "projects.json", "configs")),
      /配置目录/,
    );
  }));
test("validates unique identifiers/codes/names, bounded input and exact import envelopes", () => {
  const original = fixture();
  assert.deepEqual(importState(exportState(original)), original);
  for (const mutate of [
    (s) => s.projects.push(structuredClone(s.projects[0])),
    (s) => s.projects.push({ ...s.projects[0], id: "other" }),
    (s) => s.profiles.splice(0),
    (s) => (s.projects[0].id = undefined),
    (s) => s.profiles[0].variables.push({ key: "host", value: "duplicate" }),
    (s) =>
      s.profiles[0].overrides.push({
        projectId: "missing",
        url: "",
        enabled: true,
      }),
    (s) => (s.projects[0].enabled = "yes"),
    (s) => (s.projects[0].url = "javascript:alert(1)"),
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    assert.throws(() => validateState(changed));
  }
  assert.throws(() =>
    importState(
      JSON.stringify({
        format: "devkit-project-center",
        version: 2,
        data: original,
      }),
    ),
  );
  assert.throws(() => importState(" ".repeat(1_000_001)));
});
test("serialized saves reject stale concurrent writers and backups restore as a fresh revision", async () =>
  temporary(async (folder) => {
    const store = await createProjectStore(folder);
    try {
      const original = await store.get();
      const results = await Promise.allSettled([
        store.save(fixture(), 0),
        store.save({ ...fixture(), projects: [] }, 0),
      ]);
      assert.equal(
        results.filter((item) => item.status === "fulfilled").length,
        1,
      );
      assert.equal(
        results.find((item) => item.status === "rejected").reason.status,
        409,
      );
      assert.equal((await store.get()).revision, 1);
      assert.deepEqual(original.projects, []);
      const snapshot = (await store.snapshots())[0];
      assert.equal(snapshot.projects, 0);
      assert.equal((await store.restore(snapshot.id, 1)).revision, 2);
      assert.equal((await store.get()).projects.length, 0);
      assert.equal((await store.snapshots())[0].projects, 1);
      await assert.rejects(store.restore(snapshot.id, 1), /其他使用者/);
      await store.backup("手动备份");
    } finally {
      await store.close();
    }
    const reopened = await createProjectStore(folder);
    try {
      assert.equal((await reopened.get()).revision, 2);
      assert.equal((await reopened.snapshots())[0].name, "手动备份");
    } finally {
      await reopened.close();
    }
  }));
test("corrupt data is preserved and simultaneous host processes cannot share a data directory", async () =>
  temporary(async (folder) => {
    const store = await createProjectStore(folder);
    await assert.rejects(createProjectStore(folder), /正在/);
    await store.close();
    await writeFile(path.join(folder, "projects.json"), "{corrupt", "utf8");
    await assert.rejects(createProjectStore(folder), /原文件已保留/);
    assert.equal(
      await readFile(path.join(folder, "projects.json"), "utf8"),
      "{corrupt",
    );
  }));
test("snapshot retention is bounded to thirty and copied read results cannot mutate the store", async () =>
  temporary(async (folder) => {
    const store = await createProjectStore(folder);
    try {
      const first = await store.get();
      first.profiles[0].name = "outside";
      assert.equal((await store.get()).profiles[0].name, "默认环境");
      for (let index = 0; index < 32; index++)
        await store.backup(`snapshot ${index}`);
      assert.equal((await store.snapshots()).length, 30);
    } finally {
      await store.close();
    }
  }));
test("LAN gateway authenticates, enforces viewer/editor and blocks toolkit, traversal and cross-origin writes", async () =>
  temporary(async (folder) => {
    const dist = path.join(folder, "dist");
    await mkdir(path.join(dist, ".vite"), { recursive: true });
    await mkdir(path.join(dist, "assets"));
    await writeFile(path.join(dist, "portal.html"), "<h1>project portal</h1>");
    await writeFile(path.join(dist, "assets", "portal.js"), "portal");
    await writeFile(
      path.join(dist, "assets", "tool.worker.js"),
      "private tools",
    );
    await writeFile(
      path.join(dist, ".vite", "manifest.json"),
      JSON.stringify({ "portal.html": { file: "assets/portal.js" } }),
    );
    const store = await createProjectStore(path.join(folder, "data")),
      host = await createProjectHost(store, dist);
    try {
      const options = {
        host: "127.0.0.1",
        port: await freePort(),
        password: "test-password-only",
        canEdit: false,
        autoStart: true,
      };
      await host.start(options);
      assert.equal(host.status().autoStart, true);
      assert.equal((await store.settings()).autoStart, true);
      let origin = host.status().addresses[0].replace(/\/$/, "");
      const request = (
        route,
        { method = "GET", cookie, body, source = origin } = {},
      ) =>
        fetch(`${origin}${route}`, {
          method,
          headers: {
            ...(cookie ? { Cookie: cookie } : {}),
            ...(body === undefined
              ? {}
              : { Origin: source, "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      assert.equal((await request("/")).status, 200);
      assert.equal((await request("/assets/portal.js")).status, 200);
      for (const route of [
        "/index.html",
        "/assets/tool.worker.js",
        "/.vite/manifest.json",
        "/server/start.mjs",
        "/server/nginx-manager.mjs",
        "/shared/nginx.mjs",
        "/api/nginx/command",
        "/api/nginx/documents",
        "/%2e%2e/package.json",
        "/api/projects/sharing",
      ])
        assert.ok([401, 404].includes((await request(route)).status));
      assert.equal((await request("/api/projects/state")).status, 401);
      assert.equal(
        (
          await request("/api/projects/login", {
            method: "POST",
            source: "http://evil.example",
            body: { password: options.password },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/api/projects/login", {
            method: "POST",
            body: { password: "wrong" },
          })
        ).status,
        401,
      );
      const login = await request("/api/projects/login", {
        method: "POST",
        body: { password: options.password },
      });
      assert.match(
        login.headers.get("set-cookie"),
        /HttpOnly; SameSite=Strict/,
      );
      const cookie = login.headers.get("set-cookie").split(";")[0];
      assert.equal(
        (await request("/api/projects/state", { cookie })).status,
        200,
      );
      assert.equal(
        (
          await request("/api/projects/state", {
            method: "PUT",
            cookie,
            body: { data: fixture(), revision: 0 },
          })
        ).status,
        403,
      );
      assert.equal(
        (await request("/api/projects/snapshots", { cookie })).status,
        403,
      );
      assert.equal(
        (
          await request("/api/projects/snapshot", {
            method: "POST",
            cookie,
            body: { id: "anything" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/api/projects/probe", {
            method: "POST",
            cookie,
            body: {},
          })
        ).status,
        403,
      );
      assert.equal(
        JSON.stringify(await store.settings()).includes(options.password),
        false,
      );
      await host.start({ ...options, canEdit: true, password: "" });
      origin = host.status().addresses[0].replace(/\/$/, "");
      assert.equal(
        (await request("/api/projects/state", { cookie })).status,
        401,
        "restarting invalidates old sessions",
      );
      const editor = await request("/api/projects/login", {
        method: "POST",
        body: { password: options.password },
      });
      const editorCookie = editor.headers.get("set-cookie").split(";")[0];
      assert.equal(
        (
          await request("/api/projects/state", {
            method: "PUT",
            cookie: editorCookie,
            body: { data: fixture(), revision: 0 },
          })
        ).status,
        200,
      );
      const meta = (await store.snapshots())[0];
      const preview = await request("/api/projects/snapshot", {
        method: "POST",
        cookie: editorCookie,
        body: { id: meta.id },
      });
      assert.equal(preview.status, 200);
      assert.equal((await preview.json()).projects.length, 0);
      assert.equal(
        (
          await request("/api/projects/state", {
            method: "PUT",
            cookie: editorCookie,
            body: { data: fixture(), revision: 0 },
          })
        ).status,
        409,
      );
      await request("/api/projects/logout", {
        method: "POST",
        cookie: editorCookie,
        body: {},
      });
      assert.equal(
        (await request("/api/projects/state", { cookie: editorCookie })).status,
        401,
      );
    } finally {
      await host.stop();
      await store.close();
    }
  }));
test("manual probes resolve saved projects, cap work, never follow redirects and do not alter revisions", async () =>
  temporary(async (folder) => {
    const target = http.createServer((_request, response) => {
      response.writeHead(302, { Location: "http://127.0.0.1:1/never-follow" });
      response.end();
    });
    await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
    const store = await createProjectStore(folder);
    try {
      const data = fixture();
      data.projects[0].url = `http://127.0.0.1:${target.address().port}/`;
      await store.save(data, 0);
      const results = await probeProjects(store, {
        profileId: "default",
        projectIds: ["web"],
      });
      assert.equal(results[0].status, 302);
      assert.equal((await store.get()).revision, 1);
      await assert.rejects(
        probeProjects(store, {
          profileId: "default",
          projectIds: Array(21).fill("web"),
        }),
      );
    } finally {
      await store.close();
      await new Promise((resolve) => target.close(resolve));
    }
  }));
