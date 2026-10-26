const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');

module.exports = async function featuresSmoke(window, output) {
  window.webContents.setBackgroundThrottling(false); window.show(); window.focus(); window.webContents.focus();
  const js = code => window.webContents.executeJavaScript(code, true);
  const wait = async expression => {
    for (let i = 0; i < 150; i++) { if (await js('Boolean(' + expression + ')')) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    await fs.writeFile(path.join(output, 'features-failure.png'), (await window.webContents.capturePage()).toPNG());
    throw new Error('Feature UI condition failed: ' + expression);
  };
  const click = async (text, root) => {
    const selector = `[...document.querySelectorAll(${JSON.stringify(root + ' button')})].find(button=>button.textContent.trim()===${JSON.stringify(text)}||(button.classList.contains('run-button')&&button.textContent.trim().startsWith(${JSON.stringify(text)})))`;
    await wait(`!!${selector}&&!${selector}.disabled`); await js(`${selector}.click()`);
  };
  const fill = async (selector, value) => {
    await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
    await js(`{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await js('new Promise(resolve=>requestAnimationFrame(resolve))');
  };
  const select = async (selector, value) => js(`{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));}`);
  const editor = async (selector, value) => {
    await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
    await js(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
    await js('new Promise(resolve=>requestAnimationFrame(resolve))'); await window.webContents.insertText(value);
    await wait(`document.querySelector(${JSON.stringify(selector)})?.textContent===${JSON.stringify(value)}`);
  };
  const snap = async name => { await js('new Promise(resolve=>setTimeout(resolve,240))'); await fs.writeFile(path.join(output, name + '.png'), (await window.webContents.capturePage()).toPNG()); };
  await js('document.documentElement.dataset.theme="light"');
  const size = window.getSize(), minimum = window.getMinimumSize(); window.setMinimumSize(360, 600); window.setSize(1440, 1000);
  const { openTool } = require('./navigation-helpers.cjs')(window);
  const pane = '.task-pane:not([hidden])';
  await openTool('文本与 JSON 差异');
  await select(`${pane} .field-mode select`, 'json'); await wait(`!!document.querySelector('${pane} .field-arrayKey')`);
  await click('示例', `${pane} .input-card`); await click('对比结构', pane);
  await wait(`document.querySelector('${pane} .json-diff-result')?.textContent.includes('9007199254740993')===false && document.querySelector('${pane} .status-success')`);
  assert.match(await js(`document.querySelector('${pane} .json-diff-result').textContent`), /name/);
  await snap('features-json-diff-light');
  await js(`document.querySelector('${pane}').closest('.workspace-stage').querySelector('.task-tabs')?.click()`);
  await js('[...document.querySelectorAll(".tab-close")].forEach(button=>button.click())');
  await openTool('批量 Mock 数据'); await click('示例', `${pane} .input-card`); await fill(`${pane} .field-rules input`, '{"id":"sequence","name":"name"}');
  await click('生成 Mock 数据', pane); await wait(`!!document.querySelector('${pane} .status-success')`);
  const mock = await js(`document.querySelector('${pane} .output-card .cm-content').textContent`); assert.match(mock, /1/); assert.match(mock, /[\u4e00-\u9fff]/);
  await snap('features-mock-light');
  await js('[...document.querySelectorAll(".tab-close")].forEach(button=>button.click())');

  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/slow')) return;
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    res.writeHead(201, { 'content-type': 'application/json', 'x-devkit-test': 'yes' }); res.end(JSON.stringify({ raw: Buffer.concat(chunks).toString(), method: req.method, token: req.headers.authorization }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await js('document.querySelector(\'.floating-nav-links [aria-label="HTTP 调试"]\').click()');
    await js(`[...document.querySelectorAll('.http-product-tabs button')].find(button=>button.textContent.trim()==='快速请求').click()`);
    await wait('!!document.querySelector(\'.http-workspace:not([hidden])\')');
    await click('配置 JSON', '.http-request');
    const config = JSON.stringify({ method: 'POST', url: base + '/echo?token=secret-test', headers: { Authorization: 'Bearer secret-test' } }).slice(0, -1) + ',"body":{"id":9007199254740993,"name":"中文"}}';
    await editor('.http-request .cm-content', config); await fill('input[aria-label="请求名称"]', '本地回显');
    await click('发送请求', '.http-main'); await wait('document.querySelector(".http-response")?.textContent.includes("201")');
    assert.ok(await js('document.querySelector(".http-response .cm-content").textContent.includes("9007199254740993")'));
    await click('保存请求', '.http-main'); await wait('document.querySelectorAll(".http-collection>div:not(.feature-toolbar)").length===1');
    assert.equal(await js('localStorage.getItem("devkit:http-collection").includes("secret-test")'), false);
    assert.equal(await js('localStorage.getItem("devkit:http-collection").includes("9007199254740993")'), false);
    await snap('features-http-light');
    for (const theme of ['light', 'dark']) {
      await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      for (const width of [1440, 390]) {
        window.setSize(width, 1000); await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true, `HTTP ${theme} ${width} overflow`);
        await snap(`features-http-${theme}-${width}`);
      }
    }
    window.setSize(1440, 1000); await js('document.documentElement.dataset.theme="light"');
    await js('document.querySelector(".http-sensitive input").click()'); await click('保存请求', '.http-main');
    assert.equal(await js('localStorage.getItem("devkit:http-collection").includes("secret-test")'), true);
    await editor('.http-request .cm-content', JSON.stringify({ url: base + '/slow' }));
    await click('发送请求', '.http-main'); await click('取消请求', '.http-main'); await wait('document.querySelector(".http-main .task-error")?.textContent.includes("取消")');
    await js('document.querySelector(".http-sensitive input").click()'); await click('保存请求', '.http-main');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

  const project = await js('window.devkitProjects.request("get")'); assert.equal(project.error, undefined);
  const data = project.data;
  const a = { id: 'feature-dev', name: '功能测试开发', description: '', variables: [{ key: 'host', value: 'localhost' }], projects: [] };
  const b = { id: 'feature-prod', name: '功能测试生产', description: '', variables: [{ key: 'host', value: 'example.com' }], projects: [] };
  const updated = await js(`window.devkitProjects.request('save',${JSON.stringify({ revision: data.revision, data: { ...data, profiles: [...data.profiles, a, b] } })})`); assert.equal(updated.error, undefined);
  await js('document.querySelector(\'.floating-nav-links [aria-label="项目中心"]\').click()');
  await click('刷新', '.project-workspace'); await click('对比方案', '.project-workspace');
  await wait('!!document.querySelector(".pc-comparison table")'); await snap('features-environment-comparison');
  await click('关闭', '.pc-dialog[open]');

  const root = await fs.realpath(await fs.mkdtemp(path.join(output, 'feature-nginx-'))), common = path.join(root, 'common.conf'), log = path.join(root, 'error.log');
  await fs.writeFile(common, 'location /api/ { proxy_pass http://localhost:9000; }');
  await fs.writeFile(log, '[notice] started\n[error] sample 502\n');
  const ipc = async (action, payload) => { const result = await js(`window.devkitNginx.request(${JSON.stringify(action)},${JSON.stringify(payload) || '{}'})`); assert.equal(result.error, undefined, result.error); return result.data; };
  let state = await ipc('get');
  for (const name of ['feature-a', 'feature-b']) {
    const main = path.join(root, name + '.conf'); await fs.writeFile(main, `error_log error.log; events {} http { server { listen 8080; server_name ${name}; include common.conf; } }`);
    state = await ipc('upsert', { revision: state.revision, instance: { name, main, files: [common], prefix: root, executable: '', platform: 'any' } });
  }
  await js('document.querySelector(\'.floating-nav-links [aria-label="Nginx 配置"]\').click()'); await click('刷新', '.ng-heading');
  const id = state.instances.find(item => item.name === 'feature-a').id;
  await js(`document.querySelector('.ng-instance[data-instance-id="${id}"] .ng-instance-select').click()`);
  await wait(`document.querySelector('.ng-instance[data-instance-id="${id}"] .ng-instance-select').getAttribute('aria-pressed')==='true'`);
  await click('查看日志', '.ng-center'); await wait('document.querySelector(".ng-log-view")?.textContent.includes("实例日志") && !!document.querySelector(".ng-log-editor .cm-content")');
  await fill('input[aria-label="日志关键词"]', '502'); await wait('document.querySelector(".ng-log-editor .cm-content")?.textContent==="[error] sample 502"');
  await click('跟随日志', '.ng-log-view'); await fs.rename(log, log + '.1'); await fs.writeFile(log, '[error] rotated 502\n');
  await wait('document.querySelector(".ng-log-editor .cm-content")?.textContent.includes("rotated")'); await click('暂停跟随', '.ng-log-view');
  await fs.appendFile(log, '[error] paused 502\n');
  await new Promise(resolve=>setTimeout(resolve,2200));
  assert.equal(await js('document.querySelector(".ng-log-editor .cm-content").textContent.includes("paused")'), false, 'Paused logs retain their exact content');
  await snap('features-nginx-log'); await click('收起日志', '.ng-center');
  await js(`[...document.querySelectorAll('.ng-file-tabs button')].find(button=>button.textContent.includes('common.conf')).click()`);
  await click('全文编辑', '.ng-center'); await editor('.ng-source .cm-content', 'location /api/ { proxy_pass http://localhost:9001; }');
  await click('变更与引用预览', '.ng-center'); await wait('!!document.querySelector(".ng-review-modal[open] .change-preview")');
  assert.match(await js('document.querySelector(".ng-review-modal").textContent'), /feature-b/);
  assert.match(await js('document.querySelector(".change-preview").textContent'), /9001/);
  await snap('features-nginx-change-preview'); await click('返回编辑', '.ng-review-modal');
  await click('保存文件 (1)', '.ng-center').catch(async () => { await js('[...document.querySelectorAll(".ng-center button")].find(button=>button.textContent.startsWith("保存文件")).click()'); });
  await wait('document.querySelector(".ng-notice")?.textContent.includes("已保存")');
  await click('备份', '.ng-center'); await click('对比当前', '.ng-backups'); await wait('!!document.querySelector(".ng-review-modal .change-preview")'); await click('返回编辑', '.ng-review-modal');
  for (const theme of ['light', 'dark']) {
    await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`); window.setSize(390, 1000);
    await click('查看日志', '.ng-center'); await wait('!!document.querySelector(".ng-log-editor .cm-content")');
    assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true, `Nginx ${theme} overflow`); await snap(`features-nginx-${theme}-narrow`); await click('收起日志', '.ng-center');
  }
  // Restore fixture registrations so the following close/reload suite sees its
  // original empty Nginx state. Only IDs created by this test are removed.
  const fixtureIds = state.instances.filter(item => item.name === 'feature-a' || item.name === 'feature-b').map(item => item.id);
  for (const id of fixtureIds) {
    const latest = await ipc('get'); await ipc('remove', { id, revision: latest.revision, forgetOnly: true });
  }
  await click('刷新', '.ng-heading');
  await wait('!document.querySelector(".ng-busy")');
  await js('document.documentElement.dataset.theme="light"'); window.setSize(...size); window.setMinimumSize(...minimum);
  console.log('Six approved features passed: JSON structure diff, seeded Mock, HTTP real send/cancel/collections, environment comparison, Nginx filtered/rotated logs and shared config/backup review.');
};
