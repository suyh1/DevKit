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
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/slow')) return;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    res.writeHead(201, { 'Content-Type': 'application/json', 'Set-Cookie': ['a=1', 'b=2'], 'X-Debug': 'yes' });
    res.end('{"id":9007199254740993,"ok":true,"echo":' + JSON.stringify(requests.at(-1)) + '}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await js('document.querySelector(\'.floating-nav-links [aria-label="HTTP 调试"]\').click()');
    await js(`[...document.querySelectorAll('.http-product-tabs button')].find(button=>button.textContent.trim()==='快速请求').click()`);
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
    await select('正文类型', 'text');
    assert.equal(
      await js('document.querySelector(".http-main .run-button").disabled'),
      true,
      'Changing Content-Type must retain unrelated invalid header rows'
    );
    await click('请求头 4');
    await js('document.querySelector(\'button[aria-label="删除请求头 4"]\').click()');
    await wait('!document.querySelector(".http-main .run-button").disabled');
    await click('正文');
    await select('正文类型', 'form');
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
    console.log(
      'HTTP upgrade passed: query/header rows, enable/disable, Bearer, lossless JSON, encoded form, response formatting/duplicate headers/filter, collection sanitization, session restore, cancellation, light/dark and narrow layouts.'
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
};
