const assert = require('node:assert/strict');
const { clipboard } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function geographySmoke(window, output) {
  window.show(); window.focus(); window.webContents.focus();
  const pane = '.task-pane:not([hidden])', js = code => window.webContents.executeJavaScript(code, true);
  const wait = async expression => { for (let n = 0; n < 100; n++) { if (await js(expression)) return; await new Promise(resolve => setTimeout(resolve, 40)); } await fs.writeFile(path.join(output, 'geography-failure.png'), (await window.webContents.capturePage()).toPNG()); throw new Error(`Geo condition not met: ${expression}; toast: ${await js('document.querySelector(".app-toast")?.textContent')}`); };
  const click = async label => { await js(`document.querySelector('${pane} [aria-label=${JSON.stringify(label)}]').click()`); };
  const set = async (label, value) => { await js(`{ const el = document.querySelector('${pane} [aria-label=${JSON.stringify(label)}]'); const proto = el.tagName === 'SELECT' ? HTMLSelectElement : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input',{bubbles:true})); }`); };
  const run = async () => { await js(`document.querySelector('${pane} .run-button').click()`); await wait(`!!document.querySelector('${pane} .status-success')`); };
  const copy = async label => { await js('document.querySelector(\'button[aria-label="关闭通知"]\')?.click()'); await wait('!document.querySelector(".app-toast")'); await clipboard.clear(); await click(label); await wait(`document.querySelector('.app-toast')?.textContent.includes('已复制坐标')`); return (await clipboard.readText()).replace(/\r\n/g, '\n'); };
  assert.match(await js(`document.querySelector('${pane} .geo-output').textContent`), /116°23′28.68″E/);
  assert.equal(await copy('复制全部坐标'), '116.391300,39.907500');
  assert.equal(await copy('复制经度十进制度'), '116.391300');
  await set('复制格式', 'dms');
  assert.equal(await copy('复制纬度度分秒'), '39°54′27.00″N');
  assert.equal(await copy('复制纬度十进制度'), '39.907500', 'single-value copy is tied to its visible format');
  await set('粘贴坐标对', 'N39°54′27″ E116°23′28.68″');
  await js(`[...document.querySelectorAll('${pane} button')].find(b=>b.textContent==='填入经纬字段').click()`);
  assert.equal(await js(`document.querySelector('${pane} input[aria-label="经度"]').value`), 'E116°23′28.68″');
  assert.equal(await js(`document.querySelector('${pane} input[aria-label="纬度"]').value`), 'N39°54′27″');
  await run();
  await click('圆周点计算');
  await js(`[...document.querySelectorAll('${pane} .editor-footer button')].find(b=>b.textContent.includes('示例')).click()`);
  await set('方向', 'all'); await run();
  assert.equal(await js(`document.querySelectorAll('${pane} .geo-point').length`), 4);
  await set('方向', 'east'); await run();
  const ellipsoid = await js(`document.querySelector('${pane} .geo-point').textContent`);
  await set('圆周算法', 'sphere');
  assert.equal(await js(`document.querySelector('${pane} [aria-label="复制全部坐标"]').disabled`), true);
  await run();
  assert.notEqual(await js(`document.querySelector('${pane} .geo-point').textContent`), ellipsoid);
  await click('格式转换');
  assert.equal(await js(`document.querySelector('${pane} [aria-label="复制全部坐标"]').disabled`), false, 'cached conversion survives tab switches');
  await set('经度', '-116E'); await runError();
  assert.equal(await js(`document.querySelector('${pane} [aria-label="复制全部坐标"]').disabled`), true);
  await set('经度', '116.3913'); await run();
  await click('文本提取');
  await js(`[...document.querySelectorAll('${pane} .editor-footer button')].find(b=>b.textContent.includes('示例')).click()`);
  await run();
  assert.equal(await js(`document.querySelectorAll('${pane} .geo-table tbody tr').length`), 3);
  await set('复制格式', 'decimal');
  assert.equal(await copy('复制纬度列'), '39.907500\n31.230500\n39.907500');
  assert.equal(await copy('复制经度列'), '116.391300\n121.473667\n116.391300');
  await set('复制顺序', 'lat-lon'); await set('分隔符', 'tab'); await set('表头', 'on');
  const all = await copy('复制全部坐标');
  assert.ok(all.startsWith('纬度\t经度\n39.907500\t116.391300'));
  assert.equal(all.includes('点位'), false);
  assert.match(await js(`document.querySelector('${pane} .geo-issues').textContent`), /180/);
  await set('重复点', 'on'); await run();
  assert.equal(await js(`document.querySelectorAll('${pane} .geo-table tbody tr').length`), 2);
  // Use the repeating-fraction coordinate from row two; do not overwrite the transferred center with a sample.
  await js(`document.querySelectorAll('${pane} .geo-table tbody tr')[1].querySelectorAll('button')[1].click()`);
  await wait(`!!document.querySelector('${pane} input[aria-label="圆心经度"]')`);
  const transferred = await js(`document.querySelector('${pane} input[aria-label="圆心经度"]').value`);
  assert.equal(transferred, '121°28\'25.2"E', 'extracted coordinates retain the original DMS input');
  for (const algorithm of ['ellipsoid', 'sphere']) {
    await set('圆周算法', algorithm); await run();
    assert.equal(await js(`document.querySelectorAll('${pane} .geo-point').length`), 1);
  }
  await js(`[...document.querySelectorAll('${pane} .geo-point button')].find(b=>b.textContent==='送到格式转换').click()`);
  await run();
  assert.equal(await js(`document.querySelector('${pane} [aria-label="复制全部坐标"]').disabled`), false);
  // Empty visible conversion fields must not borrow a valid pair from the hidden extraction page.
  await set('经度', ''); await set('纬度', '');
  await click('文本提取');
  await set('包含度分秒坐标的文本', '116°0′0″E,39°0′0″N'); await run();
  await click('格式转换'); await runError();
  assert.match(await js(`document.querySelector('${pane} .task-error').textContent`), /请输入经度和纬度/);
  await set('粘贴坐标对', 'N39°54′27″ E116°23′28.68″');
  await js(`[...document.querySelectorAll('${pane} button')].find(b=>b.textContent==='填入经纬字段').click()`); await run();
  for (const tab of ['格式转换', '圆周点计算', '文本提取']) {
    await click(tab);
    for (const theme of ['light', 'dark']) {
      await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      window.setSize(1440, 1000);
      await js('new Promise(resolve=>setTimeout(resolve,200))');
      await fs.writeFile(path.join(output, `geography-${tab}-${theme}.png`), (await window.webContents.capturePage()).toPNG());
      await js(`document.querySelector('${pane} .geo-output').scrollIntoView({block:'start'})`);
      await js('new Promise(resolve=>setTimeout(resolve,100))');
      await fs.writeFile(path.join(output, `geography-${tab}-${theme}-result.png`), (await window.webContents.capturePage()).toPNG());
      await js(`document.querySelector('${pane} .geo-workbench').scrollIntoView({block:'start'})`);
      for (const width of [1440, 768, 375]) {
        window.setSize(width, 1000);
        await js('new Promise(resolve=>setTimeout(resolve,100))');
        assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true, `${tab} ${theme} ${width}`);
      }
      await fs.writeFile(path.join(output, `geography-${tab}-${theme}-narrow.png`), (await window.webContents.capturePage()).toPNG());
    }
  }
  window.setSize(1440, 1000);
  await fs.writeFile(path.join(output, 'geography-report.json'), JSON.stringify({ conversion: true, pastePair: true, pastePreservesDms: true, extractedCenterPreservesSource: true, singleCopyMatchesVisibleFormat: true, hiddenExtractionNotUsedForEmptyConversion: true, ellipsoidAndSphere: true, fourDirections: true, extraction: true, extractedCenterCalculatedWithoutReplacing: true, calculatedPointConverted: true, actualClipboard: true, columnAndTsv: true, rejectedCoordinates: true, tabCache: true, dedupe: true, responsiveThemes: true }, null, 2));
  async function runError() { await js(`document.querySelector('${pane} .run-button').click()`); await wait(`!!document.querySelector('${pane} .status-error')`); }
};
