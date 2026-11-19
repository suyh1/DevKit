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
      const scrollData = await fixture.store.get();
      scrollData.profiles.push(...Array.from({ length: 29 }, (_, index) => ({
        id: `scroll-profile-${index}`, name: `滚动档案 ${index}`, description: '独立滚动回归', variables: [], projects: [],
      })));
      await fixture.store.save(scrollData, scrollData.revision);
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
          const panel = await js(`(()=>{const e=(${expression})?.closest('.pc-profiles,.pc-content');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,above:(${expression}).getBoundingClientRect().top<r.top}})()`);
          await wheel((panel?.above ?? hit.above) ? -400 : 400, panel?.x ?? (hit.sidebar ? hit.x : undefined), panel?.y);
        }
        throw Error("Target cannot be reached by scrolling: " + expression);
      };
      const button = async (text, scope = "button") => {
        if (scope === '.portal-navigation button' && await js(`innerWidth<=780&&!document.querySelector('.portal-drawer[open]')`)) {
          await pointer(`document.querySelector('[aria-label="打开共享导航"]')`);
          await wait(`!!document.querySelector('.portal-drawer[open]')`);
        }
        return pointer(
          `[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>e.getClientRects().length&&e.textContent.trim()===${JSON.stringify(text)})`,
        );
      };
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
        await wait(`document.activeElement === document.querySelector(${JSON.stringify(css)})`);
        key("A", ["control"]);
        await wait(`(()=>{const input=document.querySelector(${JSON.stringify(css)});return input.selectionStart===0 && input.selectionEnd===input.value.length})()`);
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
        await wait('!!document.querySelector(".portal-navigation")');
      };
      if (process.argv.includes('--legacy-popover')) {
        console.log('Portal: simulating browser without native Popover');
        await window.loadURL('about:blank');
        window.webContents.debugger.attach('1.3');
        await window.webContents.debugger.sendCommand('Page.enable');
        await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
          delete HTMLElement.prototype.popover;
          delete HTMLElement.prototype.showPopover;
          delete HTMLElement.prototype.hidePopover;
          delete HTMLElement.prototype.togglePopover;
          for (const [proto, names] of [[Document.prototype, ['querySelector', 'querySelectorAll']], [Element.prototype, ['querySelector', 'querySelectorAll', 'matches', 'closest']]]) {
            for (const name of names) {
              const original = proto[name];
              proto[name] = function(selector) {
                if (String(selector).includes(':popover-open') && !String(selector).includes('\\\\:popover-open')) throw new DOMException('Unsupported :popover-open', 'SyntaxError');
                return original.call(this, selector);
              };
            }
          }
          // Emulate the older UA without native [popover] display:none rules.
          addEventListener('DOMContentLoaded', () => {
            const style = document.createElement('style');
            style.textContent = '.ng-help-popover.\\\\:popover-open { display: block; }';
            document.head.append(style);
          });
        ` });
      }
      await window.loadURL(fixture.url + "#projects");
      console.log('Portal: loaded');
      window.show();
      window.focus();
      window.webContents.focus();
      await login();
      console.log('Portal: authenticated');
      await selector('[aria-label="搜索共享资源"]');
      await fill('.command-dialog input', '共享接口定义');
      await wait('[...document.querySelectorAll(".command-dialog button[role=option]")].some(button => button.textContent.includes("共享接口定义"))');
      key('Return');
      await wait('location.hash === "#http/fixture-project%3Afixture-endpoint" && document.querySelector(".api-endpoint-header h2")?.textContent.includes("共享接口定义")');
      await button('项目中心', '.portal-navigation button');
      {
        await button('Nginx 配置', '.portal-navigation button');
        await wait('!!document.querySelector(".ng-editor-fieldset")');
        await wait('[...document.querySelectorAll(".ng-center button")].some(e=>e.textContent.trim()==="实例设置"&&!e.disabled)');
        await button('实例设置');
        await wait('!!document.querySelector(".ng-form-modal[open]")');
        await selector('.ng-form-modal [aria-label="查看实例名称说明"]');
        await wait('!!document.querySelector(".ng-help-popover:popover-open")');
        await wait('(()=>{const e=document.querySelector(".ng-help-popover:popover-open"),s=getComputedStyle(e);return e.getBoundingClientRect().height>0&&Number(s.opacity)===1})()');
        assert.equal(await js('(()=>{const r=document.querySelector(".ng-help-popover:popover-open").getBoundingClientRect(),d=document.querySelector(".ng-form-modal").getBoundingClientRect();return r.left>=d.left&&r.right<=d.right&&r.top>=d.top&&r.bottom<=d.bottom})()'), true, 'Help must remain inside the dialog without clipping');
        await screenshot(process.argv.includes('--legacy-popover') ? 'legacy-popover' : 'native-popover');
        key('Escape');
        await wait('!document.querySelector(".ng-help-popover:popover-open")');
        await selector('.ng-form-modal [aria-label="关闭对话框"]');
        await button('项目中心', '.portal-navigation button');
      }
      for (const [width, height] of [
        [1440, 900],
        [1024, 768],
        [390, 844],
      ]) {
        window.setContentSize(width, height);
        await delay(150);
        await button("项目中心", ".portal-navigation button");
        await wait('document.querySelectorAll(".pc-card").length===24');
        await delay(350);
        await js(`document.querySelector('.pc-profiles').scrollTop=0;document.querySelector('.pc-content').scrollTop=0`);
        const sidebar = await js(`(()=>{const r=document.querySelector('.pc-profiles').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        await wheel(18000, sidebar.x, sidebar.y);
        assert.equal(await js(`(()=>{const l=document.querySelector('.pc-profiles'),r=document.querySelector('.pc-content');return l.scrollTop>0&&l.scrollTop>=l.scrollHeight-l.clientHeight-2&&r.scrollTop===0&&l.scrollHeight>l.clientHeight&&r.scrollHeight>r.clientHeight})()`), true, 'Many profiles scroll independently of the project panel');
        const leftTop = await js(`document.querySelector('.pc-profiles').scrollTop`);
        await wheel(18000);
        console.log(
          "Project scroll",
          width,
          await js(
            'JSON.stringify({top:document.querySelector(".portal-content").scrollTop,sh:document.querySelector(".portal-content").scrollHeight,h:document.querySelector(".portal-content").clientHeight})',
          ),
        );
        await wait(
          '(()=>{const r=document.querySelector(".pc-content");return r.scrollTop>=r.scrollHeight-r.clientHeight-2})()',
        );
        assert.equal(await js(`document.querySelector('.pc-profiles').scrollTop`), leftTop, 'Project scrolling leaves profiles in place');
        assert.equal(await js(`(()=>{const e=document.querySelector('.portal-content');return e.scrollHeight<=e.clientHeight+1})()`), true, 'Project overflow stays inside the two panels');
        assert.equal(await js(`(()=>{const s=document.querySelector('.pc-shell').getBoundingClientRect();return s.bottom<=innerHeight+1&&document.querySelector('.project-center').scrollWidth<=document.querySelector('.project-center').clientWidth})()`), true, 'Both panels stay within the viewport: '+await js(`JSON.stringify([...document.querySelectorAll('.portal-content,.portal-page:not([hidden]),.project-center,.pc-shell,.pc-profiles,.pc-content')].map(e=>({c:e.className,h:e.clientHeight,sh:e.scrollHeight,top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,style:e.getAttribute('style')})))`));
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
      await button("Nginx 配置", ".portal-navigation button");
      await wait(
        'document.querySelector(".ng-status-connection")?.textContent.includes("状态信息已更新")',
      );
      await wheel(1100);
      await wait(
        'document.querySelector(".ng-control-dock")?.dataset.stuck==="true" && [...document.querySelectorAll(".ng-dock-details")].every(section=>section.inert&&section.clientHeight===0&&getComputedStyle(section).visibility==="hidden")',
      );
      assert.equal(
        await js(
          '(()=>{const dock=document.querySelector(".ng-control-dock").getBoundingClientRect(),bar=document.querySelector(".portal-bar").getBoundingClientRect();const actions=document.querySelector(".ng-toolbar").getBoundingClientRect();return dock.top>=bar.bottom&&Math.abs(dock.height-actions.height)<=2})()',
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
          '(()=>{const root=document.querySelector(".portal-content").getBoundingClientRect(),dock=document.querySelector(".ng-control-dock").getBoundingClientRect(),fields=document.querySelector(".ng-fields").getBoundingClientRect();const actions=document.querySelector(".ng-toolbar");return dock.top>=root.top&&fields.bottom<=root.bottom+1&&Math.abs(dock.height-actions.getBoundingClientRect().height)<=2&&getComputedStyle(actions).flexWrap==="nowrap"})()',
        ),
        true,
        "Nginx bottom and editor space at phone width",
      );
      await screenshot("nginx-bottom-390");
      window.setContentSize(1440, 900);
      await delay(150);
      await js('document.querySelector(".portal-content").scrollTop=0');
      await wait('[...document.querySelectorAll(".ng-dock-details")].every(section=>!section.inert&&getComputedStyle(section).visibility==="visible")');
      await wait(`(() => {
        const button = [...document.querySelectorAll('.ng-instance-heading button')].find(item => item.textContent.trim() === '实例设置');
        if (!button) return false;
        const bounds = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
      })()`);
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
      await button("HTTP 调试", ".portal-navigation button");
      await wait(
        'document.querySelector(".api-workspace")?.textContent.includes("共享接口定义")',
      );
      await button("接口设计", ".api-tabs button");
      await selector('.portal-appearance summary');
      await selector('select[aria-label="共享页面主题"]');
      key("End");
      key("Return");
      await wait('document.documentElement.dataset.theme==="dark"');
      // Shared portal uses the same paired styles, stored only in this browser.
      for (const style of ['default', 'minimal', 'organic', 'editorial', 'brutalist', 'soft', 'glass', 'gradient', 'retro']) {
        for (const mode of ['light', 'dark']) {
          await js(`{ const style = document.querySelector('select[aria-label="共享页面主题风格"]'); style.value = '${style}'; style.dispatchEvent(new Event('change', { bubbles: true })); const mode = document.querySelector('select[aria-label="共享页面主题"]'); mode.value = '${mode}'; mode.dispatchEvent(new Event('change', { bubbles: true })); }`);
          await wait(`document.documentElement.dataset.themeStyle === '${style}' && document.documentElement.dataset.theme === '${mode}'`);
          assert.equal(await js('localStorage.getItem("devkit:portal-theme-style")'), style);
          window.setContentSize(390, 844); await delay(160);
          assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true, `${style}/${mode} mobile portal fits`);
        }
      }
      await js(`{ const select = document.querySelector('select[aria-label="共享页面主题风格"]'); select.value = 'default'; select.dispatchEvent(new Event('change', { bubbles: true })); }`);
      await selector('.portal-appearance summary');
      assert.equal(await js('document.querySelector(".portal-bar").getBoundingClientRect().height <= 90'), true);
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
      await selector('.portal-appearance summary');
      await selector('select[aria-label="共享页面主题"]');
      key("Home");
      key("Return");
      await selector('.portal-appearance summary');
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
      await button("接口项目", "[role=tab]");
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
      await button("项目中心", ".portal-navigation button");
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
      await button("Nginx 配置", ".portal-navigation button");
      await button("HTTP 调试", ".portal-navigation button");
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
      await require('./project-probe-smoke.cjs')(window, fixture, output);
      assert.deepEqual(errors, []);
      console.log('Portal: validating visitor changes, narrow header, resource links and isolated log streams');
      window.setContentSize(1440, 900);
      await wait('innerWidth >= 1300');
      const global = {
        ...fixture.options.services,
        jar: { enabled: true, edit: true, control: false },
        logs: { enabled: true, jar: true, nginx: true },
      };
      const mobileVisitor = 'mobile-' + 'viewer'.repeat(6);
      const visitorServices = {
        projects: { enabled: false }, http: { enabled: false }, monitor: { enabled: false },
        jar: { enabled: true }, nginx: { enabled: true }, logs: { enabled: true },
      };
      const visitorPassword = 'mobile-visitor-test';
      const shared = { ...fixture.options, services: global, visitors: [{ name: mobileVisitor, password: visitorPassword, services: visitorServices }] };
      await fixture.host.start(shared);
      await window.loadURL(fixture.url + '?audit=visitor#jar');
      await login();
      await wait('document.querySelector(".jar-instance")?.textContent.includes("审查测试应用")');
      await wait('[...document.querySelectorAll(".jar-instance button")].some(button => button.textContent.trim() === "设置" && !button.disabled)');
      await selector('.jar-instance .jar-advanced summary');
      await button('设置', '.jar-instance button');
      await wait('!!document.querySelector(".jar-dialog[open]")');
      assert.match(await js('document.querySelector(".jar-dialog textarea").value'), /audit-secret/);
      await fill('.jar-dialog textarea', '-Dpassword=unsaved-audit-secret');
      const getJar = `fetch('/api/jar/get', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.status)`;
      const expire = async () => {
        await fixture.host.start(shared);
        assert.equal(await js(getJar), 401);
        await js("window.dispatchEvent(new Event('devkit:session-required'))");
        await wait('!!document.querySelector("[aria-label=关闭重新登录提示]")');
      };
      await expire();
      await fill('dialog[open] input[type=password]', fixture.options.password);
      await button('登录', 'dialog[open] button');
      await wait('!document.querySelector("[aria-label=关闭重新登录提示]")');
      assert.match(await js('document.querySelector(".jar-dialog textarea").value'), /unsaved-audit-secret/);
      await expire();
      await fill('dialog[open] input[autocomplete=username]', mobileVisitor);
      await fill('dialog[open] input[type=password]', visitorPassword);
      await button('登录', 'dialog[open] button');
      await wait('!document.querySelector(".jar-dialog") && !!document.querySelector(".jar-instance")');
      assert.ok(!await js('document.body.innerText.includes("unsaved-audit-secret") || [...document.querySelectorAll("textarea")].some(e=>e.value.includes("audit-secret"))'));
      assert.ok(!await js('[...document.querySelectorAll(".jar-instance button")].some(e=>e.textContent.trim()==="日志"||e.textContent.trim()==="控制台")'));
      for (const [page, resource] of [['jar', 'JAR 实例'], ['nginx', 'Nginx 实例'], ['logs', '日志来源']]) {
        await js(`location.hash=${JSON.stringify('#'+page+'/not-a-resource')}`);
        await wait(`[...document.querySelectorAll('[role=status]')].some(e=>e.textContent.includes(${JSON.stringify(resource+'已移除或当前访客无权访问')}))`);
      }
      await js("location.hash='#nginx'");
      await wait('!!document.querySelector(".ng-detail")');
      assert.ok(!await js('[...document.querySelectorAll(".ng-center button")].some(e=>e.textContent.trim()==="查看日志")'));
      for (const width of [390, 321]) {
        window.setContentSize(width, 810);
        await wait(`Math.abs(innerWidth-${width})<=1`);
        const header = await js(`(() => {
          const bar = document.querySelector('.portal-bar'), title = document.querySelector('.portal-current strong');
          const text = document.createRange(); text.selectNodeContents(title);
          return { height: bar.getBoundingClientRect().height, title: title.getBoundingClientRect().width,
            text: text.getBoundingClientRect().width, duplicatedPermission: !!document.querySelector('.portal-access strong') };
        })()`);
        assert.ok(header.height < 68 && header.title >= header.text && !header.duplicatedPermission, `Mobile header at ${width}px: ${JSON.stringify(header)}`);
        assert.equal(await js(`document.querySelector('.portal-current small span:last-child').title`), mobileVisitor);
        await selector('.portal-appearance summary');
        await wait('!!document.querySelector(".portal-appearance[open]")');
        await selector('.portal-current strong');
        await wait('!document.querySelector(".portal-appearance[open]")');
        await selector('.portal-appearance summary');
        key('Escape');
        await wait('!document.querySelector(".portal-appearance[open]")');
      }
      window.setContentSize(1440, 900);
      await fixture.host.start(fixture.options);
      await fixture.host.start(shared);
      await window.loadURL(fixture.url + '?audit=streams#logs');
      await login();
      const gate = Promise.withResolvers();
      fixture.faults.logGate = gate.promise;
      try {
        await wait('document.querySelector(".log-source-list")?.textContent.includes("远程延迟日志")');
        const clickSource = label => pointer(`[...document.querySelectorAll(".log-source-list label")].find(e=>e.textContent.includes(${JSON.stringify(label)})).querySelector("input")`);
        await clickSource('远程延迟日志');
        await clickSource('审查测试应用');
        await wait('document.querySelector(".log-panels")?.textContent.includes("local-first-line")');
        assert.ok(fixture.calls.remoteLogReads > 0);
        await fs.appendFile(fixture.localLog, 'local-second-line\n');
        await wait('document.querySelector(".log-panels")?.textContent.includes("local-second-line")');
        assert.ok(!await js('document.querySelector(".log-panels")?.textContent.includes("remote-ready-line")'));
        gate.resolve();
        await wait('document.querySelector(".log-panels")?.textContent.includes("remote-ready-line")');
      } finally {
        gate.resolve();
        fixture.faults.logGate = null;
      }
      assert.deepEqual(errors, []);
      console.log('Portal: validating LAN host inventory, monitoring and log navigation');
      fixture.faults.shareHosts = true;
      await fixture.host.start({ ...fixture.options, services: {
        projects: { enabled: false }, nginx: { enabled: false }, http: { enabled: false },
        'lan-hosts': { enabled: true, edit: true, diagnose: true, terminal: true, files: true, rdp: true }, monitor: { enabled: true, edit: true, control: true },
        logs: { enabled: true, jar: true },
      }, visitors: [] });
      await window.loadURL(fixture.url + '?audit=lan-hosts#lan-hosts');
      await login();
      const inventory = '.lan-host-list';
      const selectHost = name => pointer(`[...document.querySelectorAll('.lan-connection-select')].find(button => button.querySelector('strong').textContent === ${JSON.stringify(name)})`);
      await wait(`document.querySelector('${inventory}')?.textContent.includes('慢速目标')`);
      await fill('.lan-search input', '找不到的主机');
      await wait('document.querySelector(".lan-center")?.textContent.includes("没有匹配的主机")');
      await fill('.lan-search input', '测试节点');
      await wait(`document.querySelector('${inventory}')?.textContent.includes('慢速目标')`);
      await button('启用端口监控', `${inventory} button`);
      await wait('document.querySelector(".monitor-detail h2")?.textContent==="慢速目标" && location.hash.startsWith("#monitor/lan-")');
      await button('立即检测', '.monitor-detail button');
      await wait('document.querySelector(".monitor-detail")?.textContent.includes("TCP test fixture")');
      await button('局域网主机', '.portal-sidebar button');
      await wait(`document.querySelector('${inventory}')?.textContent.includes('端口可达')`);
      await button('监控历史', `${inventory} button`);
      await wait('location.hash.startsWith("#monitor/lan-")');
      await button('局域网主机', '.portal-sidebar button');
      await button('查看日志', `${inventory} button`);
      await wait('document.querySelector(".log-source-list")?.textContent.includes("远程延迟日志")');
      assert.ok(!await js('document.querySelector(".log-source-list").textContent.includes("审查测试应用")'));
      for (const width of [390, 321]) {
        window.setContentSize(width, 810);
        await wait(`Math.abs(innerWidth-${width})<=1`);
        await js('location.hash="#lan-hosts"');
        await wait('!!document.querySelector(".portal-page:not([hidden]) .lan-host-list")');
        assert.ok(await js('document.querySelector(".portal-content").scrollWidth<=document.querySelector(".portal-content").clientWidth'));
      }
      window.setContentSize(1440, 900);
      await wait('innerWidth>=1300');
      await selector('.lan-search input');
      key('A', ['control']); key('Backspace');
      const sshPort = await fixture.startSshTarget();
      await button('添加主机', '.lan-heading-actions button');
      await fill('.lan-host-form .lan-address input', '127.0.0.1');
      await js(`(() => { const e=document.querySelector('.lan-host-form .lan-port input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e, '${sshPort}'); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      await fill('.lan-host-form .lan-host-name input', '浏览器 SSH');
      await fill('.lan-host-form input[maxlength="120"][autocomplete="off"]', 'portal-fixture');
      await fill('.lan-host-form input[type=password]', 'ssh-portal-fixture');
      await button('保存连接', '.lan-host-form button');
      await wait('document.querySelector(".lan-host-list").textContent.includes("浏览器 SSH")');
      await selector('.lan-host-list button[aria-label="编辑 浏览器 SSH"]');
      assert.equal(await js('document.querySelector(".lan-host-form input[type=password]").value'), '');
      await fill('.lan-host-form .lan-host-name input', '网页 SSH 已编辑');
      await button('保存连接', '.lan-host-form button');
      await wait('document.querySelector(".lan-host-list").textContent.includes("网页 SSH 已编辑")');
      await selectHost('网页 SSH 已编辑');
      await button('打开终端', '.lan-host-list button');
      await button('信任并连接', 'dialog[open] button');
      await wait('document.querySelector(".lan-terminal-message [role=status]")?.textContent==="已连接"');
      await wait('document.querySelector(".xterm-rows")?.textContent.includes("portal ssh ready")');
      await window.webContents.insertText('browser-echo');
      await wait('document.querySelector(".xterm-rows")?.textContent.includes("browser-echo")');
      await selector('.lan-host-list button[aria-label="移除 网页 SSH 已编辑"]');
      await button('移除连接', 'dialog[open] button');
      await wait('!document.querySelector(".lan-host-list").textContent.includes("网页 SSH 已编辑") && !document.querySelector(".lan-terminal-tabs")');
      console.log('Portal: validating the embedded remote desktop');
      const rdp = await (await import('./rdp-fixture.mjs')).rdpFixture();
      const gateway = { DEVKIT_GUACD_HOST: '127.0.0.1', DEVKIT_GUACD_PORT: String(rdp.port), DEVKIT_GUACD_TLS: 'false' };
      const previousGateway = Object.fromEntries(Object.keys(gateway).map(key => [key, process.env[key]]));
      Object.assign(process.env, gateway);
      try {
        // Only the fixture guacd receives the saved address. No Windows host is contacted.
        const deployed = await js(`fetch('/api/lan-hosts/save', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'测试远程桌面',mode:'ssh',address:'192.0.2.45',user:'fixture',port:22,platform:'win32',rdpPort:3391})}).then(r=>r.status)`);
        assert.equal(deployed, 200);
        await button('刷新', '.lan-heading-actions button');
        await selectHost('测试远程桌面');
        await button('连接远程桌面', '.lan-host-list button');
        await fill('.lan-rdp-form input[name=username]', 'portal-rdp-user');
        await fill('.lan-rdp-form input[name=password]', 'portal-rdp-test');
        await button('连接', '.lan-rdp-form button');
        await wait('document.querySelector(".lan-rdp-toolbar [role=status]")?.textContent==="远程桌面已连接"');
        await wait(`Array.from(document.querySelectorAll('.lan-rdp-viewport canvas')).some(canvas=>canvas.width>=640&&Array.from(canvas.getContext('2d').getImageData(1,1,1,1).data).join(',')==='40,100,150,255')`);
        const fixtureConnection = rdp.connections.at(-1);
        assert.deepEqual([fixtureConnection.hostname, fixtureConnection.port, fixtureConnection.username], ['192.0.2.45', '3391', 'portal-rdp-user']);
        await button('发送 Ctrl+Alt+Del', '.lan-rdp-toolbar button');
        for (let attempt = 0; attempt < 40 && !rdp.messages.some(row => row.join(',') === 'key,65535,0'); attempt++) await delay(25);
        assert.ok(rdp.messages.some(row => row.join(',') === 'key,65535,0'));
        await button('断开连接', '.lan-rdp-toolbar button');
        await wait('!document.querySelector(".lan-rdp-form").hidden && !document.querySelector(".lan-rdp-form input[name=password]").value');
        await selector('button[aria-label="关闭远程桌面"]');
      } finally {
        await rdp.close();
        for (const [key, value] of Object.entries(previousGateway)) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
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
            legacyPopover: process.argv.includes('--legacy-popover'),
            statusFailureAndRecovery: true,
            copyAndManualFallback: true,
            debugDefinitionIsolation: true,
            variableDraftOnly: true,
            hashHistoryAndScroll: true,
            expiredAndOfflineLogout: true,
            visitorDraftIsolation: true,
            compactHeader: true,
            brokenResourceLinks: true,
            independentLogStreams: true,
            sharedLanInventory: true,
            embeddedRemoteDesktop: true,
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
