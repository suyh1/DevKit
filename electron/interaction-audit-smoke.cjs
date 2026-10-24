const assert = require('node:assert/strict');
const { clipboard } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

// Use real UI actions, the native save bridge and OS clipboard; no React-state injection.
module.exports = function interactionAudit(window, output) {
  const pane = '.task-pane:not([hidden])';
  const js = code => window.webContents.executeJavaScript(code, true);
  const wait = async expression => {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await js(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error(`Interaction audit condition not met: ${expression}`);
  };
  const snapshot = async () => {
    await js(`document.querySelector('button[aria-label="关闭通知"]')?.click()`);
    await fs.unlink(path.join(output, 'saved.txt')).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await js(`document.querySelector('.top-actions button[title="保存工作区"]').click()`);
    await wait(`document.querySelector('.save-dialog').open`);
    await js(`document.querySelector('.save-dialog .sensitive-toggle input').click()`);
    await js(`document.querySelector('.save-dialog .run-button').click()`);
    await wait(`!document.querySelector('.save-dialog').open && document.querySelector('.app-toast')?.textContent.includes('已保存')`);
    return JSON.parse(await fs.readFile(path.join(output, 'saved.txt'), 'utf8'));
  };
  const run = async () => {
    await js(`document.querySelector('${pane} .run-button').click()`);
    await wait(`!!document.querySelector('${pane} .status-success')`);
  };
  return async id => {
    window.show(); window.focus(); window.webContents.focus();
    const before = (await snapshot()).tasks[0];
    assert.equal(before.toolId, id);
    assert.notEqual(before.output, '', `${id}: sample output`);
    await clipboard.clear();
    await js(`document.querySelector('${pane} button[aria-label="复制结果"]').click()`);
    await wait(`document.querySelector('.app-toast')?.textContent.includes('已复制到剪贴板')`);
    assert.equal((await clipboard.readText()).replace(/\r\n/g, '\n'), before.output.replace(/\r\n/g, '\n'), `${id}: whole result clipboard`);
    await js(`document.querySelector('${pane} button[aria-label="导出结果文件"]').click()`);
    await wait(`document.querySelector('.app-toast')?.textContent.includes('已保存')`);
    // The save toast can survive a preceding snapshot; poll the real saved bytes too.
    let exported;
    for (let attempt = 0; attempt < 100; attempt++) {
      exported = await fs.readFile(path.join(output, 'saved.txt'), 'utf8');
      if (exported === before.output) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(exported, before.output, `${id}: exact exported result`);
    const clear = await js(`!!document.querySelector('${pane} button[aria-label="清空输入"]')`);
    if (clear) {
      await js(`document.querySelector('${pane} button[aria-label="清空输入"]').click()`);
      assert.equal(await js(`document.querySelector('${pane} button[aria-label="复制结果"]').disabled`), true);
      assert.equal(await js(`document.querySelector('${pane} button[aria-label="导出结果文件"]').disabled`), true);
      assert.equal(await js(`document.querySelector('${pane} .result-routing button').disabled`), true);
      await js(`[...document.querySelectorAll('${pane} .input-card .editor-footer button')].find(b => b.textContent==='撤销').click()`);
      const restored = (await snapshot()).tasks[0];
      assert.equal(restored.input, before.input, `${id}: undo restores original input`);
      assert.deepEqual(restored.options, before.options, `${id}: undo restores configuration`);
      await run();
    } else {
      // Generation-only workspaces have configuration controls instead of a clear button.
      const selector = id === 'password' ? `${pane} .field-length input` : `${pane} .generator-config input[type="number"]`;
      const original = await js(`document.querySelector(${JSON.stringify(selector)}).value`);
      const set = value => js(`{const el=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true}));}`);
      await set(String(Number(original) + 1));
      assert.equal(await js(`document.querySelector('${pane} button[aria-label="复制结果"]').disabled`), true);
      assert.equal(await js(`document.querySelector('${pane} button[aria-label="导出结果文件"]').disabled`), true);
      await set(original); await run();
    }
    const current = (await snapshot()).tasks[0];
    await js(`{const el=document.querySelector('${pane} select[aria-label="结果发送目标"]'); el.value='base64'; el.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await js(`document.querySelector('${pane} .result-routing button').click()`);
    await wait(`document.querySelectorAll('.task-tab').length===2 && document.querySelector('${pane} [data-tool]')?.dataset.tool==='base64'`);
    const routed = await snapshot(), target = routed.tasks[1];
    assert.equal(target.input, current.output, `${id}: exact result transfer`);
    assert.equal(routed.tasks[0].input, current.input, `${id}: source input remains intact`);
    assert.deepEqual(routed.tasks[0].options, current.options);
    await run();
    const completed = (await snapshot()).tasks[1];
    assert.equal(completed.output, id === 'base64' ? current.input : Buffer.from(current.output, 'utf8').toString('base64'));
    await js(`document.querySelector('.task-tab.selected .tab-close').click()`);
    await wait(`document.querySelectorAll('.task-tab').length===1`);
    if (id === 'base64') {
      await js(`document.querySelector('${pane} button[aria-label="清空输入"]').click()`); await run();
      assert.ok(await js(`document.querySelector('${pane} .empty-state').textContent.includes('处理完成，结果为空')`));
      assert.equal(await js(`document.querySelector('${pane} button[aria-label="复制结果"]').disabled`), false);
      await clipboard.writeText('empty-result-sentinel');
      await js(`document.querySelector('button[aria-label="关闭通知"]')?.click()`);
      await js(`document.querySelector('${pane} button[aria-label="复制结果"]').click()`);
      await wait(`document.querySelector('.app-toast')?.textContent.includes('已复制到剪贴板')`);
      assert.equal(await clipboard.readText(), '');
      await js(`[...document.querySelectorAll('${pane} .input-card .editor-footer button')].find(b=>b.textContent==='撤销').click()`); await run();
    }
    return { clipboard: true, exactExport: true, exactTransfer: true, sourcePreserved: true, staleBlocked: true, clearUndo: clear, successfulEmpty: id === 'base64' };
  };
};
