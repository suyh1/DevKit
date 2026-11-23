const assert = require("node:assert/strict");
const net = require("node:net");
const fs = require("node:fs/promises");
const path = require("node:path");
const { BrowserWindow, clipboard, dialog, shell } = require("electron");

module.exports = async function sharingSettingsSmoke(window, output) {
  const js = (code) => window.webContents.executeJavaScript(code, true);
  const wait = async (expression, execute = js) => {
    for (let attempt = 0; attempt < 160; attempt++) {
      if (await execute(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      `Sharing settings condition not met: ${expression}\n${await execute('document.querySelector(".sharing-panel")?.textContent')}`,
    );
  };
  const click = async (text, selector = ".sharing-panel button", execute = js) => {
    const button = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
    await wait(`!!${button}&&!${button}.disabled`, execute);
    await execute(`${button}.click()`);
  };
  const fill = async (name, value) => {
    await js(
      `(()=>{const input=[...document.querySelectorAll('.sharing-panel label')].find(e=>e.querySelector('span')?.textContent===${JSON.stringify(name)}).querySelector('input,select');Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`,
    );
  };
  const close = async () => {
    await js(
      'document.querySelector(".sharing-panel button[aria-label=关闭共享设置]").click()',
    );
    await wait('!document.querySelector(".sharing-panel dialog[open]")');
    await wait('!document.querySelector(".sharing-panel")');
  };
  const { openWorkspace: navigate, openTool } = require('./navigation-helpers.cjs')(window);
  const openShortcut = async (selector) => {
    await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await wait(
      '!!document.querySelector(".sharing-panel input[type=password]")&&!document.querySelector(".sharing-panel dialog").getAttribute("aria-busy").includes("true")',
    );
    assert.equal(
      await js(
        'document.querySelectorAll(".sharing-panel dialog[open]").length',
      ),
      1,
    );
  };
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  let occupied;
  try {
    await wait(
      'document.querySelector(".global-sharing-button")?.dataset.sharingState==="stopped"',
    );
    await openShortcut(".global-sharing-button");
    assert.deepEqual(await js('[...document.querySelectorAll(".sharing-service")].map(service => service.dataset.service).sort()'),
      ['file-shares', 'http', 'jar', 'knowledge', 'lan-hosts', 'logs', 'mock', 'monitor', 'nginx', 'project-todos', 'projects', 'transfer', 'whiteboard']);
    assert.equal(
      await js(
        '[...document.querySelectorAll(".sharing-service-toggle input")].every(input=>!input.checked)',
      ),
      true,
    );
    assert.equal(
      await js(
        '[...document.querySelectorAll(".sharing-service-permissions")].every(fieldset=>fieldset.disabled)',
      ),
      true,
    );
    assert.equal(
      await js('document.querySelector(".sharing-panel .run-button").disabled'),
      true,
    );
    await js(
      `document.querySelector('.sharing-service[data-service=nginx] .sharing-service-toggle input').click()`,
    );
    await js(
      `document.querySelector('.sharing-service[data-service=nginx] .sharing-service-permissions input').click()`,
    );
    await js(
      `document.querySelector('.sharing-service[data-service=nginx] .sharing-service-toggle input').click()`,
    );
    assert.equal(
      await js(
        '[...document.querySelectorAll(".sharing-service[data-service=nginx] .sharing-service-permissions input")].every(input=>!input.checked)',
      ),
      true,
    );
    await fill("监听范围", "127.0.0.1");
    await fill("端口", port);
    await fill("首次访问口令（至少 8 位）", "global-sharing-test-only");
    await js(
      `for(const id of ['nginx','http','lan-hosts']) document.querySelector('.sharing-service[data-service='+id+'] .sharing-service-toggle input').click()`,
    );
    await js(
      'document.querySelector(".sharing-panel button[aria-label=关闭共享设置]").click()',
    );
    await wait('!!document.querySelector(".sharing-panel .pc-discard")');
    await click("继续编辑");
    assert.equal(
      await js(
        'document.querySelector(".sharing-panel input[type=number]").value',
      ),
      String(port),
    );
    await click("开启共享");
    await wait(
      'document.querySelector(".global-sharing-button")?.dataset.sharingState==="running"',
    );
    await wait(
      'document.querySelector(".sharing-panel .pc-inline-feedback")?.textContent.includes("已启动")',
    );
    assert.equal(await js('window.devkitProjects.request("sharing").then(result => result.data.services["lan-hosts"].enabled)'), true);
    const address = `http://127.0.0.1:${port}/`;
    assert.ok(
      await js(
        `document.querySelector('.global-sharing-button').title.includes(${JSON.stringify(address)})`,
      ),
    );
    await close();
    await navigate("项目中心");
    await click("添加项目", ".project-center button");
    await wait('!!document.querySelector("dialog[open]")');
    await js(
      'window.dispatchEvent(new KeyboardEvent("keydown",{key:"k",ctrlKey:true,bubbles:true}))',
    );
    assert.equal(
      await js('document.querySelectorAll("dialog[open]").length'),
      1,
      "Global search must not cover a module dialog",
    );
    await click("取消", "dialog[open] button");
    await wait('!document.querySelector("dialog[open]")');
    assert.equal(await js("!!document.querySelector(" + JSON.stringify(".project-center .sharing-shortcut") + ")"), false);
    await openShortcut(".global-sharing-button");
    window.show();
    window.focus();
    window.webContents.focus();
    await click("复制地址");
    await wait(
      'document.querySelector(".pc-inline-feedback")?.textContent.includes("已复制")',
    );
    assert.equal(await clipboard.readText(), address);
    await close();
    await navigate("Nginx 配置");
    assert.equal(await js("!!document.querySelector(" + JSON.stringify(".ng-center .sharing-shortcut") + ")"), false);
    await openShortcut(".global-sharing-button");
    await click("停止共享");
    await wait(
      'document.querySelector(".global-sharing-button")?.dataset.sharingState==="stopped"',
    );
    await wait('!document.querySelector(".sharing-panel .pc-sharing-state > div > code")');
    await close();
    await navigate("HTTP 调试");
    assert.equal(await js("!!document.querySelector(" + JSON.stringify(".http-workspace-topline .sharing-shortcut") + ")"), false);
    await openShortcut(".global-sharing-button");
    assert.equal(
      await js(
        'document.querySelector(".sharing-panel input[type=number]").value',
      ),
      String(port),
    );
    // Reserve the port without retaining connections from the browser or the runner.
    occupied = net.createServer(connection => connection.destroy());
    await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    await fill("端口", occupied.address().port);
    await click("开启共享");
    await wait('!!document.querySelector(".sharing-panel .pc-error")');
    assert.equal(
      await js(
        'document.querySelector(".sharing-panel input[type=number]").value',
      ),
      String(occupied.address().port),
    );
    assert.equal(
      await js(
        'document.querySelector(".global-sharing-button").dataset.sharingState',
      ),
      "stopped",
    );
    await new Promise((resolve) => occupied.close(resolve));
    occupied = undefined;
    await js(
      'document.querySelector(".sharing-panel button[aria-label=关闭共享设置]").click()',
    );
    await click("放弃更改");
    await wait('!document.querySelector(".sharing-panel")');
    await js(
      'document.querySelector(".breadcrumb button:not(.icon-button)").click()',
    );
    window.setMinimumSize(360, 600);
    for (const [width, theme] of [
      [375, "light"],
      [768, "dark"],
      [1440, "light"],
    ]) {
      window.setContentSize(width, 900);
      await js(
        `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.equal(
        await js("document.documentElement.scrollWidth<=innerWidth"),
        true,
        `Sharing entry overflow at ${width}`,
      );
      assert.equal(
        await js(
          '(()=>{const r=document.querySelector(".global-sharing-button").getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth})()',
        ),
        true,
      );
      await fs.writeFile(
        path.join(output, `sharing-global-${width}-${theme}.png`),
        (await window.webContents.capturePage()).toPNG(),
      );
      assert.equal(
        await js(
          '(()=>{const bar=document.querySelector(".floating-navbar"),r=bar.getBoundingClientRect();return ["打开工具搜索","恢复工作区","保存工作区"].every(label=>!!bar.querySelector(`[aria-label="${label}"]`))&&[...bar.querySelectorAll("button")].filter(b=>b.getClientRects().length).every(button=>{const b=button.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right+1})})()',
        ),
        true,
        `Navigation clipped at ${width}`,
      );
      await openShortcut(".global-sharing-button");
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.equal(
        await js(
          '(()=>{const r=document.querySelector(".sharing-panel dialog").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()',
        ),
        true,
        `Sharing dialog overflow at ${width}`,
      );
      await fs.writeFile(
        path.join(output, `sharing-settings-${width}-${theme}.png`),
        (await window.webContents.capturePage()).toPNG(),
      );
      if (await js('!matchMedia("(forced-colors: active)").matches')) {
        await js('document.querySelector(".sharing-panel select").showPicker()');
        await wait('!!document.querySelector(".sharing-panel select:open")');
        assert.ok(await js(`(() => {
          const field = document.querySelector(".sharing-panel select:open");
          const picker = getComputedStyle(field, "::picker(select)");
          const row = field.options[0].getBoundingClientRect();
          return picker.appearance === "base-select" && row.height >= 32 &&
            row.left >= 0 && row.right <= innerWidth && row.top >= 0 && row.bottom <= innerHeight;
        })()`), `Sharing scope options fit the ${width}px viewport`);
        window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
        window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
        await wait('!document.querySelector(".sharing-panel select:open") && !!document.querySelector(".sharing-panel dialog[open]")');
      }
      if (width === 375) {
        const visible = window.isVisible();
        window.hide();
        try {
          await wait('document.hidden');
          await close();
        } finally {
          if (visible) window.show();
        }
      } else {
        await close();
      }
    }
    const sample = path.join(await fs.mkdtemp(path.join(output, 'file-share-')), 'sample.txt');
    const exportedFile = path.join(path.dirname(sample), 'desktop.todo');
    const downloadedFile = path.join(path.dirname(sample), 'browser.todo');
    const originalPicker = dialog.showOpenDialog, originalSave = dialog.showSaveDialog, originalOpen = shell.openExternal;
    let browser;
    let opened, selected;
    dialog.showOpenDialog = async (_window, options) => {
      selected = options.properties;
      return { canceled: false, filePaths: [sample] };
    };
    shell.openExternal = async url => { opened = url; };
    try {
      await fs.writeFile(sample, 'Desktop file share');
      const fileSocket = net.createServer();
      await new Promise(resolve => fileSocket.listen(0, '127.0.0.1', resolve));
      const filePort = fileSocket.address().port;
      await new Promise(resolve => fileSocket.close(resolve));
      await navigate('本机文件共享管理');
      await click('新建共享', '.workspace:not([hidden]) .planning-workspace button');
      await wait('document.querySelector("dialog[open] .planning-form input") !== null');
      await js(`(() => {
        const [name, port] = document.querySelectorAll("dialog[open] .planning-form-grid input");
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        for (const [input, value] of [[name, '文件共享测试'], [port, '${filePort}']]) {
          set.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()`);
      await click('添加文件', 'dialog[open] button');
      assert.deepEqual(selected, ['openFile', 'multiSelections']);
      await js('[...document.querySelectorAll(".planning-check")].find(label => label.textContent.includes("发布到共享工作台")).querySelector("input").click()');
      await click('保存共享', 'dialog[open] button');
      await click('打开网页', '.workspace:not([hidden]) .planning-workspace button');
      await wait('document.querySelector(".file-share-list").textContent.includes("运行中")');
      const status = await js('window.devkitFileShares.request("get").then(result => result.data.shares[0])');
      assert.equal(opened, status.links[0]);
      assert.equal(await (await fetch(opened + '0')).text(), 'Desktop file share');
      await click('停止', '.workspace:not([hidden]) .planning-workspace button');
      await wait('document.querySelector(".file-share-list").textContent.includes("已停止")');

      window.show(); window.focus(); window.webContents.focus();
      const mod = process.platform === 'darwin' ? 'meta' : 'control';
      const press = (keyCode, modifiers) => {
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      };
      await openTool('JSON 格式化');
      const taskPane = '.task-pane:not([hidden])';
      await click('示例', `${taskPane} .editor-footer button`);
      press('Enter', [mod]);
      await wait(`!!document.querySelector('${taskPane} .status-success')`);

      await navigate('待办清单');
      await click('新建清单', '.workspace:not([hidden]) .td-workspace button');
      await wait('document.querySelector("dialog[open] .td-settings input") !== null');
      await js(`(() => {
        const input = document.querySelector("dialog[open] .td-settings input");
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '本机清单');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await click('保存', 'dialog[open] button');
      await wait('document.querySelector(".td-sheet-head h2")?.textContent === "本机清单"');
      await js('document.querySelector(".td-toolbar .td-more").open = true');
      await click('源码', '.td-toolbar button');
      await click('新任务', '.td-toolbar button');
      await window.webContents.insertText('本机待办 @today');
      const todoLine = 'document.querySelectorAll(".td-editor .cm-line")[1]?.textContent.trim()';
      await wait(`${todoLine} === "☐ 本机待办 @today"`);
      press('Enter', [mod]);
      await wait(`${todoLine} === "本机待办 @today"`);
      press('Enter', [mod]);
      await wait(`${todoLine} === "☐ 本机待办 @today"`);
      press('Enter', ['alt']);
      await wait(`${todoLine} === "本机待办 @today"`);
      press('Enter', ['alt']);
      await wait(`${todoLine} === "☐ 本机待办 @today"`);
      press('S', ['alt']);
      await wait(`${todoLine}?.includes(" @started(")`);
      press('S', ['alt']);
      await wait(`${todoLine} === "☐ 本机待办 @today"`);
      press('C', ['alt']);
      await wait(`${todoLine}?.startsWith("✘ 本机待办 @today @cancelled(")`);
      press('C', ['alt']);
      await wait(`${todoLine} === "☐ 本机待办 @today"`);
      press('D', ['alt']);
      await wait(`${todoLine}?.startsWith("✔ 本机待办 @today @done(")`);
      press('A', [mod, 'shift']);
      await wait('document.querySelector(".td-editor .cm-content")?.textContent.includes("Archive:")');
      press('S', [mod]);
      await wait('document.querySelector(".td-status [role=status]")?.textContent === "已保存"');
      const todo = await js('window.devkitProjectTodos.request("get").then(result => result.data.documents[0])');
      assert.equal(todo.published, false);
      assert.match(todo.body, /Archive:\n  ✔ 本机待办 @today @done/);

      const todoInput = 'input[aria-label="选择清单文件"]';
      const importButton = '[...document.querySelectorAll(".td-heading button")].find(button => button.textContent.trim() === "导入清单")';
      const importTodo = async (execute, body, name) => {
        await wait(`!!(${importButton}) && !(${importButton}).disabled`, execute);
        await execute(`(() => {
          const input = document.querySelector(${JSON.stringify(todoInput)});
          const files = new DataTransfer();
          files.items.add(new File([${JSON.stringify(body)}], ${JSON.stringify(name + '.todo')}));
          input.files = files.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
        await wait(`document.querySelector('dialog[open] .td-settings input')?.value === ${JSON.stringify(name)}`, execute);
        await click('导入', 'dialog[open] button', execute);
        await wait(`document.querySelector('.td-sheet-head h2')?.textContent === ${JSON.stringify(name)}`, execute);
      };
      dialog.showSaveDialog = async (_window, options) => {
        assert.equal(options.defaultPath, '本机清单.todo');
        return { canceled: false, filePath: exportedFile };
      };
      await click('导出清单', '.td-sheet-head button');
      await wait('document.querySelector(".td-status [role=status]")?.textContent.includes("desktop.todo")');
      const exported = await fs.readFile(exportedFile, 'utf8');
      assert.equal(exported, todo.body);
      await importTodo(js, exported, '本机清单副本');
      const desktopDocs = 'window.devkitProjectTodos.request("get").then(result => result.data.documents)';
      const afterImport = await js(desktopDocs);
      assert.deepEqual(afterImport[0], todo);
      assert.equal(afterImport[1].published, false);
      assert.equal(afterImport[1].body, exported);

      const { emptySharingServices } = await import('../shared/sharing.mjs');
      const services = emptySharingServices(), viewerServices = emptySharingServices();
      services['project-todos'] = { enabled: true, edit: true };
      services['file-shares'].enabled = true;
      viewerServices['project-todos'].enabled = true;
      const options = { host: '127.0.0.1', port, services,
        visitors: [{ name: '只读测试', password: 'todo-view-test-only', services: viewerServices }],
      };
      const start = await js(`window.devkitProjects.request('start', ${JSON.stringify(options)})`);
      assert.equal(start.error, undefined);
      browser = new BrowserWindow({ show: false, webPreferences: { sandbox: true, partition: `todo-smoke-${Date.now()}`, backgroundThrottling: false } });
      const web = code => browser.webContents.executeJavaScript(code, true);
      await browser.loadURL(`${address}#project-todos`);
      const login = async (name, password) => {
        await wait('!!document.querySelector(".portal-login input[type=password]")', web);
        await web(`(() => {
          const inputs = document.querySelectorAll('.portal-login input');
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          for (const [input, value] of [[inputs[0], ${JSON.stringify(name)}], [inputs[1], ${JSON.stringify(password)}]]) {
            set.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()`);
        await click('登录', '.portal-login button', web);
        await wait('!!document.querySelector(".portal-page:not([hidden]) .td-documents")', web);
      };
      await login('', 'global-sharing-test-only');
      assert.equal(await web('document.querySelector(".td-documents nav")'), null);
      await importTodo(web, exported, '网页导入清单');
      const [privateOriginal, privateCopy, shared] = await js(desktopDocs);
      assert.deepEqual([privateOriginal, privateCopy], afterImport);
      assert.equal(shared.published, true);
      assert.equal(shared.body, exported);

      await click('退出登录', '.portal-bar button', web);
      await click('退出', 'dialog[open] button', web);
      await login('只读测试', 'todo-view-test-only');
      assert.equal(await web('document.querySelector(".td-documents nav").textContent'), '网页导入清单');
      assert.equal(await web(`!!document.querySelector(${JSON.stringify(todoInput)})`), false);
      assert.equal(await web(`!!(${importButton})`), false);
      assert.equal(await web('[...document.querySelectorAll(".td-toolbar button")].some(button => button.textContent === "添加子任务")'), false);
      const session = browser.webContents.session;
      const download = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Todo browser download timed out')), 8000);
        session.once('will-download', (_event, item) => {
          item.setSavePath(downloadedFile);
          item.once('done', (_event, state) => {
            clearTimeout(timer);
            if (state === 'completed') resolve(item.getFilename());
            else reject(new Error(`Todo browser download ${state}`));
          });
        });
      });
      const [downloadName] = await Promise.all([download, click('导出清单', '.td-sheet-head button', web)]);
      assert.equal(downloadName, '网页导入清单.todo');
      assert.equal(await fs.readFile(downloadedFile, 'utf8'), exported);

      const syntaxBody = [
        ':: 视图 待验收 @tag(验收) @state(open)', '发布:', '  :: 默认 @验收 @owner(小陈)', '  ✔ 打包 @id(build)',
        '  ☐ 核对下载 @验收 @after(build) @repeat(每周一)', '    ? [ ] ZIP 完整', '    :: 接着 验证只读下载',
        '  ☐ 跟进认证 @wait(小周) @review(2000-01-01)', '  ☐ 打开工具 [[工具:JSON 格式化]]', '  ☐ 打开共享 [[共享:文件共享测试]]',
      ].join('\n');
      const filter = (mode, execute) => execute(`(() => {
        const select = document.querySelector('.td-outline select');
        select.value = ${JSON.stringify(mode)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      const jump = async (title, execute) => {
        const button = `[...document.querySelectorAll('.td-outline-task')].find(item => item.querySelector('span[title]')?.textContent.startsWith(${JSON.stringify(title)}))`;
        await wait(`!!${button}`, execute);
        await execute(`${button}.click()`);
      };
      const toolbar = '.td-toolbar button';
      const syntaxToolbar = '.td-syntax-toolbar button';
      const editorContents = 'document.querySelector(".td-editor .cm-content").innerText';
      const fillSyntax = (selector, value, execute) => execute(`(() => {
        const input = document.querySelector(${JSON.stringify('.td-syntax-form ' + selector)});
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await importTodo(js, syntaxBody, '桌面扩展语法');
      await click('大纲', toolbar);
      await click('源码', toolbar);
      await wait('!!document.querySelector("button.td-preview-check[aria-checked=false]")');
      assert.ok(await js('[...document.querySelectorAll(".td-preview-resume")].some(label => label.textContent === "续做点")'));
      await js('document.querySelector("button.td-preview-check[aria-checked=false]").click()');
      await wait('!!document.querySelector("button.td-preview-check[aria-checked=true]") && document.querySelector(".td-check-progress progress").value === 1');
      await js('document.querySelector("button.td-preview-check[aria-checked=true]").click()');
      await wait('document.querySelector(".td-check-progress progress").value === 0');
      await jump('核对下载', js);
      await wait('document.querySelector(".td-editor .cm-activeLine").textContent.includes("@after(build)")');
      await click('源码', toolbar);
      await wait('!document.querySelector(".td-preview-token")');
      assert.deepEqual(await js(`[...document.querySelectorAll(${JSON.stringify(syntaxToolbar)})].map(button => button.textContent).sort()`),
        ['验收条件', '续做点', '自定义视图', '添加引用', '等待回访', '前置任务', '周期任务', '分组默认'].sort());
      await jump('核对下载', js);
      await click('续做点', syntaxToolbar);
      await wait('document.querySelector(".td-syntax-form input")?.value === "验证只读下载"');
      await fillSyntax('input', '验证只读下载和文件名', js);
      await click('写入清单', '.td-syntax-form button');
      await wait(`${editorContents}.includes(":: 续做 验证只读下载和文件名")`);
      await filter('view:待验收', js);
      await wait('document.querySelectorAll(".td-outline-task").length === 1');
      await wait('document.querySelector(".td-outline-task").textContent.includes("验收 0/1")');
      await click('前置已完成 · build', '.td-outline-details button');
      await wait('document.querySelector(".td-line-number").textContent === "第 4 行"');
      await click('继续做 · 验证只读下载和文件名', '.td-outline-details button');
      await wait('document.querySelector(".td-line-number").textContent === "第 7 行"');
      await click('添加子任务', toolbar);
      await window.webContents.insertText('测试只读账号');
      await click('添加子任务', toolbar);
      await window.webContents.insertText('核对下载文件名');
      await click('完成', toolbar);
      await jump('核对下载', js);
      await click('添加子任务', toolbar);
      await window.webContents.insertText('检查分享地址');
      assert.match(await js(editorContents), /\n    :: 续做 验证只读下载和文件名\n      ☐ 测试只读账号 @验收 @owner\(小陈\)\n        ✔ 核对下载文件名 .*@done\(.*\)\n    ☐ 检查分享地址 @验收 @owner\(小陈\)\n  ☐ 跟进认证/);
      await jump('核对下载', js);
      await click('完成', toolbar);
      await click('继续验收', 'dialog[open] button');
      await wait('!document.querySelector("dialog[open]")');
      assert.match(await js(editorContents), /☐ 核对下载/);
      await click('完成', toolbar);
      await click('仍然完成', 'dialog[open] button');
      await wait('document.querySelector(".td-status [role=status]").textContent.includes("已生成 1 项下期任务")');
      await wait('!document.querySelector("dialog[open]")');
      assert.match(await js(editorContents), /✔ 核对下载 .*@done\(/);
      assert.match(await js(editorContents), /☐ 核对下载 @验收 @repeat\(每周一\) @due\(\d{4}-\d{2}-\d{2}\)/);

      window.show(); window.focus(); window.webContents.focus();
      await filter('all', js);
      await js('document.querySelector(".td-outline-section").click()');
      await wait('document.querySelector(".td-line-number").textContent === "第 2 行"');
      await click('新任务', toolbar);
      assert.match(await js(editorContents), /☐\s+@验收\s+@owner\(小陈\)/);
      await wait('document.activeElement.matches(".td-editor .cm-content")');
      await window.webContents.insertText('补充说明');
      assert.match(await js(editorContents), /☐ 补充说明 @验收 @owner\(小陈\)/);
      await jump('打开工具', js);
      await click('打开引用', toolbar);
      await wait(`document.querySelector('${taskPane} h1')?.textContent === 'JSON 格式化'`);

      const fileState = await js('window.devkitFileShares.request("get").then(result => result.data)');
      const restarted = await js(`window.devkitFileShares.request('toggle', { id:${JSON.stringify(status.id)}, revision:${fileState.revision}, enabled:true })`);
      assert.equal(restarted.error, undefined);
      assert.ok(restarted.data.shares.some(share => share.id === status.id && share.running && share.published), 'The referenced fixture is running and published');
      await click('退出登录', '.portal-bar button', web);
      await click('退出', 'dialog[open] button', web);
      await login('', 'global-sharing-test-only');
      await importTodo(web, syntaxBody, '网页扩展语法');
      await click('大纲', toolbar, web);
      await click('自定义视图', syntaxToolbar, web);
      await wait('!!document.querySelector(".td-syntax-form input")', web);
      await fillSyntax('input', '网页待办', web);
      await click('写入清单', '.td-syntax-form button', web);
      await wait('Array.from(document.querySelectorAll(".td-outline option")).some(option => option.textContent === "网页待办")', web);
      await jump('核对下载', web);
      await click('添加子任务', toolbar, web);
      await web(`(() => {
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', '核对网页下载');
        document.querySelector('.td-editor .cm-content').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
      })()`);
      await wait(`${editorContents}.includes("核对网页下载")`, web);
      await click('保存', '.td-sheet-head button', web);
      await wait('document.querySelector(".td-status [role=status]").textContent === "已保存"', web);
      const savedWebTodo = (await js(desktopDocs)).find(item => item.name === '网页扩展语法');
      assert.match(savedWebTodo.body, /\n    ☐ 核对网页下载 @验收 @owner\(小陈\)\n  ☐ 跟进认证/);
      await filter('follow-up', web);
      await wait('document.querySelector(".td-outline-task")?.textContent.includes("跟进认证") && document.querySelector(".td-follow-up").textContent === "1 项回访到期"', web);
      await filter('all', web);
      browser.setContentSize(375, 780);
      await wait('Math.abs(innerWidth - 375) <= 1', web);
      assert.ok(await web('[...document.querySelectorAll(".td-toolbar")].every(bar => bar.scrollWidth <= bar.clientWidth)'));
      assert.ok(await web('document.querySelector(".td-document-picker").getClientRects().length === 1 && document.querySelector(".td-documents nav").getClientRects().length === 0'));
      await wait('!!document.querySelector(".td-preview-reference[data-reference-kind=share]")', web);
      await web('document.querySelector(".td-preview-reference[data-reference-kind=share]").click()');
      try {
        await wait(`location.hash === ${JSON.stringify('#file-shares/' + encodeURIComponent(status.id))} && document.querySelector('.pl-share-detail h2')?.textContent === '文件共享测试'`, web);
      } catch (failure) {
        console.error(await web(`({ hash: location.hash, todoStatus: document.querySelector('.td-status')?.textContent, shareDetail: document.querySelector('.pl-files-workspace')?.textContent.slice(0, 300) })`));
        throw failure;
      }
      await click('退出登录', '.portal-bar button', web);
      await click('退出', 'dialog[open] button', web);
      await web('location.hash = "#project-todos"');
      await login('只读测试', 'todo-view-test-only');
      await click('网页扩展语法', '.td-documents nav button', web);
      assert.equal(await web('!!document.querySelector(".td-syntax-toolbar")'), false);
      await wait('!!document.querySelector(".td-preview-check[aria-disabled=true]")', web);
      await click('大纲', toolbar, web);
      await jump('核对网页下载', web);
      await jump('打开共享', web);
      await click('打开引用', toolbar, web);
      await wait('location.hash === "#project-todos" && document.querySelector(".workspace-access-bubble[role=status]")?.textContent === "「本机文件共享管理」未向当前访客共享。"', web);
      const sheetActions = '.td-sheet-head button';
      const confirmation = '.confirm-dialog[open] button';
      assert.equal(await web('!!document.querySelector(".td-sheet-head .td-delete")'), false);

      await navigate('待办清单');
      await click('删除清单', sheetActions);
      await wait('document.querySelector(".confirm-dialog[open] p")?.textContent.includes("未保存的编辑")');
      await click('保留清单', confirmation);
      await wait('!document.querySelector(".confirm-dialog[open]")');
      assert.match(await js(editorContents), /补充说明/);
      await click('删除清单', sheetActions);
      await click('删除清单', confirmation);
      await wait('document.querySelector(".td-sheet-head h2")?.textContent === "本机清单"');
      assert.equal((await js(desktopDocs)).some(item => item.name === '桌面扩展语法'), false);

      await click('退出登录', '.portal-bar button', web);
      await click('退出', 'dialog[open] button', web);
      await login('', 'global-sharing-test-only');
      await click('删除清单', sheetActions, web);
      await click('删除清单', confirmation, web);
      await wait('document.querySelector(".td-sheet-head h2")?.textContent === "网页扩展语法"', web);
      await click('删除清单', sheetActions, web);
      await click('删除清单', confirmation, web);
      await wait('document.querySelector(".td-empty [role=status]")?.textContent === "已删除清单"', web);
      assert.deepEqual(await js(desktopDocs), afterImport);

      const stopped = await js(`window.devkitFileShares.request('toggle', { id:${JSON.stringify(status.id)}, revision:${restarted.data.revision}, enabled:false })`);
      assert.equal(stopped.error, undefined);
    } finally {
      browser?.destroy();
      dialog.showOpenDialog = originalPicker;
      dialog.showSaveDialog = originalSave;
      shell.openExternal = originalOpen;
      await Promise.all([sample, exportedFile, downloadedFile].map(file => fs.rm(file, { force: true })));
      await fs.rmdir(path.dirname(sample));
    }
  } finally {
    if (occupied) await new Promise((resolve) => occupied.close(resolve));
    await js('window.devkitProjects.request("stop")');
  }
  console.log(
    "Global sharing settings, file downloads, Todo shortcuts, nested subtasks, syntax and desktop/browser import, export and deletion passed.",
  );
};
