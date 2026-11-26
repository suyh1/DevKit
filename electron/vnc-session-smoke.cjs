const assert = require('node:assert/strict');
const { createServer } = require('node:net');
const { once } = require('node:events');

// Minimal RFB 3.8 peer, with a VNC authentication challenge and one raw red pixel.
module.exports = async function checkVncSession(window, waitFor) {
  const wait = expression => waitFor('Boolean(' + expression + ')');
  const sockets = new Set(), keys = [], pasted = [];
  let connections = 0;
  const applications = [];
  const server = createServer(socket => {
    connections++; sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.write('RFB 003.008\n');
    let ctrl = false, clipboardText = '';
    let buffer = Buffer.alloc(0), step = 0, painted = false;
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length) {
        let size = [12, 1, 16, 1][step];
        const type = buffer[0];
        if (step >= 4) {
          if (type === 2 && buffer.length < 4 || type === 6 && buffer.length < 8) return;
          size = { 0: 20, 2: type === 2 ? 4 + 4 * buffer.readUInt16BE(2) : 0, 3: 10, 4: 8, 5: 6, 6: type === 6 ? 8 + buffer.readUInt32BE(4) : 0 }[type];
        }
        if (!size || buffer.length < size) return;
        const data = buffer.subarray(0, size);
        buffer = buffer.subarray(size);
        if (step === 0) socket.write(Buffer.from([1, 2]));
        else if (step === 1) socket.write(Buffer.alloc(16, 42));
        else if (step === 2) socket.write(Buffer.alloc(4));
        else if (step === 3) {
          const init = Buffer.alloc(24);
          init.writeUInt16BE(64); init.writeUInt16BE(48, 2);
          Buffer.from([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 0, 8, 16]).copy(init, 4);
          socket.write(init);
        } else if (type === 3 && !painted) {
          painted = true;
          socket.write(Buffer.from([0,0,0,1, 0,0,0,0, 0,1,0,1, 0,0,0,0, 220,80,50,255]));
          socket.write(Buffer.concat([Buffer.from([3,0,0,0,0,0,0,6]), Buffer.from('remote')]));
        } else if (type === 4) {
          const symbol = data.readUInt32BE(4), down = data[1] === 1;
          keys.push(symbol);
          if (symbol === 0xffe3) ctrl = down;
          if (ctrl && down && symbol === 118) applications.push(clipboardText);
          if (ctrl && down && symbol === 99) {
            const selected = Buffer.from('selected-remote');
            socket.write(Buffer.concat([Buffer.from([3,0,0,0,0,0,0,selected.length]), selected]));
          }
        } else if (type === 6) { clipboardText = data.subarray(8).toString(); pasted.push(clipboardText); }
        step++;
      }
    });
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const js = code => window.webContents.executeJavaScript(code, true);
  const button = (root, label) => `[...document.querySelectorAll(${JSON.stringify(root + ' button')})].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
  async function click(root, label) {
    const target = button(root, label);
    await wait(target + ' && !' + target + '.disabled');
    await js(target + '.click()');
  }
  const submitPassword = async () => {
    await wait('document.querySelector(".lan-vnc-login input[name=password]")');
    await js('document.querySelector(".lan-vnc-login input").value = "fixture"; document.querySelector(".lan-vnc-login").requestSubmit()');
    await wait('document.querySelector(".lan-vnc-session [role=status]")?.textContent === "VNC 已连接"');
    await wait('document.querySelector(".lan-vnc-screen canvas")?.getContext("2d").getImageData(0,0,1,1).data[0] === 220');
  };
  try {
    const port = server.address().port;
    const { openWorkspace } = require('./navigation-helpers.cjs')(window);
    await openWorkspace('局域网主机');
    await click('.lan-heading-actions', '添加主机');
    await js('document.querySelector(".lan-protocol input[value=vnc]").click()');
    assert.equal(await js('document.querySelector(".lan-port input").value'), '5900');
    await js(`for (const [selector,value] of Object.entries({".lan-address input":"127.0.0.1",".lan-port input":"${port}",".lan-host-name input":"VNC fixture"})) {
      const field = document.querySelector(selector);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(field,value);
      field.dispatchEvent(new Event("input",{bubbles:true}));
    }`);
    await click('.lan-host-form', '保存并连接');
    await wait('!document.querySelector(".lan-host-dialog[open]") && document.querySelector(".lan-connection-select")');
    await submitPassword();
    await require('./remote-clipboard-smoke.cjs').checkClipboard(window, '.lan-vnc-screen canvas', {
      pasted: () => applications.length === 1 && applications[0] === 'from-local',
    });
    await js('document.querySelector(".lan-session-clipboard summary").click()');
    await wait('document.querySelector(".lan-session-clipboard textarea[readonly]").value === "selected-remote"');
    await js('const field=document.querySelector(".lan-session-clipboard textarea"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(field,"local"); field.dispatchEvent(new Event("input",{bubbles:true}))');
    await click('.lan-session-clipboard', '发送到远端');
    for (let i = 0; i < 40 && pasted.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(pasted, ['from-local', 'local']);
    await click('.lan-vnc-session', '发送 Ctrl+Alt+Del');
    for (let attempt = 0; attempt < 40 && !keys.includes(0xffff); attempt++) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(keys.includes(0xffff));
    await js('document.querySelector(".lan-vnc-session input[type=checkbox]").click()');
    assert.ok(await js(button('.lan-vnc-session', '发送 Ctrl+Alt+Del') + '.disabled'));
    await js('document.querySelector(".lan-vnc-screen canvas").focus()');
    const readOnlyKeys = keys.length;
    for (const keyCode of ['C','V']) for (const type of ['keyDown','keyUp']) {
      window.webContents.sendInputEvent({ type, keyCode, modifiers: ['control'] });
    }
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(keys.length, readOnlyKeys);
    assert.deepEqual(pasted, ['from-local', 'local']);
    await click('.lan-vnc-session', '断开连接');
    await click('.lan-vnc-session', '重新连接');
    await submitPassword();
    assert.equal(connections, 2);
    await js('document.querySelector(".lan-terminal-tabs .icon-button").click()');
    await wait('document.activeElement.matches(".lan-connection-select")');
    await js('[...document.querySelectorAll(".lan-connection-select")].find(el => el.querySelector("strong").textContent === "VNC fixture").click()');
    await click('.lan-host-list', '打开 VNC');
    await submitPassword();
    await js('document.querySelector(".lan-terminal-tabs .icon-button").click()');
    const records = await js('window.devkitDesktop.lanHosts("list")');
    const record = records.data.find(host => host.name === 'VNC fixture');
    assert.equal(record.hasPassword, false);
    await js(`window.devkitDesktop.lanHosts("remove", ${JSON.stringify(record.id)})`);
    const ftp = await (await import('./ftp-fixture.mjs')).ftpFixture();
    const consoleServer = createServer(socket => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket));
      socket.write('Telnet session ready'); socket.pipe(socket);
    }).listen(0, '127.0.0.1');
    await once(consoleServer, 'listening');
    try {
      for (const [mode, address, port] of [['telnet','127.0.0.1',consoleServer.address().port], ['ftp','127.0.0.1',ftp.port], ['serial','COM99999',0]]) {
        await click('.lan-heading-actions', '添加主机');
        await js('document.querySelector(".lan-protocol input[value=' + mode + ']").click()');
        const fields = { '.lan-address input': address, '.lan-host-name input': 'fixture-' + mode };
        if (port) fields['.lan-port input'] = String(port);
        await js('for (const [selector,value] of Object.entries(' + JSON.stringify(fields) + ')) { const field=document.querySelector(selector); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(field,value);field.dispatchEvent(new Event("input",{bubbles:true})); }');
        if (mode === 'serial') assert.equal(await js('!!document.querySelector(".lan-port input")'), false);
        await click('.lan-host-form', '保存并连接');
        await wait('document.querySelector(".lan-terminal-tabs [aria-selected=true]")?.textContent.includes("fixture-' + mode + '")');
        if (mode === 'telnet') await wait('document.querySelector(".xterm-rows")?.textContent.includes("Telnet session ready")');
        if (mode === 'ftp') await wait('document.querySelector(".lan-file-session")?.textContent.includes("readme.txt")');
        if (mode === 'serial') await wait('document.querySelector("[role=tabpanel]:not([hidden]) [role=status]")?.textContent.includes("串口")');
      }
      assert.equal(await js('document.querySelectorAll(".lan-terminal-tabs [role=tab]").length'), 3);
      await js('document.querySelector(".lan-terminal-tabs [role=tab]").click()');
      await wait('document.querySelector("[role=tabpanel]:not([hidden]) .xterm-rows")?.textContent.includes("Telnet session ready")');
      while (await js('!!document.querySelector(".lan-terminal-tabs .icon-button")')) await js('document.querySelector(".lan-terminal-tabs .icon-button").click()');
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => consoleServer.close(resolve)); await ftp.close();
    }
    console.log('Telnet, FTP and serial settings, save-and-connect and simultaneous tabs passed.');
    console.log('VNC session passed: saved profile, RFB authentication, framebuffer, input, view-only, reconnect and focus.');
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
};
