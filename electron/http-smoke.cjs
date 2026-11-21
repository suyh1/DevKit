const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');

module.exports = async function httpSmoke(window, output) {
  window.webContents.setBackgroundThrottling(false);
  window.show();
  window.focus();
  window.webContents.focus();
  const js = async (code) => {
    try {
      return await window.webContents.executeJavaScript(code, true);
    } catch (error) {
      console.error('Failed HTTP test script:', code);
      throw error;
    }
  };
  async function wait(expression) {
    for (let i = 0; i < 150; i++) {
      if (await js(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await fs.writeFile(path.join(output, 'http-upgrade-failure.png'), (await window.webContents.capturePage()).toPNG());
    throw new Error('HTTP condition failed: ' + expression);
  }
  const click = async (text, root = '.http-workbench') => {
    const target = `[...document.querySelectorAll(${JSON.stringify(root + ' button')})].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
    await wait(`!!${target}&&!${target}.disabled`);
    await js(`${target}.click()`);
    await js('new Promise(resolve=>requestAnimationFrame(resolve))');
  };
  const fill = async (label, value) => {
    await js(
      `{const e=document.querySelector('input[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}`
    );
    await js('new Promise(resolve=>requestAnimationFrame(resolve))');
  };
  const chooseSegment = async (label, value) => {
    const selector = `[role="group"][aria-label=${JSON.stringify(label)}] button[value=${JSON.stringify(value)}]`;
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await js('new Promise(resolve => requestAnimationFrame(resolve))');
  };
  const select = async (label, value) => {
    await js(
      `{const e=document.querySelector('select[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));}`
    );
    await js('new Promise(resolve=>requestAnimationFrame(resolve))');
  };
  const edit = async (selector, text) => {
    await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
    await js(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
    await window.webContents.insertText(text);
    await js('new Promise(resolve=>requestAnimationFrame(resolve))');
  };
  const requests = [], requestBodies = [];
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/slow')) return;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    requestBodies.push(body);
    requests.push({ url: req.url, headers: req.headers, body: body.toString() });
    res.writeHead(201, { 'Content-Type': 'application/json', 'Set-Cookie': ['a=1', 'b=2'], 'X-Debug': 'yes' });
    res.end('{"id":9007199254740993,"ok":true,"echo":' + JSON.stringify(requests.at(-1)) + '}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await require('./navigation-helpers.cjs')(window).openWorkspace('HTTP 调试');
    await click('快速请求', '.http-product-tabs');
    await wait('!!document.querySelector(\'input[aria-label="请求 URL"]\')');
    const initialSize = window.getSize(), initialMinimum = window.getMinimumSize();
    window.setMinimumSize(360, 600);
    await fill('请求名称', '布局验证请求');
    await click('保存请求');
    for (const width of [1440, 375, 390]) {
      window.setContentSize(width, 844);
      await js('new Promise(resolve=>setTimeout(resolve,100))');
      const actual = await js('innerWidth');
      if (actual !== width) window.setContentSize(width + (width - actual), 844);
      await wait('innerWidth === ' + width);
      const toggle = 'document.querySelector(".http-collection-toggle")';
      const list = 'document.querySelector(".http-collection")';
      if (width < 900) {
        assert.equal(await js(list + '.offsetWidth'), 0);
        assert.ok(await js(`(() => {
          document.querySelector('.http-workspace').scrollTop=0;
          const r=document.querySelector('.http-main input[aria-label="请求 URL"]').getBoundingClientRect();
          return r.height>0 && r.top>=0 && r.bottom<innerHeight;
        })()`), 'URL is visible on entry at ' + width);
        await fs.writeFile(path.join(output, `http-quick-entry-${width}.png`), (await window.webContents.capturePage()).toPNG());
        await js(toggle + '.click()');
      }
      await wait(list + '.offsetWidth > 0');
      await fill('搜索请求集合', '布局验证');
      const row = 'document.querySelector(".http-collection [data-motion-key] button")';
      await wait(row + '?.textContent.includes("布局验证请求")');
      await js('document.querySelectorAll(".notice-stack button[aria-label=关闭通知]").forEach(b=>b.click())');
      await js(row + '.click()');
      await wait('!document.querySelector(".notice-stack")');
      if (width < 900) await wait(list + '.offsetWidth === 0');
      await click('保存请求');
      await wait('document.querySelector(".notice-stack .app-toast")?.textContent.includes("请求已保存")');
      await js('document.querySelector(".notice-stack button[aria-label=关闭通知]").click()');
      await wait('!document.querySelector(".notice-stack")');
    }
    await js('document.querySelector(".http-collection-toggle").click()');
    await js(`(() => {
      const file=document.querySelector('input[aria-label="导入请求集合"]');
      const data=JSON.parse(localStorage.getItem('devkit:http-collection'));
      data.entries[0].name='导入验证请求';
      const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(data)],'collection.json'));
      file.files=dt.files;file.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await click('合并导入', '.confirm-dialog');
    await fill('搜索请求集合', '导入验证请求');
    await wait('document.querySelector(".http-collection [data-motion-key] button")?.textContent.includes("导入验证请求")');
    await js('document.querySelector(".http-collection-toggle").click()');
    assert.equal(await js('document.querySelector(".http-main input[aria-label=请求名称]").value'), '布局验证请求');
    await click('新请求');
    window.setSize(...initialSize);
    window.setMinimumSize(...initialMinimum);
    await fill('请求 URL', base + '/?tag=a&tag=b');
    await select('HTTP 方法', 'POST');
    await wait('document.querySelectorAll(".http-kv-row").length===2');
    await js('document.querySelector(\'input[aria-label="参数 2 启用"]\').click()');
    await click('添加参数');
    await fill('参数 3 名称', '中文');
    await fill('参数 3 值', 'a+b & c');
    assert.equal(await js('document.querySelector(\'input[aria-label="参数 2 启用"]\').checked'), false);
    await click('请求头 0');
    await click('添加请求头');
    await fill('请求头 1 名称', 'X-Client');
    await fill('请求头 1 值', 'DevKit');
    await click('鉴权');
    await fill('Bearer Token', 'secret-for-session');
    await click('应用到请求头');
    await click('正文');
    const body = '{"id":9007199254740993,"name":"中文"}';
    await edit('.http-body-editor .cm-content', body);
    await fill('请求名称', '表单联调');
    await click('发送请求');
    await wait('document.querySelector(".http-response")?.textContent.includes("201")');
    assert.equal(requests[0].body, body);
    assert.equal(requests[0].headers.authorization, 'Bearer secret-for-session');
    assert.equal(requests[0].headers['x-client'], 'DevKit');
    const query = new URL(requests[0].url, base).searchParams;
    assert.deepEqual(query.getAll('tag'), ['a']);
    assert.equal(query.get('中文'), 'a+b & c');
    assert.ok(await js('document.querySelector(".http-response .cm-content").textContent.includes("9007199254740993")'));
    await click('原始正文');
    await click('格式化');
    await click('响应头');
    await fill('筛选响应头', 'set-cookie');
    assert.equal(await js('document.querySelectorAll(".http-headers-table tr").length'), 2);
    await click('响应正文');
    await click('保存请求');
    assert.equal(await js('localStorage.getItem("devkit:http-collection").includes("secret-for-session")'), false);
    await click('请求头 3');
    await click('添加请求头');
    await fill('请求头 4 名称', 'x-client');
    await wait('document.querySelector(".http-main .run-button").disabled');
    await fill('请求 URL', base + '/?tag=a');
    assert.equal(
      await js('document.querySelector(".http-main .run-button").disabled'),
      true,
      'Changing URL cannot hide an invalid header draft'
    );
    await click('正文');
    await chooseSegment('正文类型', 'text');
    assert.equal(
      await js('document.querySelector(".http-main .run-button").disabled'),
      true,
      'Changing Content-Type must retain unrelated invalid header rows'
    );
    await click('请求头 4');
    await js('document.querySelector(\'button[aria-label="删除请求头 4"]\').click()');
    await wait('!document.querySelector(".http-main .run-button").disabled');
    await click('正文');
    await chooseSegment('正文类型', 'form');
    await click('添加表单字段');
    await fill('表单字段 1 名称', 'a');
    await fill('表单字段 1 值', '中文 +');
    await click('发送请求');
    await wait('document.querySelectorAll(".http-history>button").length===3');
    assert.equal(requests[1].body, 'a=%E4%B8%AD%E6%96%87+%2B');
    assert.equal(requests[1].headers['content-type'], 'application/x-www-form-urlencoded');
    await click('保存请求');
    const minimum = window.getMinimumSize(),
      size = window.getSize();
    window.setMinimumSize(360, 600);
    for (const theme of ['light', 'dark'])
      for (const width of [1440, 390]) {
        window.setSize(width, 1000);
        await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
        await js('new Promise(resolve=>setTimeout(resolve,250))');
        assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true, `${theme} ${width} overflow`);
        await fs.writeFile(path.join(output, `http-upgrade-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG());
      }
    window.setSize(...size);
    window.setMinimumSize(...minimum);
    await js('document.documentElement.dataset.theme="light"');
    await js('document.querySelectorAll(".http-history>button")[2].click()');
    await wait('!document.querySelector(".confirm-dialog[open]")');
    await click('正文');
    assert.equal(await js('document.querySelector(".http-body-editor .cm-content").textContent'), body);
    await click('配置 JSON');
    await edit('.http-request .request-json .cm-content', JSON.stringify({ url: base + '/slow' }));
    await click('发送请求');
    await click('取消请求');
    await wait('document.querySelector(".http-main .task-error")?.textContent.includes("取消")');
    await click('保存请求');
    await click('清空历史');
    assert.equal(await js('document.querySelectorAll(".http-history>button").length'), 0);
    const uploadUrl = base + '/multipart';
    await edit('.http-request .request-json .cm-content', JSON.stringify({ url: uploadUrl, method: 'POST' }));
    await js('document.querySelector(".http-multipart label input[type=checkbox]").click()');
    await fill('表单字段名称 1', 'marker');
    await fill('表单字段值 1', '上传测试');
    await click('添加表单字段', '.http-multipart');
    await fill('表单字段名称 2', 'attachment');
    await select('表单字段类型 2', 'file');
    await js(`(() => {
      const input = document.querySelector('.http-multipart input[type=file]');
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.of(0, 255, 128, 13, 10)], 'fixture.bin'));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await click('发送请求');
    await wait('document.querySelector(".http-response")?.textContent.includes("201")');
    const sent = requests.at(-1);
    assert.equal(sent.url, '/multipart');
    const parts = await new Response(requestBodies.at(-1), { headers: { 'content-type': sent.headers['content-type'] } }).formData();
    assert.equal(parts.get('marker'), '上传测试');
    assert.deepEqual(Buffer.from(await parts.get('attachment').arrayBuffer()), Buffer.from([0, 255, 128, 13, 10]));
    await js('document.querySelector(".http-multipart label input[type=checkbox]").click()');
    console.log(
      'HTTP upgrade passed: query/header rows, enable/disable, Bearer, lossless JSON, encoded form, response formatting/duplicate headers/filter, collection sanitization, session restore, cancellation, light/dark and narrow layouts.'
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
};
