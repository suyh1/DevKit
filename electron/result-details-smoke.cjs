const assert = require('node:assert/strict');
const { clipboard } = require('electron');

// Runs in the JSON workspace opened by the feature suite.
module.exports = async function resultDetails({ js, wait, fill, click, pane }) {
  const inPane = selector => `document.querySelector(${JSON.stringify(pane + ' ' + selector)})`;
  const filter = pane + ' .preview-toolbar input';
  async function importJson(source, name) {
    await js(`{ const input = ${inPane('[aria-label="选择输入文件"]')};
      const transfer = new DataTransfer();
      transfer.items.add(new File([${JSON.stringify(source)}], ${JSON.stringify(name)}));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }`);
    await wait(`${inPane('.input-card')}.textContent.includes(${JSON.stringify(name)})`);
  }
  async function preview(source, name) {
    await importJson(source, name);
    await js(`${inPane('.run-actions .run-button')}.click()`);
    await wait(`!!${inPane('.status-success')} && !!${inPane('.json-tree')}`);
  }

  await preview('[{"a":1,"a":2},{"name":"Alice"},{"name":"Bob"}]', 'duplicate.json');
  await click('表格视图', pane + ' .preview-toolbar');
  await wait(`${inPane('.structured-preview')}.textContent.includes('同名字段')`);
  await fill(filter, 'bOB');
  await wait(`${inPane('.table-preview tbody')}?.innerText.includes('Bob')`);
  assert.equal(await js(`${inPane('.table-preview tbody td')}.textContent`), '3');
  assert.doesNotMatch(await js(`${inPane('.preview-toolbar')}.textContent`), /复制路径/);
  await fill(filter, 'missing');
  await wait(`${inPane('.structured-preview')}.textContent.includes('没有匹配的行')`);
  await click('结构视图', pane + ' .preview-toolbar');
  await wait(`${inPane('.structured-preview')}.textContent.includes('没有匹配的节点')`);
  await fill(filter, '');
  await wait(`!!${inPane('.json-tree')}`);

  await preview(JSON.stringify(Array.from({ length: 200 }, (_, i) => 'row-' + i)), 'rows.json');
  await js(`{
    const value = ${inPane('.json-tree .json-value')};
    value.scrollIntoView({block: 'center'});
    getSelection().selectAllChildren(value);
  }`);
  await wait('!!document.querySelector(".selection-copy")');
  await js(`${inPane('.json-tree .tree-leaf:last-child')}.scrollIntoView({block:'center'})`);
  await wait('!document.querySelector(".selection-copy") && !getSelection().isCollapsed');
  await js(`${inPane('.json-tree .json-value')}.scrollIntoView({block:'center'})`);
  await wait('!!document.querySelector(".selection-copy")');
  await js('getSelection().removeAllRanges()');

  const content = 'x'.repeat(9000);
  await importJson(JSON.stringify(content), 'long.json');
  await js(`${inPane('.recipe-panel')}.open=true`);
  await click('用当前原文运行', pane + ' .recipe-panel');
  await wait(`${inPane('.recipe-panel details p')}?.textContent.includes((9002).toLocaleString())`);
  const lengths = await js(`[...${inPane('.recipe-panel details')}.querySelectorAll('pre')].map(el=>el.textContent.length)`);
  assert.deepEqual(lengths, [8192, 8192]);
  await js(`${inPane('.recipe-panel details')}.open=true`);
  await click('复制完整输出', pane + ' .recipe-panel');
  await wait(`${inPane('.recipe-panel')}.textContent.includes('已复制完整结果')`);
  assert.equal(await clipboard.readText(), JSON.stringify(content));
};
