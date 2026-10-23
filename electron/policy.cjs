const path = require('node:path');

const origin = 'devkit://app';
const { csp } = require('./security.json');

function isAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'devkit:' && url.hostname === 'app' && !url.port && !url.username && !url.password;
  } catch { return false; }
}

function assetPath(root, value) {
  if (!isAppUrl(value)) return null;
  let pathname;
  try { pathname = decodeURIComponent(new URL(value).pathname); } catch { return null; }
  if (pathname.includes('\\') || pathname.includes('\0')) return null;
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  const relative = path.relative(root, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? file : null;
}

function validateSave(value) {
  if (!value || typeof value !== 'object' || typeof value.text !== 'string' || value.text.length > 16_000_000) throw new Error('保存内容无效或超过 16,000,000 字符。');
  if (typeof value.filename !== 'string' || !value.filename || value.filename.length > 180 || /[\\/:*?"<>|\x00-\x1f]/.test(value.filename) || /^\.+$/.test(value.filename)) throw new Error('保存文件名无效。');
  return { text: value.text, filename: value.filename };
}

module.exports = { origin, csp, isAppUrl, assetPath, validateSave };
