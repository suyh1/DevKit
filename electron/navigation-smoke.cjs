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
  const originalStyle = await js('document.documentElement.dataset.themeStyle');
  window.setContentSize(1440, 844);
  await settle();
  for (const style of ['default', 'minimal', 'organic', 'editorial', 'brutalist', 'soft', 'glass', 'gradient', 'retro']) {
    for (const theme of ['light', 'dark']) {
      await js(`void Object.assign(document.documentElement.dataset, {themeStyle:'${style}', theme:'${theme}'})`);
      await open('data');
      const layer = await js(`(() => {
        const panel = document.querySelector('.category-panel'), r = panel.getBoundingClientRect();
        const points = [[r.left+20,r.top+20], [r.right-20,r.top+20], [r.left+20,r.bottom-20], [r.right-20,r.bottom-20], [r.left+r.width/2,r.top+r.height/2]];
        return {style:document.documentElement.dataset.themeStyle, theme:document.documentElement.dataset.theme,
          topLayer:panel.matches(':popover-open'),
          hit:points.every(([x,y]) => panel.contains(document.elementFromPoint(x,y))),
          left:r.left, sidebarRight:document.querySelector('.sidebar').getBoundingClientRect().right};
      })()`);
      assert.equal(layer.topLayer, true, `${style} ${theme}: native top layer`);
      assert.equal(layer.hit, true, `${style} ${theme}: the panel receives pointer input across its surface`);
      assert.ok(Math.abs(layer.left-layer.sidebarRight-10) < 1, `${style} ${theme}: viewport positioning`);
      report.push(layer);
      if (style === 'glass') await fs.writeFile(path.join(output, `navigation-glass-${theme}.png`), (await window.webContents.capturePage()).toPNG());
      await key('Escape');
      await wait('!document.querySelector(".category-panel")');
    }
  }
  await js(`document.documentElement.dataset.themeStyle = ${JSON.stringify(originalStyle ?? 'default')}`);
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
  window.show(); window.focus(); window.webContents.focus();
  await settle();
  assert.equal(await js(`document.querySelector('.category-navigation').contains(document.elementFromPoint(${point.x},${point.y}))`), false);
  window.webContents.sendInputEvent({ type:'mouseMove', x:point.x, y:point.y });
  window.webContents.sendInputEvent({ type:'mouseDown', x:point.x, y:point.y, button:'left', clickCount:1 });
  window.webContents.sendInputEvent({ type:'mouseUp', x:point.x, y:point.y, button:'left', clickCount:1 });
  await wait('!document.querySelector(".category-panel")');
  await open('data');
  const selectedTitle = await js('document.activeElement.closest(".category-tool").title');
  await key('Enter');
  await wait('document.querySelector(".task-pane:not([hidden]) h1")?.textContent === ' + JSON.stringify(selectedTitle));
  await wait('!document.querySelector(".category-panel")');
  assert.equal(await js('document.querySelector(".category-trigger.current-category").dataset.category'), 'data');
  await open('data');
  assert.equal(await js('document.activeElement.getAttribute("aria-current")'), 'page');
  assert.equal(await js('document.querySelector(\'.category-tool[aria-current="page"] .category-task-count\').textContent'), '1');
  await key('K', ['control']);
  await wait('!!document.querySelector(".command-dialog[open]") && !document.querySelector(".category-panel")');
  assert.ok(await js('[...document.querySelectorAll(".command-result")].every(option => option.tabIndex === -1)'));
  await key('Down');
  assert.ok(await js('document.getElementById(document.activeElement.getAttribute("aria-activedescendant"))?.matches("[aria-selected=true]")'));
  await key('Tab');
  assert.equal(await js('document.activeElement.getAttribute("aria-label")'), '关闭搜索');
  await key('Escape');

  const sharedTrigger = '.shared-sidebar-trigger';
  const sharedPanel = '#shared-sidebar-panel';
  const categoryPositions = '[...document.querySelectorAll(".category-trigger")].map(button => button.getBoundingClientRect().top)';
  const beforeShared = await js(categoryPositions);
  await js(`document.querySelector('${sharedTrigger}').click()`);
  await wait(`!!document.querySelector('${sharedPanel}:popover-open')`);
  await settle();
  assert.deepEqual(await js(categoryPositions), beforeShared, 'Opening shared navigation keeps category entrances fixed');
  assert.equal(await js(`(() => {
    const panel = document.querySelector('${sharedPanel}').getBoundingClientRect();
    const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
    return Math.abs(panel.left - sidebar.right - 10) < 1 && panel.bottom <= innerHeight;
  })()`), true, 'The shared panel fits to the right of the sidebar');
  await open('data');
  assert.equal(await js(`document.querySelector('${sharedPanel}')`), null, 'Selecting a category replaces the shared panel');
  await js(`document.querySelector('${sharedTrigger}').click()`);
  await wait(`!!document.querySelector('${sharedPanel}:popover-open')`);
  await key('Escape');
  await wait(`!document.querySelector('${sharedPanel}')`);
  assert.equal(await js(`document.activeElement.matches('${sharedTrigger}')`), true);
  await key('Enter');
  await wait(`!!document.querySelector('${sharedPanel}:popover-open')`);
  await key('End');
  assert.equal(await js('document.activeElement.title'), '局域网主机');
  await key('Enter');
  await wait('document.querySelector(".workspace:not([hidden]) .lan-heading h1")?.textContent === "局域网主机"');
  await wait(`!document.querySelector('${sharedPanel}')`);
  await js(`document.querySelector('${sharedTrigger}').click()`);
  await wait(`document.querySelector('${sharedPanel}')?.contains(document.activeElement)`);
  assert.equal(await js('document.activeElement.getAttribute("aria-current")'), 'page');
  await key('Escape');
  await wait(`!document.querySelector('${sharedPanel}')`);

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
    await js(`document.querySelector('${sharedTrigger}').click()`);
    await wait(`!!document.querySelector('${sharedPanel}.category-panel-inline')`);
    assert.equal(await js(`document.querySelector('${sharedTrigger}').getClientRects().length`), 0);
    assert.equal(await js('document.querySelector(".category-list").getClientRects().length'), 0);
    await js('document.querySelector(\'button[aria-label="返回侧栏导航"]\').click()');
    await wait(`!document.querySelector('${sharedPanel}')`);
    assert.equal(await js(`document.activeElement.matches('${sharedTrigger}')`), true);
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
    assert.equal(await js('document.querySelector(".sidebar").inert'), false);
    assert.equal(await js('document.activeElement.dataset.category'), 'color');
    await key('Escape');
    await wait('document.querySelector(".sidebar").inert');
    await js('document.querySelector(\'.topbar button[aria-label="展开导航"]\').click()');
    await settle();
    await open('utility');
    await js('document.querySelector(\'.category-tool[data-tool-id="timestamp"]\').click()');
    await wait('document.querySelector(".task-pane:not([hidden]) h1")?.textContent === "时间戳转换"');
    await wait('document.querySelector(".sidebar").inert');
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

  const orderDialog = '.shared-order-dialog';
  const dialogOpen = `!!document.querySelector('${orderDialog}[open]')`;
  const listOrder = menu => `[...document.querySelectorAll('${menu} strong')].map(item => item.textContent)`;
  const draftOrder = '[...document.querySelectorAll(".shared-order-name")].map(item => item.textContent)';
  const handle = name => `[aria-label="拖动${name}排序"]`;
  const position = name => `[aria-label="${name}的位置"]`;
  const focus = selector => js(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  const center = selector => js(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  const mouse = (type, point) => window.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
  const startDrag = async point => {
    mouse('mouseMove', point);
    mouse('mouseDown', point);
    mouse('mouseMove', { x: point.x + 8, y: point.y });
    await wait('!!document.querySelector(".shared-order-preview")');
  };
  const topMenu = '#shared-workspace-menu';
  const click = async selector => {
    const lookup = `document.querySelector(${JSON.stringify(selector)})`;
    await wait(`!!${lookup}?.getClientRects().length`);
    await js(`${lookup}.click()`);
  };
  window.setContentSize(1280, 844);
  await settle();
  await click('.topbar button[aria-label="收起导航"]');
  await click('.shared-nav-trigger');
  await wait(`!!document.querySelector('${topMenu}:popover-open')`);
  const defaultOrder = await js(listOrder(topMenu));
  await key('Home');
  assert.equal(await js('document.activeElement.textContent'), '排序');
  await key('Enter');
  await wait(dialogOpen);
  await settle();

  const first = defaultOrder[0], last = defaultOrder.at(-1);
  const target = await center(handle(defaultOrder[4]));
  await startDrag(await center(handle(first)));
  mouse('mouseMove', target);
  await settle();
  mouse('mouseUp', target);
  await wait('!document.querySelector(".shared-order-preview")');
  const draggedOrder = [...defaultOrder.slice(1, 5), first, ...defaultOrder.slice(5)];
  assert.deepEqual(await js(draftOrder), draggedOrder, 'Dragging can move across several rows');

  await focus(handle(first));
  await key('Space');
  await wait('!!document.querySelector(".shared-order-preview")');
  await key('Up');
  await key('Escape');
  assert.equal(await js(dialogOpen), true, 'Esc cancels the active drag before closing the dialog');
  assert.deepEqual(await js(draftOrder), draggedOrder);
  await key('Space');
  await key('Up');
  await key('Space');
  const keyboardOrder = [...defaultOrder.slice(1, 4), first, ...defaultOrder.slice(4)];
  assert.deepEqual(await js(draftOrder), keyboardOrder, 'Keyboard dragging can move a row');

  await focus(position(last));
  await key('Home');
  assert.deepEqual(await js(draftOrder), [last, ...keyboardOrder.slice(0, -1)], 'The position selector can jump to the first row');
  assert.equal(await js('document.activeElement.getAttribute("aria-label")'), `${last}的位置`);
  await focus('[aria-label="上移监控中心"]');
  await key('Enter');
  assert.equal(await js('document.activeElement.getAttribute("aria-label")'), '上移监控中心');
  await fs.writeFile(path.join(output, 'shared-order-desktop.png'), (await window.webContents.capturePage()).toPNG());
  await js('document.querySelector(".shared-order-footer .run-button").focus()');
  await key('Enter');
  await wait(`!(${dialogOpen})`);
  assert.equal(await js('document.activeElement.matches(".shared-nav-trigger")'), true);
  const updatedOrder = [keyboardOrder[0], last, ...keyboardOrder.slice(1, -1)];
  await click(sharedTrigger);
  await wait(`!!document.querySelector('${sharedPanel}:popover-open')`);
  assert.deepEqual(await js(listOrder(sharedPanel)), updatedOrder);

  const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  window.webContents.reload();
  await reloaded;
  await click('.topbar button[aria-label="收起导航"]');
  await wait('!!document.querySelector(".shared-nav-trigger")');
  await click('.shared-nav-trigger');
  await wait(`!!document.querySelector('${topMenu}:popover-open')`);
  assert.deepEqual(await js(listOrder(topMenu)), updatedOrder);
  await key('Escape');

  await click('.topbar button[aria-label="展开导航"]');
  window.setMinimumSize(360, 450);
  window.setContentSize(375, 500);
  await settle();
  await click('.topbar button[aria-label="展开导航"]');
  await click(sharedTrigger);
  await wait(`!!document.querySelector('${sharedPanel}.category-panel-inline')`);
  await click(`${sharedPanel} .shared-sort-action`);
  await wait(dialogOpen);
  await settle();
  const edge = await js(`(() => {
    const r = document.querySelector('.shared-order-list').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.floor(r.bottom - 4) };
  })()`);
  await startDrag(await center(handle(updatedOrder[0])));
  mouse('mouseMove', edge);
  await wait(`(() => {
    const list = document.querySelector('.shared-order-list');
    return list.scrollTop > 0 && list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
  })()`);
  mouse('mouseUp', edge);
  await wait('!document.querySelector(".shared-order-preview")');
  assert.deepEqual(await js(draftOrder), [...updatedOrder.slice(1), updatedOrder[0]], 'Dragging past the visible rows reaches the last position');
  await settle();
  await click('.shared-order-footer .text-button');
  await settle();
  assert.deepEqual(await js(draftOrder), defaultOrder, 'Reset restores the default order in the draft');
  assert.equal(await js('document.querySelector(".shared-order-list").scrollTop'), 0);
  await fs.writeFile(path.join(output, 'shared-order-narrow.png'), (await window.webContents.capturePage()).toPNG());
  await key('Escape');
  await wait(`!(${dialogOpen})`);
  assert.equal(await js('document.querySelector(".sidebar").inert'), false, 'Esc closes only the order dialog');
  assert.equal(await js(`document.activeElement.matches('${sharedTrigger}')`), true);
  await click(sharedTrigger);
  await wait(`!!document.querySelector('${sharedPanel}.category-panel-inline')`);
  assert.deepEqual(await js(listOrder(sharedPanel)), updatedOrder, 'Esc discards the reset draft');
  await click(`${sharedPanel} .shared-sort-action`);
  await wait(dialogOpen);
  await click('.shared-order-footer .text-button');
  await click('.shared-order-footer .run-button');
  await wait(`!(${dialogOpen})`);
  await click(sharedTrigger);
  await wait(`!!document.querySelector('${sharedPanel}.category-panel-inline')`);
  assert.deepEqual(await js(listOrder(sharedPanel)), defaultOrder);
  await key('Escape');
  await key('Escape');
  await js('document.querySelector(\'button[aria-label="关闭通知"]\')?.click()');
  await js('document.documentElement.dataset.theme="light"');
  window.setSize(...size); window.setMinimumSize(...minimum);
  await fs.writeFile(path.join(output, 'navigation-report.json'), JSON.stringify(report, null, 2));
  console.log('Navigation passed: category popovers, responsive menus, shared order dragging, scrolling, position selection, keyboard focus, persistence, cancel and reset.');
};
