const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { assetPath, isAppUrl, validateSave, lanPortalUrl } = require('./policy.cjs');

test('only the packaged app origin is trusted', () => {
  assert.equal(isAppUrl('devkit://app/index.html'), true);
  for (const value of ['https://app/', 'file:///etc/passwd', 'devkit://app.evil/', 'devkit://user@app/', 'devkit://app:8080/']) assert.equal(isAppUrl(value), false);
});
test('local resources cannot escape the packaged asset directory', () => {
  const root = path.resolve('dist');
  assert.equal(assetPath(root, 'devkit://app/assets/example.js'), path.join(root, 'assets/example.js'));
  assert.equal(assetPath(root, 'devkit://app/'), path.join(root, 'index.html'));
  for (const value of ['devkit://app/%2e%2e%2fsecret', 'devkit://app/%5c..%5csecret', 'devkit://app/%00', 'devkit://app/%broken', 'file:///secret']) assert.equal(assetPath(root, value), null);
});
test('the save bridge accepts text and a suggested filename, never a target path', () => {
  assert.deepEqual(validateSave({ text: '你好', filename: 'workspace.json' }), { text: '你好', filename: 'workspace.json' });
  for (const filename of ['../../secret', 'C:\\secret', '/etc/passwd', '..', 'bad\nname', '']) assert.throws(() => validateSave({ text: 'sample', filename }));
  assert.throws(() => validateSave({ text: {}, filename: 'test.txt' }));
  assert.throws(() => validateSave({ text: 'x'.repeat(16_000_001), filename: 'test.txt' }));
});
test('LAN windows only open HTTP(S) shared-workspace module URLs', () => {
  assert.equal(lanPortalUrl('http://192.168.1.20:8765', 'jar').href, 'http://192.168.1.20:8765/#jar');
  assert.equal(lanPortalUrl('https://host.example', 'nginx').href, 'https://host.example/#nginx');
  for (const url of ['file:///etc/passwd', 'devkit://app/', 'http://user:secret@host/', 'http://host/path', 'http://host/#jar', 'http://host/?a=b']) {
    assert.throws(() => lanPortalUrl(url, 'jar'));
  }
  assert.throws(() => lanPortalUrl('http://host/', 'projects'));
});
