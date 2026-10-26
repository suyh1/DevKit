const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function workflowsSmoke(window, output) {
  window.webContents.setBackgroundThrottling(false);
  const js = code => window.webContents.executeJavaScript(code, true);
  const pane = '.task-pane:not([hidden])';
  async function wait(expression) {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await js(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    console.error(await js(`JSON.stringify({focus:document.hasFocus(),status:document.querySelector('${pane} .color-status')?.textContent,tool:document.querySelector('${pane} h1')?.textContent})`));
    await fs.writeFile(path.join(output, 'workflow-failure.png'), (await window.webContents.capturePage()).toPNG());
    throw new Error(`Workflow condition not met: ${expression}`);
  }
  const fill = async (selector, value) => {
    await js(`{ const input = document.querySelector(${JSON.stringify(selector)}); const type = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(type.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', {bubbles:true})); }`);
  };
  await js('[...document.querySelectorAll(".tab-close")].forEach(button => button.click())');
  await wait('document.querySelectorAll(".task-tab").length === 0');
  const size = window.getSize(), minimum = window.getMinimumSize();
  window.setMinimumSize(360, 600);
  window.setSize(1440, 1000);
  const { catalog, openTool } = require('./navigation-helpers.cjs')(window);
  const names = (await catalog()).map(tool => tool.name);
  assert.equal(names.length, 46);
  const report = [];
  const audit = require('./interaction-audit-smoke.cjs')(window, output);
  for (const name of names) {
    console.log(`Checking workflow UI: ${name}`);
    await openTool(name);
    await wait(`document.querySelector('${pane} h1')?.textContent === ${JSON.stringify(name)}`);
    const id = await js(`document.querySelector('${pane} [data-tool]')?.dataset.tool`);
    if (id) {
      await js(`[...document.querySelectorAll('${pane} .editor-footer button')].find(button => button.textContent.includes('示例'))?.click()`);
      if (id === 'hmac') await fill(`${pane} .field-key input`, 'key');
      await js(`document.querySelector('${pane} .run-button').click()`);
      await wait(`!!document.querySelector('${pane} .status-success')`);
      if (id === 'geo-coordinates') await require('./geography-smoke.cjs')(window, output);
      if (id === 'json') {
        await wait(`getComputedStyle(document.querySelector('${pane} .input-card')).display === 'none'`);
        await js(`document.querySelector('${pane} .document-tabs button').click()`);
        await wait(`getComputedStyle(document.querySelector('${pane} .output-card')).display === 'none'`);
        await js(`document.querySelectorAll('${pane} .document-tabs button')[1].click()`);
      }
      if (id === 'chmod') {
        await js(`document.querySelector('${pane} input[aria-label="所有者读取"]').click()`);
        await wait(`!!document.querySelector('${pane} .status-stale')`);
        assert.equal(await js(`!!document.querySelector('${pane} .result-preview')`), false);
        await js(`document.querySelector('${pane} .run-button').click()`);
        await wait(`!!document.querySelector('${pane} .status-success')`);
        assert.equal(await js(`document.querySelector('${pane} .permission-value strong').textContent`), '4355');
      }
      if (id === 'hash') {
        const digest = await js(`document.querySelector('${pane} .digest-value').textContent`);
        await fill(`${pane} input[aria-label="待核对摘要或签名"]`, digest.toUpperCase());
        await wait(`document.querySelector('${pane} .digest-result')?.textContent.includes('完全一致')`);
        await fill(`${pane} input[aria-label="待核对摘要或签名"]`, 'bad');
        await wait(`document.querySelector('${pane} .digest-result')?.textContent.includes('值不一致')`);
      }
      if (id === 'ulid') {
        await js(`{ const select = document.querySelector('${pane} .field-mode select'); select.value = 'parse'; select.dispatchEvent(new Event('change', {bubbles:true})); }`);
        await wait(`!!document.querySelector('${pane} .workflow-inspect')`);
        await js(`document.querySelector('${pane} .run-button').click()`);
        await wait(`!!document.querySelector('${pane} .status-success')`);
        await wait(`!!document.querySelector('${pane} .ulid-results')`);
      }
      if (id === 'http-code') {
        // Real editor input followed by a form edit must not round or rewrite an untouched body.
        const config = '{"method":"POST","url":"https://example.com","body":{"id":9007199254740993,"value":1.2300e+2}}';
        window.show(); window.focus(); window.webContents.focus();
        await js(`document.querySelectorAll('${pane} .request-input-tabs button')[1].click()`);
        await wait(`!!document.querySelector('${pane} .input-card .cm-content')`);
        await js(`document.querySelector('${pane} .input-card .cm-content').focus()`);
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
        await window.webContents.insertText(config);
        await wait(`document.querySelector('${pane} .input-card .cm-content')?.textContent===${JSON.stringify(config)}`);
        await js(`document.querySelector('${pane} .request-input-tabs button').click()`);
        await wait(`!!document.querySelector('${pane} input[aria-label="请求 URL"]')`);
        await fill(`${pane} input[aria-label="请求 URL"]`, 'https://example.com/edited');
        await js(`document.querySelector('${pane} .run-button').click()`);
        await wait(`!!document.querySelector('${pane} .status-success')`);
        await wait(`document.querySelector('${pane} .output-card .cm-content')?.textContent.includes('/edited')`);
        await js(`document.querySelectorAll('${pane} .request-input-tabs button')[1].click()`);
        await wait(`document.querySelector('${pane} .input-card .cm-content')?.textContent.includes('/edited')`);
        assert.ok(await js(`document.querySelector('${pane} .input-card .cm-content').textContent.includes('9007199254740993')`));
        assert.ok(await js(`document.querySelector('${pane} .input-card .cm-content').textContent.includes('1.2300e+2')`));
        await js(`document.querySelector('${pane} .request-input-tabs button').click()`);
      }
      const interaction = id === 'geo-coordinates' ? { dedicatedGeographyFlow: true } : await audit(id);
      report.push({ name, id, workflow: await js(`document.querySelector('${pane} .text-workbench').className`), status: 'success', interaction });
      await js(`document.querySelector('button[aria-label="关闭通知"]')?.click()`);
      for (const theme of ['light', 'dark']) {
        await js(`document.documentElement.dataset.theme = '${theme}'`);
        await js('new Promise(resolve => setTimeout(resolve, 250))');
        if (['json', 'diff', 'ipv4', 'chmod', 'cron', 'hash', 'password', 'jwt', 'http-status', 'text-stats', 'http-code', 'json-csv'].includes(id)) {
          await fs.writeFile(path.join(output, `workflow-${id}-${theme}.png`), (await window.webContents.capturePage()).toPNG());
        }
        for (const width of [1440, 1024, 768, 375]) {
          window.setSize(width, 1000);
          await js('new Promise(resolve => setTimeout(resolve, 50))');
          assert.equal(await js('document.documentElement.scrollWidth <= window.innerWidth'), true, `${name} ${theme} ${width}: horizontal overflow`);
        }
        if (['chmod', 'cron', 'http-code', 'json-csv'].includes(id)) await fs.writeFile(path.join(output, `workflow-${id}-${theme}-narrow.png`), (await window.webContents.capturePage()).toPNG());
        window.setSize(1440, 1000);
      }
    } else {
      assert.equal(await js(`!!document.querySelector('${pane} .color-workbench')`), true, name);
      const original = 'rgba(10, 20, 30, 0.5)';
      const primary = `${pane} .color-control-panel .color-value-input`;
      await fill(primary, original);
      assert.equal(await js(`document.querySelector(${JSON.stringify(primary)}).value`), original);
      if (await js(`!!document.querySelector('${pane} .color-secondary-button') && [...document.querySelectorAll('${pane} .color-secondary-button')].some(b=>b.textContent==='交换颜色')`)) {
        const secondary = await js(`document.querySelectorAll('${pane} .color-control-panel .color-value-input')[1].value`);
        for (let n=0;n<2;n++) await js(`[...document.querySelectorAll('${pane} .color-secondary-button')].find(b=>b.textContent==='交换颜色').click()`);
        assert.equal(await js(`document.querySelector(${JSON.stringify(primary)}).value`), original);
        assert.equal(await js(`document.querySelectorAll('${pane} .color-control-panel .color-value-input')[1].value`), secondary);
      }
      if (name === '取色器') {
        await js(`[...document.querySelectorAll('${pane} button')].find(b=>b.textContent==='示例图片').click()`);
        await js(`[...document.querySelectorAll('${pane} button')].find(b=>b.textContent==='取此像素').click()`);
        assert.equal(await js(`document.querySelector(${JSON.stringify(primary)}).value`), '#EF4444');
        await fill(primary, original);
      }
      const { clipboard } = require('electron');
      window.show(); window.focus(); window.webContents.focus();
      await wait('document.hasFocus()');
      await clipboard.clear();
      if (await js(`!!document.querySelector('${pane} .color-formats button')`)) {
        const visible = await js(`document.querySelector('${pane} .color-formats button code').textContent`);
        await js(`document.querySelector('${pane} .color-formats button').click()`);
        await wait(`document.querySelector('${pane} .color-status').textContent.includes('已复制')`);
        assert.equal(await clipboard.readText(), visible);
      } else if (await js(`!!document.querySelector('${pane} .color-export button')`)) {
        await js(`document.querySelector('${pane} .color-export button').click()`);
        await wait(`document.querySelector('${pane} .color-status').textContent.includes('已复制')`);
        assert.ok((await clipboard.readText()).length > 10);
      } else {
        assert.ok(await js(`Number.parseFloat(document.querySelector('${pane} .color-ratio strong').textContent)>1`));
      }
      assert.equal(await js(`document.querySelector(${JSON.stringify(primary)}).value`), original, `${name}: output actions preserve input`);
      await fill(primary, 'invalid-color');
      assert.equal(await js(`!!document.querySelector('${pane} .color-error')`), true);
      assert.equal(await js(`!!document.querySelector('${pane} .color-formats button')`), false);
      assert.equal(await js(`!!document.querySelector('${pane} .color-export button')`), false);
      await fill(primary, original);
      report.push({ name, workflow: 'color', status: 'verified', interaction: { inputPreserved: true, actualCopyOrContrast: true, invalidatedResults: true, imagePixel: name === '取色器' } });
    }
    await js('document.querySelector(".task-tab.selected .tab-close").click()');
    await wait('document.querySelectorAll(".task-tab").length === 0');
  }
  await js("document.documentElement.dataset.theme = 'light'");
  window.setSize(...size); window.setMinimumSize(...minimum);
  await fs.writeFile(path.join(output, 'workflow-report.json'), JSON.stringify(report, null, 2));
  console.log('All 46 tool UIs checked; 40 text/coordinate tools executed, both themes and four viewport widths passed.');
};
