const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');

module.exports = async function checkNginx(window, output) {
  const js = source => window.webContents.executeJavaScript(source);
  async function wait(expression) {
    for (let index = 0; index < 180; index++) {
      if (await js(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    await fs.writeFile(path.join(output, 'nginx-failure.png'), (await window.webContents.capturePage()).toPNG());
    throw new Error(`Nginx UI condition failed: ${expression}\n${await js('document.querySelector(".ng-center")?.innerText')}`);
  }
  const idle = () => wait('!document.querySelector(".ng-busy")');
  const click = async (text, root = '.ng-center, .ng-modal[open]') => {
    const expression = `[...document.querySelectorAll(${JSON.stringify(root)})].flatMap(root => [...root.querySelectorAll('button')]).find(button => button.textContent.trim() === ${JSON.stringify(text)})`;
    await wait(`!!${expression} && !${expression}.disabled`); await js(`${expression}.click()`); await idle();
  };
  const input = async (label, value, root = '.ng-modal[open]') => {
    await js(`{const element=[...document.querySelectorAll(${JSON.stringify(root + ' label')})].find(label=>label.childNodes[0]?.textContent.trim()===${JSON.stringify(label)}).querySelector('input'); element.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event('input',{bubbles:true}));}`);
  };
  const ipc = async (action, payload) => {
    const result = await js(`window.devkitNginx.request(${JSON.stringify(action)},${JSON.stringify(payload) || 'undefined'})`);
    assert.equal(result.error, undefined, result.error); return result.data;
  };
  const field = async (name, value) => {
    await js(`{ const element=[...document.querySelectorAll('.ng-center .ng-argument input')].find(input=>input.getAttribute('aria-label').startsWith(${JSON.stringify(name + ' 第')})); let parent=element.closest('details');while(parent){parent.open=true;parent=parent.parentElement.closest('details');} element.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,${JSON.stringify(value)}); element.dispatchEvent(new Event('input',{bubbles:true})); }`);
    await js(`document.activeElement.blur()`);
  };
  async function source(text) {
    await click('全文编辑'); await wait('!!document.querySelector(".ng-source .cm-content")');
    await js('document.querySelector(".ng-source .cm-content").focus()');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
    await window.webContents.insertText(text);
  }
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const dir = path.join(output, `nginx-fixture-${Date.now()}`);
  await fs.mkdir(path.join(dir, 'logs'), { recursive: true }); await fs.mkdir(path.join(dir, 'temp'));
  const main = path.join(dir, 'nginx-win.conf'), common = path.join(dir, 'common_proxy.conf');
  const original = `\uFEFF# 保留此注释\r\nworker_processes 1;\r\npid logs/ui.pid;\r\nerror_log logs/error.log;\r\nevents { worker_connections 64; }\r\nhttp {\r\n    server {\r\n        listen 127.0.0.1:${port};\r\n        server_name localhost;\r\n        location / { return 200 "before"; }\r\n        include common_proxy.conf;\r\n    }\r\n}\r\n`;
  const commonOriginal = '# 公共代理\nlocation /api/ {\n    proxy_pass http://127.0.0.1:9000;\n    proxy_set_header Host $host;\n}\n';
  await fs.writeFile(main, original); await fs.writeFile(common, commonOriginal);
  const executable = process.env.DEVKIT_NGINX_TEST_EXECUTABLE || '';
  let instanceId, createdId;
  let upstream;
  const oldSize = window.getSize(), oldMinimum = window.getMinimumSize();
  try {
    window.setMinimumSize(360, 600); window.setSize(1440, 1000);
    await js('document.querySelector(\'.sidebar button[title="Nginx 配置"]\').click()'); await idle();
    await wait('!!document.querySelector(".ng-heading")');
    await click('添加实例');
    await input('实例名称', '界面回归'); await input('主配置文件', main); await input('运行目录（-p prefix）', dir);
    if (executable) await input('nginx 程序路径（留空自动检测）', executable);
    await input('主配置文件', path.join(dir, 'missing.conf')); await click('保存实例');
    await wait('document.querySelector(".ng-modal[open] [role=alert]")?.textContent.includes("ENOENT")');
    await input('主配置文件', main);
    if (executable) {
      await click('检测 nginx 并填入运行目录');
      assert.equal(await js('document.querySelector(".ng-detection").textContent.includes("nginx version")'), true);
      await input('运行目录（-p prefix）', dir);
    }
    await click('解析附属文件');
    assert.equal(await js(`document.querySelector('.ng-modal textarea').value.includes(${JSON.stringify(common)})`), true);
    await click('保存实例');
    await wait('document.querySelector(".ng-instance-heading h2")?.textContent.includes("界面回归")');
    const state = await ipc('get'); instanceId = state.instances.find(item => item.main === main).id;
    assert.equal(await js('document.querySelector(\'button[aria-pressed=true]\')?.textContent === "字段配置" || !!document.querySelector(".ng-tree")'), true);
    assert.equal(await js('document.querySelectorAll(".ng-file-tabs button").length'), 2);
    await field('server_name', 'ui.local');
    await wait('document.querySelector(".ng-center .ng-warning")?.textContent.includes("未保存")');
    await js('document.querySelector(\'.floating-nav-links button[aria-label="工作空间"]\').click()');
    await js('document.querySelector(\'.sidebar button[title="Nginx 配置"]\').click()');
    assert.equal(await js('[...document.querySelectorAll(".ng-argument input")].find(i=>i.getAttribute("aria-label").startsWith("server_name 第")).value'), 'ui.local');
    await click('保存文件 (1)');
    assert.equal(await fs.readFile(main, 'utf8'), original.replace('localhost', 'ui.local'));
    await js(`[...document.querySelectorAll('.ng-file-tabs button')].find(button=>button.textContent.includes('common_proxy.conf')).click()`);
    await field('proxy_pass', 'http://127.0.0.1:9001'); await click('保存文件 (1)');
    assert.equal(await fs.readFile(common, 'utf8'), commonOriginal.replace(':9000', ':9001'));
    await click('备份'); await click('载入草稿', '.ng-modal[open]'); await click('保存文件 (1)');
    assert.equal(await fs.readFile(common, 'utf8'), commonOriginal);
    await field('proxy_pass', 'http://127.0.0.1:9002');
    await click('重新读取'); await click('取消', '.ng-modal[open]');
    assert.equal(await js('[...document.querySelectorAll(".ng-argument input")].find(i=>i.getAttribute("aria-label").startsWith("proxy_pass 第")).value'), 'http://127.0.0.1:9002');
    await fs.writeFile(common, commonOriginal + '# 外部修改\n');
    await click('保存文件 (1)'); await wait('document.querySelector(".ng-center [role=alert]")?.textContent.includes("外部修改")');
    assert.equal(await fs.readFile(common, 'utf8'), commonOriginal + '# 外部修改\n');
    await click('重新读取'); await click('放弃草稿并继续', '.ng-modal[open]');
    await source('location /api/ {'); await click('字段配置');
    await wait('document.querySelector(".ng-editor-fieldset [role=alert]")?.textContent.includes("缺少")');
    await source(commonOriginal); await click('字段配置'); await click('保存文件 (1)');
    assert.equal(await fs.readFile(common, 'utf8'), commonOriginal);
    await js(`[...document.querySelectorAll('.ng-file-tabs button')].find(button=>button.textContent.includes('nginx-win.conf')).click()`);
    if (executable) {
      // nginx itself rejects BOMs. Earlier assertions exercised lossless BOM editing;
      // explicitly remove it through the BOM action before running this fixture.
      await click('移除 UTF-8 BOM'); await click('保存文件 (1)');
      await click('检查配置'); await wait('!!document.querySelector(".ng-output.success")');
      await click('启动'); await wait('document.querySelector(".ng-instance-heading .ng-status")?.textContent.includes("运行中")');
      assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'before');
      await field('return', '200 "after"'); await click('保存文件 (1)'); await click('重载');
      let body;
      for (let index = 0; index < 30; index++) { body = await (await fetch(`http://127.0.0.1:${port}/`, { headers: { Connection: 'close' } })).text(); if (body === 'after') break; await new Promise(resolve => setTimeout(resolve, 100)); }
      assert.equal(body, 'after');
      await click('停止'); await click('停止 Nginx', '.ng-modal[open]');
      await wait('document.querySelector(".ng-instance-heading .ng-status")?.textContent.includes("已停止")');
    }
    await js('document.querySelector(".workspace.nginx-workspace").scrollTop = 0');
    for (const theme of ['light', 'dark']) {
      await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await new Promise(resolve => setTimeout(resolve, 350));
      await fs.writeFile(path.join(output, `nginx-${theme}.png`), (await window.webContents.capturePage()).toPNG());
      assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
    }
    window.setSize(390, 844); await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
    assert.equal(await js('document.querySelector(".ng-detail").getBoundingClientRect().right <= innerWidth'), true);
    assert.equal(await js(`(() => { const title=document.querySelector('.ng-heading h1');const range=document.createRange();range.selectNodeContents(title);const text=range.getBoundingClientRect(),box=title.getBoundingClientRect();return title.textContent==='Nginx 配置' && text.left>=box.left-1 && text.right<=box.right+1; })()`), true, 'Narrow heading text must fit its column');
    await fs.writeFile(path.join(output, 'nginx-narrow.png'), (await window.webContents.capturePage()).toPNG());
    // Other-system profiles can be edited without accidentally executing on this host.
    const latest = await ipc('get'), instance = latest.instances.find(item => item.id === instanceId);
    await ipc('upsert', { revision: latest.revision, instance: { ...instance, platform: process.platform === 'win32' ? 'linux' : 'win32' } });
    await click('刷新'); assert.equal(await js('document.querySelector(".ng-instance-heading .ng-status").textContent'), '其他系统');
    assert.equal(await js('[...document.querySelectorAll(".ng-toolbar button")].find(b=>b.textContent.includes("启动")).disabled'), true);
    window.setSize(1440, 1000);
    const createdDirectory = path.join(dir, 'new config'); await fs.mkdir(createdDirectory);
    await click('添加实例'); await click('新建配置', '.ng-modal[open]');
    await input('实例名称', '全新配置');
    const { dialog } = require('electron'); const originalPicker = dialog.showOpenDialog;
    dialog.showOpenDialog = async (_window, options) => { assert.deepEqual(options.properties, ['openDirectory']); return { canceled: false, filePaths: [createdDirectory] }; };
    try { await click('选择目录', '.ng-modal[open]'); } finally { dialog.showOpenDialog = originalPicker; }
    assert.deepEqual(await fs.readdir(createdDirectory), []);
    await input('主文件名', '../invalid.conf'); await click('创建文件并添加实例', '.ng-modal[open]');
    await wait('document.querySelector(".ng-modal[open] [role=alert]")?.textContent.includes("文件名")');
    assert.deepEqual(await fs.readdir(createdDirectory), []);
    await input('主文件名', 'new.conf'); await input('附属文件名', 'shared.conf'); await input('监听端口', String(port));
    if (executable) {
      await input('nginx 程序路径（留空自动检测）', executable); await click('检测 nginx', '.ng-modal[open]');
      assert.equal(await js('[...document.querySelectorAll(".ng-modal label")].find(label=>label.childNodes[0]?.textContent.trim()==="配置目录").querySelector("input").value'), createdDirectory);
    }
    await fs.writeFile(path.join(output, 'nginx-create.png'), (await window.webContents.capturePage()).toPNG());
    window.setSize(390, 844); await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(await js('document.querySelector(".ng-modal[open]").scrollWidth <= document.querySelector(".ng-modal[open]").clientWidth + 1'), true, 'Create dialog must fit narrow width');
    window.setSize(1440, 1000);
    await click('创建文件并添加实例', '.ng-modal[open]');
    await wait('document.querySelector(".ng-instance-heading h2")?.textContent.includes("全新配置")');
    const createdState = await ipc('get'); createdId = createdState.instances.find(item => item.main === path.join(createdDirectory, 'new.conf')).id;
    assert.equal(await js('document.querySelectorAll(".ng-file-tabs button").length'), 2);
    assert.match(await fs.readFile(path.join(createdDirectory, 'new.conf'), 'utf8'), /include "shared.conf"/);
    await js(`[...document.querySelectorAll('.ng-file-tabs button')].find(button=>button.textContent.includes('shared.conf')).click()`);
    if (executable) {
      upstream = require('node:http').createServer((request, response) => response.end(`included:${request.url}`));
      await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve)); const backendPort = upstream.address().port;
      await field('proxy_pass', `http://127.0.0.1:${backendPort}`); await click('保存文件 (1)');
      await click('检查配置'); await click('启动');
      assert.match(await (await fetch(`http://127.0.0.1:${port}/`, { headers: { Connection: 'close' } })).text(), /Nginx ready/);
      assert.equal(await (await fetch(`http://127.0.0.1:${port}/api/ping`, { headers: { Connection: 'close' } })).text(), 'included:/api/ping');
      await field('proxy_pass', `http://127.0.0.1:${backendPort}/`); await click('保存文件 (1)'); await click('重载');
      let body;
      for (let index = 0; index < 30; index++) { body = await (await fetch(`http://127.0.0.1:${port}/api/ping`, { headers: { Connection: 'close' } })).text(); if (body === 'included:/ping') break; await new Promise(resolve => setTimeout(resolve, 100)); }
      assert.equal(body, 'included:/ping'); await click('停止'); await click('停止 Nginx', '.ng-modal[open]');
    }
    console.log(`Nginx UI passed: import and create sets, directory picker, filename validation, linked main/include editing, lossless save, backup recovery, draft preservation, source repair, external conflicts, themes, narrow layout${executable ? ', real nginx start/reload/quit, homepage and included proxy HTTP routing' : ''}.`);
  } catch (error) {
    console.error(await js('JSON.stringify({error:document.querySelector(".ng-center [role=alert]")?.textContent,notice:document.querySelector(".ng-notice")?.textContent,source:document.querySelector(".ng-source .cm-content")?.textContent,warning:document.querySelector(".ng-warning")?.textContent})'));
    await fs.writeFile(path.join(output, 'nginx-failure.png'), (await window.webContents.capturePage()).toPNG());
    throw error;
  } finally {
    if (createdId) {
      const statuses = await ipc('statuses'); if (statuses.find(item => item.id === createdId)?.state === 'running') await ipc('command', { id: createdId, command: 'stop' });
      const state = await ipc('get'); await ipc('remove', { id: createdId, revision: state.revision, forgetOnly: true });
    }
    if (upstream) await new Promise(resolve => upstream.close(resolve));
    if (instanceId) {
      const statuses = await ipc('statuses');
      if (statuses.find(item => item.id === instanceId)?.state === 'running') await ipc('command', { id: instanceId, command: 'stop' });
      const state = await ipc('get'); await ipc('remove', { id: instanceId, revision: state.revision, forgetOnly: true });
    }
    window.setSize(...oldSize); window.setMinimumSize(...oldMinimum);
    await js('document.documentElement.dataset.theme="light"');
  }
};
