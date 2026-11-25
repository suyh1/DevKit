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
  git('switch', '-c', 'feature/guide');
  await fs.writeFile(path.join(repo, 'guide.md'), '# Guide\n');
  git('add', 'guide.md');
  git('commit', '-m', '补充使用指南');
  git('tag', '-a', 'guide-v1', '-m', 'Guide published');
  git('switch', 'main');
  git('merge', '--no-ff', 'feature/guide', '-m', '合并使用指南');
  await fs.writeFile(path.join(repo, 'README.md'), '# Atlas\nReviewed change\n');
  await fs.writeFile(path.join(repo, 'one.txt'), 'Selected\n');
  await fs.writeFile(path.join(repo, 'two.txt'), 'For later\n');
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
    await click(execute, '.git-open-commit');
    await wait(execute, 'document.activeElement.id === "git-message"');
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
    await click(execute, '[aria-label="关闭提交窗口"]');
  }
  let browser;
  const throttled = window.webContents.getBackgroundThrottling();
  window.webContents.setBackgroundThrottling(false);
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
    await click(desktop, '.git-file-row [aria-label="暂存 README.md"]');
    await click(desktop, '.git-file-row [aria-label="取消暂存 README.md"]');
    await wait(desktop, `document.querySelector('.git-file-group[aria-label="未暂存"] .git-batch-action')?.textContent.includes("（3）")`);
    const beforeSmartCommit = git('rev-parse', 'HEAD').toString().trim();
    await click(desktop, '.git-file-group[aria-label="未暂存"] .git-batch-action');
    await wait(desktop, `document.querySelector('.git-file-group[aria-label="已暂存"] .git-batch-action')?.textContent.includes("（3）")`);
    await click(desktop, '.git-file-group[aria-label="已暂存"] .git-batch-action');
    await wait(desktop, `document.querySelector('.git-file-group[aria-label="未暂存"] .git-batch-action')?.textContent.includes("（3）")`);
    await click(desktop, '.git-open-commit');
    const setCommitMessage = async (value) => desktop(`(() => {
      const field = document.querySelector('#git-message');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(value)});
      field.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await setCommitMessage('临时提交');
    await click(desktop, '.git-commit-dialog button[type="submit"]');
    await click(desktop, '.confirm-dialog[open] .confirm-cancel');
    assert.equal(git('rev-parse', 'HEAD').toString().trim(), beforeSmartCommit);
    await click(desktop, '.git-commit-dialog button[type="submit"]');
    await click(desktop, '.confirm-dialog[open] .confirm-discard');
    await wait(desktop, 'document.querySelector(".git-hero-main p")?.textContent.includes("临时提交")');
    await click(desktop, '.git-open-commit');
    await click(desktop, '.git-amend-choice input');
    await wait(desktop, 'document.querySelector("#git-message")?.value === "临时提交"');
    await setCommitMessage('补充说明');
    await click(desktop, '.git-commit-dialog button[type="submit"]');
    await wait(desktop, 'document.querySelector(".git-hero-main p")?.textContent.includes("补充说明")');
    await click(desktop, '.git-open-commit');
    await chooseText(desktop, '撤销上次提交…');
    await click(desktop, '.confirm-dialog[open] .confirm-discard');
    await wait(desktop, 'document.querySelector("#git-message")?.value === "补充说明"');
    assert.equal(git('rev-parse', 'HEAD').toString().trim(), beforeSmartCommit);
    await click(desktop, '[aria-label="关闭提交窗口"]');
    await click(desktop, '.git-file-group[aria-label="已暂存"] .git-batch-action');
    await wait(desktop, `document.querySelector('.git-file-group[aria-label="未暂存"] .git-batch-action')?.textContent.includes("（3）")`);
    const filterFiles = value => desktop(`(() => {
      const field = document.querySelector('.git-filter');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, ${JSON.stringify(value)});
      field.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await fs.writeFile(path.join(repo, 'discard-a.txt'), 'A');
    await fs.writeFile(path.join(repo, 'discard-b.txt'), 'B');
    await click(desktop, '[aria-label="刷新仓库"]');
    await filterFiles('discard-');
    await click(desktop, '[aria-label="放弃更改 discard-a.txt"]');
    await click(desktop, 'dialog[open] [data-modal-focus]');
    assert.equal(await fs.readFile(path.join(repo, 'discard-a.txt'), 'utf8'), 'A');
    await click(desktop, '[aria-label="放弃匹配文件（2）"]');
    await wait(desktop, 'document.querySelector("dialog[open] .pc-modal-body")?.textContent.includes("2 个未跟踪文件")');
    await click(desktop, 'dialog[open] .run-button');
    await wait(desktop, 'document.querySelector(".git-files-panel")?.textContent.includes("没有匹配的文件")');
    await assert.rejects(fs.stat(path.join(repo, 'discard-a.txt')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(repo, 'discard-b.txt')), { code: 'ENOENT' });
    await filterFiles('one.txt');
    await click(desktop, '[aria-label="全选本页未暂存文件"]');
    await chooseText(desktop, '暂存所选（1）');
    await wait(desktop, 'document.querySelector(\'.git-file-row [aria-label="取消暂存 one.txt"]\')');
    assert.equal(git('diff', '--cached', '--name-only').toString().trim(), 'one.txt');
    await click(desktop, '[aria-label="全选本页已暂存文件"]');
    await chooseText(desktop, '取消暂存所选（1）');
    await wait(desktop, 'document.querySelector(\'.git-file-row [aria-label="暂存 one.txt"]\')');
    await filterFiles('');
    await click(desktop, '[aria-label="选择未暂存文件 README.md"]');
    await click(desktop, '[aria-label="选择未暂存文件 one.txt"]');
    await chooseText(desktop, '暂存所选（2）');
    await wait(desktop, 'document.querySelector(\'.git-file-row [aria-label="取消暂存 one.txt"]\')');
    assert.deepEqual(git('diff', '--cached', '--name-only').toString().trim().split(/\r?\n/), ['README.md', 'one.txt']);
    await click(desktop, '.git-open-commit');
    await desktop(
      '(()=>{const field=document.querySelector("#git-message"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(field,"网页审阅样本"); field.dispatchEvent(new Event("input",{bubbles:true}));})()',
    );
    const actionTop = () => desktop('document.querySelector(".git-open-commit").getBoundingClientRect().top');
    await click(desktop, '.git-review-staged');
    await wait(desktop, 'document.activeElement.matches(\'.git-file-group[aria-label="已暂存"] h4\')');
    await click(desktop, '.git-open-commit');
    await wait(desktop, 'document.querySelector("#git-message")?.value === "网页审阅样本"');
    await click(desktop, '.git-submit-next');
    await wait(desktop, 'document.querySelector(".git-hero-main p")?.textContent.includes("网页审阅样本")');
    await wait(desktop, 'document.querySelector(".git-push-preview ul")?.textContent.includes("网页审阅样本")');
    await desktop('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await checkAppearance(desktop, window.webContents, '.git-hero', 'git-push');
    assert.equal(git('ls-tree', '--name-only', 'HEAD', '--', 'two.txt').toString(), '');
    await fs.writeFile(path.join(output, 'git-push-preview.png'), (await window.webContents.capturePage()).toPNG());
    await click(desktop, '.git-push-preview .run-button');
    await wait(desktop, 'document.querySelector(".notice-stack")?.textContent.includes("origin/main")');
    assert.equal(git('rev-parse', '--abbrev-ref', '@{u}').toString().trim(), 'origin/main');
    await click(desktop, '.git-workspace button[aria-label="提交历史"]');
    await wait(desktop, 'document.querySelector(".git-selected-commit")?.textContent.includes("HEAD")');
    await wait(desktop, 'document.querySelector(".git-graph-scroll")?.textContent.includes("guide-v1")');
    await wait(desktop, 'document.querySelector(".git-selected-commit")?.textContent.includes("origin/main")');
    await wait(desktop, 'document.querySelector(".git-history-detail .git-diff")?.textContent.includes("+Reviewed change")');
    await fs.writeFile(path.join(output, 'git-commit-graph.png'), (await window.webContents.capturePage()).toPNG());
    await chooseText(desktop, '设为比较起点');
    await desktop('Array.from(document.querySelectorAll(".git-commit-row")).find(row => row.textContent.includes("补充使用指南")).click()');
    await wait(desktop, 'document.querySelector(".git-inspector h3, .git-inspector strong")?.textContent.includes("版本差异")');
    await wait(desktop, 'document.querySelector(".git-diff")?.textContent.includes("README.md")');
    await click(desktop, '.git-workspace button[aria-label="工作区"]');
    await wait(desktop, 'document.querySelector(".git-open-commit")');
    const beforePublish = await actionTop();
    await chooseText(desktop, '发布到网页');
    await click(desktop, '.confirm-dialog[open] .confirm-discard');
    await wait(desktop, 'document.querySelector(".git-repo-bar")?.textContent.includes("撤下共享")');

    assert.equal(await desktop('document.body.innerText.includes("发布仓库完成")'), false);
    assert.equal(await actionTop(), beforePublish);
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
    assert.equal(await web('!!document.querySelector(".git-open-commit, .git-push")'), false);
    await click(web, '.git-workspace button[aria-label="提交历史"]');
    await wait(web, 'document.querySelector(".git-diff")?.textContent.includes("+Reviewed change")');
    assert.equal(await web('document.querySelectorAll(".git-commit-row").length'), 4);
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
    services.git.sync = true;
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
    await wait(web, 'document.querySelector(".git-open-commit")');
    await checkTextarea(web);
    await click(web, '.git-file-row [aria-label="暂存 review.txt"]');
    await click(web, '.git-file-group[aria-label="已暂存"] .git-path[title="review.txt"]');
    await wait(web, 'document.querySelector(".git-review-tools button[aria-label=\\"取消暂存 review.txt\\"]")');
    assert.equal(git('diff', '--cached', '--name-only').toString().trim(), 'review.txt');
    await click(web, '.git-workspace button[aria-label="贮藏"]');
    await chooseText(web, '贮藏当前改动');
    await click(web, '.confirm-dialog[open] .confirm-discard');
    await wait(web, 'document.querySelector(".git-diff")?.textContent.includes("+Browser editor")');
    assert.equal(git('status', '--porcelain').toString().trim(), '');
    const bulk = path.join(repo, 'many-files');
    await fs.mkdir(bulk);
    for (let start = 0; start < 1000; start += 50) {
      await Promise.all(Array.from({ length: 50 }, (_, i) =>
        fs.writeFile(path.join(bulk, String(start + i).padStart(4, '0') + '.txt'), 'staged\n')));
    }
    git('add', '--', 'many-files');
    await fs.appendFile(path.join(repo, 'README.md'), 'long diff\n'.repeat(400));
    await chooseText(web, '工作区');
    for (const execute of [desktop, web]) {
      await click(execute, '[aria-label="刷新仓库"]');
      await wait(execute, 'document.querySelector(\'.git-file-group[aria-label="已暂存"] h4 small\')?.textContent === "1000"');
      await wait(execute, 'document.querySelector(".git-diff")?.textContent.includes("long diff")');
      const metrics = await execute(`(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect();
        const root = document.querySelector('.git-workspace').closest('.workspace, .portal-content');
        if (root) root.scrollTop = 0;
        const start = box('.git-working-layout').top;
        const accessible = selector => {
          const button = document.querySelector(selector), rect = button.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= innerHeight && button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        };
        const initiallyVisible = accessible('.git-open-commit') && accessible('.git-push');
        const offsets = ['.git-open-commit', '.git-push'].map(selector => Math.round(box(selector).top - start));
        const diff = document.querySelector('.git-diff');
        diff.scrollTop = diff.scrollHeight;
        diff.scrollIntoView({block:'end'});
        const afterReview = accessible('.git-open-commit') && accessible('.git-push');
        diff.scrollTop = 0;
        if (root) root.scrollTop = 0;
        return { width: innerWidth, height: innerHeight, fileRows: document.querySelectorAll('.git-file-row').length,
          bothVisible: initiallyVisible && afterReview,
          commit: offsets[0], push: offsets[1] };
      })()`);
      assert.ok(metrics.fileRows <= 51 && metrics.commit < 60 && metrics.push < 60 && metrics.bothVisible, JSON.stringify(metrics));
      console.log('Git 1000 staged files', metrics);
      const contents = (execute === desktop ? window : browser).webContents;
      await fs.writeFile(path.join(output, execute === desktop ? 'git-many-files-desktop.png' : 'git-many-files-mobile.png'),
        (await contents.capturePage()).toPNG());
      await execute("document.querySelector('.git-open-commit').focus()");
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      await wait(execute, "document.activeElement.matches('.git-push')");
      const group = '.git-file-group[aria-label="已暂存"] ';
      await click(execute, group + '[aria-label="选择已暂存文件 many-files/0000.txt"]');
      await click(execute, group + '[aria-label="下一页"]');
      await click(execute, group + '[aria-label="选择已暂存文件 many-files/0050.txt"]');
      await wait(execute, 'document.querySelector(' + JSON.stringify(group + '.git-batch-action') + ')?.textContent.includes("（2）")');
      await click(execute, group + '[aria-label="上一页"]');
      assert.equal(await execute('document.querySelector(' + JSON.stringify(group + '[aria-label="选择已暂存文件 many-files/0000.txt"]') + ').checked'), true);
      await click(execute, group + 'header input');
      await wait(execute, 'document.querySelector(' + JSON.stringify(group + '.git-batch-action') + ')?.textContent.includes("（51）")');
      await click(execute, group + '.git-file-page-tools .text-button');
      await wait(execute, 'document.querySelector(' + JSON.stringify(group + '.git-batch-action') + ')?.textContent.includes("（1000）")');
      await click(execute, '.git-open-commit');
      await wait(execute, 'document.activeElement.id === "git-message" && document.querySelector(".git-review-staged")?.textContent.includes("1000")');
      await click(execute, '[aria-label="关闭提交窗口"]');
    }
    git('restore', '--staged', '--', 'many-files');
    assert.equal(await fs.realpath(bulk), path.join(await fs.realpath(repo), 'many-files'));
    await fs.rm(bulk, { recursive: true });
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
    window.webContents.setBackgroundThrottling(throttled);
    dialog.showOpenDialog = originalPicker;
    browser?.destroy();
    await desktop('window.devkitProjects.request("stop")');
  }
};
