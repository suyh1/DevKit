const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDesktopPreferences } = require('./desktop-preferences.cjs');

test('close preferences default to asking, persist across launches and reject invalid input', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-close-'));
  try {
    const file = path.join(root, 'nested', 'desktop-settings.json');
    const store = createDesktopPreferences(file);
    assert.equal(store.get().closeAction, 'ask');
    for (const action of ['tray', 'quit', 'ask']) {
      store.set(action);
      assert.equal(createDesktopPreferences(file).get().closeAction, action);
    }
    assert.throws(() => store.set('delete'));
    assert.equal(store.get().closeAction, 'ask');
    fs.writeFileSync(file, '{broken');
    assert.equal(createDesktopPreferences(file).get().closeAction, 'ask');
    fs.writeFileSync(file, '{"closeAction":"unknown"}');
    assert.equal(createDesktopPreferences(file).get().closeAction, 'ask');
    const blocked = path.join(root, 'blocked');
    fs.mkdirSync(blocked);
    const failed = createDesktopPreferences(blocked);
    assert.throws(() => failed.set('tray'), /保存失败/);
    assert.equal(failed.get().closeAction, 'ask');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
