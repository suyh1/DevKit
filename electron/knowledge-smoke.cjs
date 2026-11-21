const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { BrowserWindow } = require('electron');
const path = require('node:path');

module.exports = async function knowledgeSmoke(desktop, portal, wait, output) {
  const stored = [];
  async function exercise(window, narrow) {
    const wc = window.webContents,
      run = (s) => wc.executeJavaScript(s, true),
      until = (s) => wait(wc, s);
    const q = JSON.stringify,
      source = '.kb-source-pane .cm-content';
    const btn = (root, name) =>
      '([...document.querySelectorAll(' +
      q(root + ' button') +
      ')].find(b=>b.textContent.trim()===' +
      q(name) +
      ' && b.getClientRects().length))';
    async function click(root, name) {
      const target = btn(root, name);
      await until(target + ' && !' + target + '.disabled');
      await run(target + '.click()');
    }
    async function field(selector, value) {
      await run(
        '(()=>{const el=document.querySelector(' +
          q(selector) +
          '); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,' +
          q(value) +
          ');el.dispatchEvent(new Event("input",{bubbles:true}));})()',
      );
    }
    async function select(selector, value) {
      await run(
        '(()=>{const e=document.querySelector(' +
          q(selector) +
          ');e.value=' +
          q(value) +
          ';e.dispatchEvent(new Event("change",{bubbles:true}));})()',
      );
    }
    async function write(text) {
      await until('!!document.querySelector(' + q(source) + ')');
      await run('document.querySelector(' + q(source) + ').focus()');
      await wc.insertText(text);
    }
    async function labelClick(root, label) {
      const target =
        '[...document.querySelectorAll(' +
        q(root + ' label') +
        ')].find(l=> (l.querySelector("strong")?.textContent||l.textContent).trim()===' +
        q(label) +
        ')';
      await until('!!(' + target + ')');
      await run('(' + target + ').querySelector("input").click()');
    }
    async function library() {
      await run('location.hash="#knowledge"');
      await until('document.querySelector(".kb-header .run-button")?.disabled===false');
    }
    async function snapshot(name) {
      await run('new Promise(resolve=>setTimeout(resolve,320))');
      await fs.writeFile(
        path.join(output, 'knowledge-' + (narrow ? 'narrow' : 'desktop') + '-' + name + '.png'),
        (await wc.capturePage()).toPNG(),
      );
    }
    async function viewMode(mode) {
      await click('.kb-writing-tools', mode);
    }
    async function previewAndResume(title) {
      await run('document.querySelector(' + q(source) + ').focus()');
      await until('!!document.querySelector(".kb-source-pane .cm-focused")');
      assert.equal(await run('getComputedStyle(document.activeElement).outlineStyle'), 'none');
      assert.equal(
        await run(
          'getComputedStyle(document.querySelector(".kb-source-pane .cm-focused"), "::after").borderInlineStartWidth',
        ),
        '1px',
      );
      const scroll = await run(
        '(()=>{const s=document.querySelector(".kb-source-pane .cm-scroller");s.scrollTop=s.scrollHeight;return s.scrollTop})()',
      );
      if (title === '团队术语表') assert.ok(scroll > 50, 'Glossary scrolls through multiple sections');
      const focus = await run('document.getSelection().focusOffset');
      await viewMode('预览');
      await until('document.querySelector(".kb-live-preview")?.innerText.length>0');
      if (title === '订单服务发布指南')
        await until('!!document.querySelector(".kb-live-preview pre code span")');
      await viewMode('编辑');
      assert.ok(
        Math.abs((await run('document.querySelector(".kb-source-pane .cm-scroller").scrollTop')) - scroll) <
          4,
        'Preview preserves the source scroll position',
      );
      await run('document.querySelector(' + q(source) + ').focus()');
      assert.equal(
        await run('document.getSelection().focusOffset'),
        focus,
        'Preview preserves the selection',
      );
      await click('.kb-writing-bar', '知识库');
      await until('!!document.querySelector(".kb-drafts")');
      wc.reload();
      await until('!!document.querySelector(".kb-drafts")');
      await click('.kb-drafts', title + ' · 继续写作');
      await until('!!document.querySelector(' + q(source) + ')');
      assert.equal(await run('document.querySelector(".kb-title-input").value'), title);
    }
    async function finish(title) {
      await click('.kb-writing-bar', '保存');
      await until('document.querySelector(".kb-save-state")?.textContent.includes("已保存")');
      await click('.kb-writing-bar', '完成编辑');
      await until('document.querySelector(".kb-reader h2")?.textContent===' + q(title));
      const hash = await run('location.hash');
      await click('.kb-actions', '编辑文档');
      await until('!!document.querySelector(' + q(source) + ')');
      assert.equal(await run('document.querySelector(".kb-title-input").value'), title);
      await click('.kb-writing-bar', '完成编辑');
      await until('document.querySelector(".kb-reader h2")?.textContent===' + q(title));
      return hash;
    }
    window.show();
    window.focus();
    wc.focus();
    window.setContentSize(narrow ? 390 : 1440, narrow ? 800 : 900);
    await library();
    const folder = (narrow ? '窄屏验收' : '桌面验收') + '/基础知识';
    await run('document.querySelector("button[aria-label=新建目录]").click()');
    await field('input[aria-label=目录路径]', folder);
    await click('.kb-folder-form', '创建目录');
    await until('document.querySelector("select[aria-label=筛选目录]").value===' + q('/' + folder));
    await click('.kb-header', '新建文档');
    await until('!!document.querySelector(' + q(source) + ')');
    assert.equal(await run('!!document.querySelector("dialog[open]")'), false);
    assert.equal(
      await run(
        'JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith(location.hash.split("%3A").at(-1))))).form.body',
      ),
      '',
    );
    await field('.kb-title-input', '团队术语表');
    const glossary =
      '## 内网术语\n\n发布窗口是允许部署变更的时段。\n\n## 服务术语\n\n探活用于确认服务可用。' +
      [
        ['回退', '发布失败时恢复到上一个可用版本。'],
        ['灰度发布', '先让部分请求进入新版本，观察通过后逐步放量。'],
        ['健康检查', '按约定的路径或端口探测服务。'],
        ['上游服务', '接收网关转发请求的应用。'],
        ['制品', '构建后可部署的文件。'],
        ['发布窗口', '团队约定的变更时间段。'],
        ['值班交接', '记录未完成的操作、风险和负责人。'],
        ['基线', '用于对比发布前后状态的观测值。'],
        ['观察期', '发布后持续跟踪错误率和响应时间的时段。'],
        ['验收记录', '记录验证时间、结果和执行人。'],
      ]
        .map(([term, definition]) => '\n\n### ' + term + '\n\n' + definition)
        .join('');
    await write(glossary);
    await click('.kb-writing-tools', '文档属性');
    assert.equal(await run("document.querySelector('.kb-properties input[list=kb-folders]').value"), folder);
    await click('.kb-writing-tools', '文档属性');
    const shape = await run(
      '(()=>{const r=document.querySelector(".kb-source-pane").getBoundingClientRect();return {height:r.height,width:r.width,viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth}})()',
    );
    assert.ok(shape.height > (narrow ? 285 : 400) && !shape.overflow, JSON.stringify(shape));
    if (!narrow) {
      await viewMode('分栏');
      await until('!!document.querySelector(".kb-live-preview h2")');
      await viewMode('编辑');
    }
    await until('document.querySelector(".kb-source-pane .cm-line span") !== null');
    await snapshot('writing');
    await previewAndResume('团队术语表');
    const glossaryHash = await finish('团队术语表');
    await select('select[aria-label=从模板新建]', '部署手册');
    await until('document.querySelector(".kb-source-pane")?.innerText.includes("回退")');
    await field('.kb-title-input', '订单服务发布指南');
    await run('document.querySelector(' + q(source) + ').focus()');
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'End', modifiers: ['control'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'End', modifiers: ['control'] });
    await write(
      '\n恢复上一版订单制品并复核探活。\n\n## 网关配置示例\n\n```nginx\nlocation /orders/ { proxy_pass http://orders; }\n```\n\n本次发布验证使用以下资源：\n',
    );
    await click('.kb-writing-tools', '插入资源');
    for (const kind of ['后端服务', 'Nginx 实例', '监控项']) await labelClick('.kb-filters', kind);
    await field('.kb-resource-dialog input[type=search]', '应用');
    await labelClick('.kb-choices', '应用 A');
    await labelClick('.kb-choices', '应用 B');
    await field('.kb-resource-dialog input[type=search]', '网关');
    await labelClick('.kb-choices', '网关');
    await field('.kb-resource-dialog input[type=search]', '订单健康');
    await labelClick('.kb-choices', '订单健康检查');
    await labelClick('.kb-filters', '后端服务');
    await until('document.querySelector(".kb-selected strong")?.textContent==="已选 4 项"');
    await snapshot('resources');
    await click('.kb-resource-dialog', '插入 4 项');
    await until('document.querySelector(".kb-source-pane")?.innerText.includes("订单健康检查")');
    await click('.kb-writing-tools', '插入资源');
    await field('.kb-resource-dialog input[type=search]', '术语表');
    await until(
      '[...document.querySelectorAll(".kb-choices label")].some(l=>l.innerText.includes(' + q(folder) + '))',
    );
    await run(
      '(()=>{const choices=[...document.querySelectorAll(".kb-choices label")];const l=choices.find(l=>l.innerText.includes(' +
        q(folder) +
        '));if(!l)throw Error("Missing glossary in selected folder");l.querySelector("input").click()})()',
    );
    await click('.kb-resource-dialog', '插入 1 项');
    await previewAndResume('订单服务发布指南');
    const guideHash = await finish('订单服务发布指南');
    stored.push({ guideHash, glossaryHash });
    for (const [kind, count] of [
      ['jar', 2],
      ['nginx', 1],
      ['monitor', 1],
      ['knowledge', 1],
    ])
      assert.equal(
        await run(
          'document.querySelectorAll(' + q('.kb-reader .kb-prose a[href^="#' + kind + '/"]') + ').length',
        ),
        count,
      );
    if (window === desktop) {
      assert.match(await run('document.querySelector(".app-statusbar").textContent'), /写作草稿保存在本机/);
      await run('document.querySelector(".kb-reader .resource-copy button").click()');
      await until('document.querySelector(".kb-reader .resource-copy button").textContent !== "复制链接"');
    }
    await run('document.querySelector(\'.kb-reader .kb-prose a[href^="#knowledge/"]\').click()');
    await until(
      'location.hash===' +
        q(glossaryHash) +
        ' && document.querySelector(".kb-backlinks")?.textContent.includes("订单服务发布指南")',
    );
    assert.equal(await run('document.querySelector(".kb-reader .resource-copy button").textContent'), '复制链接');
    await field('input[aria-label=知识库全文搜索]', '确认服务可用');
    await until('document.querySelector(".kb-card small")?.textContent.includes("确认服务可用")');
    await run('document.querySelector(".kb-card").click()');
    await until('!!document.querySelector(".kb-location")');
    await run('document.querySelector(".kb-toc").open=true');
    await click('.kb-toc', '服务术语');
    await until(
      'location.hash.includes("~h") && document.querySelector(".kb-location")?.textContent==="服务术语"',
    );
    await require('./focus-smoke.cjs')(wc, wait, output, narrow);
    console.log(
      (narrow ? '390px shared browser' : '1440px desktop') +
        ' wrote, previewed, resumed after reload, saved and reopened both articles; confirmed cross-module batch, backlinks, search and section navigation. Editor dimensions ' +
        JSON.stringify(shape),
    );
  }
  await exercise(desktop, false);
  await exercise(portal, true);
  async function conflictClient(win, note) {
    const wc = win.webContents,
      run = (s) => wc.executeJavaScript(s, true);
    const button = (label) =>
      '[...document.querySelectorAll("button")].find(b=>b.getClientRects().length && b.textContent.trim()===' +
      JSON.stringify(label) +
      ')';
    await run('location.hash=' + JSON.stringify(stored[0].glossaryHash));
    await wait(wc, '!!(' + button('编辑文档') + ')');
    await run('(' + button('编辑文档') + ').click()');
    await wait(wc, '!!document.querySelector(".kb-source-pane .cm-content")');
    win.focus();
    wc.focus();
    await run('document.querySelector(".kb-source-pane .cm-content").focus()');
    await wc.insertText(note + '\n\n');
    return {
      run,
      wc,
      click: (label) => run('(' + button(label) + ').click()'),
      save: () =>
        run('window.dispatchEvent(new KeyboardEvent("keydown",{key:"s",ctrlKey:true,cancelable:true}))'),
    };
  }
  const author = await conflictClient(desktop, '桌面修订发布窗口'),
    peer = await conflictClient(portal, '共享端修订探活');
  await author.save();
  await wait(author.wc, 'document.querySelector(".kb-save-state")?.textContent.includes("已保存 · v2")');
  await peer.save();
  await wait(peer.wc, 'document.querySelector(".kb-conflict pre")?.textContent.includes("桌面修订发布窗口")');
  assert.ok(await peer.run('document.querySelector(".kb-source-pane").innerText.includes("共享端修订探活")'));
  await peer.click('另存副本');
  await wait(peer.wc, 'document.querySelector(".kb-title-input")?.value==="团队术语表（副本）"');
  await peer.click('完成编辑');
  await wait(peer.wc, 'document.querySelector(".kb-reader h2")?.textContent==="团队术语表（副本）"');
  await author.click('完成编辑');
  await wait(
    author.wc,
    'document.querySelector(".kb-reader .kb-prose")?.textContent.includes("桌面修订发布窗口")',
  );
  console.log(
    'Concurrent editing preserved the original revision and the separately saved shared-browser draft.',
  );
  for (const kind of ['jar', 'nginx']) {
    const wc = portal.webContents,
      run = (s) => wc.executeJavaScript(s, true);
    await run('location.hash=' + JSON.stringify(stored[1].guideHash));
    await wait(wc, 'document.querySelector(".kb-reader h2")?.textContent==="订单服务发布指南"');
    await run('document.querySelector(\'.kb-reader .kb-prose a[href^="#' + kind + '/"]\').click()');
    const root = kind === 'jar' ? '.jar-instance[data-linked=true]' : '.ng-detail';
    await wait(wc, '!!document.querySelector(' + JSON.stringify(root) + ')');
    if (kind === 'jar')
      await run('document.querySelector(".jar-instance[data-linked=true] details").open=true');
    await run(
      '[...document.querySelectorAll(' +
        JSON.stringify(root + ' button') +
        ')].find(b=>b.textContent==="关联手册").click()',
    );
    await wait(
      wc,
      'location.hash.includes("related") && document.querySelector(".kb-header .run-button")?.disabled===false',
    );
    await run('document.querySelector(".kb-header .run-button").click()');
    await wait(wc, 'document.querySelector(".kb-source-pane")?.innerText.includes("共享主机")');
    assert.ok(
      await run(
        'document.querySelector(".kb-source-pane").innerText.includes(' +
          JSON.stringify(kind === 'jar' ? '应用 A' : '网关') +
          ')',
      ),
    );
  }
  const reader = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: 'kb-reader-' + Date.now(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  try {
    const wc = reader.webContents,
      run = (s) => wc.executeJavaScript(s, true);
    const address = new URL(portal.webContents.getURL());
    address.hash = stored[1].guideHash;
    await reader.loadURL(address.toString());
    await wait(wc, '!!document.querySelector(".portal-login input[autocomplete=username]")');
    await run(`(()=>{
      for(const [selector,value] of [['input[autocomplete=username]','知识库读者'],['input[type=password]','knowledge-reader-only']]){
        const e=document.querySelector('.portal-login '+selector);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);
        e.dispatchEvent(new Event('input',{bubbles:true}));
      }
    })()`);
    await wait(wc, 'document.querySelector(".portal-login .run-button")?.disabled===false');
    await run('document.querySelector(".portal-login .run-button").click()');
    await wait(wc, 'document.querySelector(".kb-reader h2")?.textContent==="订单服务发布指南"');
    assert.equal(
      await run(
        '!!document.querySelector(".kb-header .run-button") || [...document.querySelectorAll(".kb-actions button")].some(b=>b.textContent.includes("编辑文档"))',
      ),
      false,
    );
  } finally {
    reader.destroy();
  }
};
