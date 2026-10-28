const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function checkManualProbes(window, fixture, output) {
  console.log('Manual probes: starting UI checks');
  window.webContents.setBackgroundThrottling(false);
  window.setSize(1440, 1000);
  window.show();
  const js = async source => {
    try { return await window.webContents.executeJavaScript(source); }
    catch (error) { console.error('Probe UI expression:', source); throw error; }
  };
  const wait = async expression => {
    for (let i = 0; i < 200; i++) {
      if (await js(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Probe UI condition not met: ' + expression);
  };
  const calls = [];
  const target = http.createServer((request, response) => {
    calls.push(request.url);
    setTimeout(() => { response.writeHead(request.url === '/p2' ? 503 : 200); response.end(); }, 100);
  });
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  try {
    const data = await fixture.store.get();
    const projects = Array.from({ length: 26 }, (_, i) => ({ id: `p${i}`, code: `p${i}`, name: `探活项目 ${i}`, group: i % 2 ? 'A' : 'B', description: '',
      url: i === 24 ? 'http://{{absent}}/' : `http://127.0.0.1:${target.address().port}/p${i}`, enabled: i !== 25, query: [] }));
    data.profiles = [{ id: 'probe-a', name: '探活配置 A', description: '', variables: [], projects },
      { id: 'probe-b', name: '探活配置 B', description: '', variables: [], projects: [projects[0]] }];
    await fixture.store.save(data, data.revision);
    fixture.options.services.projects.probe = true;
    await fixture.host.start(fixture.options);
    await window.loadURL(fixture.url);
    await wait('!!document.querySelector("input[type=password]")');
    await js(`{const e=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'portal-test-only');e.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await wait(`[...document.querySelectorAll('.portal-login button')].some(e=>e.textContent.trim()==='登录'&&!e.disabled)`);
    await js(`[...document.querySelectorAll('.portal-login button')].find(e=>e.textContent.trim()==='登录').click()`);
    await wait('document.querySelectorAll(".pc-card").length===26');
    // One item, then an entire profile while only one item is visible.
    await js(`document.querySelector('button[aria-label="探活 探活项目 0"]').click()`);
    await wait(`document.querySelector('.pc-probe-progress')?.textContent.includes('主机探活完成')`);
    assert.equal(calls.length, 1);
    assert.match(await js(`document.querySelector('.pc-card').textContent`), /正常 · HTTP 200/);
    await js(`{const e=document.querySelector('input[aria-label="搜索项目"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'探活项目 0');e.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await wait('document.querySelectorAll(".pc-card").length===1');
    await js(`[...document.querySelectorAll('.pc-environment button')].find(e=>e.textContent.includes('全部探活')).click()`);
    await wait(`document.querySelector('.pc-probe-progress')?.textContent.includes('主机探活中')`);
    assert.equal(await js(`document.querySelector('button[aria-label="探活 探活项目 0"]').disabled`), true);
    await wait(`document.querySelector('.pc-probe-progress')?.textContent.includes('25/25')`);
    assert.match(await js(`document.querySelector('.pc-probe-progress').textContent`), /正常 23 · 异常 2 · 跳过停用 1/);
    assert.equal(calls.length, 25); // 1 single + 24 valid enabled entries, including p23.
    assert.ok(calls.includes('/p23'));
    const revision = (await fixture.store.get()).revision;
    assert.equal(revision, data.revision + 1);
    await new Promise(resolve => setTimeout(resolve, 200));
    await fs.writeFile(path.join(output, 'project-probe-filtered.png'), (await window.webContents.capturePage()).toPNG());
    await js(`{const e=document.querySelector('input[aria-label="搜索项目"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await wait('document.querySelectorAll(".pc-card").length===26');
    assert.equal(await js(`document.querySelector('button[aria-label="探活 探活项目 25"]').disabled`), true);
    assert.equal(await js(`document.querySelector('button[aria-label="探活 探活项目 24"]').disabled`), true);
    // All selected, with no 20-item truncation.
    await js(`document.querySelector('input[aria-label="选择当前结果"]').click()`);
    await js(`[...document.querySelectorAll('.pc-bulk button')].find(e=>e.textContent.includes('检测所选入口')).click()`);
    await wait(`document.querySelector('.pc-probe-progress')?.textContent.includes('主机探活中')`);
    await wait(`document.querySelector('.pc-probe-progress')?.textContent.includes('主机探活完成')`);
    assert.equal(calls.length, 49);
    // Shared card/list controls and narrow viewport.
    await js(`document.querySelector('button[aria-label="列表视图"]').click()`);
    window.setSize(390, 844);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
    await fs.writeFile(path.join(output, 'project-probe-narrow.png'), (await window.webContents.capturePage()).toPNG());
    await js(`[...document.querySelectorAll('.pc-profile')].find(e=>e.textContent.includes('探活配置 B')).click()`);
    await wait('document.querySelectorAll(".pc-card").length===1');
    assert.equal(await js(`document.querySelector('.pc-probe-progress')===null`), true);
    assert.doesNotMatch(await js(`document.querySelector('.pc-card').textContent`), /HTTP 200/);
    console.log('Manual probes: single, whole profile beyond 20, filtered/selected scope, progress, skipped/errors, isolated profiles and narrow list passed.');
  } catch (error) {
    await fs.writeFile(path.join(output, 'project-probe-failure.png'), (await window.webContents.capturePage()).toPNG());
    console.error(await js(`document.querySelector('.project-center')?.textContent.slice(0,2000)||document.body.textContent.slice(0,1000)`));
    throw error;
  } finally {
    target.closeAllConnections();
    await new Promise(resolve => target.close(resolve));
  }
};
