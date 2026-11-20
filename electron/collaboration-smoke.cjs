const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs/promises');
const { BrowserWindow, clipboard, dialog } = require('electron');

module.exports = async function collaborationSmoke(window, output) {
  const desktop = (code) => window.webContents.executeJavaScript(code, true);
  const { openWorkspace } = require('./navigation-helpers.cjs')(window);
  const { emptySharingServices } = await import('../shared/sharing.mjs');
  const services = emptySharingServices();
  for (const id of ['mock', 'transfer', 'whiteboard']) services[id] = { enabled: true, edit: true };
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const lan = process.env.DEVKIT_TEST_COLLAB_LAN === '1';
  const settings = {
    port,
    host: lan ? '0.0.0.0' : '127.0.0.1',
    services,
    visitors: [],
    password: require('node:crypto').randomBytes(20).toString('hex'),
  };
  const start = await desktop('window.devkitProjects.request("start",' + JSON.stringify(settings) + ')');
  assert.equal(start.error, undefined);
  const browser = new BrowserWindow({
    show: false,
    width: 1120,
    height: 850,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      backgroundThrottling: false,
      partition: 'collab-test-' + Date.now(),
    },
  });
  const web = (code) => browser.webContents.executeJavaScript(code, true);
  const current = '.portal-page:not([hidden]) .collab-page ';
  const main = '.workspace:not([hidden]) .collab-page ';
  async function wait(js, expr) {
    for (let i = 0; i < 180; i++) {
      if (await js(expr)) return;
      await new Promise((resolve) => setTimeout(resolve, 55));
    }
    throw new Error('Expected ' + expr + ' in ' + (await js('document.body.innerText')).slice(-1600));
  }
  async function fill(js, selector, value) {
    const node = 'document.querySelector(' + JSON.stringify(selector) + ')';
    await wait(js, '!!' + node);
    await js(
      `{const el=${node};Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));}`,
    );
  }
  async function click(js, scope, label) {
    const node = `[...document.querySelectorAll(${JSON.stringify(scope + 'button')})].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
    await wait(js, '!!' + node);
    await js(node + '.click()');
  }
  async function selectMode(js, scope, value) {
    const node = 'document.querySelector(' + JSON.stringify(scope + '[aria-label="发送方式"]') + ')';
    if (await js(node + '.value') !== value)
      await js(`{const mode=${node}; mode.value=${JSON.stringify(value)}; mode.dispatchEvent(new Event('change',{bubbles:true}));}`);
  }
  try {
    // The fixture starts the listener via IPC. Opening settings refreshes the same provider used by invitations.
    await desktop('document.querySelector(".topbar .global-sharing-button").click()');
    await wait(
      desktop,
      'document.querySelector(".topbar .global-sharing-button")?.dataset.sharingState === "running" && document.querySelector(".sharing-panel dialog")?.getAttribute("aria-busy") !== "true"',
    );
    await desktop('document.querySelector(".sharing-panel button[aria-label=关闭共享设置]").click()');
    await wait(desktop, '!document.querySelector(".sharing-panel")');
    await openWorkspace('局域网快传');
    assert.equal(await desktop('document.querySelector(' + JSON.stringify(main + '[aria-label="发送方式"]') + ').value'), 'direct');
    await selectMode(desktop, main, 'stored');
    await fill(desktop, main + 'textarea', '跨设备取件测试');
    await fill(desktop, main + 'input[type=password]', 'case-pass');
    await click(desktop, main, '发送文字或链接');
    await click(desktop, main, '邀请设备');
    let address = 'http://127.0.0.1:' + port + '/#transfer';
    if (lan) {
      await wait(desktop, '!!document.querySelector(".collab-invite img")');
      address = await desktop('document.querySelector(".collab-invite p").textContent');
      assert.notEqual(new URL(address).hostname, '127.0.0.1');
    }
    await browser.loadURL(address);
    await fill(web, '.portal-login input[type=password]', settings.password);
    await click(web, '.portal-login ', '登录');
    await click(web, current, '凭密码取件');
    assert.equal(await web('document.querySelector(' + JSON.stringify(current + '[aria-label="发送方式"]') + ').value'), 'direct');
    await fill(web, current + 'input[aria-label="输入取件密码"]', 'bad');
    await click(web, current, '确认取件');
    await wait(web, 'document.body.innerText.includes("取件密码不正确")');
    assert.equal(await web('document.body.innerText.includes("跨设备取件测试")'), false);
    await fill(web, current + 'input[aria-label="输入取件密码"]', 'case-pass');
    await click(web, current, '确认取件');
    await wait(web, 'document.body.innerText.includes("跨设备取件测试")');
    // Send actual browser File objects in each direction, then read the downloaded bytes.
    async function exchange(send, sendScope, receive, receiveScope, receiverWindow, name, direct = false) {
      const bytes = [0, 255, 3, 9, 128];
      const length = direct ? 3 * 524288 + 31 : bytes.length;
      const content = Buffer.alloc(length);
      for (let i = 0; i < length; i++) content[i] = bytes[i % bytes.length];
      await selectMode(send, sendScope, direct ? 'direct' : 'stored');
      await send(`{ const input=document.querySelector(${JSON.stringify(sendScope + 'input[type=file]')}); const dt=new DataTransfer();
        const pattern=${JSON.stringify(bytes)};dt.items.add(new File([Uint8Array.from({length:${length}},(_,i)=>pattern[i%pattern.length])],${JSON.stringify(name)}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true})); }`);
      await fill(send, sendScope + '.collab-compose input[type=password]', 'file-pass');
      await click(send, sendScope, direct ? '发布直传文件（1）' : '发送所选内容（1）');
      const article = `[...document.querySelectorAll(${JSON.stringify(receiveScope + '.collab-entry')})].find(el=>el.innerText.includes(${JSON.stringify(name)}))`;
      await wait(receive, '!!' + article);
      await receive(article + '.querySelector("button").click()');
      await fill(receive, receiveScope + 'input[aria-label="输入取件密码"]', 'file-pass');
      if (direct) await click(receive, receiveScope, '确认取件');
      const saveButton = direct ? '保存直传文件' : '确认取件';
      const target = path.join(output, name);
      if (receiverWindow === window) {
        const originalDialog = dialog.showSaveDialog;
        try {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
          await click(receive, receiveScope, saveButton);
          await wait(
            receive,
            'document.querySelector(".workspace:not([hidden]) .collab-inbox").innerText.includes("文件已保存")',
          );
        } finally {
          dialog.showSaveDialog = originalDialog;
        }
      } else {
        const saved = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('File download timed out')), direct ? 45000 : 8000);
          receiverWindow.webContents.session.once('will-download', (_event, item) => {
            item.setSavePath(target);
            item.once('done', (_e, state) => {
              clearTimeout(timer);
              state === 'completed' ? resolve() : reject(new Error(state));
            });
          });
        });
        if (direct && !lan) await receive('window.showSaveFilePicker = undefined');
        await Promise.all([saved, click(receive, receiveScope, saveButton)]);
      }
      assert.deepEqual(await fs.readFile(target), content);
      await fs.unlink(target);
    }
    await exchange(desktop, main, web, current, browser, 'desktop-to-portal.bin');
    await exchange(web, current, desktop, main, window, 'portal-to-desktop.bin');
    const storage = path.join(process.env.DEVKIT_DEV_ROOT, 'configs', 'collaboration');
    const beforeDirect = await fs.readdir(storage);
    const beforeIndex = await fs.readFile(path.join(storage, 'transfer.json'), 'utf8');
    await exchange(desktop, main, web, current, browser, 'direct-desktop-to-web.bin', true);
    await exchange(web, current, desktop, main, window, 'direct-web-to-desktop.bin', true);
    const visitor = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        backgroundThrottling: false,
        partition: 'collab-peer-' + Date.now(),
      },
    });
    try {
      const peer = (code) => visitor.webContents.executeJavaScript(code, true);
      await visitor.loadURL(address);
      await fill(peer, '.portal-login input[type=password]', settings.password);
      await click(peer, '.portal-login ', '登录');
      await wait(peer, '!!document.querySelector(".collab-compose")');
      await exchange(peer, current, web, current, browser, 'direct-between-guests.bin', true);
      await peer('location.reload()');
      await wait(web, '![...document.querySelectorAll(".collab-entry")].some(entry => entry.innerText.includes("direct-between-guests.bin"))');
    } finally {
      visitor.destroy();
    }
    assert.deepEqual(await fs.readdir(storage), beforeDirect);
    assert.equal(await fs.readFile(path.join(storage, 'transfer.json'), 'utf8'), beforeIndex);
    async function capture(name) {
      await web('new Promise(resolve => setTimeout(resolve, 450))');
      browser.webContents.invalidate();
      await web('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await fs.writeFile(path.join(output, name + '.png'), (await browser.webContents.capturePage()).toPNG());
    }
    await capture('collab-transfer');
    await web('location.hash="mock"');
    await click(web, current, '新建接口');
    await fill(web, current + '.collab-fields input', '订单列表');
    await web('document.querySelectorAll(' + JSON.stringify(current + '.collab-check input') + ')[1].click()');
    await click(web, current, '保存接口');
    await wait(web, '!!document.querySelector(".collab-url")');
    const url = await web('document.querySelector(".collab-url").textContent');
    assert.deepEqual(await (await fetch(url)).json(), { items: [{ id: 1 }] });
    await click(web, current, '响应配置');
    await wait(web, '!!document.querySelector(".mock-code-panel .cm-content")');
    await capture('collab-mock-editor');
    await web('location.hash="whiteboard"');
    await fill(web, current + '[aria-label="新画板名称"]', '同步标注');
    await web(`(async () => {
      const sample = document.createElement('canvas');
      sample.width = 800; sample.height = 420;
      const ctx = sample.getContext('2d');
      ctx.fillStyle = '#edf2f7'; ctx.fillRect(0,0,800,420);
      ctx.fillStyle = '#284466'; ctx.fillRect(36,36,728,58);
      ctx.fillStyle = 'white'; ctx.font = '24px sans-serif'; ctx.fillText('订单详情',60,74);
      ctx.fillStyle = 'white'; ctx.fillRect(36,106,728,220);
      ctx.fillStyle = '#334155'; ctx.fillText('状态：等待确认',60,156);
      const png = await new Promise(resolve => sample.toBlob(resolve,'image/png'));
      const dt = new DataTransfer(); dt.items.add(new File([png],'订单详情.png',{type:'image/png'}));
      const picker = document.querySelector(${JSON.stringify(current + 'input[type=file]')}); picker.files=dt.files; picker.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await wait(
      web,
      `[...document.querySelectorAll(${JSON.stringify(current + 'button')})].some(b=>b.textContent==='导出 PNG' && !b.disabled)`,
    );
    await wait(web, '!!document.querySelector("canvas[aria-label=共享标注画布]")');
    const boardId = await web('location.hash.split("/")[1]');
    assert.ok(boardId);
    await web(`(() => {
      const canvas = document.querySelector('canvas[aria-label=共享标注画布]');
      const r = canvas.getBoundingClientRect();
      window.boardRect = { x: Math.round(r.left + r.width * .2), y: Math.round(r.top + r.height * .2) };
    })()`);
    const { x, y } = await web('window.boardRect');
    for (const event of [
      { type: 'mouseDown', x, y, button: 'left', clickCount: 1 },
      { type: 'mouseMove', x: x + 24, y: y + 20, modifiers: ['leftButtonDown'] },
      { type: 'mouseUp', x: x + 24, y: y + 20, button: 'left', clickCount: 1 },
    ])
      browser.webContents.sendInputEvent(event);
    await wait(
      web,
      'document.querySelector(".portal-page:not([hidden]) .board-editor details summary")?.textContent.includes("（1）")',
    );
    const board = await desktop(
      'window.devkitCollab.request("whiteboard","read",{id:' + JSON.stringify(boardId) + '})',
    );
    assert.equal(board.data.marks.length, 1);
    assert.equal(board.data.image, true);
    const pixels = await web(
      'Array.from(document.querySelector("canvas[aria-label=共享标注画布]").getContext("2d").getImageData(0,0,1,1).data)',
    );
    assert.deepEqual(pixels, [237, 242, 247, 255]);
    const exported = path.join(output, 'collab-export.png');
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PNG export timed out')), 8000);
      browser.webContents.session.once('will-download', (_event, item) => {
        item.setSavePath(exported);
        item.once('done', (_e, state) => {
          clearTimeout(timer);
          state === 'completed' ? resolve() : reject(new Error(state));
        });
      });
    });
    await Promise.all([done, click(web, current, '导出 PNG')]);
    const png = await fs.readFile(exported);
    assert.equal(png.readUInt32BE(16), 800);
    assert.equal(png.readUInt32BE(20), 420);
    await wait(web, 'document.querySelector(".portal-page:not([hidden]) h1")?.textContent==="截图协作白板"');
    await web('new Promise(resolve => setTimeout(resolve, 350))');
    browser.webContents.invalidate();
    await fs.writeFile(path.join(output, 'collab-whiteboard.png'), (await browser.webContents.capturePage()).toPNG());
    await web(
      '(() => { const theme = document.querySelector("[aria-label=共享页面主题]"); theme.value = "light"; theme.dispatchEvent(new Event("change", {bubbles:true})); })()',
    );
    await capture('collab-whiteboard-light');
    const libraryToggle = current + '.board-library-bar button';
    await web('document.querySelector(' + JSON.stringify(libraryToggle) + ').click()');
    await wait(web, '!!document.querySelector(".board-index .collab-record")');
    await web('document.querySelector(".board-index .collab-record").click()');
    await wait(web, '!document.querySelector(".board-library")');
    browser.setContentSize(390, 844);
    await wait(web, 'innerWidth <= 390');
    assert.ok(await web('document.documentElement.scrollWidth <= innerWidth'));
    await wait(
      web,
      'document.querySelector(".board-editor canvas")?.getContext("2d").getImageData(0,0,1,1).data[0] === 237',
    );
    await capture('collab-whiteboard-mobile');
    await web('location.hash="mock"');
    await wait(web, '!!document.querySelector(".portal-page:not([hidden]) .mock-code-panel")');
    assert.ok(await web('document.documentElement.scrollWidth <= innerWidth'));
    await capture('collab-mock-mobile');
    const directoryToggle = current + '.mock-directory-toggle';
    await web('document.querySelector(' + JSON.stringify(directoryToggle) + ').click()');
    await wait(web, '!!document.querySelector(".mock-layout .collab-rail").offsetWidth');
    await web('document.querySelector(".mock-layout .collab-record").click()');
    await wait(web, '!document.querySelector(".mock-layout .collab-rail").offsetWidth');
    await web('location.hash="transfer"');
    await wait(web, 'document.querySelector(".portal-page:not([hidden]) h1")?.textContent==="局域网快传"');
    assert.ok(await web('document.documentElement.scrollWidth <= innerWidth'));
    await click(web, current + '.transfer-switch ', '发送内容');
    await wait(web, '!!document.querySelector(".portal-page:not([hidden]) .collab-compose").offsetWidth');
    await capture('collab-transfer-compose-mobile');
    await click(web, current + '.transfer-switch ', '收件箱');
    await wait(web, '!!document.querySelector(".portal-page:not([hidden]) .collab-inbox").offsetWidth');
    await web('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await fs.writeFile(
      path.join(output, 'collab-transfer-mobile.png'),
      (await browser.webContents.capturePage()).toPNG(),
    );

    await desktop('window.devkitProjects.request("stop")');
    await openWorkspace('局域网快传');
    await desktop('document.querySelector(".transfer-link-settings summary").click()');
    await wait(desktop, '!!document.querySelector(".transfer-link-settings input:not(:disabled)")');
    await fill(desktop, '.transfer-link-settings input', String(port));
    await click(desktop, '.transfer-link-settings ', '保存端口');
    await wait(desktop, '!!document.querySelector(".transfer-port-links code")');
    const quick = await desktop('document.querySelector(".transfer-port-links code").textContent');
    await click(desktop, '.transfer-port-links ', '复制链接');
    await wait(desktop, 'document.querySelector(".transfer-link-settings").innerText.includes("已复制快速链接")');
    assert.equal(await clipboard.readText(), quick);
    await browser.webContents.session.setProxy({ mode: 'direct' });
    await browser.loadURL(quick);
    const standalone = '.transfer-link-page .collab-page ';
    await wait(web, '!!document.querySelector(".transfer-link-page .collab-entry")');
    assert.equal(await web('document.querySelector("h1").innerText'), '局域网快传');
    assert.equal(await web('!!document.querySelector(".portal-login, .transfer-link-settings")'), false);
    await exchange(web, standalone, desktop, main, window, 'quick-to-desktop.bin');
    await exchange(desktop, main, web, standalone, browser, 'desktop-to-quick-stored.bin');
    await exchange(desktop, main, web, standalone, browser, 'desktop-to-quick.bin', true);
    await fill(desktop, '.transfer-link-settings input', '');
    await click(desktop, '.transfer-link-settings ', '保存端口');
    await wait(desktop, '!document.querySelector(".transfer-port-links code")');
  } finally {
    browser.destroy();
    await desktop('window.devkitProjects.request("stop")');
  }
  console.log(
    'Desktop, portal and independent quick-link transfers, Mock response, shared canvas drawing and mobile layout passed.',
  );
};
