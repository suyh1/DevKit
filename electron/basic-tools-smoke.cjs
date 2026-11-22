const assert = require('node:assert/strict');
const path = require('node:path');
const { clipboard, nativeImage } = require('electron');
const jsQR = require('jsqr');

function controls(window) {
  const pane = '.task-pane:not([hidden]) ';
  const run = (fn, ...args) => window.webContents.executeJavaScript('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')', true);
  const text = selector => run(s => document.querySelector(s)?.innerText ?? '', pane + selector);
  const click = selector => run(s => document.querySelector(s).click(), pane + selector);
  const fill = (selector, value) => run((s, value) => {
    const el = document.querySelector(s);
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, pane + selector, value);
  async function wait(label, predicate) {
    for (let i = 0; i < 150; i++) {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(label + ' · ' + await text('h1') + ' · ' + await text('.task-error'));
  }
  return { pane, run, text, click, fill, wait };
}

async function live(window, id, output) {
  const { pane, run, click, fill, text, wait } = controls(window);
  if (id === 'qr-code') {
    const payload = 'https://example.org/?名称=你好&emoji=😄';
    await fill('textarea', payload);
    await click('.field-level [value=H]');
    await click('.field-size [value="512"]');
    await wait('二维码像素尺寸', () => run(s => document.querySelector(s)?.width === 512, pane + 'canvas'));
    const pngPath = path.join(output, 'basic-tools-qr.png');
    const saved = new Promise((resolve, reject) => {
      window.webContents.session.once('will-download', (_event, item) => {
        item.setSavePath(pngPath);
        item.once('done', (_event, state) => state === 'completed' ? resolve() : reject(new Error(state)));
      });
    });
    await click('.visual-preview button');
    await saved;
    const png = nativeImage.createFromPath(pngPath);
    assert.deepEqual(png.getSize(), { width: 512, height: 512 });
    const decoded = jsQR(new Uint8ClampedArray(png.toBitmap()), 512, 512);
    assert.equal(decoded?.data, payload);
    await fill('textarea', '文'.repeat(3000));
    await wait('二维码容量提示', async () => (await text('.visual-preview')).includes('缩短文本'));
    assert.equal(await run(s => !!document.querySelector(s), pane + 'canvas'), false);
  } else {
    await fill('.field-width input', '190');
    await wait('容器实时换行', () => run(s => {
      const el = document.querySelector(s); return el.children[1].offsetTop > el.children[0].offsetTop;
    }, pane + '.flex-stage'));
    await click('.visual-preview button');
    await wait('复制 Flex CSS', async () => (await clipboard.readText()).replace(/\r\n/g, '\n') === await run(s => document.querySelector(s).textContent, pane + '.visual-preview pre'));
    const css = await clipboard.readText();
    assert.ok(css.includes('width: 190px;'));
    assert.equal(await run((s, css) => {
      const original = document.querySelector(s), other = original.cloneNode(true);
      other.removeAttribute('style');
      other.style.cssText = css.slice(css.indexOf('{') + 1, css.lastIndexOf('}'));
      original.after(other);
      const positions = box => [...box.children].map(child => [child.offsetLeft - box.offsetLeft, child.offsetTop - box.offsetTop]);
      const same = JSON.stringify(positions(original)) === JSON.stringify(positions(other));
      other.remove(); return same;
    }, pane + '.flex-stage', css), true);
  }
}

async function basicTools(window, output) {
  window.webContents.setBackgroundThrottling(false);
  window.show(); window.focus(); window.webContents.focus();
  const { catalog, openTool } = require('./navigation-helpers.cjs')(window);
  const entries = await catalog();
  const { pane, run, text, click, fill, wait } = controls(window);
  const open = async id => { await openTool(entries.find(entry => entry.id === id).name); };
  const close = () => run(() => document.querySelector('.task-tab.selected .tab-close').click());
  const mode = value => click('.field-mode button[value="' + value + '"]');
  async function drop(side, name, content) {
    await run((s, name, content) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([content], name));
      const panel = document.querySelector(s);
      (panel.querySelector('.cm-content') ?? panel).dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, pane + side, name, content);
    await wait('导入文件 ' + name, async () => (await text(side)).includes(name));
  }
  async function result() {
    await click('.run-button');
    await wait('Worker 成功返回', () => run(s => !!document.querySelector(s), pane + '.status-success'));
    await clipboard.writeText('等待复制结果');
    await click('button[aria-label="复制结果"]');
    await wait('复制到剪贴板', async () => await clipboard.readText() !== '等待复制结果');
    return (await clipboard.readText()).replace(/\r\n/g, '\n');
  }
  await open('diff');
  await mode('json');
  await drop('.input-card', 'before.json', '{"a":1}');
  await drop('.target-card', 'after.json', '{"a":1,"b":2}');
  assert.ok((await result()).includes('added'));
  await drop('.target-card', 'revision.json', '{"a":1,"c":3}');
  assert.ok((await text('.input-card')).includes('before.json'));
  await run(s => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([0, 9, 8])], 'binary.bin'));
    document.querySelector(s + ' .cm-content').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, pane + '.target-card');
  await wait('无效文件提示', () => run(() => [...document.querySelectorAll('.app-toast')].some(el => el.textContent.includes('二进制'))));
  assert.ok((await text('.target-card')).includes('revision.json'));
  assert.equal(JSON.parse(await result())[0].path, '$["c"]');
  await run(s => [...document.querySelectorAll(s)].find(b => b.textContent.includes('交换')).click(), pane + '.target-card button');
  assert.ok((await text('.target-card')).includes('before.json'));
  assert.ok((await result()).includes('removed'));
  await close();

  await open('json-schema');
  await drop('.input-card', 'sample.json', '[{"count":1},{"count":2}]');
  await result();
  await mode('validate');
  assert.equal(await result(), '校验通过');
  await drop('.input-card', 'invalid.json', '[{"count":1},{"count":"two"}]');
  assert.match(await result(), /1\/count/);
  await close();

  await open('regex');
  await mode('replace');
  await fill('.field-pattern input', '(?<姓>[^,]+),(.+)');
  await fill('.field-replacement input', '$2 $<姓>');
  await drop('.input-card', 'names.txt', '张,三');
  assert.equal(await result(), '三 张');
  assert.ok((await text('.output-card')).includes('1 个匹配'));
  await close();

  await open('env');
  await mode('compare');
  await drop('.input-card', 'dev.env', 'KEY=secret');
  await drop('.target-card', 'prod.env', 'REGION=cn');
  const envDiff = JSON.parse(await result());
  assert.deepEqual(envDiff['仅左侧'], ['KEY']);
  assert.deepEqual(envDiff['仅右侧'], ['REGION']);
  await click('.result-preview details summary');
  assert.ok((await text('.result-preview details')).includes('secret'));
  await close();

  await open('timestamp');
  await mode('batch');
  await fill('input[list]', 'America/New_York');
  await drop('.input-card', 'times.txt', '1735689600\nbad\n1751328000');
  const times = await result();
  assert.match(times, /05:00/); assert.match(times, /04:00/); assert.ok(times.includes('bad'));
  await close();

  for (const [id, expected] of [['json-lines','9007199254740993'], ['markdown-table','001'], ['semver','1.4.0']]) {
    await open(id);
    await run(s => [...document.querySelectorAll(s)].find(el => el.textContent.includes('示例')).click(), pane + '.editor-footer button');
    assert.ok((await result()).includes(expected)); await close();
  }
  for (const id of ['qr-code', 'css-flex']) { await open(id); await live(window, id, output); await close(); }
  console.log('Verified 10 offline tools, clipboard, file imports, PNG decode and CSS layout.');
}
module.exports = { basicTools, live };
