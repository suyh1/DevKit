const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function focusSmoke(wc, wait, output, narrow) {
  const run = (code) => wc.executeJavaScript(code, true);
  const previous = await run(
    '({theme:document.documentElement.dataset.theme, style:document.documentElement.dataset.themeStyle})',
  );
  const search = '.kb-search input',
    select = 'select[aria-label=筛选目录]';
  const focus = (selector) => run('document.querySelector(' + JSON.stringify(selector) + ').focus()');
  const key = (keyCode) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
  };
  async function click(selector) {
    const point = await run(`(() => {
      const field = document.querySelector(${JSON.stringify(selector)});
      field.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = field.getBoundingClientRect();
      return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
    })()`);
    wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  }
  function setTheme(theme, style) {
    return run(
      `Object.assign(document.documentElement.dataset, ${JSON.stringify({ theme, themeStyle: style })}) && true`,
    );
  }
  async function checkOutline(selector, highContrast = false) {
    const value = await run(
      'getComputedStyle(document.querySelector(' + JSON.stringify(selector) + ')).outlineWidth',
    );
    const width = parseFloat(value);
    assert.ok(highContrast ? width > 1 && width <= 2 : width > 0 && width <= 1, selector + ': ' + value);
  }
  const renderedColors = new Set();
  try {
    await click(search);
    await wait(wc, 'document.activeElement.matches(".kb-search input")');
    assert.equal(await run('getComputedStyle(document.activeElement).outlineStyle'), 'none');
    assert.equal(await run('getComputedStyle(document.activeElement).boxShadow'), 'none');
    await click(select);
    await wait(wc, 'document.querySelector("select[aria-label=筛选目录]").matches(":open")');
    key('Escape');
    await wait(
      wc,
      'document.activeElement.matches("select[aria-label=筛选目录]") && !document.activeElement.matches(":open")',
    );
    assert.equal(await run('getComputedStyle(document.activeElement).outlineStyle'), 'none');
    await click('button[aria-label=刷新文档]');
    await wait(wc, 'document.activeElement.matches("button[aria-label=刷新文档]")');
    assert.equal(await run('getComputedStyle(document.activeElement).outlineStyle'), 'none');
    for (const style of [
      'default',
      'minimal',
      'organic',
      'editorial',
      'brutalist',
      'soft',
      'glass',
      'gradient',
      'retro',
    ]) {
      for (const theme of ['light', 'dark']) {
        await setTheme(theme, style);
        await focus(search);
        const edge = await run(`(() => {
          const s=getComputedStyle(document.querySelector('.kb-search'));
          return { color:s.borderBottomColor, rest:s.borderTopColor, width:s.borderBottomWidth, outline:s.outlineStyle };
        })()`);
        assert.equal(edge.outline, 'none');
        assert.ok(parseFloat(edge.width) > 0 && parseFloat(edge.width) <= 1, edge.width);
        assert.notEqual(edge.color, edge.rest, style + ' ' + theme);
        renderedColors.add(edge.color);
        await focus(select);
        const mark = await run('getComputedStyle(document.activeElement).boxShadow');
        assert.ok(mark.includes(edge.color) && mark.includes('inset') && mark.includes('-1px'), mark);
        assert.equal(await run('getComputedStyle(document.activeElement).outlineStyle'), 'none');
        if (style === (narrow ? 'organic' : 'default') && theme === (narrow ? 'dark' : 'light')) {
          const filename = 'focus-' + (narrow ? 'narrow-dark' : 'desktop-light') + '.png';
          // Wait for theme transitions and Chromium's compositor before capturing the field.
          await run('new Promise(resolve => setTimeout(() => requestAnimationFrame(resolve), 400))');
          await fs.writeFile(path.join(output, filename), (await wc.capturePage()).toPNG());
        }
      }
    }
    assert.equal(renderedColors.size, 18);
    // Tab from the template selector to the adjacent create action, without activating either.
    await focus('select[aria-label=从模板新建]');
    key('Tab');
    await wait(wc, 'document.activeElement.matches(".kb-header .run-button:focus-visible")');
    await checkOutline(':focus');
    wc.debugger.attach();
    try {
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'forced-colors', value: 'active' }],
      });
      assert.equal(await run('matchMedia("(forced-colors: active)").matches'), true);
      await checkOutline(':focus', true);
      await focus(select);
      await checkOutline(':focus', true);
      await focus(search);
      await checkOutline('.kb-search', true);
      assert.equal(await run('getComputedStyle(document.activeElement).outlineStyle'), 'none');
    } finally {
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
      wc.debugger.detach();
    }
  } finally {
    await run(`{
      const root=document.documentElement.dataset, previous=${JSON.stringify(previous)};
      for (const [key,value] of [['theme',previous.theme],['themeStyle',previous.style]]) {
        if (value) root[key]=value; else delete root[key];
      }
    }`);
  }
  console.log(
    (narrow ? 'Narrow portal' : 'Desktop') +
      ' passed focus checks in 18 palettes, keyboard navigation and forced colors.',
  );
};
