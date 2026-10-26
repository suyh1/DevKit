const { app, BrowserWindow, clipboard } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
app.on("window-all-closed", () => {});
let window, fixture;
app
  .whenReady()
  .then(async () => {
    const timeout = setTimeout(() => {
      console.error("Portal interaction check timed out");
      app.exit(1);
    }, 240000);
    const output = path.resolve("artifacts/portal-regression");
    try {
      await fs.mkdir(output, { recursive: true });
      fixture = await (
        await import("./portal-fixture.mjs")
      ).portalFixture(process.env.DEVKIT_TEST_APP || process.cwd());
      window = new BrowserWindow({
        show: false,
        width: 1440,
        height: 900,
        webPreferences: {
          backgroundThrottling: false,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      const errors = [];
      window.webContents.on("console-message", (event) => {
        if (event.level === "error" && /Uncaught|Unhandled/.test(event.message))
          errors.push(event.message);
      });
      const js = (code) => window.webContents.executeJavaScript(code, true);
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const wait = async (expression) => {
        for (let i = 0; i < 150; i++) {
          if (await js(expression)) return;
          await delay(40);
        }
        throw Error(
          "Condition failed: " +
            expression +
            "\n" +
            (await js("document.body.innerText")).slice(0, 7000),
        );
      };
      const wheel = async (delta, x, y) => {
        const size = await js(
            '(()=>{const r=document.querySelector(".portal-content").getBoundingClientRect();return {x:r.right-40,y:r.bottom-50}})()',
          ),
          zoom = window.webContents.getZoomFactor();
        for (let turn = 0; turn < (Math.abs(delta) > 3000 ? 24 : 1); turn++) {
          window.webContents.sendInputEvent({
            type: "mouseMove",
            x: Math.round((x ?? size.x) * zoom),
            y: Math.round((y ?? size.y) * zoom),
          });
          window.webContents.sendInputEvent({
            type: "mouseWheel",
            x: Math.round((x ?? size.x) * zoom),
            y: Math.round((y ?? size.y) * zoom),
            deltaY: -Math.sign(delta) * Math.min(Math.abs(delta), 900),
            deltaX: 0,
          });
          await delay(35);
        }
        await delay(140);
      };
      // Only geometry is read through JS. Actions use native mouse/keyboard input.
      const pointer = async (expression) => {
        for (let i = 0; i < 45; i++) {
          const hit = await js(
            `(()=>{const e=${expression};if(!e||!e.getClientRects().length)return null;const r=e.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2};return {...p,disabled:!!e.disabled,above:p.y<(e.closest('.portal-bar')?0:document.querySelector('.portal-bar').getBoundingClientRect().bottom),hit:p.y>0&&p.y<innerHeight-12&&e.contains(document.elementFromPoint(p.x,p.y)),sidebar:!!e.closest('.api-sidebar')};})()`,
          );
          if (!hit) {
            await delay(50);
            continue;
          }
          if (hit.disabled) throw Error("Disabled target: " + expression);
          if (hit.hit) {
            window.webContents.sendInputEvent({
              type: "mouseDown",
              button: "left",
              x: Math.round(hit.x * window.webContents.getZoomFactor()),
              y: Math.round(hit.y * window.webContents.getZoomFactor()),
              clickCount: 1,
            });
            window.webContents.sendInputEvent({
              type: "mouseUp",
              button: "left",
              x: Math.round(hit.x * window.webContents.getZoomFactor()),
              y: Math.round(hit.y * window.webContents.getZoomFactor()),
              clickCount: 1,
            });
            await delay(60);
            return;
          }
          await wheel(hit.above ? -400 : 400, hit.sidebar ? hit.x : undefined);
        }
        throw Error("Target cannot be reached by scrolling: " + expression);
      };
      const button = (text, scope = "button") =>
        pointer(
          `[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>e.getClientRects().length&&e.textContent.trim()===${JSON.stringify(text)})`,
        );
      const selector = (value) =>
        pointer(`document.querySelector(${JSON.stringify(value)})`);
      const key = (keyCode, modifiers = []) => {
        window.webContents.sendInputEvent({
          type: "keyDown",
          keyCode,
          modifiers,
        });
        window.webContents.sendInputEvent({
          type: "keyUp",
          keyCode,
          modifiers,
        });
      };
      const fill = async (css, text) => {
        await selector(css);
        key("A", ["control"]);
        await window.webContents.insertText(text);
        await delay(40);
      };
      const screenshot = async (name) =>
        fs.writeFile(
          path.join(output, name + ".png"),
          (await window.webContents.capturePage()).toPNG(),
        );
      const login = async () => {
        await wait('!!document.querySelector("input[type=password]")');
        await fill("input[type=password]", fixture.options.password);
        await button("登录");
        await wait('!!document.querySelector(".portal-bar nav")');
      };
      await window.loadURL(fixture.url + "#projects");
      window.show();
      window.focus();
      window.webContents.focus();
      await login();
      for (const [width, height] of [
        [1440, 900],
        [1024, 768],
        [390, 844],
      ]) {
        window.setContentSize(width, height);
        await delay(150);
        await button("项目中心", ".portal-bar button");
        await wait('document.querySelectorAll(".pc-card").length===24');
        await delay(350);
        await wheel(18000);
        console.log(
          "Project scroll",
          width,
          await js(
            'JSON.stringify({top:document.querySelector(".portal-content").scrollTop,sh:document.querySelector(".portal-content").scrollHeight,h:document.querySelector(".portal-content").clientHeight})',
          ),
        );
        await wait(
          '(()=>{const r=document.querySelector(".portal-content");return r.scrollTop>=r.scrollHeight-r.clientHeight-2})()',
        );
        assert.equal(
          await js("document.documentElement.scrollWidth<=innerWidth"),
          true,
        );
        assert.equal(
          await js(
            '(()=>{const e=[...document.querySelectorAll(".project-center button")].find(e=>e.textContent.trim()==="备份与恢复"),r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()',
          ),
          true,
          "Project footer must be visible and hit-testable",
        );
        await screenshot("projects-bottom-" + width);
      }
      window.setContentSize(1440, 900);
      await delay(150);
      await button("Nginx 配置", ".portal-bar button");
      await wait(
        'document.querySelector(".ng-status-connection")?.textContent.includes("状态信息已更新")',
      );
      await wheel(1100);
      await wait(
        'document.querySelector(".ng-control-dock")?.dataset.compact==="true"',
      );
      assert.equal(
        await js(
          '(()=>{const dock=document.querySelector(".ng-control-dock").getBoundingClientRect(),bar=document.querySelector(".portal-bar").getBoundingClientRect();return dock.top>=bar.bottom&&dock.height<innerHeight*.6})()',
        ),
        true,
      );
      assert.equal(
        await js(
          'document.querySelectorAll(".ng-editor-heading .ng-help-trigger,.ng-field-tools .ng-help-trigger").length',
        ),
        0,
      );
      await screenshot("nginx-sticky");
      window.setContentSize(390, 844);
      await delay(150);
      await wheel(18000);
      assert.equal(
        await js("document.documentElement.scrollWidth<=innerWidth"),
        true,
      );
      assert.equal(
        await js(
          '(()=>{const root=document.querySelector(".portal-content").getBoundingClientRect(),dock=document.querySelector(".ng-control-dock").getBoundingClientRect(),fields=document.querySelector(".ng-fields").getBoundingClientRect();return dock.top>=root.top&&fields.bottom<=root.bottom+1&&root.height-dock.height>=120})()',
        ),
        true,
        "Nginx bottom and editor space at phone width",
      );
      await screenshot("nginx-bottom-390");
      window.setContentSize(1440, 900);
      await delay(150);
      await button("实例设置", ".ng-center button");
      await wait('!!document.querySelector(".ng-form-modal[open]")');
      key("Escape");
      await wait('!document.querySelector(".ng-form-modal[open]")');
      await wait('document.activeElement?.textContent.trim()==="实例设置"');
      fixture.faults.statuses = true;
      await button("重新确认状态", ".ng-center button");
      await wait(
        'document.querySelector(".ng-status-connection")?.dataset.stale==="true"',
      );
      assert.equal(
        await js(
          '[...document.querySelectorAll(".ng-toolbar button")].find(e=>e.textContent.trim()==="启动").disabled',
        ),
        true,
      );
      await screenshot("nginx-stale");
      fixture.faults.statuses = false;
      await button("重新确认状态", ".ng-center button");
      await wait(
        'document.querySelector(".ng-status-connection")?.dataset.stale==="false"',
      );
      await button("HTTP 调试", ".portal-bar button");
      await wait(
        'document.querySelector(".api-workspace")?.textContent.includes("共享接口定义")',
      );
      await button("接口设计", ".api-tabs button");
      await selector('select[aria-label="共享页面主题"]');
      key("End");
      key("Return");
      await wait('document.documentElement.dataset.theme==="dark"');
      for (const [width, height, zoom] of [
        [1920, 1080, 1],
        [1366, 768, 1.25],
        [1024, 768, 1],
        [390, 844, 1],
      ]) {
        window.setContentSize(width, height);
        window.webContents.setZoomFactor(zoom);
        await delay(160);
        await wheel(18000);
        await wait(
          '(()=>{const e=document.querySelector(".portal-content");return e.scrollTop>=e.scrollHeight-e.clientHeight-2})()',
        );
        assert.equal(
          await js("document.documentElement.scrollWidth<=innerWidth"),
          true,
        );
        assert.equal(
          await js(
            '(()=>{const e=document.querySelector(".api-main"),r=document.querySelector(".portal-content").getBoundingClientRect();return getComputedStyle(e).overflowY==="visible"&&e.getBoundingClientRect().bottom<=r.bottom+1})()',
          ),
          true,
          "API bottom must be reachable without a clipped editor scroller",
        );
        await screenshot("api-bottom-" + width + "-zoom-" + zoom);
      }
      window.webContents.setZoomFactor(1);
      window.setContentSize(1440, 900);
      await delay(150);
      await wheel(-18000);
      await selector('select[aria-label="共享页面主题"]');
      key("Home");
      key("Return");
      await button("运行调试", ".api-tabs button");
      await fill('input[aria-label="参数1示例"]', "temporary-request");
      await selector('button[aria-label="新增API接口"]');
      await wait('!!document.querySelector(".confirm-dialog[open]")');
      await button("继续编辑", ".confirm-dialog button");
      await wait('!document.querySelector(".confirm-dialog[open]")');
      assert.equal(
        await js('document.querySelector("input[aria-label=参数1示例]").value'),
        "temporary-request",
      );
      await button("接口设计", ".api-tabs button");
      await wait('!!document.querySelector("input[aria-label=参数1示例]")');
      assert.equal(
        await js('document.querySelector("input[aria-label=参数1示例]").value'),
        "definition-value",
      );
      assert.equal(
        await js(
          '[...document.querySelectorAll(".api-endpoint-header button")].find(e=>e.textContent.trim()==="保存接口").disabled',
        ),
        true,
      );
      assert.equal(
        (await fixture.library.get()).state.projects[0].endpoints[0]
          .parameters[0].example,
        "definition-value",
      );
      await button("运行调试", ".api-tabs button");
      assert.equal(
        await js('document.querySelector("input[aria-label=参数1示例]").value'),
        "temporary-request",
      );
      await selector(".api-tree-item.selected");
      await wait('!!document.querySelector(".confirm-dialog[open]")');
      await button("放弃草稿", ".confirm-dialog button");
      await wait('!document.querySelector(".confirm-dialog[open]")');
      await wait(
        'document.querySelector("input[aria-label=参数1示例]")?.value === "definition-value"',
      );
      await fill('input[aria-label="参数1示例"]', "another-temporary-request");
      await button("恢复定义值");
      await wait(
        'document.querySelector("input[aria-label=参数1示例]")?.value === "definition-value"',
      );
      await button("快速请求", "[role=tab]");
      await button("生成请求代码");
      await wait(
        'document.querySelector("dialog[open] .cm-content")?.textContent.includes("fetch(")',
      );
      window.show();
      window.focus();
      window.webContents.focus();
      if (!fixture.url.includes("127.0.0.1"))
        assert.equal(
          await js("isSecureContext"),
          false,
          "The clipboard check must use actual untrusted LAN HTTP",
        );
      await button("复制代码", "dialog[open] button");
      await wait(
        'document.querySelector("dialog[open]")?.textContent.includes("代码已复制")',
      );
      assert.match(await clipboard.readText(), /const response = await fetch/);
      await screenshot("lan-copy");
      await js(
        'window.fixtureExecCommand=document.execCommand;document.execCommand=()=>false;Object.defineProperty(navigator,"clipboard",{value:undefined,configurable:true});true',
      );
      await button("复制代码", "dialog[open] button");
      await wait('!!document.querySelector(".manual-copy-dialog[open]")');
      assert.equal(
        await js(
          '(()=>{const e=document.querySelector(".manual-copy-dialog textarea");return e.readOnly&&e.selectionEnd-e.selectionStart===e.value.length})()',
        ),
        true,
      );
      await screenshot("manual-copy");
      key("Escape");
      await wait('!document.querySelector(".manual-copy-dialog")');
      await js("document.execCommand=window.fixtureExecCommand;true");
      await selector('button[aria-label="关闭请求代码"]');
      await wait('!document.querySelector("dialog[open]")');
      await button("接口项目 · 文档与调试", "[role=tab]");
      await selector('button[aria-label="新增API接口"]');
      await wait('!!document.querySelector(".api-draft-item")');
      await selector('button[aria-label="刷新API工作区"]');
      await wait('!!document.querySelector(".portal-notice")');
      await selector('button[aria-label="删除API接口"]');
      await wait('!!document.querySelector(".confirm-dialog[open]")');
      await button("删除接口", ".confirm-dialog button");
      await wait(
        '!document.querySelector(".api-draft-item")&&!document.querySelector(".portal-notice")',
      );
      await button("项目中心", ".portal-bar button");
      await wheel(-18000);
      await button("补齐缺少的变量");
      await wait(
        'document.activeElement?.dataset.variableValue==="missing_host"',
      );
      assert.equal(
        await js(
          'document.querySelector("input[data-variable-value=existing]").value',
        ),
        "preserve-me",
      );
      await fill("input[data-variable-value=missing_host]", "127.0.0.1");
      await button("取消", ".pc-dialog button");
      await wait('!!document.querySelector(".pc-discard")');
      await button("放弃更改", ".pc-dialog button");
      await wait('!document.querySelector("dialog[open]")');
      assert.equal((await fixture.store.get()).profiles[0].variables.length, 1);
      await wheel(18000);
      const projectScroll = await js(
        'document.querySelector(".portal-content").scrollTop',
      );
      await button("Nginx 配置", ".portal-bar button");
      await button("HTTP 调试", ".portal-bar button");
      window.webContents.navigationHistory.goBack();
      await wait('location.hash==="#nginx"');
      window.webContents.navigationHistory.goBack();
      await wait('location.hash==="#projects"');
      assert.ok(
        Math.abs(
          (await js('document.querySelector(".portal-content").scrollTop')) -
            projectScroll,
        ) < 3,
        "Back restores service scroll position",
      );
      await fixture.host.start(fixture.options);
      await button("退出登录", ".portal-bar button");
      await wait('!!document.querySelector(".confirm-dialog[open]")');
      await button("退出", ".confirm-dialog button");
      await wait('!!document.querySelector(".portal-login")');
      assert.equal(
        await js('document.querySelector(".project-center")===null'),
        true,
      );
      await login();
      await fixture.host.stop();
      await button("退出登录", ".portal-bar button");
      await wait('!!document.querySelector(".confirm-dialog[open]")');
      await button("退出", ".confirm-dialog button");
      await wait('!!document.querySelector(".portal-login")');
      assert.equal(
        await js('document.querySelector(".ng-center")===null'),
        true,
      );
      await fixture.host.start(fixture.options);
      await button("重试连接");
      await wait(
        '!document.querySelector(".portal-bar nav")&&!document.querySelector(".portal-login button").disabled',
      );
      assert.equal(fixture.calls.commands, 0);
      assert.deepEqual(errors, []);
      await fs.writeFile(
        path.join(output, "results.json"),
        JSON.stringify(
          {
            lanUrl: fixture.url,
            projectBottomWidths: [1440, 1024, 390],
            apiBottomWidths: [1920, 1366, 1024, 390],
            zoomFactors: [1, 1.25],
            darkTheme: true,
            nativePointerAndWheel: true,
            sticky: true,
            nginxPhoneBottom: true,
            statusFailureAndRecovery: true,
            copyAndManualFallback: true,
            debugDefinitionIsolation: true,
            variableDraftOnly: true,
            hashHistoryAndScroll: true,
            expiredAndOfflineLogout: true,
            commandsExecuted: 0,
          },
          null,
          2,
        ),
      );
      console.log(
        "Portal regression passed: native clicks/wheels, actual LAN HTTP clipboard, vertical reachability, sticky controls, failed status/recovery, isolated debug values, variable drafts, hash history and offline/expired logout.",
      );
    } finally {
      clearTimeout(timeout);
      window?.destroy();
      await fixture?.close();
    }
  })
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
