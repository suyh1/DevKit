const assert = require('node:assert/strict');

const catalogs = new WeakMap();
module.exports = function navigationHelpers(window) {
  const js = code => window.webContents.executeJavaScript(code);
  async function wait(expression) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await js(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Navigation condition not met: ${expression}`);
  }
  async function expand() {
    await js('document.querySelector(\'.topbar button[aria-label="展开导航"]\')?.click()');
    await wait('!document.querySelector(".app").classList.contains("sidebar-collapsed")');
  }
  async function catalog() {
    if (catalogs.has(window)) return catalogs.get(window);
    await expand();
    const keys = await js('[...document.querySelectorAll(".category-trigger")].map(button => button.dataset.category)');
    const entries = [];
    for (const key of keys) {
      await js(`{ const trigger = document.querySelector('.category-trigger[data-category="${key}"]'); if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click(); }`);
      await wait(`document.querySelector('.category-trigger[data-category="${key}"]')?.getAttribute('aria-expanded') === 'true'`);
      const group = await js('[...document.querySelectorAll(".category-tool")].map(button => ({name:button.title, id:button.dataset.toolId}))');
      entries.push(...group.map(tool => ({ ...tool, category: key })));
    }
    await js('document.querySelector(\'button[aria-label="关闭分类工具面板"]\')?.click()');
    await wait('!document.querySelector(".category-panel")');
    assert.equal(entries.length, 46);
    assert.equal(new Set(entries.map(tool => tool.id)).size, 46);
    catalogs.set(window, entries);
    return entries;
  }
  async function openTool(name) {
    const entry = (await catalog()).find(tool => tool.name === name);
    assert.ok(entry, `Tool registered: ${name}`);
    await expand();
    await js(`{ const trigger = document.querySelector('.category-trigger[data-category="${entry.category}"]'); if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click(); }`);
    await wait(`!!document.querySelector('.category-tool[data-tool-id="${entry.id}"]')`);
    await js(`document.querySelector('.category-tool[data-tool-id="${entry.id}"]').click()`);
    await wait(`document.querySelector('.task-pane:not([hidden]) h1')?.textContent === ${JSON.stringify(name)}`);
    await wait('!document.querySelector(".category-panel")');
  }
  return { catalog, openTool };
};
