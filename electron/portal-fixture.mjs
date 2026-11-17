import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, realpath, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export async function portalFixture(root) {
  const load = (file) => import(pathToFileURL(path.join(root, file)).href);
  const [
    { createProjectStore },
    { createProjectHost },
    { createNginxManager },
    { createApiWorkspace },
    { initialApiState, newApiEndpoint },
    { createJarManager },
    { createLogCenter },
  ] = await Promise.all([
    load("server/project-store.mjs"),
    load("server/project-host.mjs"),
    load("server/nginx-manager.mjs"),
    load("server/api-workspace.mjs"),
    load("shared/api-workspace.mjs"),
    load("server/jar-manager.mjs"),
    load("server/log-center.mjs"),
  ]);
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "devkit-portal-")),
  );
  let store, nginx, library, host, jar;
  const faults = { statuses: false, logGate: null },
    calls = { commands: 0, remoteLogReads: 0 };
  try {
    store = await createProjectStore(directory);
    const data = await store.get();
    data.profiles[0].variables = [{ key: "existing", value: "preserve-me" }];
    data.profiles[0].projects = Array.from({ length: 24 }, (_, index) => ({
      id: "project-" + index,
      code: "P" + index,
      name: "浏览器项目 " + index,
      group: index % 2 ? "分组A" : "分组B",
      description: "长页面与缺变量定位测试",
      url: "http://{{missing_host}}:8080/" + index,
      query: [],
      enabled: true,
    }));
    await store.save(data, data.revision);
    const main = path.join(directory, "nginx.conf"),
      executable = path.join(directory, "fixture-nginx.exe");
    await writeFile(
      main,
      "pid logs/test.pid;\nevents { worker_connections 64; }\nhttp {\n" +
        Array.from(
          { length: 16 },
          (_, index) =>
            "server { listen " +
            (18080 + index) +
            "; server_name fixture-" +
            index +
            "; location / { root html; } }",
        ).join("\n") +
        "\n}\n",
    );
    await writeFile(executable, "fixture only; no executable code");
    nginx = await createNginxManager(directory, {
      detect: async () => ({
        found: true,
        executable,
        pid: "logs/test.pid",
        output: "fixture nginx",
      }),
      inspect: async () => null,
      run: async () => {
        calls.commands++;
        throw Error("Fixture never runs commands");
      },
    });
    await nginx.request("upsert", {
      revision: 0,
      instance: {
        name: "长配置实例",
        main,
        files: [],
        prefix: directory,
        executable,
        platform: process.platform,
      },
    });
    await nginx.request("statuses");
    jar = await createJarManager(directory);
    const jarPath = path.join(directory, 'audit.jar'), localLog = path.join(directory, 'audit.log');
    await writeFile(jarPath, 'fixture');
    await writeFile(localLog, 'local-first-line\n');
    const jarState = await jar.request('upsert', { revision: 0, instance: {
      name: '审查测试应用', jar: jarPath, logMode: 'file', logName: 'audit.log', stopTimeout: 15, jvmArgs: ['-Dpassword=audit-secret'],
    } });
    const remoteHost = 'a'.repeat(36), remoteId = 'b'.repeat(64);
    const logs = createLogCenter({ jar: () => jar, nginx: () => nginx, lan: () => ({
      logTargets: () => [{ id: remoteHost, name: '慢速目标', modules: { jar: true, nginx: false } }],
      async logs(_hostId, action) {
        if (action === 'sources') return { warnings: [], sources: [{ id: remoteId, instanceId: jarState.instances[0].id, kind: 'jar', name: '远程延迟日志', path: '/srv/audit.log', mode: 'file' }] };
        calls.remoteLogReads++;
        await faults.logGate;
        return { results: [{ id: remoteId, text: 'remote-ready-line\n', reset: true }] };
      },
    }) });
    library = await createApiWorkspace(directory);
    const endpoint = newApiEndpoint("fixture-endpoint");
    endpoint.name = "共享接口定义";
    endpoint.parameters = [
      {
        id: "q",
        name: "q",
        location: "query",
        type: "string",
        required: false,
        enabled: true,
        description: "",
        example: "definition-value",
        schema: "",
      },
    ];
    await library.save(
      {
        ...initialApiState(),
        projects: [
          {
            id: "fixture-project",
            name: "共享接口项目",
            description: "",
            baseUrl: "http://127.0.0.1:8080",
            version: "1",
            groups: [],
            environments: [],
            endpoints: [endpoint],
          },
        ],
      },
      0,
    );
    host = await createProjectHost(store, path.join(root, "dist"), {
      nginx: () => ({
        request: (action, ...args) =>
          action === "statuses" && faults.statuses
            ? Promise.reject(new Error("Fixture status unavailable"))
            : nginx.request(action, ...args),
      }),
      library: () => library,
      jar: () => jar,
      logs: () => logs,
    });
    const portServer = createServer();
    await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
    const port = portServer.address().port;
    await new Promise((resolve) => portServer.close(resolve));
    const options = {
      host: "0.0.0.0",
      port,
      password: "portal-test-only",
      services: {
        projects: { enabled: true, edit: true, probe: false },
        nginx: { enabled: true, edit: true, control: true },
        http: { enabled: true, edit: true, send: false },
      },
    };
    await host.start(options);
    const addresses = host.status().addresses;
    const url =
      addresses.find((address) => address.startsWith("http://192.168.")) ||
      addresses.find((address) => address.startsWith("http://10.")) ||
      addresses.find((address) => !address.includes("127.0.0.1")) ||
      addresses[0];
    async function close() {
      await host.stop();
      await library.close();
      await nginx.close();
      await jar.close();
      await store.close();
      assert.equal(path.dirname(directory), await realpath(tmpdir()));
      assert.ok(path.basename(directory).startsWith("devkit-portal-"));
      await rm(directory, { recursive: true, force: true });
    }
    return { url, options, host, store, nginx, library, faults, calls, localLog, close };
  } catch (error) {
    await host?.stop();
    await library?.close();
    await nginx?.close();
    await jar?.close();
    await store?.close();
    throw error;
  }
}
