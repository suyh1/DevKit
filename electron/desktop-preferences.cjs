const fs = require('node:fs');
const path = require('node:path');
const actions = ['ask', 'tray', 'quit'];
function createDesktopPreferences(file) {
  let closeAction = 'ask';
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (actions.includes(value.closeAction)) closeAction = value.closeAction;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('关闭偏好读取失败，恢复为每次询问。');
  }
  return {
    get: () => ({ closeAction }),
    set(action) {
      if (!actions.includes(action)) throw new Error('无效的窗口关闭行为。');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = file + '.tmp';
      try {
        fs.writeFileSync(temporary, JSON.stringify({ closeAction: action }) + '\n', { mode: 0o600 });
        fs.renameSync(temporary, file);
      } catch (error) {
        try {
          fs.unlinkSync(temporary);
        } catch {}
        throw new Error(`关闭偏好保存失败：${error.message}`);
      }
      closeAction = action;
      return { closeAction };
    }
  };
}
module.exports = { createDesktopPreferences };
