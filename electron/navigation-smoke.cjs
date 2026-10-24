const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function navigationSmoke(window, output) {
  const js = code => window.webContents.executeJavaScript(code);
  const settle = () => new Promise(resolve => setTimeout(resolve, 300));
  async function wait(expression) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await js(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Category condition not met: ${expression}`);
  }
  const key = async (keyCode, modifiers = []) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Enter') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await settle();
  };
  const open = async category => {
    await js(`document.querySelector('.category-trigger[data-category="${category}"]').click()`);
    await wait('!!document.querySelector(".category-panel")');
    await settle();
  };
  const size = window.getSize(), minimum = window.getMinimumSize();
  window.setMinimumSize(360, 600);
  window.show(); window.focus(); window.webContents.focus();
  const report = [];
  for (const theme of ['light', 'dark']) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    for (const width of [1440, 1024, 768]) {
      window.setContentSize(width, 844);
      await settle();
      await js('document.querySelector(\'.topbar button[aria-label="展开导航"]\')?.click()');
      await settle();
      const before = await js('[...document.querySelectorAll(".category-trigger")].map(b => ({key:b.dataset.category, top:b.getBoundingClientRect().top, height:b.getBoundingClientRect().height}))');
      assert.equal(before.length, 7);
      for (const entrance of before) {
        assert.ok(entrance.height >= 44);
        await js(`document.querySelector('.category-trigger[data-category="${entrance.key}"]').scrollIntoView({block:'nearest'})`);
        const positions = await js('[...document.querySelectorAll(".category-trigger")].map(b => b.getBoundingClientRect().top)');
        await open(entrance.key);
        const geometry = await js(`(() => {
          const panel = document.querySelector('.category-panel'), rect = panel.getBoundingClientRect();
          return { left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom, width:innerWidth, height:innerHeight,
            positions:[...document.querySelectorAll('.category-trigger')].map(b=>b.getBoundingClientRect().top),
            toolCount:panel.querySelectorAll('.category-tool').length,
            focused:document.activeElement.classList.contains('category-tool'),
            pageOverflow:document.documentElement.scrollWidth>innerWidth,
            panelOverflow:panel.scrollWidth>panel.clientWidth,
            listScrollable:panel.querySelector('nav').scrollHeight>panel.querySelector('nav').clientHeight };
        })()`);
        assert.deepEqual(geometry.positions, positions, 'Opening a category must not move the entrances');
        assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && geometry.top >= 0 && geometry.bottom <= geometry.height, `${theme} ${width} ${entrance.key}: panel fits`);
        assert.ok(geometry.toolCount > 0);
        assert.equal(geometry.focused, true);
        assert.equal(geometry.pageOverflow, false);
        assert.equal(geometry.panelOverflow, false);
        report.push({ theme, viewport:width, category:entrance.key, ...geometry });
        if (width === 1440 && entrance.key === 'data') await fs.writeFile(path.join(output, `navigation-${theme}.png`), (await window.webContents.capturePage()).toPNG());
        await js('document.querySelector(\'button[aria-label="关闭分类工具面板"]\').click()');
        await wait('!document.querySelector(".category-panel")');
        assert.equal(await js('document.activeElement.dataset.category'), entrance.key);
      }
    }
  }
  window.setContentSize(1440, 844);
  await settle();
  await open('data');
  await key('End');
  assert.equal(await js('document.activeElement === [...document.querySelectorAll(".category-tool")].at(-1)'), true);
  await key('Home');
  await key('Down');
  assert.equal(await js('document.activeElement === document.querySelectorAll(".category-tool")[1]'), true);
  await key('Escape');
  await wait('!document.querySelector(".category-panel")');
  assert.equal(await js('document.activeElement.dataset.category'), 'data');
  await open('data');
  await js('[...document.querySelectorAll(".category-tool")].at(-1).focus()');
  await key('Tab');
  await wait('!document.querySelector(".category-panel")');
  assert.equal(await js('document.activeElement.title'), '设置', 'Tab must leave the non-modal panel');
  await open('data');
  await js('document.querySelector(\'.category-trigger[data-category="data"]\').click()');
  await wait('!document.querySelector(".category-panel")');
  await open('data');
  const point = await js('({x:innerWidth-30,y:innerHeight-20})');
  window.webContents.sendInputEvent({ type:'mouseDown', x:point.x, y:point.y, button:'left', clickCount:1 });
  window.webContents.sendInputEvent({ type:'mouseUp', x:point.x, y:point.y, button:'left', clickCount:1 });
  await wait('!document.querySelector(".category-panel")');
  await open('data');
  await key('Enter');
  await wait('document.querySelector(".task-pane:not([hidden]) h1")?.textContent === "JSON 格式化"');
  await wait('!document.querySelector(".category-panel")');
  assert.equal(await js('document.querySelector(".category-trigger.current-category").dataset.category'), 'data');
  await open('data');
  assert.equal(await js('document.activeElement.getAttribute("aria-current")'), 'page');
  assert.equal(await js('document.querySelector(\'.category-tool[data-tool-id="json"] .category-task-count\').textContent'), '1');
  await key('K', ['control']);
  await wait('!!document.querySelector(".command-dialog[open]") && !document.querySelector(".category-panel")');
  await key('Escape');
  await js('document.querySelector(\'.topbar button[aria-label="收起导航"]\').click()');
  await settle();
  assert.equal(await js('document.querySelectorAll(".category-trigger").length'), 7);
  assert.equal(await js('document.querySelectorAll(".category-tool").length'), 0);
  await open('security');
  await fs.writeFile(path.join(output, 'navigation-collapsed.png'), (await window.webContents.capturePage()).toPNG());
  await key('Escape');

  for (const width of [620, 375]) {
    window.setContentSize(width, 700);
    await settle();
    await js('document.querySelector(\'button[aria-label="关闭通知"]\')?.click()');
    await js('document.querySelector(\'.topbar button[aria-label="展开导航"]\')?.click()');
    await settle();
    await open('data');
    assert.equal(await js('getComputedStyle(document.querySelector(".category-list")).display'), 'none');
    const fits = await js(`(() => {const p=document.querySelector('.category-panel').getBoundingClientRect(),s=document.querySelector('.sidebar').getBoundingClientRect(); return p.left>=s.left && p.right<=s.right && p.bottom<=s.bottom && !document.documentElement.scrollLeft;})()`);
    assert.equal(fits, true);
    assert.equal(await js('document.querySelector(".category-tool-list").clientHeight > 300'), true, 'Mobile selection gives the tools most of the drawer height');
    await fs.writeFile(path.join(output, `navigation-mobile-${width}.png`), (await window.webContents.capturePage()).toPNG());
    await js('document.querySelector(\'button[aria-label="返回工具分类"]\').click()');
    await wait('!document.querySelector(".category-panel")');
    assert.equal(await js('document.activeElement.dataset.category'), 'data');
    await open('color');
    await key('Escape');
    await wait('!document.querySelector(".category-panel")');
    assert.equal(await js('document.querySelector(".app").classList.contains("sidebar-collapsed")'), false);
    assert.equal(await js('document.activeElement.dataset.category'), 'color');
    await key('Escape');
    await wait('document.querySelector(".app").classList.contains("sidebar-collapsed")');
    await js('document.querySelector(\'.topbar button[aria-label="展开导航"]\').click()');
    await settle();
    await open('utility');
    await js('document.querySelector(\'.category-tool[data-tool-id="timestamp"]\').click()');
    await wait('document.querySelector(".task-pane:not([hidden]) h1")?.textContent === "时间戳转换"');
    await wait('document.querySelector(".app").classList.contains("sidebar-collapsed")');
    await js('document.querySelectorAll(".tab-close").forEach(button=>button.click())');
    await wait('document.querySelectorAll(".task-tab").length === 0');
  }
  window.setContentSize(1024, 600);
  await settle();
  await open('data');
  assert.equal(await js('document.querySelector(".category-tool-list").scrollHeight > document.querySelector(".category-tool-list").clientHeight'), true);
  await key('End');
  const visible = await js(`(() => {const b=document.activeElement.getBoundingClientRect(),l=document.querySelector('.category-tool-list').getBoundingClientRect();return b.top>=l.top && b.bottom<=l.bottom+1;})()`);
  assert.equal(visible, true, 'The last tool remains reachable in a short viewport');
  await key('Escape');
  await js('document.documentElement.dataset.theme="light"');
  window.setSize(...size); window.setMinimumSize(...minimum);
  await fs.writeFile(path.join(output, 'navigation-report.json'), JSON.stringify(report, null, 2));
  console.log('Category navigation passed: fixed entrances, 7 groups, themes, collapsed icons, viewport bounds, real keyboard, outside click, focus return and mobile drawer.');
};
