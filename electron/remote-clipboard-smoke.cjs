const assert = require('node:assert/strict');
const { clipboard, ClipboardItem } = require('electron');
const { setTimeout: delay } = require('node:timers/promises');

async function preserveClipboard() {
  const original = [];
  for (const item of await clipboard.read()) {
    const formats = {};
    for (const type of item.types) formats[type] = await item.getType(type);
    original.push(new ClipboardItem(formats));
  }
  return async () => { if (original.length) await clipboard.write(original); else clipboard.clear(); };
}

async function checkClipboard(window, selector, peer) {
  const js = code => window.webContents.executeJavaScript(code, true);
  const restore = await preserveClipboard();
  const press = letter => {
    for (const [type, keyCode, modifiers] of [
      ['keyDown', 'Control', ['control']], ['keyDown', letter, ['control']],
      ['keyUp', letter, ['control']], ['keyUp', 'Control', []],
    ]) window.webContents.sendInputEvent({ type, keyCode, modifiers });
  };
  const until = async (condition, why) => {
    for (let i = 0; i < 100; i++) { if (await condition()) return; await delay(25); }
    assert.fail(why);
  };
  try {
    window.show(); window.focus(); window.webContents.focus();
    await js('document.querySelector(' + JSON.stringify(selector) + ').focus()');
    await clipboard.writeText('from-local');
    press('V');
    await until(() => peer.pasted(), 'Remote application should paste the local text exactly once after receiving it');
    press('C');
    await until(async () => await clipboard.readText() === 'selected-remote', 'New remote selection should reach the OS clipboard');
    assert.equal(await js('document.querySelector(".lan-session-clipboard").open'), false);
  } finally { await restore(); }
}

module.exports = { checkClipboard, preserveClipboard };
