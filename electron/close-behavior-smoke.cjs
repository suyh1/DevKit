const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Tray, dialog, app } = require('electron');

module.exports = async function checkCloseBehavior(window, output) {
  window.webContents.setBackgroundThrottling(false);
  window.show();
  window.focus();
  window.webContents.focus();
  const js = async (source) => {
    try {
      return await window.webContents.executeJavaScript(source);
    } catch (error) {
      console.error('Failed close test script:', source);
      throw error;
    }
  };
  async function wait(expression) {
    for (let i = 0; i < 150; i++) {
      if (await js(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error('Close choice condition failed: ' + expression);
  }
  const button = async (text) => {
    await wait(`!![...document.querySelectorAll('.close-choice button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`);
    await js(`[...document.querySelectorAll('.close-choice button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
  };
  const preferences = async (action = 'get', value) =>
    js(`window.devkitDesktop.closeSettings(${JSON.stringify(action)},${JSON.stringify(value)})`);
  const originalMenu = Tray.prototype.setContextMenu,
    originalError = dialog.showErrorBox;
  let tray,
    menu,
    failTray = true,
    trayErrors = 0;
  Tray.prototype.setContextMenu = function (value) {
    if (failTray) throw new Error('isolated tray failure');
    tray = this;
    menu = value;
    return originalMenu.call(this, value);
  };
  dialog.showErrorBox = () => {
    trayErrors++;
  };
  try {
    await js('document.documentElement.dataset.theme="light"');
    assert.equal((await preferences()).closeAction, 'ask');
    // Forged/late choices must never hide the window.
    await js('window.devkitDesktop.chooseClose("tray",true)');
    assert.equal(window.isVisible(), true);
    await preferences('set', 'tray');
    window.close();
    await wait('!!document.querySelector(".close-choice[open]")');
    assert.equal(trayErrors, 1);
    assert.equal(window.isVisible(), true);
    await button('取消');
    await wait('!document.querySelector(".close-choice")');
    await preferences('set', 'ask');
    failTray = false;
    window.close();
    await wait('!!document.querySelector(".close-choice[open]")');
    assert.equal(await js('document.activeElement.textContent'), '取消');
    window.close();
    assert.equal(await js('document.querySelectorAll(".close-choice[open]").length'), 1);
    await js('new Promise(resolve=>setTimeout(resolve,350))');
    await window.webContents.capturePage();
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await fs.writeFile(path.join(output, 'close-choice-light.png'), (await window.webContents.capturePage()).toPNG());
    await button('取消'); await wait('!document.querySelector(".close-choice")');
    await js('document.documentElement.dataset.theme="dark"');
    window.close(); await wait('!!document.querySelector(".close-choice[open]")');
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,350))))');
    await fs.writeFile(path.join(output, 'close-choice-dark.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript('document.querySelector(".close-choice").focus()', true);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait('!document.querySelector(".close-choice")');
    window.close();
    await wait('!!document.querySelector(".close-choice[open]")');
    await js('document.querySelector(".close-remember input").click()');
    await button('最小化到托盘');
    await wait('!document.querySelector(".close-choice")');
    assert.equal(window.isVisible(), false);
    assert.equal((await preferences()).closeAction, 'tray');
    assert.ok(tray && !tray.isDestroyed());
    assert.deepEqual(
      menu.items.filter((item) => item.type !== 'separator').map((item) => item.label),
      ['打开 DevKit', '退出 DevKit']
    );
    tray.emit('click');
    assert.equal(window.isVisible(), true);
    window.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(window.isVisible(), false);
    menu.items[0].click();
    assert.equal(window.isVisible(), true);
    app.emit('second-instance');
    assert.equal(window.isVisible(), true);
    await js('document.querySelector(".sidebar-bottom .nav-item").click()');
    await wait(`document.querySelector('select[aria-label="窗口关闭行为"]')?.value==="tray"`);
    await js(
      `{ const select=document.querySelector('select[aria-label="窗口关闭行为"]');select.value="ask";select.dispatchEvent(new Event("change",{bubbles:true})); }`
    );
    await wait(`!document.querySelector('select[aria-label="窗口关闭行为"]').disabled`);
    assert.equal((await preferences()).closeAction, 'ask');
    const saved = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'desktop-settings.json'), 'utf8'));
    assert.equal(saved.closeAction, 'ask');
    await js('document.documentElement.dataset.theme="light"');
    await js('document.querySelector(\'.floating-nav-links [aria-label="工作空间"]\').click()');
    console.log(
      'Close choice passed: tray failure stays visible, cancel/Escape/repeated close, remember, restore/menu/second instance, settings and on-disk persistence.'
    );
  } finally {
    Tray.prototype.setContextMenu = originalMenu;
    dialog.showErrorBox = originalError;
  }
};
