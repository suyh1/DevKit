const assert = require('node:assert/strict');
const { createServer } = require('node:net');
const { once } = require('node:events');

// Minimal RFB 3.8 peer, with a VNC authentication challenge and one raw red pixel.
module.exports = async function checkVncSession(window, waitFor) {
  const wait = expression => waitFor('Boolean(' + expression + ')');
  const sockets = new Set(), keys = [];
  let connections = 0;
  const server = createServer(socket => {
    connections++; sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.write('RFB 003.008\n');
    let buffer = Buffer.alloc(0), step = 0, painted = false;
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length) {
        let size = [12, 1, 16, 1][step];
        const type = buffer[0];
        if (step >= 4) {
          if (type === 2 && buffer.length < 4) return;
          size = { 0: 20, 2: type === 2 ? 4 + 4 * buffer.readUInt16BE(2) : 0, 3: 10, 4: 8, 5: 6 }[type];
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
        } else if (type === 4) keys.push(data.readUInt32BE(4));
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
    await click('.lan-vnc-session', '发送 Ctrl+Alt+Del');
    for (let attempt = 0; attempt < 40 && !keys.includes(0xffff); attempt++) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(keys.includes(0xffff));
    await js('document.querySelector(".lan-vnc-session input[type=checkbox]").click()');
    assert.ok(await js(button('.lan-vnc-session', '发送 Ctrl+Alt+Del') + '.disabled'));
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
    console.log('VNC session passed: saved profile, RFB authentication, framebuffer, input, view-only, reconnect and focus.');
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
};
