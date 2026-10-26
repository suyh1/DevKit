const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
module.exports = async function apiSmoke(window, output) {
  window.show();
  window.focus();
  window.webContents.focus();
  window.webContents.setBackgroundThrottling(false);
  window.setSize(1440, 1000);
  const js = async (source) => {
    try {
      return await window.webContents.executeJavaScript(source, true);
    } catch (error) {
      console.error("Failed API script:", source);
      throw error;
    }
  };
  const wait = async (expression) => {
    for (let i = 0; i < 150; i++) {
      if (await js(`Boolean(${expression})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await fs.writeFile(
      path.join(output, "api-failure.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    console.error(
      await js(
        'JSON.stringify({errors:[...document.querySelectorAll(".api-error")].map(item=>item.textContent),dialog:document.querySelector("dialog[open]")?.textContent?.slice(0,500)})',
      ),
    );
    throw Error("API condition failed: " + expression);
  };
  const click = async (text, root = ".api-workspace") => {
    const target = `[...document.querySelectorAll(${JSON.stringify(root + " button")})].find(item=>item.textContent.trim()===${JSON.stringify(text)})`;
    await wait(`!!${target}&&!${target}.disabled`);
    await js(`${target}.click()`);
    await js("new Promise(resolve=>requestAnimationFrame(resolve))");
  };
  const input = async (label, value) => {
    await js(
      `{const e=document.querySelector('input[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}`,
    );
    await js("new Promise(resolve=>requestAnimationFrame(resolve))");
  };
  const select = async (label, value) => {
    await js(
      `{const e=document.querySelector('select[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));}`,
    );
    await js("new Promise(resolve=>requestAnimationFrame(resolve))");
  };
  const edit = async (label, value) => {
    const selector = `.cm-content[aria-label=${JSON.stringify(label)}]`;
    await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
    await js(`document.querySelector(${JSON.stringify(selector)}).focus()`);
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
    await window.webContents.insertText(value);
    await js("new Promise(resolve=>requestAnimationFrame(resolve))");
  };
  const ipc = async (action, payload) => {
    const result = await js(
      `window.devkitHttp.request(${JSON.stringify(action)},${JSON.stringify(payload) || "undefined"})`,
    );
    assert.equal(result.error, undefined, result.error);
    return result.data;
  };
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith("/slow")) return;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({
      url: req.url,
      headers: req.headers,
      body: Buffer.concat(chunks).toString(),
    });
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": ["a=1", "b=2"],
    });
    res.end(
      JSON.stringify({ ok: true, name: "张三", echo: requests.at(-1).body }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await js(
      `document.querySelector('.floating-nav-links [aria-label="HTTP 调试"]').click()`,
    );
    await wait('!!document.querySelector(".api-blank")');
    await click("新建API项目");
    await wait(
      'document.querySelector("dialog[open] h2")?.textContent==="API项目设置"',
    );
    await input("API项目名称", "本地接口联调");
    await input("API默认服务地址", base);
    await click("添加目录", ".api-settings");
    await input("目录1名称", "用户");
    await click("添加环境", ".api-settings");
    await input("环境1名称", "本地环境");
    await input("环境1服务地址", base);
    await click("添加环境1变量", ".api-settings");
    await input("环境1变量 1 名称", "token");
    await input("环境1变量 1 值", "local-token");
    await click("保存API项目", ".api-settings");
    await wait(
      '!document.querySelector("dialog[open]")&&document.querySelector(".api-project-select").textContent.includes("本地接口联调")',
    );
    await click("添加第一个接口");
    await input("API接口名称", "创建用户");
    await select("API接口方法", "POST");
    await input("API接口路径", "/users/{id}");
    await select("API接口目录", "用户");
    await click("添加参数", ".api-definition");
    await input("参数1名称", "id");
    await select("参数1位置", "path");
    await input("参数1示例", "a/b");
    await click("添加参数", ".api-definition");
    await input("参数2名称", "q");
    await input("参数2示例", "中文 & value");
    await select("API鉴权方式", "bearer");
    await input("API Bearer Token", "{{token}}");
    await select("API正文类型", "json");
    const body = '{"id":9007199254740993,"name":"张三"}';
    await edit("API请求正文", body);
    await edit(
      "响应1Schema",
      '{"type":"object","required":["ok","name"],"properties":{"ok":{"type":"boolean"},"name":{"type":"string"}}}',
    );
    await click("保存接口");
    await wait('!document.querySelector(".api-draft-badge")');
    const library = await ipc("get-library");
    assert.equal(library.state.projects[0].endpoints[0].body, body);
    assert.equal(
      JSON.parse(
        await fs.readFile(
          path.join(library.directory, "api-workspace.json"),
          "utf8",
        ),
      ).current.projects.length,
      1,
    );
    await click("接口文档", ".api-view-toolbar");
    await wait(
      '!!document.querySelector(".api-documentation table[aria-label=Schema字段结构]")',
    );
    await js(
      'document.querySelector(".api-main").scrollTop=0;document.querySelector(".http-workspace").scrollTop=0;new Promise(resolve=>setTimeout(resolve,200))',
    );
    await fs.writeFile(
      path.join(output, "preview-api-docs-dark.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    await click("运行调试", ".api-view-toolbar");
    await wait(
      'document.querySelector(".api-debug .api-error")?.textContent.includes("缺少环境变量")',
    );
    assert.equal(requests.length, 0);
    await select("API当前环境", library.state.projects[0].environments[0].id);
    await click("接口设计", ".api-view-toolbar");
    await js(`document.querySelectorAll('.api-parameter-schema')[1].open=true`);
    await js(`{const e=document.querySelector('textarea[aria-label="参数2Schema"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'{"type":"string","pattern":"^NEVER$"}');e.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await click("保存接口");
    await wait('!document.querySelector(".api-draft-badge")');
    await click("运行调试", ".api-view-toolbar");
    await click("发送API请求", ".api-debug");
    await wait('document.querySelector(".api-debug .api-error")?.textContent.includes("未通过Schema")');
    assert.equal(requests.length, 0);
    await click("接口设计", ".api-view-toolbar");
    await js(`document.querySelectorAll('.api-parameter-schema')[1].open=true`);
    await js(`{const e=document.querySelector('textarea[aria-label="参数2Schema"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'{"type":"string","minLength":1}');e.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await click("保存接口");
    await wait('!document.querySelector(".api-draft-badge")');
    await click("运行调试", ".api-view-toolbar");
    await click("发送API请求", ".api-debug");
    await wait('!!document.querySelector(".api-live-response")');
    assert.equal(requests[0].headers.authorization, "Bearer local-token");
    assert.equal(requests[0].body, body);
    assert.match(requests[0].url, /^\/users\/a%2Fb\?q=/);
    await click("校验 3/3", ".api-debug");
    await wait(
      'document.querySelectorAll(".api-checks li[data-result=pass]").length===3',
    );
    await js(
      `[...document.querySelectorAll('.api-debug [role=tab]')].find(button=>button.textContent.startsWith('响应头')).click()`,
    );
    await wait(
      'document.querySelectorAll("table[aria-label=API响应头] tr").length>=3',
    );
    assert.equal(
      await js(
        '[...document.querySelectorAll(\'table[aria-label="API响应头"] th\')].filter(item=>item.textContent.toLowerCase()==="set-cookie").length',
      ),
      2,
    );
    await js(
      `[...document.querySelectorAll('.api-debug [role=tab]')].find(button=>button.textContent==='响应正文').click()`,
    );
    await click("采用为响应示例", ".api-debug");
    await click("保存接口");
    await wait('!document.querySelector(".api-draft-badge")');
    // Saved examples and definitions survive reload without any hosted service.
    await window.webContents.reload();
    await wait(
      "!!document.querySelector('.floating-nav-links [aria-label=\"HTTP 调试\"]')",
    );
    await js(
      `document.querySelector('.floating-nav-links [aria-label="HTTP 调试"]').click()`,
    );
    await wait('!!document.querySelector(".http-workspace:not([hidden])")');
    await wait('!!document.querySelector(".api-endpoint-header")');
    assert.equal(
      (
        await ipc("get-library")
      ).state.projects[0].endpoints[0].responses[0].example.includes("张三"),
      true,
    );
    await click("接口设计", ".api-view-toolbar");
    await input("API接口名称", "未保存草稿");
    await js(
      "document.querySelector('button[aria-label=\"新增API接口\"]').click()",
    );
    await wait('!!document.querySelector(".confirm-dialog[open]")');
    await click("继续编辑", ".confirm-dialog");
    await wait('!document.querySelector("dialog[open]")');
    assert.equal(
      await js(
        "document.querySelector('input[aria-label=\"API接口名称\"]').value",
      ),
      "未保存草稿",
    );
    await input("API接口名称", "创建用户");
    await input("API接口路径", "/slow");
    await click("运行调试", ".api-view-toolbar");
    await click("发送API请求", ".api-debug");
    await click("取消API请求", ".api-debug");
    await wait(
      'document.querySelector(".api-debug .api-error")?.textContent.includes("已取消")',
    );
    await click("接口设计", ".api-view-toolbar");
    await input("API接口路径", "/users/{id}");
    await select("API当前环境", "");
    // Invalid import must preserve every existing saved endpoint.
    const before = (await ipc("get-library")).state.revision;
    await js(
      `{const e=document.querySelector('input[aria-label="导入API项目文件"]');const transfer=new DataTransfer();transfer.items.add(new File(['{broken'],'bad.json',{type:'application/json'}));e.files=transfer.files;e.dispatchEvent(new Event('change',{bubbles:true}));}`,
    );
    await wait(
      'document.querySelector(".api-workspace>.api-error")?.textContent.includes("操作未完成")',
    );
    assert.equal((await ipc("get-library")).state.revision, before);
    // Conflicts retain the draft, and explicit refresh permits a reviewed retry.
    await click("接口设计", ".api-view-toolbar");
    await input("API接口名称", "冲突保留草稿");
    const concurrent = await ipc("get-library");
    await ipc("save-library", {
      data: concurrent.state,
      revision: concurrent.state.revision,
    });
    await click("保存接口");
    await wait(
      'document.querySelector(".api-workspace>.api-error")?.textContent.includes("已被更新")',
    );
    assert.equal(
      await js(
        "document.querySelector('input[aria-label=\"API接口名称\"]').value",
      ),
      "冲突保留草稿",
    );
    await js(
      `document.querySelector('button[aria-label="刷新API工作区"]').click()`,
    );
    await wait('!document.querySelector(".api-workspace>.api-error")');
    await click("保存接口");
    await wait('!document.querySelector(".api-draft-badge")');
    await input("API接口名称", "创建用户");
    await click("保存接口");
    await wait('!document.querySelector(".api-draft-badge")');
    await js(
      `document.querySelector('button[aria-label="复制API接口"]').click()`,
    );
    await input("API接口名称", "独立副本");
    await click("保存接口");
    await wait('!document.querySelector(".api-draft-badge")');
    assert.equal(
      (await ipc("get-library")).state.projects[0].endpoints.length,
      2,
    );
    assert.equal(
      (await ipc("get-library")).state.projects[0].endpoints[0].name,
      "创建用户",
    );
    await js(
      `document.querySelector('button[aria-label="删除API接口"]').click()`,
    );
    await click("继续编辑", ".confirm-dialog");
    await wait('!document.querySelector("dialog[open]")');
    assert.equal(
      (await ipc("get-library")).state.projects[0].endpoints.length,
      2,
    );
    await js(
      `document.querySelector('button[aria-label="删除API接口"]').click()`,
    );
    await click("删除接口", ".confirm-dialog");
    await wait('!document.querySelector("dialog[open]")');
    assert.equal(
      (await ipc("get-library")).state.projects[0].endpoints.length,
      1,
    );
    await click("恢复上次保存");
    await click("恢复上次保存", ".confirm-dialog");
    await wait('!document.querySelector("dialog[open]")');
    assert.equal(
      (await ipc("get-library")).state.projects[0].endpoints.length,
      2,
    );
    await click("导出OpenAPI");
    const exportedText = await fs.readFile(
      path.join(output, "saved.txt"),
      "utf8",
    );
    const exported = JSON.parse(exportedText);
    assert.equal(exported.openapi, "3.1.0");
    assert.equal(JSON.stringify(exported).includes("local-token"), false);
    // Export back into a separate project; duplicate names are made distinct in preview.
    await js(
      `{const e=document.querySelector('input[aria-label="导入API项目文件"]');const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(exportedText)}],'roundtrip.json',{type:'application/json'}));e.files=transfer.files;e.dispatchEvent(new Event('change',{bubbles:true}));}`,
    );
    await wait(
      'document.querySelector("dialog[open] h2")?.textContent === "API导入预览"',
    );
    await click("确认导入API项目", "dialog[open]");
    await wait('!document.querySelector("dialog[open]")');
    const importedLibrary = await ipc("get-library");
    assert.equal(importedLibrary.state.projects.length, 2);
    assert.notEqual(
      importedLibrary.state.projects[0].name,
      importedLibrary.state.projects[1].name,
    );
    assert.equal(importedLibrary.state.projects[1].endpoints[0].body, body);
    await js('document.documentElement.dataset.theme="light"');
    await click("接口文档", ".api-view-toolbar");
    await js("new Promise(resolve=>setTimeout(resolve,200))");
    await fs.writeFile(
      path.join(output, "preview-api-docs-light.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    const original = window.getSize(),
      minimum = window.getMinimumSize();
    window.setMinimumSize(360, 600);
    const sizes = [];
    for (const width of [375, 768, 1024, 1440]) {
      window.setContentSize(width, 850);
      await js("new Promise(resolve=>setTimeout(resolve,120))");
      await js(
        `document.querySelector('button[aria-label="关闭工具导航"]')?.click()`,
      );
      await wait('!document.querySelector("main[inert]")');
      const size = await js(
        "({width:innerWidth,scroll:document.documentElement.scrollWidth})",
      );
      assert.ok(size.scroll <= size.width, JSON.stringify(size));
      sizes.push(size);
    }
    window.setContentSize(375, 850);
    await js("new Promise(resolve=>setTimeout(resolve,120))");
    await js(
      `document.querySelector('button[aria-label="关闭工具导航"]')?.click()`,
    );
    await wait('!document.querySelector("main[inert]")');
    await fs.writeFile(
      path.join(output, "preview-api-narrow.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    window.setSize(...original);
    window.setMinimumSize(...minimum);
    const remote = await js(
      'performance.getEntriesByType("resource").map(row=>row.name).filter(name=>/^https?:/.test(name))',
    );
    assert.deepEqual(remote, []);
    await fs.writeFile(
      path.join(output, "api-offline-verification.json"),
      JSON.stringify(
        {
          offlineAssets: true,
          remoteResources: remote,
          sizes,
          localRequests: requests.length,
          schemasValidated: true,
          storage: library.directory,
        },
        null,
        2,
      ),
    );
    console.log(
      "API workbench passed: native project/parameter/auth/body design, environment preflight, lossless send, response Schema Worker, duplicate headers, examples, file persistence/reload, draft protection, cancel, import failure, OpenAPI export and offline responsive UI.",
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
};
