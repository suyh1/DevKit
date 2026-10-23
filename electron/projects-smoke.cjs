const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { BrowserWindow } = require("electron");

module.exports = async function checkProjects(window, output, staging) {
  window.webContents.setBackgroundThrottling(false);
  window.show();
  const js = (source) => window.webContents.executeJavaScript(source);
  const wait = async (contents, expression) => {
    for (let index = 0; index < 100; index++) {
      if (await contents.executeJavaScript(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    console.error(
      await contents.executeJavaScript(
        'JSON.stringify({errors:[...document.querySelectorAll(".pc-error")].map(item=>item.textContent),role:document.querySelector(".pc-role")?.textContent,cards:[...document.querySelectorAll(".pc-card h3")].map(item=>item.textContent),dialog:document.querySelector("dialog[open] h2")?.textContent,busy:document.querySelector(".pc-login .run-button")?.disabled})',
      ),
    );
    await fs.writeFile(
      path.join(output, "preview-project-failure.png"),
      (
        await BrowserWindow.fromWebContents(contents).webContents.capturePage()
      ).toPNG(),
    );
    throw new Error(`Project UI condition not met: ${expression}`);
  };
  const click = async (text) => {
    const expression = `[...document.querySelectorAll('.project-workspace button, dialog[open] button')].find(button => button.textContent.trim() === ${JSON.stringify(text)})`;
    await wait(
      window.webContents,
      `!!${expression} && !${expression}.disabled`,
    );
    await js(`${expression}.click()`);
    await wait(window.webContents, '!document.querySelector(".project-workspace .pc-busy")');
  };
  const field = (label, value) =>
    js(
      `{ const input = [...document.querySelectorAll('dialog[open] label')].find(label => label.querySelector('span')?.textContent === ${JSON.stringify(label)}).querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); }`,
    );
  const aria = (label, value) =>
    js(
      `{ const input = document.querySelector('dialog[open] input[aria-label=${JSON.stringify(label)}]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); }`,
    );
  const ipc = async (action, payload) => {
    const result = await js(
      `window.devkitProjects.request(${JSON.stringify(action)},${JSON.stringify(payload) ?? "undefined"})`,
    );
    assert.equal(result.error, undefined, result.error);
    return result.data;
  };
  const current = await ipc("get");
  await ipc("save", {
    revision: current.revision,
    data: {
      schemaVersion: 1,
      revision: current.revision,
      projects: [],
      profiles: [
        {
          id: "smoke-default",
          name: "开发环境",
          description: "本机开发入口",
          variables: [{ key: "host", value: "127.0.0.1" }],
          overrides: [],
        },
      ],
    },
  });
  await js(
    `document.querySelector('.sidebar button[title="项目中心"]').click()`,
  );
  await wait(
    window.webContents,
    '!!document.querySelector(".project-workspace .pc-heading")',
  );
  await click("刷新");
  await wait(
    window.webContents,
    'document.querySelector(".project-workspace .pc-environment h2")?.textContent === "开发环境"',
  );
  await click("添加项目");
  await field("项目名称", "管理控制台");
  await field("唯一编码", "admin");
  await field("分组", "业务应用");
  await field("说明", "项目定义与环境配置独立维护");
  await click("＋ 添加参数");
  await aria("参数 1 名称", "lang");
  await aria("参数 1 值", "中文");
  await click("保存项目定义");
  await wait(
    window.webContents,
    'document.querySelectorAll(".project-workspace .pc-card").length === 1 && !document.querySelector("dialog[open]")',
  );
  await js(
    `document.querySelector('button[aria-label="新建配置档案"]').click()`,
  );
  await field("档案名称", "测试环境");
  await field("说明", "共享测试服务器");
  await click("＋ 添加变量");
  await aria("变量 1 名称", "host");
  await aria("变量 1 值", "192.0.2.10");
  await click("保存配置档案");
  await wait(
    window.webContents,
    'document.querySelector(".project-workspace .pc-card code")?.textContent.includes("192.0.2.10") && !document.querySelector("dialog[open]")',
  );
  await js(
    `document.querySelector('button[aria-label="配置 管理控制台 环境覆盖"]').click()`,
  );
  await field("覆盖地址模板", "https://{{host}}/console");
  await click("保存当前档案覆盖");
  await wait(
    window.webContents,
    'document.querySelector(".project-workspace .pc-card code")?.textContent.includes("https://192.0.2.10/console") && !document.querySelector("dialog[open]")',
  );
  const saved = await ipc("get");
  assert.equal(saved.projects.length, 1);
  assert.equal(saved.profiles.length, 2);
  assert.equal(saved.projects[0].url, "http://{{host}}:8080/");
  await js(
    `document.querySelector('button[aria-label="编辑 管理控制台"]').click()`,
  );
  await field("项目名称", "管理控制台草稿");
  await ipc("save", { revision: saved.revision, data: saved });
  await click("保存项目定义");
  await wait(
    window.webContents,
    'document.querySelector("dialog[open] .pc-error")?.textContent.includes("其他使用者")',
  );
  assert.equal(
    await js(
      '[...document.querySelectorAll("dialog[open] label")].find(label => label.querySelector("span")?.textContent === "项目名称").querySelector("input").value',
    ),
    "管理控制台草稿",
  );
  await click("刷新共享数据");
  await wait(
    window.webContents,
    '!document.querySelector("dialog[open] .pc-error")',
  );
  await click("保存项目定义");
  await wait(
    window.webContents,
    '!document.querySelector("dialog[open]") && document.querySelector(".project-workspace .pc-card h3")?.textContent === "管理控制台草稿"',
  );
  await click("备份与恢复");
  await click("创建手动快照");
  await wait(
    window.webContents,
    'document.querySelector("dialog[open] .pc-snapshots")?.textContent.includes("手动快照")',
  );
  await wait(window.webContents, '!document.querySelector(\'dialog[open] button[aria-label="关闭项目中心窗口"]\').disabled');
  await js(
    `document.querySelector('dialog[open] button[aria-label="关闭项目中心窗口"]').click()`,
  );
  const beforeImport = await ipc("get"),
    imported = structuredClone(beforeImport);
  imported.projects[0].name = "团队管理台";
  const importSource = JSON.stringify({
    format: "devkit-project-center",
    version: 1,
    data: imported,
  });
  const chooseFile = () =>
    js(
      `{const input=document.querySelector('.project-workspace input[type=file]'); const files=new DataTransfer(); files.items.add(new File([${JSON.stringify(importSource)}], 'projects.json', {type:'application/json'})); input.files=files.files; input.dispatchEvent(new Event('change',{bubbles:true}));}`,
    );
  await chooseFile();
  await wait(
    window.webContents,
    'document.querySelector("dialog[open] h2")?.textContent === "导入预览"',
  );
  assert.equal(
    (await ipc("get")).projects[0].name,
    "管理控制台草稿",
    "import preview must not write",
  );
  await click("备份当前数据并导入");
  await wait(
    window.webContents,
    '!document.querySelector("dialog[open]") && document.querySelector(".project-workspace .pc-card h3")?.textContent === "团队管理台"',
  );
  const storage = await ipc('storage');
  assert.equal(path.resolve(storage.directory), path.resolve(output, 'installation/configs'));
  assert.equal(JSON.parse(await fs.readFile(path.join(storage.directory,'projects.json'),'utf8')).current.projects[0].name, '团队管理台');
  await click('配置文件');
  await wait(window.webContents, 'document.querySelector("dialog[open] .pc-path code")?.textContent.endsWith("configs")');
  await click('知道了');
  // Closing a dirty editor must preserve the draft until explicitly discarded.
  await js(`document.querySelector('button[aria-label="编辑 团队管理台"]').click()`);
  await field('项目名称','尚未保存的名称');
  await click('取消');
  await wait(window.webContents, '!!document.querySelector("dialog[open] .pc-discard")');
  await click('继续编辑');
  assert.equal(await js('[...document.querySelectorAll("dialog[open] label")].find(label=>label.querySelector("span")?.textContent==="项目名称").querySelector("input").value'), '尚未保存的名称');
  await click('取消'); await click('放弃更改');
  assert.equal((await ipc('get')).projects[0].name,'团队管理台');
  // A second merge must retain entries absent from the file.
  const existing = await ipc('get');
  existing.projects.push({ ...existing.projects[0], id:'retained', code:'retained', name:'保留项目', url:'https://example.test/status', query:[] });
  await ipc('save', {data:existing, revision:existing.revision});
  await click('刷新'); await chooseFile();
  await wait(window.webContents, '!!document.querySelector("dialog[open] .pc-import-modes")');
  await click('备份当前数据并导入');
  await wait(window.webContents, '!document.querySelector("dialog[open]") && document.querySelectorAll(".project-workspace .pc-card").length===2');
  assert.equal((await ipc('get')).projects.length,2);
  await js(`document.querySelector('input[aria-label="选择 团队管理台"]').click()`);
  await click('停用所选');
  await wait(window.webContents, '!!document.querySelector(\'button[aria-label="启用 团队管理台（仅当前档案）"]\')');
  let after = await ipc('get');
  assert.equal(after.profiles.find(item=>item.name==='测试环境').overrides.find(item=>item.projectId==='retained'), undefined);
  await click('启用所选'); await click('清除选择');
  await js(`document.querySelector('button[aria-label="列表视图"]').click()`);
  await wait(window.webContents, '!!document.querySelector(".project-workspace .pc-list")');
  await js(`document.querySelector('button[aria-label="卡片视图"]').click()`);
  // Restore is reviewed before a new revision is written.
  await click('备份与恢复');
  await aria('快照名称','恢复验收快照'); await click('创建手动快照');
  await wait(window.webContents, 'document.querySelector(".pc-snapshots")?.textContent.includes("恢复验收快照") && !document.querySelector(\'dialog[open] button[aria-label="关闭项目中心窗口"]\').disabled');
  await js(`document.querySelector('dialog[open] button[aria-label="关闭项目中心窗口"]').click()`);
  after=await ipc('get'); after.projects[0].name='临时变更';
  await ipc('save',{data:after,revision:after.revision});
  await click('刷新'); await click('备份与恢复');
  await js(`[...document.querySelectorAll('.pc-snapshots > div')].find(row=>row.querySelector('strong')?.textContent==='恢复验收快照').querySelector('button').click()`);
  await wait(window.webContents, 'document.querySelector("dialog[open] h2")?.textContent==="恢复预览"');
  assert.equal((await ipc('get')).projects[0].name,'临时变更');
  await click('备份当前数据并恢复');
  await wait(window.webContents, 'document.querySelector("dialog[open] h2")?.textContent==="备份与恢复" && !document.querySelector(\'dialog[open] button[aria-label="关闭项目中心窗口"]\').disabled');
  assert.equal((await ipc('get')).projects[0].name,'团队管理台');
  await js(`document.querySelector('dialog[open] button[aria-label="关闭项目中心窗口"]').click()`);
  await js(`document.querySelector('button[aria-label="编辑 团队管理台"]').click()`);
  window.show();
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await js('new Promise(resolve=>setTimeout(resolve,150))');
  assert.ok(await js('document.querySelector(\'dialog[open] input[aria-label="参数 1 名称"]\').getBoundingClientRect().width > 150'), 'Query fields must use their grid columns');
  await fs.writeFile(path.join(output,'preview-project-editor.png'),(await window.webContents.capturePage()).toPNG());
  const editorSize=window.getSize(), editorMinimum=window.getMinimumSize();
  window.setMinimumSize(360,600); window.setContentSize(375,800);
  await js('new Promise(resolve=>setTimeout(resolve,150))');
  assert.equal(await js('document.querySelector("dialog[open]").scrollWidth <= document.querySelector("dialog[open]").clientWidth + 1'),true,'Narrow editor must not overflow horizontally');
  await fs.writeFile(path.join(output,'preview-project-editor-narrow.png'),(await window.webContents.capturePage()).toPNG());
  window.setSize(...editorSize); window.setMinimumSize(...editorMinimum);
  await aria('参数 1 名称','');
  assert.equal(await js('[...document.querySelectorAll("dialog[open] button")].find(item=>item.textContent.trim()==="保存项目定义").disabled'),true);
  await aria('参数 1 名称','lang');
  await js('document.querySelector("dialog[open]").dispatchEvent(new Event("cancel",{cancelable:true}))');
  await wait(window.webContents, '!document.querySelector("dialog[open]")');
  const heights = await js('[...document.querySelectorAll(".project-workspace .pc-card")].map(item=>item.getBoundingClientRect().height)');
  assert.ok(heights.every(height=>height <= 180), `Compact cards exceeded 180 CSS px: ${heights}`);
  console.log(`Compact card heights (CSS px): ${heights.join(', ')}`);
  const port = await new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
  const hosted = await ipc("start", {
    host: "127.0.0.1",
    port,
    canEdit: false,
    password: "project-smoke-only",
  });
  const remote = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      partition: `project-smoke-${Date.now()}`,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  try {
    const url = hosted.addresses[0];
    await remote.loadURL(url);
    await wait(
      remote.webContents,
      '!!document.querySelector(".pc-login input[type=password]")',
    );
    await remote.webContents.executeJavaScript(
      `{const input=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'project-smoke-only');input.dispatchEvent(new Event('input',{bubbles:true}));}`,
    );
    await wait(
      remote.webContents,
      '!document.querySelector(".pc-login .run-button").disabled',
    );
    await remote.webContents.executeJavaScript(
      'document.querySelector(".pc-login .run-button").click()',
    );
    await wait(
      remote.webContents,
      'document.querySelector(".pc-card h3")?.textContent === "团队管理台"',
    );
    assert.equal(
      await remote.webContents.executeJavaScript(
        'document.querySelector(".pc-toolbar .run-button").disabled',
      ),
      true,
    );
    assert.equal(
      await remote.webContents.executeJavaScript(
        "typeof window.devkitProjects",
      ),
      "undefined",
    );
    assert.equal(
      await remote.webContents.executeJavaScript(
        'fetch("/api/projects/state",{method:"PUT",headers:{"Content-Type":"application/json"},body:"{}"}).then(r=>r.status)',
      ),
      403,
    );
    const privateFile = (
      await fs.readdir(path.join(staging, "dist", "assets"))
    ).find((name) => /^tool\.worker-/.test(name));
    assert.equal(
      await remote.webContents.executeJavaScript(
        `fetch(${JSON.stringify(`/assets/${privateFile}`)}).then(r=>r.status)`,
      ),
      404,
    );
    const buildManifest = JSON.parse(
      await fs.readFile(
        path.join(staging, "dist", ".vite", "manifest.json"),
        "utf8",
      ),
    );
    assert.equal(
      await remote.webContents.executeJavaScript(
        `fetch(${JSON.stringify("/" + buildManifest["index.html"].file)}).then(r=>r.status)`,
      ),
      404,
    );
    remote.showInactive();
    await remote.webContents.executeJavaScript(
      'document.documentElement.dataset.theme="light"; new Promise(resolve=>setTimeout(resolve,200))',
    );
    await fs.writeFile(
      path.join(output, "preview-project-portal.png"),
      (await remote.webContents.capturePage()).toPNG(),
    );
    const responsive = [];
    for (const width of [375,768,1024,1440]) {
      remote.setContentSize(width,800);
      await remote.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,100))');
      const metrics = await remote.webContents.executeJavaScript('({width:innerWidth,scroll:document.documentElement.scrollWidth})');
      assert.ok(metrics.scroll <= metrics.width, `Portal overflow at ${metrics.width}`); responsive.push(metrics);
    }
    await fs.writeFile(path.join(output,'project-responsive.json'),JSON.stringify(responsive,null,2));
    remote.setContentSize(375, 800);
    await remote.webContents.executeJavaScript(
      'document.documentElement.dataset.theme="dark"; new Promise(resolve=>setTimeout(resolve,200))',
    );
    assert.equal(
      await remote.webContents.executeJavaScript(
        "document.documentElement.scrollWidth <= innerWidth",
      ),
      true,
    );
    await fs.writeFile(
      path.join(output, "preview-project-portal-narrow.png"),
      (await remote.webContents.capturePage()).toPNG(),
    );
    window.show();
    await js("new Promise(resolve=>setTimeout(resolve,200))");
    await fs.writeFile(
      path.join(output, "preview-project-center.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
  } finally {
    remote.destroy();
    await ipc("stop");
  }
  console.log(
    "Project center smoke passed: real CRUD, environment overrides, import preview, snapshots, conflict draft retention, browser cookie login, readonly access, toolkit resource isolation and responsive portal.",
  );
};
