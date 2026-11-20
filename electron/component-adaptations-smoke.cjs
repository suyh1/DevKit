const assert = require('node:assert/strict');

module.exports = async function componentAdaptations(window) {
  const js = (code) => window.webContents.executeJavaScript(code, true);
  async function wait(expression) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await js(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error('Component interaction failed: ' + expression);
  }
  const tabs = '.task-tabs [role=tab]';
  const count = () => js(`document.querySelectorAll('${tabs}').length`);
  const before = await count();
  await js('document.querySelector(\'button[aria-label="新建JSON 格式化任务"]\').click()');
  await wait(`document.querySelectorAll('${tabs}').length === ${before + 1}`);
  for (let index = 0; index < 2; index++) {
    await js("document.querySelector('.task-create > button').click()");
    await wait(
      `(() => { const button = document.querySelector('.task-create button:last-child'); const rect = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(rect.left + rect.width/2, rect.top + rect.height/2)); })()`,
    );
    await js("document.querySelector('.task-create button:last-child').click()");
    await wait("document.querySelector('.command-dialog').open");
    await js(
      "[...document.querySelectorAll('.command-dialog [role=option]')].find(b => b.textContent.includes('JSON 格式化')).click()",
    );
    await wait(`document.querySelectorAll('${tabs}').length === ${before + index + 2}`);
  }
  const ids = await js(`Array.from(document.querySelectorAll('${tabs}'), tab => tab.id).slice(-3)`);
  for (const id of ids) {
    await js(`document.getElementById(${JSON.stringify(id)}).parentElement.querySelector('.tab-close').click()`);
    await wait(`!document.getElementById(${JSON.stringify(id)})`);
  }
  await wait("document.querySelectorAll('.notice-stack .app-toast').length === 3");
  await js("document.querySelector('.notice-count').click()");
  for (const id of [...ids].reverse()) {
    await js(
      "[...document.querySelectorAll('.notice-stack .app-toast button')].find(b => b.textContent.includes('撤销')).click()",
    );
    await wait(`!!document.getElementById(${JSON.stringify(id)})`);
  }
  assert.equal(await count(), before + 3);
  for (const id of ids) {
    await js(`document.getElementById(${JSON.stringify(id)}).parentElement.querySelector('.tab-close').click()`);
    await wait(`!document.getElementById(${JSON.stringify(id)})`);
  }
  await js("document.querySelector('.sidebar-bottom .nav-item').click()");
  await wait("!!document.querySelector('.font-slider input')");
  const size = await js("document.querySelector('.font-slider input').valueAsNumber");
  const next = size === 18 ? 17 : size + 1;
  async function setSize(value) {
    await js(
      `{ const input = document.querySelector('.font-slider input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${value}); input.dispatchEvent(new Event('input',{bubbles:true})); }`,
    );
    await wait(
      `document.querySelector('.font-slider output').textContent === '${value} px' && document.querySelector('.font-slider code').style.fontSize === '${value}px'`,
    );
  }
  await setSize(next);
  await setSize(size);
  await js("document.querySelector('.sidebar-workspace button').click()");
  await js("document.querySelector('button[aria-label=新建调色板与色阶任务]').click()");
  const values = "Array.from(document.querySelectorAll('.color-saved code'), element => element.textContent)";
  for (const hex of ['#214761', '#D06F40']) {
    await js(
      `{ const input = document.querySelector('input[aria-label=主颜色]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(hex)}); input.dispatchEvent(new Event('input',{bubbles:true})); }`,
    );
    await js(
      "[...document.querySelectorAll('button')].find(button => button.textContent === '收藏主颜色').click()",
    );
    await wait(values + '.includes(' + JSON.stringify(hex) + ')');
  }
  const original = await js(values);
  const clickColor = (label) =>
    js(
      `[...document.querySelectorAll('.color-favorites button')].find(button => button.textContent === ${JSON.stringify(label)}).click()`,
    );
  await clickColor('清空');
  await clickColor('取消');
  assert.deepEqual(await js(values), original);
  await clickColor('清空');
  await clickColor('确认清空收藏色');
  await wait(values + '.length === 0');
  await clickColor('撤销清空');
  assert.deepEqual(await js(values), original);
  console.log(
    'Component adaptations passed: fresh tasks, independent undo, font preview and reversible color clearing.',
  );
};
