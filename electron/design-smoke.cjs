const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { clipboard, shell } = require('electron');
const { version, author, homepage } = require('../package.json');

module.exports = async function designSmoke(window, output) {
  window.webContents.setBackgroundThrottling(false);
  window.show(); window.focus(); window.webContents.focus();
  const js = code => window.webContents.executeJavaScript(code);
  const settle = () => js('new Promise(resolve => setTimeout(resolve, 350))');
  async function wheel(delta) {
    const point = await js(`(() => {
      const rect = document.querySelector('.home-overview').getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width * .78), y: Math.round(rect.y + rect.height * .47) };
    })()`);
    window.webContents.sendInputEvent({ type: 'mouseWheel', ...point, deltaY: -delta });
  }
  async function wait(expression) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await js(expression)) return;
      await js('new Promise(resolve => setTimeout(resolve, 50))');
    }
    throw new Error(`Design condition not met: ${expression}`);
  }
  const size = window.getSize(), minimum = window.getMinimumSize();
  await require('./navigation-smoke.cjs')(window, output);
  window.setMinimumSize(360, 600);
  const report = [];
  for (const theme of ['light', 'dark']) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    for (const width of [1920, 1440, 1024, 768, 620, 375]) {
      window.setContentSize(width, width === 1920 ? 1080 : 1000);
      await settle();
      const geometry = await js(`(() => {
        const workspace = document.querySelector('.overview-workspace');
        const launch = workspace.querySelector('.home-launch');
        const catalog = workspace.querySelector('.home-catalog');
        const navbar = document.querySelector('.floating-navbar');
        const controls = [...navbar.querySelectorAll('button')].filter(button => button.getClientRects().length);
        return { width: innerWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth,
          workspaceOverflow: workspace.scrollWidth > workspace.clientWidth + 1,
          navbarOutside: controls.some(button => { const rect = button.getBoundingClientRect(); return rect.left < 0 || rect.right > innerWidth + 1; }),
          floating: navbar.getBoundingClientRect().top > 0,
          launchScrollbar: getComputedStyle(launch).scrollbarWidth,
          workspaceOverflowY: getComputedStyle(workspace).overflowY,
          launchFits: launch.scrollHeight <= launch.clientHeight + 1,
          catalogHidden: catalog.inert && catalog.getBoundingClientRect().top >= workspace.getBoundingClientRect().bottom - 1,
          background: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
          panel: getComputedStyle(document.querySelector('.smart-open')).backgroundColor,
          text: getComputedStyle(workspace).color,
          accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
          appGradient: getComputedStyle(document.querySelector('.app')).backgroundImage };
      })()`);
      assert.equal(geometry.pageOverflow, false, `${theme} ${width}: page overflow`);
      assert.equal(geometry.workspaceOverflow, false, `${theme} ${width}: workspace overflow`);
      assert.equal(geometry.navbarOutside, false, `${theme} ${width}: navbar outside viewport`);
      assert.equal(geometry.floating, true);
      assert.equal(geometry.background, theme === 'dark' ? '#161d28' : '#eef2f6');
      assert.equal(geometry.panel, theme === 'dark' ? 'rgb(32, 42, 56)' : 'rgb(255, 255, 255)');
      assert.equal(geometry.text, theme === 'dark' ? 'rgb(237, 242, 251)' : 'rgb(32, 51, 78)');
      assert.equal(geometry.accent, theme === 'dark' ? '#b4caff' : '#365fae');
      assert.equal(geometry.appGradient, 'none');
      assert.equal(geometry.catalogHidden, true, `${theme} ${width}: library is off-screen and inert on arrival`);
      assert.equal(geometry.launchScrollbar, 'none');
      assert.equal(geometry.workspaceOverflowY, 'clip');
      assert.equal(geometry.launchFits, true);
      report.push({ theme, ...geometry });
      if ([1920, 1440, 375].includes(width)) await fs.writeFile(path.join(output, `design-home-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG());
    }
  }
  window.setContentSize(1440, 1000);
  await js("document.documentElement.dataset.theme = 'light'");
  assert.equal(await js('document.querySelector(".overview-heading h1").textContent'), '开发工作台');
  {
    const previousClipboard = await clipboard.readText();
    try {
      window.focus(); window.webContents.focus();
      await clipboard.writeText('{"name":"DevKit","ready":true}');
      await js('document.querySelector(".smart-open-paste").click()');
      assert.equal(await js('document.activeElement.matches(".smart-open textarea")'), true);
      window.webContents.paste();
      await wait('[...document.querySelectorAll(".smart-suggestion strong")].some(el => el.textContent === "JSON 格式化")');
      await js('document.querySelector(".smart-open-results summary").click()');
      await wait('!!document.querySelector(".smart-open-results details[open] .smart-suggestion")');
      await js('document.querySelector(".smart-open-actions .text-button").click()');
      await wait('!document.querySelector(".smart-suggestion")');
      async function paste(content) {
        await clipboard.writeText(content);
        await js('document.querySelector(".smart-open-paste").click()');
        window.webContents.paste();
      }
      await paste('#1984ae');
      await wait('document.querySelectorAll(".smart-suggestion").length === 6');
      await js('document.querySelector(".smart-suggestion").click()');
      await wait('document.querySelector(".task-pane:not([hidden]) input[aria-label=主颜色]")?.value === "#1984ae"');
      await js('document.querySelector(".task-tab.selected .tab-close").click()');
      await js('document.querySelector(\'.sidebar button[title="工作台"]\').click()');
      await wait('!!document.querySelector(".overview-workspace:not([hidden]) .smart-open-paste")');
      await js('document.querySelector(".smart-open-actions .text-button")?.click()');
      await paste('- [ ] 核对输入');
      await wait('[...document.querySelectorAll(".smart-open-results[aria-label=共享栏目] button")].some(el => el.textContent.includes("待办清单"))');
      await js('[...document.querySelectorAll(".smart-open-results[aria-label=共享栏目] button")].find(el => el.textContent.includes("待办清单")).click()');
      await wait('!!document.querySelector(".workspace:not([hidden]) .td-heading")');
      await js('document.querySelector(\'.sidebar button[title="工作台"]\').click()');
      await wait('!!document.querySelector(".overview-workspace:not([hidden]) .smart-open-paste")');
    } finally {
      if (previousClipboard) await clipboard.writeText(previousClipboard);
      else clipboard.clear();
    }
  }
  const atLibrary = '!!document.querySelector(".home-overview[data-screen=library]")';
  await wheel(120);
  await wait(atLibrary);
  await wait(`(() => {
    const catalog = document.querySelector('.home-catalog');
    const viewport = document.querySelector('.home-overview');
    const bounds = catalog.getBoundingClientRect();
    return !catalog.inert && Math.abs(bounds.top - viewport.getBoundingClientRect().top) < 1 &&
      Math.abs(bounds.height - viewport.clientHeight) < 1 && catalog.scrollHeight > catalog.clientHeight && catalog.offsetWidth > catalog.clientWidth;
  })()`);
  assert.equal(await js('document.querySelector(".home-launch").inert'), true);
  assert.equal(await js('document.querySelector(".home-catalog .category-filters, .home-catalog .library-scope")'), null);
  assert.equal(await js('document.querySelectorAll(".tool-card").length'), 95);
  const firstCard = await js(`(() => {
    const rect = document.querySelector('.home-catalog .tool-card').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width * .7), y: Math.round(rect.top + rect.height * .35) };
  })()`);
  window.webContents.sendInputEvent({ type: 'mouseMove', ...firstCard });
  await wait('!!document.querySelector(".tool-card[data-lit]")');
  window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
  await wait('!document.querySelector(".tool-card[data-lit]")');
  await fs.writeFile(path.join(output, 'design-library-light.png'), (await window.webContents.capturePage()).toPNG());
  await settle();
  await wheel(320);
  await wait('document.querySelector(".home-catalog").scrollTop > 50');
  await wheel(-500);
  await wait('document.querySelector(".home-catalog").scrollTop === 0');
  assert.equal(await js(atLibrary), true, 'The list scrolls to its top before returning to the launch screen');
  await settle();
  await wheel(-120);
  await wait(`!(${atLibrary})`);
  await js('document.body.dispatchEvent(new KeyboardEvent("keydown", {key:"/", bubbles:true, cancelable:true}))');
  await wait(atLibrary);
  assert.equal(await js('document.activeElement.matches(".library-search input")'), true);
  await window.webContents.insertText('经纬度工具');
  await wait('document.querySelectorAll(".tool-card").length === 1');
  await js('document.querySelector(".home-catalog button[aria-label=列表视图]").click()');
  await wait('!!document.querySelector(".home-catalog .tool-list")');
  await js(`{
    const input = document.querySelector('.library-search input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.home-catalog button[aria-label=卡片视图]').click();
    document.querySelector('.overview-back').click();
  }`);
  await wait(`!(${atLibrary})`);
  try {
    window.webContents.setZoomFactor(2);
    await settle();
    assert.equal(await js(`(() => {
      const bar = document.querySelector('.floating-navbar');
      return document.documentElement.scrollWidth <= innerWidth &&
        [...bar.querySelectorAll('button')].every(button => {
          const bounds = button.getBoundingClientRect();
          return !bounds.width || bounds.left >= 0 && bounds.right <= innerWidth;
        });
    })()`), true, 'Desktop controls fit at 200% zoom');
  } finally {
    window.webContents.setZoomFactor(1);
    await settle();
  }
  await js('document.querySelector(".top-search").click()');
  await wait('!!document.querySelector(".command-dialog[open] input")');
  assert.equal(await js('document.activeElement.matches(".command-dialog input")'), true);
  assert.equal(await js('document.querySelector(".command-dialog").hasAttribute("data-capsule")'), true);
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await wait('!document.querySelector(".command-dialog[open]")');
  window.webContents.debugger.attach('1.3');
  try {
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await js('getComputedStyle(document.querySelector(".overview-deck")).transitionDuration'), '0s');
    assert.equal(await js('getComputedStyle(document.querySelector(".segmented-control .motion-pill")).transitionDuration'), '0s');
    await window.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const point = await js(`(() => {
      const rect = document.querySelector('.home-launch').getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width * .85), y: Math.round(rect.y + rect.height * .65) };
    })()`);
    await window.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await window.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, y: point.y - 100 }] });
    await window.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(atLibrary);
    await js('document.querySelector(".overview-back").click()');
    await wait(`!(${atLibrary})`);
  } finally {
    await window.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false });
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    window.webContents.debugger.detach();
  }
  await js('document.querySelector(".quick-start button").click()');
  await wait('document.querySelector(".task-pane:not([hidden]) h1")?.textContent === "JSON 格式化"');
  await js("document.documentElement.dataset.theme = 'dark'");
  await wait('!!document.querySelector(".task-pane:not([hidden]) .editor-footer button")');
  await js('[...document.querySelectorAll(".task-pane:not([hidden]) .editor-footer button")].find(button => button.textContent.includes("示例")).click()');
  await js('document.querySelector(".task-pane:not([hidden]) .run-button").click()');
  await wait('!!document.querySelector(".task-pane:not([hidden]) .status-success")');
  assert.equal(await js('document.querySelector(".task-pane:not([hidden]) .output-card").dataset.resultState'), 'success');
  assert.equal(await js('getComputedStyle(document.querySelector(".task-pane:not([hidden]) .workspace-banner")).borderInlineStartWidth'), '3px');
  // Resizing can leave the OS pointer over the run button; compare its base color.
  window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
  await settle();
  assert.equal(await js('getComputedStyle(document.querySelector(".task-pane:not([hidden]) .status-success")).color'), 'rgb(138, 197, 160)');
  assert.equal(await js('getComputedStyle(document.querySelector(".task-pane:not([hidden]) .run-button")).backgroundColor'), 'rgb(180, 202, 255)');
  assert.equal(await js('getComputedStyle(document.querySelector(".task-pane:not([hidden]) .cm-gutters")).backgroundColor'), 'rgb(38, 49, 65)');
  await fs.writeFile(path.join(output, 'design-editor-dark.png'), (await window.webContents.capturePage()).toPNG());
  await js("document.documentElement.dataset.theme = 'light'");
  await settle();
  assert.equal(await js('getComputedStyle(document.querySelector(".task-pane:not([hidden]) .status-success")).color'), 'rgb(40, 119, 70)');
  assert.equal(await js('getComputedStyle(document.querySelector(".task-pane:not([hidden]) .run-button")).backgroundColor'), 'rgb(54, 95, 174)');
  assert.equal(await js('getComputedStyle(document.querySelector(".task-pane:not([hidden]) .cm-gutters")).backgroundColor'), 'rgb(248, 249, 251)');
  await fs.writeFile(path.join(output, 'design-editor-light.png'), (await window.webContents.capturePage()).toPNG());
  await js('document.querySelector(".task-tab.selected .tab-close").click()');
  await wait('!!document.querySelector(".overview-workspace:not([hidden])")');
  await js('document.querySelector(".overview-library-entry").click()');
  await wait(atLibrary);
  const expanding = await js(`(() => {
    const button = [...document.querySelectorAll(".tool-card-open")].find(item => item.textContent.startsWith("调色板与色阶"));
    button.click();
    return getComputedStyle(button.closest('.tool-card')).viewTransitionName;
  })()`);
  assert.equal(expanding, 'tool-detail');
  await wait('document.querySelector(".task-pane:not([hidden]) h1")?.textContent === "调色板与色阶"');
  await wait('!document.documentElement.hasAttribute("data-expanding-card")');
  await js('document.querySelector(".task-tab.selected .tab-close").click()');
  const { openWorkspace } = require('./navigation-helpers.cjs')(window);
  for (const name of ['日志中心', '监控中心', 'HTTP 调试', 'Nginx 配置', '服务管理', '局域网主机', '项目中心']) {
    await openWorkspace(name);
    const title = JSON.stringify(name);
    await wait(`[...document.querySelectorAll('.workspace-banner h1')].some(heading => heading.textContent === ${title} && heading.getClientRects().length)`);
    assert.equal(await js(`getComputedStyle([...document.querySelectorAll('.workspace-banner h1')].find(heading => heading.textContent === ${title} && heading.getClientRects().length).closest('.workspace-banner')).borderInlineStartWidth`), '3px');
  }
  await wait('!!document.querySelector(".project-workspace:not([hidden]) .pc-shell")');
  await js("document.documentElement.dataset.theme = 'dark'");
  await settle();
  assert.equal(await js('getComputedStyle(document.querySelector(".pc-shell")).backgroundColor'), 'rgb(32, 42, 56)');
  await fs.writeFile(path.join(output, 'design-projects-dark.png'), (await window.webContents.capturePage()).toPNG());
  await js("document.documentElement.dataset.theme = 'light'");
  await js('document.querySelector(\'.sidebar button[title="我的收藏"]\').click()');
  await wait('document.querySelector(".overview-heading h1")?.textContent === "我的收藏"');
  await js('document.querySelector(\'.sidebar button[title="工作台"]\').click()');
  await wait('!!document.querySelector(".overview-workspace:not([hidden]) .home-launch")');
  await js('document.querySelector(\'button[aria-label="关闭通知"]\')?.click()');
  window.setSize(...size); window.setMinimumSize(...minimum);
  window.setMinimumSize(360, 600);
  // Use the actual preference controls; check all style/brightness pairs and persistence.
  await js(`document.querySelector('.sidebar button[title="设置"]').click()`);
  await wait('!!document.querySelector(".settings-page .theme-picker")');
  await settle();
  const about = 'section[aria-labelledby="devkit-about-heading"]';
  assert.equal(await js('document.getElementById("devkit-about-heading").textContent'), '关于 DevKit');
  assert.deepEqual(await js(`['版本','作者'].map(label => [...document.querySelectorAll('${about} dt')].find(term => term.textContent === label)?.nextElementSibling?.textContent)`), [version, author.name]);
  assert.equal(await js(`document.querySelector('${about} .license-details summary').textContent`), '非商业许可');
  await js(`document.querySelector('${about} .license-details summary').click()`);
  await wait(`document.querySelector('${about} .license-details [popover]').matches(':popover-open')`);
  assert.ok(await js(`document.querySelector('${about} .license-details pre').textContent.includes('# PolyForm Noncommercial License 1.0.0')`));
  await js(`document.querySelector('${about} .floating-details-close').click()`);
  await wait(`!document.querySelector('${about} .license-details').open`);
  assert.equal(await js('document.querySelector(".about-contact span").textContent'), author.email);
  assert.equal(await js('document.querySelector(".about-repository").href'), homepage);
  const previousClipboard = await clipboard.readText();
  const openExternal = shell.openExternal;
  let handledUrl;
  shell.openExternal = async url => { handledUrl = url; };
  try {
    await window.webContents.executeJavaScript('document.querySelector(".about-contact button").click()', true);
    await wait('document.querySelector(".app-toast")?.textContent.includes("联系邮箱已复制")');
    assert.equal(await clipboard.readText(), author.email);
    await js('document.querySelector(".about-repository").click()');
    for (let attempt = 0; !handledUrl && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(handledUrl, homepage);
    assert.equal(new URL(window.webContents.getURL()).protocol, 'devkit:');
  } finally {
    shell.openExternal = openExternal;
    if (previousClipboard) await clipboard.writeText(previousClipboard);
    else clipboard.clear();
  }
  window.setContentSize(375, 780);
  await settle();
  assert.equal(await js(`(() => { const section = document.querySelector('${about}'); return section.scrollWidth <= section.clientWidth; })()`), true);
  await js('document.querySelector(\'button[aria-label="关闭通知"]\')?.click()');
  console.log('About DevKit passed: package metadata, real clipboard, desktop browser handler and narrow layout.');
  const libraryHeight = () => js('document.querySelector(".setting-theme-library").getBoundingClientRect().height');
  const closedHeight = await libraryHeight();
  await js('document.querySelector(".setting-theme-library summary").click()');
  await wait('document.querySelector(".setting-theme-library [popover]")?.matches(":popover-open")');
  assert.equal(await libraryHeight(), closedHeight, 'opening the theme library leaves its row stationary');
  for (const style of ['default', 'minimal', 'organic', 'editorial', 'brutalist', 'soft', 'glass', 'gradient', 'retro']) {
    await js(`document.querySelector('input[name="theme-style"][value="${style}"]').click()`);
    for (const mode of ['light', 'dark']) {
      await js(`document.querySelector('.settings-page [aria-label="明暗模式"] button[value="${mode}"]').click()`);
      await wait(`document.documentElement.dataset.themeStyle === '${style}' && document.documentElement.dataset.theme === '${mode}'`);
      for (const width of [1440, 768, 375]) {
        window.setContentSize(width, 1000); await settle();
        const appearance = await js(`(() => {
          const section = document.querySelector('.theme-picker');
          const styles = getComputedStyle(document.documentElement);
          return { overflow: document.documentElement.scrollWidth > innerWidth || section.scrollWidth > section.clientWidth + 1,
            background: styles.getPropertyValue('--bg').trim(), text: styles.getPropertyValue('--text').trim(),
            heroImage: getComputedStyle(document.querySelector('.home-launch .smart-open')).backgroundImage,
            panelRadius: getComputedStyle(document.querySelector('.settings-section')).borderRadius,
            panelBlur: getComputedStyle(document.querySelector('.settings-section')).backdropFilter,
            heroBorder: getComputedStyle(document.querySelector('.home-launch .smart-open')).borderTopStyle,
            saved: JSON.parse(localStorage.getItem('devkit:preferences')) };
        })()`);
        assert.equal(appearance.overflow, false, `${style}/${mode}/${width} fits`);
        assert.equal(appearance.saved.themeStyle, style);
        assert.equal(appearance.saved.theme, mode);
        if (style === 'soft') assert.equal(appearance.panelRadius, '22px');
        if (style === 'glass') assert.ok(appearance.panelBlur.includes('blur(24px)'));
        if (style === 'gradient') assert.ok(appearance.heroImage.includes('linear-gradient'), 'gradient hero must render in both modes');
        if (style === 'retro') assert.equal(appearance.heroBorder, 'double');
        const rgb = hex => hex.match(/[a-f0-9]{2}/gi).map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
        const lum = hex => rgb(hex).reduce((sum, c, index) => sum + c * [.2126, .7152, .0722][index], 0);
        const a = lum(appearance.background), b = lum(appearance.text);
        assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${style}/${mode} contrast`);
        if (width === 1440) await fs.writeFile(path.join(output, `design-theme-${style}-${mode}.png`), (await window.webContents.capturePage()).toPNG());
      }
      window.setContentSize(1440, 1000);
      await js(`document.querySelector('.sidebar button[title="工作台"]').click()`);
      await settle();
      await fs.writeFile(path.join(output, `design-home-${style}-${mode}.png`), (await window.webContents.capturePage()).toPNG());
      await js(`document.querySelector('.sidebar button[title="设置"]').click()`);
      await settle();
    }
  }
  await js(`document.querySelector('input[name="theme-style"][value="default"]').click()`);
  await js(`document.querySelector('.sidebar button[title="工作台"]').click()`);
  window.setSize(...size); window.setMinimumSize(...minimum);
  await fs.writeFile(path.join(output, 'design-report.json'), JSON.stringify(report, null, 2));
  console.log('Design smoke passed: light and dark palettes, semantic success, editor, projects, responsive themes, navigation, keyboard and reduced motion.');
};
