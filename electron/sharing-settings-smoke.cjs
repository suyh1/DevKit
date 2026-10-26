const assert = require("node:assert/strict");
const net = require("node:net");
const fs = require("node:fs/promises");
const path = require("node:path");
const { clipboard } = require("electron");

module.exports = async function sharingSettingsSmoke(window, output) {
  const js = (code) => window.webContents.executeJavaScript(code, true);
  const wait = async (expression) => {
    for (let attempt = 0; attempt < 160; attempt++) {
      if (await js(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      `Sharing settings condition not met: ${expression}\n${await js('document.querySelector(".sharing-panel")?.textContent')}`,
    );
  };
  const click = async (text, selector = ".sharing-panel button") => {
    const button = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
    await wait(`!!${button}&&!${button}.disabled`);
    await js(`${button}.click()`);
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
  const navigate = async (name) => {
    await js(
      `[...document.querySelectorAll('.sidebar .nav-item')].find(e=>e.querySelector('span')?.textContent===${JSON.stringify(name)}).click()`,
    );
  };
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
    assert.equal(
      await js('document.querySelectorAll(".sharing-service").length'),
      3,
    );
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
      `for(const id of ['nginx','http']) document.querySelector('.sharing-service[data-service='+id+'] .sharing-service-toggle input').click()`,
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
    await openShortcut(".project-center .sharing-shortcut");
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
    await openShortcut(".ng-center .sharing-shortcut");
    await click("停止共享");
    await wait(
      'document.querySelector(".global-sharing-button")?.dataset.sharingState==="stopped"',
    );
    assert.equal(
      await js(
        'document.querySelectorAll(".sharing-panel .pc-sharing-state code").length',
      ),
      0,
    );
    await close();
    await navigate("HTTP 调试");
    await openShortcut(".http-workspace-topline .sharing-shortcut");
    assert.equal(
      await js(
        'document.querySelector(".sharing-panel input[type=number]").value',
      ),
      String(port),
    );
    occupied = net.createServer();
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
          '(()=>{const nav=document.querySelector(".floating-nav-links"),r=nav.getBoundingClientRect();return [...nav.querySelectorAll("button")].every(button=>{const b=button.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right+1})})()',
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
      await close();
    }
    console.log(
      "Global sharing settings passed: home entry, one panel across modules, draft protection, start/stop state, address copy, port-conflict draft preservation and responsive themes.",
    );
  } finally {
    if (occupied) await new Promise((resolve) => occupied.close(resolve));
    await js('window.devkitProjects.request("stop")');
  }
};
