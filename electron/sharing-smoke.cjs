const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
app.on("window-all-closed", () => {});
const root = path.resolve(__dirname, "..");
const appRoot = process.env.DEVKIT_TEST_APP || root;
const load = (file) => import(pathToFileURL(path.join(appRoot, file)).href);
let window, host, store, nginx, library, target, directory;
app
  .whenReady()
  .then(async () => {
    const watchdog = setTimeout(() => {
      console.error("Sharing UI test exceeded 60 seconds.");
      app.exit(1);
    }, 60_000);
    try {
      directory = await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), "devkit-sharing-ui-")),
      );
      store = await (
        await load("server/project-store.mjs")
      ).createProjectStore(directory);
      nginx = await (
        await load("server/nginx-manager.mjs")
      ).createNginxManager(directory);
      library = await (
        await load("server/api-workspace.mjs")
      ).createApiWorkspace(directory);
      host = await (
        await load("server/project-host.mjs")
      ).createProjectHost(store, path.join(appRoot, "dist"), {
        nginx: () => nginx,
        library: () => library,
      });
      target = http.createServer((_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end('{"ok":true}');
      });
      await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
      const { initialApiState, newApiEndpoint } = await load(
        "shared/api-workspace.mjs",
      );
      const endpoint = {
        ...newApiEndpoint("echo"),
        name: "共享回显接口",
        path: "/",
      };
      endpoint.responses[0].schema =
        '{"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}}}';
      await library.save(
        {
          ...initialApiState(),
          projects: [
            {
              id: "shared",
              name: "共享API项目",
              description: "",
              baseUrl: `http://127.0.0.1:${target.address().port}`,
              groups: [],
              environments: [],
              endpoints: [endpoint],
            },
          ],
        },
        0,
      );
      const conf = path.join(directory, "nginx.conf");
      await fs.writeFile(conf, "events {} http { server { listen 8080; } }");
      await nginx.request("upsert", {
        revision: 0,
        instance: {
          name: "共享Nginx",
          main: conf,
          files: [],
          prefix: directory,
          executable: "",
          platform: "any",
        },
      });
      const portServer = http.createServer();
      await new Promise((resolve) =>
        portServer.listen(0, "127.0.0.1", resolve),
      );
      const port = portServer.address().port;
      await new Promise((resolve) => portServer.close(resolve));
      const options = {
        host: "0.0.0.0",
        port,
        password: "sharing-ui-test",
        canEdit: true,
        shareNginx: true,
        shareHttp: true,
      };
      await host.start(options);
      const url = host.status().addresses[0];
      window = new BrowserWindow({
        show: false,
        width: 1360,
        height: 900,
        webPreferences: {
          backgroundThrottling: false,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      const errors = [];
      window.webContents.on("console-message", (event) => {
        if (event.level === "error") errors.push(event.message);
      });
      const js = (code) => window.webContents.executeJavaScript(code, true);
      const wait = async (expression) => {
        for (let i = 0; i < 100; i++) {
          if (await js(expression)) return;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(
          `Timed out: ${expression}\n${await js("document.body.innerText")}\n${errors.join("\n")}`,
        );
      };
      const click = async (text, selector = "button") => {
        const code = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
        await wait(`!!${code}`);
        await js(`${code}.click()`);
      };
      const login = async () => {
        console.log("Loading shared portal:", url);
        await window.loadURL(url);
        await wait(
          '!!document.querySelector(".portal-login button:not(:disabled)")',
        );
        await js(
          `Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true});let input=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'sharing-ui-test');input.dispatchEvent(new Event('input',{bubbles:true}));`,
        );
        await click("登录");
        await wait('!!document.querySelector(".portal-bar")');
      };
      await login();
      console.log("Portal login passed; checking shared API.");
      await click("HTTP 调试", ".portal-bar button");
      await wait(
        'document.querySelector(".api-workspace")?.textContent.includes("共享API项目")',
      );
      await click("运行调试");
      await click("发送API请求");
      await wait('!!document.querySelector(".api-live-response")');
      await wait(
        'document.querySelector(".api-live-response")?.textContent.includes("200")',
      );
      await js(
        `[...document.querySelectorAll('.api-debug button')].find(e=>e.textContent.trim().startsWith('校验 '))?.click()`,
      );
      await wait(
        'document.querySelector(".api-checks")?.textContent.includes("JSON Schema")',
      );
      assert.ok(
        await js(
          `[...document.querySelectorAll('.api-checks li')].some(e=>e.textContent.includes('JSON Schema')&&e.dataset.result==='pass')`,
        ),
        "Schema worker runs from portal manifest assets",
      );
      await click("Nginx 配置", ".portal-bar button");
      await wait(
        'document.querySelector(".ng-detail")?.textContent.includes("共享Nginx")',
      );
      assert.equal(
        await js(
          `[...document.querySelectorAll('.ng-center button')].find(e=>e.textContent.trim()==='重载').disabled`,
        ),
        true,
      );
      assert.equal(
        await js(
          `[...document.querySelectorAll('.ng-center button')].find(e=>e.textContent.trim()==='添加实例').disabled`,
        ),
        false,
      );
      await click("全文编辑");
      await wait(
        'document.querySelector(".ng-source .cm-content")?.textContent.includes("listen 8080")',
      );
      await wait('!document.querySelector(".ng-busy")');
      await js('document.querySelector(".ng-source .cm-content").focus()');
      window.webContents.sendInputEvent({
        type: "keyDown",
        keyCode: "A",
        modifiers: ["control"],
      });
      window.webContents.sendInputEvent({
        type: "keyUp",
        keyCode: "A",
        modifiers: ["control"],
      });
      await window.webContents.insertText(
        "events {} http { server { listen 8081; } }",
      );
      await wait(
        `[...document.querySelectorAll('.ng-center button')].some(e=>e.textContent.trim()==='保存文件 (1)'&&!e.disabled)`,
      );
      await click("保存文件 (1)");
      await wait(
        'document.querySelector(".ng-notice")?.textContent.includes("保存")',
      );
      assert.match(await fs.readFile(conf, "utf8"), /8081/);
      await wait('!document.querySelector(".ng-busy")');
      await click('实例设置');
      await wait('!!document.querySelector(".ng-form-modal[open]")');
      assert.equal(await js('document.querySelector(".ng-form-modal").textContent.includes("共享主机")'), true);
      assert.equal(await js('[...document.querySelectorAll(".ng-form-modal button")].filter(e=>/^(选择|选择目录|选择附属文件)$/.test(e.textContent.trim())&&e.getClientRects().length>0).length'), 0);
      const remoteMain = path.join(directory, 'remote-path.conf');
      await fs.writeFile(remoteMain, 'events {} http { server { listen 8082; } }');
      await js(`(()=>{const input=[...document.querySelectorAll('.ng-instance-form label')].find(e=>e.textContent.startsWith('主配置文件')).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(remoteMain)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await click('保存实例');
      await wait('!document.querySelector(".ng-form-modal[open]")&&!document.querySelector(".ng-busy")');
      assert.equal((await nginx.request('get')).instances[0].main, remoteMain);
      await click('添加实例'); await wait('!!document.querySelector(".ng-form-modal[open]")');
      await click('取消', '.ng-form-modal button');
      await wait('!document.querySelector(".ng-form-modal[open]")');
      window.showInactive();
    await new Promise(resolve => setTimeout(resolve, 600));
    const output = path.join(root, "artifacts", "sharing-smoke");
      await fs.mkdir(output, { recursive: true });
      await fs.writeFile(
        path.join(output, "nginx-editor.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      await host.start({ ...options, canEdit: false });
      await login();
      await click("HTTP 调试", ".portal-bar button");
      await wait(
        'document.querySelector(".api-workspace")?.textContent.includes("共享API项目")',
      );
      assert.equal(
        await js(
          `[...document.querySelectorAll('.api-workspace button')].find(e=>e.textContent.trim()==='新建API项目').disabled`,
        ),
        true,
      );
      await click("运行调试");
      assert.equal(
        await js(
          `[...document.querySelectorAll('.api-debug button')].find(e=>e.textContent.trim()==='发送API请求').disabled`,
        ),
        true,
      );
      await click("Nginx 配置", ".portal-bar button");
      await click("全文编辑");
      await wait('!!document.querySelector(".ng-source .cm-content")');
      assert.equal(
        await js(
          '!!document.querySelector(".ng-source .code-editor.is-readonly")',
        ),
        true,
      );
      const before = await js(
        'document.querySelector(".ng-source .cm-content").textContent',
      );
      await js('document.querySelector(".ng-source .cm-content").focus()');
      window.webContents.sendInputEvent({ type: "char", keyCode: "x" });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(
        await js(
          'document.querySelector(".ng-source .cm-content").textContent',
        ),
        before,
      );
      for (const [width, theme] of [
        [1360, "dark"],
        [390, "light"],
      ]) {
        window.setSize(width, 900);
        await js(
          `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        await wait('!document.querySelector(".ng-busy")');
        assert.equal(
          await js("document.documentElement.scrollWidth<=innerWidth"),
          true,
          `${width}px portal overflow`,
        );
        await fs.writeFile(
          path.join(output, `viewer-${width}-${theme}.png`),
          (await window.webContents.capturePage()).toPNG(),
        );
      }
      console.log('Portal computed colors:', await js('JSON.stringify({surface:getComputedStyle(document.documentElement).getPropertyValue("--surface"),button:getComputedStyle(document.querySelector(".portal-bar .secondary-button")).backgroundColor,text:getComputedStyle(document.querySelector(".ng-instance-select")).color})'));
    assert.deepEqual(errors, []);
      console.log(
        "LAN browser UI passed: login, shared API docs, host send, Schema worker, Nginx source, editor/viewer permissions, HTTP-origin IDs, light/dark and narrow layout.",
      );
    } finally {
      clearTimeout(watchdog);
      window?.destroy();
      await host?.stop();
      await library?.close();
      await nginx?.close();
      await store?.close();
      if (target) {
        target.closeAllConnections();
        await new Promise((resolve) => target.close(resolve));
      }
      if (directory) {
        assert.equal(path.dirname(directory), await fs.realpath(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith("devkit-sharing-ui-"));
        await fs.rm(directory, { recursive: true, force: true });
      }
    }
  })
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
