const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function designSmoke(window, output) {
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
          background: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() };
      })()`);
      assert.equal(geometry.pageOverflow, false, `${theme} ${width}: page overflow`);
      assert.equal(geometry.workspaceOverflow, false, `${theme} ${width}: workspace overflow`);
      assert.equal(geometry.navbarOutside, false, `${theme} ${width}: navbar outside viewport`);
      assert.equal(geometry.floating, true);
      report.push({ theme, ...geometry });
      if ([1440, 375].includes(width)) await fs.writeFile(path.join(output, `design-home-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG());
    }
  }
  window.setContentSize(1440, 1000);
  await js("document.documentElement.dataset.theme = 'light'");
  const favoriteCount = await js('Number(document.querySelector(\'.sidebar-workspace button[title="我的收藏"] small\').textContent)');
  await js('document.querySelectorAll(".library-scope button")[1].click()');
  await settle();
  assert.equal(await js('document.querySelectorAll(".tool-card").length'), favoriteCount);
  await js('document.querySelectorAll(".library-scope button")[1].dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowRight", bubbles:true}))');
  await settle();
  assert.equal(await js('document.querySelectorAll(".library-scope button")[2].getAttribute("aria-pressed")'), 'true');
  await js('document.querySelectorAll(".library-scope button")[2].dispatchEvent(new KeyboardEvent("keydown", {key:"Home", bubbles:true}))');
  await settle();
  assert.equal(await js('document.querySelectorAll(".tool-card").length'), 44);
  await js('document.querySelector(".category-marquee button").click()');
  await settle();
  assert.equal(await js('getComputedStyle(document.querySelector(".marquee-track")).animationPlayState'), 'paused');
  await js('document.querySelector(".welcome-actions button").click()');
  assert.equal(await js('document.activeElement.getAttribute("aria-label")'), '筛选工具库');
  await js('document.querySelector(".overview-workspace").scrollTop = 0; document.activeElement.blur()');
  await settle();
  await fs.writeFile(path.join(output, 'design-library-light.png'), (await window.webContents.capturePage()).toPNG());
  window.webContents.debugger.attach('1.3');
  try {
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await js('getComputedStyle(document.querySelector(".marquee-track")).animationName'), 'none');
    assert.equal(await js('getComputedStyle(document.querySelector(".segment-indicator")).transitionDuration'), '0s');
  } finally {
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    window.webContents.debugger.detach();
  }
  await js('document.querySelector(".category-marquee button").click(); document.activeElement.blur(); document.querySelector(".overview-workspace").scrollTop = 0');
  await js('document.querySelector(".quick-start-grid button").click()');
  await wait('document.querySelector(".task-pane:not([hidden]) h1")?.textContent === "JSON 格式化"');
  await js('document.querySelector(".task-tab.selected .tab-close").click()');
  await wait('!!document.querySelector(".overview-workspace:not([hidden])")');
  await js('document.querySelector(".color-story-card").click()');
  await wait('document.querySelector(".task-pane:not([hidden]) h1")?.textContent === "调色板与色阶"');
  await js('document.querySelector(".task-tab.selected .tab-close").click()');
  await js('document.querySelector(\'.floating-nav-links button[aria-label="项目中心"]\').click()');
  await wait('!!document.querySelector(".project-workspace:not([hidden]) .pc-shell")');
  await js('document.querySelector(\'.floating-nav-links button[aria-label="收藏"]\').click()');
  await wait('document.querySelector(".collection-welcome h1")?.textContent === "你的常用工具"');
  await js('document.querySelector(\'.floating-nav-links button[aria-label="工作空间"]\').click()');
  await wait('!!document.querySelector(".overview-workspace:not([hidden]) .home-bento")');
  await js('document.querySelector(\'button[aria-label="关闭通知"]\')?.click()');
  window.setSize(...size); window.setMinimumSize(...minimum);
  await fs.writeFile(path.join(output, 'design-report.json'), JSON.stringify(report, null, 2));
  console.log('Design smoke passed: responsive themes, floating navigation, quick launch, scope, keyboard, marquee and reduced motion.');
};
