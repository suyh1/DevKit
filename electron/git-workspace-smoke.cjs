const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { BrowserWindow, dialog } = require('electron');

module.exports = async function gitSmoke(window, installation, output) {
  const repo = path.join(installation, 'Atlas');
  await fs.mkdir(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, windowsHide: true, stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.name', 'DevKit Test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  await fs.writeFile(path.join(repo, 'README.md'), '# Atlas\n');
  git('add', 'README.md');
  git('commit', '-m', '创建项目说明');
  await fs.writeFile(path.join(repo, 'README.md'), '# Atlas\nReviewed change\n');
  const remote = path.join(installation, 'atlas-origin.git');
  git('init', '--bare', '-b', 'main', remote);
  git('remote', 'add', 'origin', remote);
  const originalPicker = dialog.showOpenDialog;
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [repo] });
  const desktop = (code) => window.webContents.executeJavaScript(code, true);
  const wait = async (execute, expression) => {
    for (let attempt = 0; attempt < 160; attempt++) {
      if (await execute('Boolean(' + expression + ')')) return;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    throw new Error(
      'Git UI condition failed: ' + expression + '\n' + (await execute('document.body.innerText')).slice(-1500),
    );
  };
  const click = async (execute, selector) => {
    const element = 'document.querySelector(' + JSON.stringify(selector) + ')';
    await wait(execute, element + ' && !' + element + '.disabled');
    await execute(element + '.click()');
  };
  const chooseText = async (execute, label) => {
    const target =
      '[...document.querySelectorAll(".git-workspace button")].find(b => b.textContent.trim() === ' +
      JSON.stringify(label) +
      ')';
    await wait(execute, target);
    await execute(target + '.click()');
  };
  // Read computed styles in the same renderer used by desktop and shared browsers.
  async function checkAppearance(execute, contents, surface, shot) {
    const original = await execute('({...document.documentElement.dataset})');
    const backgrounds = new Set();
    try {
      for (const style of ['default', 'editorial']) {
        for (const theme of ['light', 'dark']) {
          const sample = await execute(`(async () => {
            Object.assign(document.documentElement.dataset, {theme: ${JSON.stringify(theme)}, themeStyle: ${JSON.stringify(style)}});
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            await Promise.allSettled(document.getAnimations().filter(a => a instanceof CSSTransition).map(a => a.finished));
            const page = document.querySelector('.git-workspace');
            const panel = page.querySelector(${JSON.stringify(surface)});
            const css = getComputedStyle(panel);
            const probe = document.createElement('span');
            panel.append(probe);
            const color = token => {
              probe.style.color = 'var(--' + token + ')';
              return getComputedStyle(probe).color;
            };
            const sample = {
              background: css.backgroundImage,
              textMatches: css.color === color('text'),
              accentMatches: getComputedStyle(page.querySelector('.git-heading svg')).color === color('accent'),
              titleSize: parseFloat(getComputedStyle(page.querySelector('h1')).fontSize),
              branchSize: parseFloat(getComputedStyle(panel.querySelector('h2')).fontSize),
              bodySize: parseFloat(getComputedStyle(page).fontSize),
            };
            probe.remove();
            return sample;
          })()`);
          assert.ok(sample.textMatches && sample.accentMatches, style + '/' + theme + ' palette');
          assert.ok(sample.titleSize <= 22 && sample.branchSize <= 18 && sample.bodySize <= 13);
          backgrounds.add(sample.background);
          if (shot && style === 'default') {
            await fs.writeFile(path.join(output, shot + '-' + theme + '.png'), (await contents.capturePage()).toPNG());
          }
        }
      }
      assert.equal(backgrounds.size, 4, 'Git panel follows both palette and brightness');
    } finally {
      await execute('void Object.assign(document.documentElement.dataset, ' + JSON.stringify(original) + ')');
    }
  }
  async function checkTextarea(execute) {
    const sizes = await execute(`(async () => {
      const field = document.querySelector('#git-message');
      const measure = async value => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(resolve => requestAnimationFrame(resolve));
        return field.clientHeight;
      };
      const initial = await measure('');
      const medium = await measure('line\\n'.repeat(5));
      const full = await measure('long line\\n'.repeat(150));
      field.scrollTop = field.scrollHeight;
      const scrolls = field.scrollTop > 0;
      const capped = full === await measure('long line\\n'.repeat(250));
      const reset = await measure('');
      return { initial, medium, full, capped, scrolls, reset, resize: getComputedStyle(field).resize };
    })()`);
    assert.equal(sizes.resize, 'none');
    assert.ok(sizes.medium > sizes.initial && sizes.full > sizes.medium && sizes.capped && sizes.scrolls, JSON.stringify(sizes));
    assert.equal(sizes.initial, sizes.reset);
  }
  let browser;
  try {
    await require('./navigation-helpers.cjs')(window).openWorkspace('Git 仓库管理');
    await wait(desktop, 'document.querySelector(".git-empty h2")');
    await checkAppearance(desktop, window.webContents, '.git-empty');
    const top = execute => execute('document.querySelector(".git-heading").getBoundingClientRect().height');
    const beforeClone = await top(desktop);
    await chooseText(desktop, '克隆仓库');
    await wait(desktop, 'document.querySelector(".git-clone-dialog:modal input")');
    assert.equal(await top(desktop), beforeClone);
    await click(desktop, '.git-clone-dialog [aria-label="关闭克隆仓库"]');
    await chooseText(desktop, '选择工作目录');
    await wait(desktop, 'document.querySelector(".git-diff")?.textContent.includes("+Reviewed change")');
    const text = await desktop('document.querySelector(".git-hero h2").textContent');
    assert.equal(text, 'main');
    await checkTextarea(desktop);
    await checkAppearance(desktop, window.webContents, '.git-hero', 'git-workspace');
    await fs.writeFile(path.join(output, 'git-desktop.png'), (await window.webContents.capturePage()).toPNG());
    await click(desktop, '.git-review-tools button[aria-label="暂存 README.md"]');
    await wait(desktop, '!!document.querySelector(".git-review-tools button[aria-label=\\"取消暂存 README.md\\"]")');
    await desktop(
      '(()=>{const field=document.querySelector("#git-message"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(field,"网页审阅样本"); field.dispatchEvent(new Event("input",{bubbles:true}));})()',
    );
    const editorTop = () => desktop('document.querySelector("#git-message").getBoundingClientRect().top');
    const beforePreview = await editorTop();
    await click(desktop, '.git-staged-menu > button');
    await wait(desktop, 'document.querySelector(".git-staged-menu :popover-open")?.textContent.includes("README.md")');
    assert.equal(await editorTop(), beforePreview);
    await click(desktop, '.git-staged-menu .action-popover button');
    await click(desktop, '.git-submit-next');
    await wait(desktop, 'document.querySelector(".git-hero-main p")?.textContent.includes("网页审阅样本")');
    await wait(desktop, 'document.querySelector(".git-push-preview ul")?.textContent.includes("网页审阅样本")');
    await desktop('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await checkAppearance(desktop, window.webContents, '.git-hero', 'git-push');
    assert.equal(await editorTop(), beforePreview, 'preview keeps the commit editor in place');
    await fs.writeFile(path.join(output, 'git-push-preview.png'), (await window.webContents.capturePage()).toPNG());
    await click(desktop, '.git-push-preview .run-button');
    await wait(desktop, 'document.querySelector(".notice-stack")?.textContent.includes("origin/main")');
    assert.equal(git('rev-parse', '--abbrev-ref', '@{u}').toString().trim(), 'origin/main');
    const beforePublish = await editorTop();
    await chooseText(desktop, '发布到网页');
    await click(desktop, '.confirm-dialog[open] .confirm-discard');
    await wait(desktop, 'document.querySelector(".git-repo-bar")?.textContent.includes("撤下共享")');

    assert.equal(await desktop('document.body.innerText.includes("发布仓库完成")'), false);
    assert.equal(await editorTop(), beforePublish);
    const socket = net.createServer();
    await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const { emptySharingServices } = await import('../shared/sharing.mjs');
    const services = emptySharingServices();
    services.git.enabled = true;
    const start = await desktop(
      'window.devkitProjects.request("start",' +
        JSON.stringify({ host: '127.0.0.1', port, password: 'git-smoke-only', services }) +
        ')',
    );
    assert.equal(start.error, undefined);
    browser = new BrowserWindow({
      show: false,
      width: 405,
      height: 830,
      webPreferences: { sandbox: true, offscreen: true, backgroundThrottling: false, partition: 'git-' + Date.now() },
    });
    const web = (code) => browser.webContents.executeJavaScript(code, true);
    const address = 'http://127.0.0.1:' + port + '/#git';
    await browser.loadURL(address);
    const post = (action, payload) =>
      'fetch(' +
      JSON.stringify('/api/' + action) +
      ',{method:"POST",headers:{"Content-Type":"application/json"},body:' +
      JSON.stringify(JSON.stringify(payload)) +
      '})';
    assert.equal(await web(post('git/list', {}) + '.then(r=>r.status)'), 401);
    await wait(web, 'document.querySelector(".portal-login input[type=password]")');
    await web(
      '(()=>{const field=document.querySelector(".portal-login input[type=password]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(field,"git-smoke-only"); field.dispatchEvent(new Event("input",{bubbles:true}));})()',
    );
    await click(web, '.portal-login button[type=submit]');
    await wait(web, 'document.querySelector(".git-hero h2")?.textContent === "main"');
    assert.equal(await web('!!document.querySelector(".git-compose")'), false);
    await click(web, '.git-workspace button[aria-label="提交历史"]');
    await wait(web, 'document.querySelector(".git-diff")?.textContent.includes("+Reviewed change")');
    assert.equal(await web('document.querySelectorAll(".git-commit-row").length'), 2);
    await checkAppearance(web, browser.webContents, '.git-hero', 'git-portal');
    assert.equal(await web('document.documentElement.scrollWidth <= window.innerWidth'), true);
    const [published] = await web(post('git/list', {}) + '.then(r=>r.json())');
    assert.equal(published.root, undefined);
    assert.equal(published.access.worktree, false);
    assert.equal(await web(post('git/review', { id: published.id, path: 'README.md' }) + '.then(r=>r.status)'), 403);
    assert.equal(await web(post('git/stage', { id: published.id, path: 'README.md' }) + '.then(r=>r.status)'), 403);
    await web('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await fs.writeFile(path.join(output, 'git-portal-mobile.png'), (await browser.webContents.capturePage()).toPNG());
    // Restart with editor access and use a fresh session to exercise the HTTP write path.
    await desktop('window.devkitProjects.request("stop")');
    const grants = '.git-repo-bar button[aria-haspopup="dialog"]';
    await desktop('document.querySelector(' + JSON.stringify(grants) + ').focus()');
    await click(desktop, grants);
    await wait(desktop, 'document.querySelector(".git-grants-dialog:modal")');
    await wait(desktop, 'document.querySelector(".git-grants-dialog")?.innerText.includes("在局域网共享设置中")');
    await desktop('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await desktop('Promise.allSettled(document.querySelector(".git-grants-dialog").getAnimations({subtree:true}).map(animation => animation.finished)).then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
    await fs.writeFile(path.join(output, 'git-repository-permissions.png'), (await window.webContents.capturePage()).toPNG());
    await desktop('document.querySelector("#git-default-grant").value="none"; document.querySelector("#git-default-grant").dispatchEvent(new Event("change",{bubbles:true}))');
    await click(desktop, '.git-grants-dialog [aria-label="关闭仓库访问权限"]');
    await chooseText(desktop, '放弃更改');
    await wait(desktop, '!document.querySelector(".git-grants-dialog")');
    assert.equal(await desktop('document.activeElement.matches(' + JSON.stringify(grants) + ')'), true);
    await click(desktop, grants);
    await wait(desktop, 'document.querySelector("#git-default-grant")?.value === "history"');
    await desktop(
      '(()=>{const field=document.querySelector("select[aria-label=默认仓库权限]");field.value="collaborate";field.dispatchEvent(new Event("change",{bubbles:true}));})()',
    );
    await chooseText(desktop, '保存仓库权限');
    await wait(desktop, 'document.body.innerText.includes("仓库授权已保存")');
    services.git.edit = true;
    const restart = await desktop(
      'window.devkitProjects.request("start",' + JSON.stringify({ host: '127.0.0.1', port, services }) + ')',
    );
    assert.equal(restart.error, undefined);
    await browser.loadURL('about:blank');
    await fs.writeFile(path.join(repo, 'review.txt'), 'Browser editor\n');
    await browser.loadURL(address);
    await wait(web, 'document.querySelector(".portal-login input[type=password]")');
    // Exercise browsers that do not implement native content sizing on the portal.
    await web(`(() => {
      const supports = CSS.supports.bind(CSS);
      CSS.supports = (...args) => args[0] === 'field-sizing' ? false : supports(...args);
      const style = document.createElement('style');
      style.textContent = 'textarea { field-sizing: fixed !important }';
      document.head.append(style);
    })()`);
    await web(
      '(()=>{const field=document.querySelector(".portal-login input[type=password]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(field,"git-smoke-only"); field.dispatchEvent(new Event("input",{bubbles:true}));})()',
    );
    await click(web, '.portal-login button[type=submit]');
    await wait(web, 'document.querySelector("#git-message")');
    await checkTextarea(web);
    await click(web, '.git-review-tools button[aria-label="暂存 review.txt"]');
    await wait(web, 'document.querySelector(".git-review-tools button[aria-label=\\"取消暂存 review.txt\\"]")');
    assert.equal(git('diff', '--cached', '--name-only').toString().trim(), 'review.txt');
    await click(web, '.git-workspace button[aria-label="贮藏"]');
    await chooseText(web, '贮藏当前改动');
    await click(web, '.confirm-dialog[open] .confirm-discard');
    await wait(web, 'document.querySelector(".git-diff")?.textContent.includes("+Browser editor")');
    assert.equal(git('status', '--porcelain').toString().trim(), '');
    const cloneParent = path.join(installation, 'clone-parent');
    await fs.mkdir(cloneParent);
    dialog.showOpenDialog = async () => ({ canceled:false, filePaths:[cloneParent] });
    await chooseText(desktop, '克隆仓库');
    await wait(desktop, 'document.querySelector(".git-clone-dialog:modal input")');
    await desktop('(()=>{const input=document.querySelector(".git-clone-dialog input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,' + JSON.stringify(remote) + ');input.dispatchEvent(new Event("input",{bubbles:true}));})()');
    await chooseText(desktop, '选择父目录');
    await wait(desktop, 'document.querySelector(".git-clone-dialog .pc-field button")?.textContent.includes("clone-parent")');
    await desktop('Promise.allSettled(document.querySelector(".git-clone-dialog").getAnimations({subtree:true}).map(a=>a.finished)).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
    await fs.writeFile(path.join(output, 'git-clone-dialog.png'), (await window.webContents.capturePage()).toPNG());
    assert.ok(await desktop('(()=>{const body=document.querySelector(".git-clone-dialog .pc-modal-body");return body.scrollWidth <= body.clientWidth + 1})()'));
    await chooseText(desktop, '克隆并登记');
    await wait(desktop, '!document.querySelector(".git-clone-dialog") && document.querySelector(".git-repo-bar select")?.selectedOptions[0]?.textContent.includes("atlas-origin")');
    assert.match(await fs.readFile(path.join(cloneParent,'atlas-origin','README.md'),'utf8'), /Reviewed change/);
    console.log('Git desktop workflow, mobile review, visitor permissions, web staging and stash passed.');
  } finally {
    dialog.showOpenDialog = originalPicker;
    browser?.destroy();
    await desktop('window.devkitProjects.request("stop")');
  }
};
