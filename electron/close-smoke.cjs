const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, dialog } = require('electron');

module.exports = async function checkClose(window, output) {
  const js = source => window.webContents.executeJavaScript(source);
  async function wait(expression) {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await js(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error(`Close condition failed: ${expression}`);
  }
  async function button(text, root = '.confirm-dialog[open]') {
    const expression = `[...document.querySelectorAll(${JSON.stringify(root + ' button')})].find(button=>button.textContent.trim()===${JSON.stringify(text)})`;
    await wait(`!!${expression}`); return js(`${expression}.click()`);
  }
  const request = async (bridge, action) => {
    const result = await js(`window.${bridge}.request(${JSON.stringify(action)})`);
    assert.equal(result.error, undefined, result.error); return result.data;
  };
  const originalNative = dialog.showMessageBoxSync;
  let nativePrompts = 0;
  dialog.showMessageBoxSync = () => { nativePrompts++; return 0; };
  try {
    await js('window.devkitDesktop.answerClose(true)');
    await request('devkitNginx', 'get'); // Unsolicited close acknowledgements must be ignored.
    await js('document.querySelector(\'.floating-nav-links [aria-label="Nginx 配置"]\').click()');
    await button('添加实例', '.ng-center'); await wait('!!document.querySelector(".ng-form-modal[open]")');
    await js(`{const input=document.querySelector('.ng-form-modal input');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'退出后仍可编辑');input.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await button('取消', '.ng-form-modal'); await wait('!!document.querySelector(".confirm-dialog[open]")');
    app.quit();
    await wait('document.querySelector(".confirm-dialog h2")?.textContent === "关闭 DevKit？"');
    window.close();
    assert.equal(await js('document.querySelectorAll(".confirm-dialog[open]").length'), 1, 'Local discard and close-app share a single confirmation');
    assert.equal(nativePrompts, 0);
    await fs.writeFile(path.join(output, 'nginx-close-confirmation.png'), (await window.webContents.capturePage()).toPNG());
    await button('继续编辑'); await wait('!document.querySelector(".confirm-dialog[open]")');
    assert.equal(await js('document.querySelector(".ng-form-modal input").value'), '退出后仍可编辑');
    window.webContents.reload();
    await wait('document.querySelector(".confirm-dialog h2")?.textContent === "重新加载工作台？"');
    const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
    try { await button('放弃并重新加载'); } catch (error) { if (!/context|frame|disposed/i.test(error.message)) throw error; }
    await reloaded;
    await wait('!!document.querySelector(\'.floating-nav-links [aria-label="Nginx 配置"]\')');
    await js('document.querySelector(\'.floating-nav-links [aria-label="Nginx 配置"]\').click()');
    await wait('!document.querySelector(".ng-busy") && !!document.querySelector(".ng-empty")');
    await button('添加实例', '.ng-center');
    await js(`{const input=document.querySelector('.ng-form-modal input');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'重新加载后仍保护草稿');input.dispatchEvent(new Event('input',{bubbles:true}));}`);
    // Electron's automation gesture avoids depending on OS foreground focus.
    await window.webContents.executeJavaScript("document.querySelector('.ng-form-modal input').focus()", true);
    assert.equal(await js('navigator.userActivation.hasBeenActive'), true);
    await request('devkitNginx', 'get'); await request('devkitProjects', 'get');
    window.webContents.reload();
    await wait('document.querySelector(".confirm-dialog h2")?.textContent === "重新加载工作台？"');
    await button('继续编辑'); await wait('!document.querySelector(".confirm-dialog[open]")');
    assert.equal(await js('document.querySelector(".ng-form-modal input").value'), '重新加载后仍保护草稿');
    const storage = await request('devkitProjects', 'storage');
    const nginx = await request('devkitNginx', 'get');
    window.close(); await wait('document.querySelector(".confirm-dialog h2")?.textContent === "关闭 DevKit？"');
    const watchdog = setTimeout(() => { console.error('Confirmed close did not finish shutdown'); app.exit(1); }, 10000);
    app.once('will-quit', () => {
      clearTimeout(watchdog);
      try {
        const nativeFs = require('node:fs');
        assert.equal(nativeFs.existsSync(path.join(storage.directory, '.lock')), false);
        assert.equal(nativeFs.existsSync(path.join(nginx.directory, '.lock')), false);
        assert.equal(nativePrompts, 0);
        console.log('Close lifecycle passed: single themed confirmation, no native prompt, cancel retains drafts and both managers, reload cancel/confirm and renewed guard, confirmed close releases storage locks.');
      } catch (error) { console.error(error); app.exit(1); }
    });
    const closed = new Promise(resolve => window.once('closed', resolve));
    try { await button('放弃并关闭'); } catch (error) { if (!window.isDestroyed()) throw error; }
    await closed;
  } finally { dialog.showMessageBoxSync = originalNative; }
};
