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
    for (const width of [1440, 1024, 768, 620, 375]) {
      window.setContentSize(width, 1000);
      await settle();
      const geometry = await js(`(() => {
        const workspace = document.querySelector('.overview-workspace');
        workspace.scrollTop = 0;
        const navbar = document.querySelector('.floating-navbar');
        const controls = [...navbar.querySelectorAll('button')].filter(button => button.getClientRects().length);
        return { width: innerWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth,
          workspaceOverflow: workspace.scrollWidth > workspace.clientWidth + 1,
          navbarOutside: controls.some(button => { const rect = button.getBoundingClientRect(); return rect.left < 0 || rect.right > innerWidth + 1; }),
          floating: navbar.getBoundingClientRect().top > 0,
          bentoColumns: getComputedStyle(document.querySelector('.home-bento')).gridTemplateColumns,
          background: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
          panel: getComputedStyle(document.querySelector('.quick-start-card')).backgroundColor,
          text: getComputedStyle(workspace).color,
          accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
          appGradient: getComputedStyle(document.querySelector('.app')).backgroundImage,
          aurora: getComputedStyle(document.querySelector('.aurora')).display };
      })()`);
      assert.equal(geometry.pageOverflow, false, `${theme} ${width}: page overflow`);
      assert.equal(geometry.workspaceOverflow, false, `${theme} ${width}: workspace overflow`);
      assert.equal(geometry.navbarOutside, false, `${theme} ${width}: navbar outside viewport`);
      assert.equal(geometry.floating, true);
      assert.equal(geometry.background, theme === 'dark' ? '#141518' : '#f5f6f8');
      assert.equal(geometry.panel, theme === 'dark' ? 'rgb(28, 30, 34)' : 'rgb(255, 255, 255)');
      assert.equal(geometry.text, theme === 'dark' ? 'rgb(232, 233, 237)' : 'rgb(37, 41, 52)');
      assert.equal(geometry.accent, theme === 'dark' ? '#a6b8f4' : '#3d5fad');
      assert.equal(geometry.appGradient, 'none');
      assert.equal(geometry.aurora, 'none');
      report.push({ theme, ...geometry });
      if ([1440, 375].includes(width)) await fs.writeFile(path.join(output, `design-home-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG());
    }
  }
  window.setContentSize(1440, 1000);
  await js("document.documentElement.dataset.theme = 'light'");
  assert.match(await js('document.querySelector(".welcome-content h1").textContent'), /让专注发生.*让灵感成形/);
  assert.notEqual(await js('getComputedStyle(document.querySelector(".art-code")).transform'), 'none');
  const favoriteCount = await js('Number(document.querySelector(\'.sidebar-workspace button[title="我的收藏"] small\').textContent)');
  await js('document.querySelectorAll(".library-scope button")[1].click()');
  await settle();
  assert.equal(await js('document.querySelectorAll(".tool-card").length'), favoriteCount);
  await js('document.querySelectorAll(".library-scope button")[1].dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowRight", bubbles:true}))');
  await settle();
  assert.equal(await js('document.querySelectorAll(".library-scope button")[2].getAttribute("aria-pressed")'), 'true');
  await js('document.querySelectorAll(".library-scope button")[2].dispatchEvent(new KeyboardEvent("keydown", {key:"Home", bubbles:true}))');
  await settle();
  assert.equal(await js('document.querySelectorAll(".tool-card").length'), 46);
  await js('document.querySelector(".category-marquee button").click()');
  await wait('document.querySelector(".category-marquee").dataset.paused === "true"');
  const reducedMotion = await js('matchMedia("(prefers-reduced-motion: reduce)").matches');
  // A system-wide reduction disables animation entirely. Its shorthand resets
  // animationPlayState to "running", even though nothing is moving.
  await wait(reducedMotion
    ? 'getComputedStyle(document.querySelector(".marquee-track")).animationName === "none"'
    : 'getComputedStyle(document.querySelector(".marquee-track")).animationPlayState === "paused"');
  console.log(`Home motion preference: ${reducedMotion ? 'reduced (animation disabled)' : 'normal (pause verified)'}`);
  await js('document.querySelector(".welcome-actions button").click()');
  assert.equal(await js('document.activeElement.getAttribute("aria-label")'), '筛选工具库');
  await js('document.querySelector(".overview-workspace").scrollTop = 0; document.activeElement.blur()');
  await settle();
  await fs.writeFile(path.join(output, 'design-library-light.png'), (await window.webContents.capturePage()).toPNG());
  window.webContents.debugger.attach('1.3');
  try {
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await js('getComputedStyle(document.querySelector(".marquee-track")).animationName'), 'none');
    assert.equal(await js('getComputedStyle(document.querySelector(".segmented-control .motion-pill")).transitionDuration'), '0s');
  } finally {
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    window.webContents.debugger.detach();
  }
  await js('document.querySelector(".category-marquee button").click(); document.activeElement.blur(); document.querySelector(".overview-workspace").scrollTop = 0');
  await js('document.querySelector(".quick-start-grid button").click()');
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
  assert.equal(await js('getComputedStyle(document.querySelector(".task-pane:not([hidden]) .run-button")).backgroundColor'), 'rgb(166, 184, 244)');
  assert.equal(await js('getComputedStyle(document.querySelector(".task-pane:not([hidden]) .cm-gutters")).backgroundColor'), 'rgb(24, 26, 30)');
  await fs.writeFile(path.join(output, 'design-editor-dark.png'), (await window.webContents.capturePage()).toPNG());
  await js("document.documentElement.dataset.theme = 'light'");
  await settle();
  assert.equal(await js('getComputedStyle(document.querySelector(".task-pane:not([hidden]) .status-success")).color'), 'rgb(40, 119, 70)');
  assert.equal(await js('getComputedStyle(document.querySelector(".task-pane:not([hidden]) .run-button")).backgroundColor'), 'rgb(61, 95, 173)');
  assert.equal(await js('getComputedStyle(document.querySelector(".task-pane:not([hidden]) .cm-gutters")).backgroundColor'), 'rgb(248, 249, 251)');
  await fs.writeFile(path.join(output, 'design-editor-light.png'), (await window.webContents.capturePage()).toPNG());
  await js('document.querySelector(".task-tab.selected .tab-close").click()');
  await wait('!!document.querySelector(".overview-workspace:not([hidden])")');
  await js('document.querySelector(".color-story-card").click()');
  await wait('document.querySelector(".task-pane:not([hidden]) h1")?.textContent === "调色板与色阶"');
  await js('document.querySelector(".task-tab.selected .tab-close").click()');
  const { openWorkspace } = require('./navigation-helpers.cjs')(window);
  for (const name of ['日志中心', '监控中心', 'HTTP 调试', 'Nginx 配置', 'JAR 管理', '局域网主机', '项目中心']) {
    await openWorkspace(name);
    const title = JSON.stringify(name === 'HTTP 调试' ? '接口工作台' : name);
    await wait(`[...document.querySelectorAll('.workspace-banner h1')].some(heading => heading.textContent === ${title} && heading.getClientRects().length)`);
    assert.equal(await js(`getComputedStyle([...document.querySelectorAll('.workspace-banner h1')].find(heading => heading.textContent === ${title} && heading.getClientRects().length).closest('.workspace-banner')).borderInlineStartWidth`), '3px');
  }
  await wait('!!document.querySelector(".project-workspace:not([hidden]) .pc-shell")');
  await js("document.documentElement.dataset.theme = 'dark'");
  await settle();
  assert.equal(await js('getComputedStyle(document.querySelector(".pc-shell")).backgroundColor'), 'rgb(28, 30, 34)');
  await fs.writeFile(path.join(output, 'design-projects-dark.png'), (await window.webContents.capturePage()).toPNG());
  await js("document.documentElement.dataset.theme = 'light'");
  await js('document.querySelector(\'.sidebar button[title="我的收藏"]\').click()');
  await wait('document.querySelector(".collection-welcome h1")?.textContent === "你的常用工具"');
  await js('document.querySelector(\'.sidebar button[title="工作台"]\').click()');
  await wait('!!document.querySelector(".overview-workspace:not([hidden]) .home-bento")');
  await js('document.querySelector(\'button[aria-label="关闭通知"]\')?.click()');
  window.setSize(...size); window.setMinimumSize(...minimum);
  window.setMinimumSize(360, 600);
  // Use the actual preference controls; check all style/brightness pairs and persistence.
  await js(`document.querySelector('.sidebar button[title="设置"]').click()`);
  await wait('!!document.querySelector(".settings-page .theme-picker")');
  await settle();
  const about = 'section[aria-labelledby="devkit-about-heading"]';
  assert.equal(await js('document.getElementById("devkit-about-heading").textContent'), '关于 DevKit');
  assert.deepEqual(await js(`[...document.querySelectorAll('${about} dd')].slice(0, 2).map(item => item.textContent)`), [version, author.name]);
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
  for (const style of ['default', 'minimal', 'organic', 'editorial', 'brutalist', 'soft', 'glass', 'gradient', 'retro']) {
    await js(`document.querySelector('input[name="theme-style"][value="${style}"]').click()`);
    for (const mode of ['light', 'dark']) {
      await js(`{ const select = document.querySelector('.settings-page select[aria-label="明暗模式"]'); select.value = '${mode}'; select.dispatchEvent(new Event('change', { bubbles: true })); }`);
      await wait(`document.documentElement.dataset.themeStyle === '${style}' && document.documentElement.dataset.theme === '${mode}'`);
      for (const width of [1440, 768, 375]) {
        window.setContentSize(width, 1000); await settle();
        const appearance = await js(`(() => {
          const section = document.querySelector('.theme-picker');
          const styles = getComputedStyle(document.documentElement);
          return { overflow: document.documentElement.scrollWidth > innerWidth || section.scrollWidth > section.clientWidth + 1,
            background: styles.getPropertyValue('--bg').trim(), text: styles.getPropertyValue('--text').trim(),
            heroImage: getComputedStyle(document.querySelector('.welcome-card')).backgroundImage,
            panelRadius: getComputedStyle(document.querySelector('.settings-section')).borderRadius,
            panelBlur: getComputedStyle(document.querySelector('.settings-section')).backdropFilter,
            heroBorder: getComputedStyle(document.querySelector('.welcome-card')).borderTopStyle,
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
  window.setSize(...size); window.setMinimumSize(...minimum);
  await fs.writeFile(path.join(output, 'design-report.json'), JSON.stringify(report, null, 2));
  console.log('Design smoke passed: graphite palette, semantic success, editor, projects, responsive themes, navigation, keyboard and reduced motion.');
};
