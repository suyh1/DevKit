const assert = require('node:assert/strict');
const { createServer } = require('node:net');
const { BrowserWindow } = require('electron');

module.exports = async function developmentDocsSmoke(desktop) {
  const library = '.kb-center[aria-label="开发文档管理"]';
  const writeInput = (selector, value) => `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`;
  async function wait(contents, expression) {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await contents.executeJavaScript('Boolean(' + expression + ')', true)) return;
      await new Promise(resolve => setTimeout(resolve, 75));
    }
    const state = await contents.executeJavaScript("({ hash: location.hash, cards: document.querySelectorAll('.kb-card').length, view: document.body.innerText.slice(0, 650) })");
    throw new Error('开发文档界面未达到预期状态 ' + expression + '\n' + JSON.stringify(state));
  }
  async function exercise(window, readOnly) {
    const contents = window.webContents;
    const run = code => contents.executeJavaScript(code, true);
    const cards = JSON.stringify(library + ' .kb-card');
    await wait(contents, 'document.querySelectorAll(' + cards + ').length === ' + (readOnly ? 24 : 23));
    const fontSize = selector => run(`getComputedStyle(document.querySelector(${JSON.stringify(library + ' ' + selector)})).fontSize`);
    assert.equal(await fontSize('.dev-doc-folder > summary'), '13px');
    assert.equal(await fontSize('.kb-card strong'), '13px');
    assert.equal(await run(`!!document.querySelector('${library} .kb-header .run-button')`), !readOnly);
    for (const index of [0, readOnly ? 23 : 22]) {
      await run(`document.querySelectorAll(${cards})[${index}].click()`);
      await wait(contents, `document.activeElement === document.querySelector('${library} .kb-reader h2')`);
      await run(`[...document.querySelectorAll('${library} .kb-actions button')].find(b => b.textContent === '返回文档目录').click()`);
      await wait(contents, `document.activeElement === document.querySelectorAll(${cards})[${index}]`);
    }
    const field = library + ' input[type=search]';
    for (const term of ['df -h', '校验清单', 'ls']) {
      await run(writeInput(field, term));
      await wait(contents, `document.querySelector(${cards})?.querySelector('small')`);
      assert.equal(await fontSize('.kb-card strong'), '13px');
      assert.equal(await fontSize('.kb-card small'), '12px');
      await run(`document.querySelector(${cards}).click()`);
      await wait(contents, `document.querySelector('${library} .kb-location')?.textContent.includes(${JSON.stringify(term)})`);
    }
    assert.equal(await run(`document.querySelector('${library} .kb-location').textContent`), 'ls');
    assert.ok(await run('document.documentElement.scrollWidth <= innerWidth + 1'));
  }

  await require('./navigation-helpers.cjs')(desktop).openWorkspace('开发文档管理');
  await desktop.webContents.executeJavaScript('location.hash = "#dev-docs/search:journalctl"');
  await wait(desktop.webContents, `document.querySelector('${library} .kb-location')?.textContent === 'journalctl'`);
  await desktop.webContents.executeJavaScript('location.hash = "#dev-docs/folder:" + encodeURIComponent("Linux 命令大全")');
  await wait(desktop.webContents, `document.querySelector('${library} select[aria-label="筛选目录"]')?.value === '/Linux 命令大全' && document.querySelector('${library} .kb-reader h2')`);
  await exercise(desktop, false);
  const wc = desktop.webContents;
  await wc.executeJavaScript(`document.querySelector('${library} .kb-header .run-button').click()`);
  await wait(wc, 'document.querySelector(".kb-source-pane .cm-content")');
  await wc.executeJavaScript(writeInput('.kb-title-input', '构建手册'));
  await wc.executeJavaScript('document.querySelector(".kb-source-pane .cm-content").focus()');
  await wc.insertText('测试环境的依赖清单');
  await wc.executeJavaScript('[...document.querySelectorAll(".kb-writing-bar button")].find(b => b.textContent.trim() === "保存").click()');
  await wait(wc, 'document.querySelector(".kb-save-state")?.textContent.includes("已保存")');
  await wc.executeJavaScript('[...document.querySelectorAll(".kb-writing-bar button")].find(b => b.textContent.trim() === "开发文档管理").click()');
  await wait(wc, `document.querySelector('${library} .kb-reader h2')?.textContent === '构建手册'`);
  const { emptySharingServices } = await import('../shared/sharing.mjs');
  const services = emptySharingServices();
  services['dev-docs'].enabled = true;
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const options = { host: '127.0.0.1', port, password: 'docs-smoke-only', services };
  const result = await desktop.webContents.executeJavaScript('window.devkitProjects.request("start",' + JSON.stringify(options) + ')');
  assert.equal(result.error, undefined);
  const web = new BrowserWindow({ show: false, width: 390, height: 820, webPreferences: { sandbox: true, partition: 'development-docs-test', backgroundThrottling: false } });
  try {
    await web.loadURL('http://127.0.0.1:' + port + '/#dev-docs');
    await wait(web.webContents, 'document.querySelector(".portal-login input[type=password]")');
    await web.webContents.executeJavaScript(writeInput('.portal-login input[type=password]', options.password));
    await wait(web.webContents, 'document.querySelector(".portal-login button[type=submit]:enabled")');
    await web.webContents.executeJavaScript('document.querySelector(".portal-login button[type=submit]").click()');
    await exercise(web, true);
    await web.webContents.executeJavaScript(writeInput(library + ' input[type=search]', '依赖清单'));
    await wait(web.webContents, `document.querySelector('${library} .kb-card strong')?.textContent === '构建手册'`);
    console.log('开发文档桌面与窄屏网页已验证：分类、全文检索、目录焦点与只读权限');
  } finally {
    web.destroy();
    await desktop.webContents.executeJavaScript('window.devkitProjects.request("stop")');
  }
};
