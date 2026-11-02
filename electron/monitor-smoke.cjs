const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const { BrowserWindow } = require('electron');

module.exports = async (window, output) => {
  window.webContents.setBackgroundThrottling(false); window.show(); window.setSize(1440, 1000);
  const js = async source => { try { return await window.webContents.executeJavaScript(source, true); } catch (error) { console.error('Monitor UI script failed:', source, await window.webContents.executeJavaScript('document.body.innerText')); throw error; } };
  const wait = async (contents, expression) => { for (let i = 0; i < 150; i++) { if (await contents.executeJavaScript(expression, true)) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Monitor UI condition failed: ' + expression + '\n' + await contents.executeJavaScript('document.body.innerText')); };
  const ipc = async (action, payload) => { const value = await js(`window.devkitMonitor.request(${JSON.stringify(action)},${JSON.stringify(payload) ?? '{}'})`); assert.equal(value.error, undefined); return value.data; };
  const click = text => js(`[...document.querySelectorAll('.monitor-center button,dialog[open] button')].find(e=>e.getClientRects().length&&e.textContent.trim()===${JSON.stringify(text)}).click()`);
  const fill = async (label, value) => { await js(`(()=>{const e=[...document.querySelectorAll('dialog[open] label')].find(e=>e.querySelector('span')?.textContent===${JSON.stringify(label)}).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`); };
  let healthy = false, requests = 0, remote;
  const target = http.createServer((_req, res) => { requests++; res.writeHead(healthy ? 200 : 503); res.end('monitor fixture'); });
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  try {
    await js(`document.querySelector('.sidebar button[title="监控中心"]').click()`);
    await wait(window.webContents, `!!document.querySelector('.monitor-empty .run-button')`);
    await click('添加监控'); await fill('监控名称', '共享健康检测'); await fill('检测地址', `http://127.0.0.1:${target.address().port}/health`); await fill('检测间隔（秒）', '10');
    await click('保存监控'); await wait(window.webContents, `!document.querySelector('dialog[open]')&&document.querySelectorAll('.monitor-card').length===1`);
    let state = await ipc('get'), id = state.monitors[0].id;
    await js(`document.querySelector('.monitor-card button[aria-label="启用 共享健康检测"]').click()`);
    await wait(window.webContents, `document.querySelector('.monitor-card button[aria-label="暂停 共享健康检测"]')!==null`);
    // Scheduler runs on the host even while the monitor page is hidden.
    await js(`document.querySelector('.sidebar .brand').click()`);
    for (let i = 0; i < 60 && !(await ipc('get')).monitors[0].samples.length; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(requests > 0, 'Scheduled checks continue away from the monitor page');
    await ipc('check', { id }); state = await ipc('get'); assert.equal(state.monitors[0].state, 'down'); assert.equal(state.monitors[0].incidents.length, 1);
    healthy = true; await ipc('check', { id }); state = await ipc('get'); assert.equal(state.monitors[0].state, 'up'); assert.ok(state.monitors[0].incidents[0].end);
    await js(`document.querySelector('.sidebar button[title="监控中心"]').click()`); await click('刷新'); await wait(window.webContents, `document.querySelector('.monitor-card .monitor-status')?.textContent==='正常'`);
    await wait(window.webContents, `document.querySelector('.sidebar button[title="监控中心"]')?.getAttribute('aria-current')==='page'`);
    await new Promise(resolve => setTimeout(resolve, 550));
    await fs.writeFile(path.join(output, 'monitor-desktop.png'), (await window.webContents.capturePage()).toPNG());
    await js(`document.querySelector('.monitor-card button[aria-label="编辑 共享健康检测"]').click()`); await fill('监控名称', '未保存修改'); await click('取消');
    await wait(window.webContents, `!!document.querySelector('.pc-discard')`); await click('放弃更改'); await wait(window.webContents, `!document.querySelector('dialog[open]')`);
    const portServer = net.createServer(); await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve)); const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
    const settings = { host: '127.0.0.1', port, password: 'monitor-smoke-only', services: { projects: { enabled: false, edit: false, probe: false }, nginx: { enabled: false, edit: false, control: false }, http: { enabled: false, edit: false, send: false }, jar: { enabled: false, edit: false, control: false }, monitor: { enabled: true, edit: false, control: false } } };
    const sharing = await js(`window.devkitProjects.request('start',${JSON.stringify(settings)})`); assert.equal(sharing.error, undefined);
    remote = new BrowserWindow({ show: true, width: 1440, height: 900, webPreferences: { partition: 'monitor-smoke', sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await remote.loadURL(`http://127.0.0.1:${port}/#monitor`);
    await wait(remote.webContents, `!!document.querySelector('.portal-login input[type=password]')&&!document.querySelector('.portal-login button').disabled`);
    await remote.webContents.executeJavaScript(`(()=>{const e=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'monitor-smoke-only');e.dispatchEvent(new Event('input',{bubbles:true}))})()`, true);
    await new Promise(resolve => setTimeout(resolve, 100));
    await remote.webContents.executeJavaScript(`document.querySelector('.portal-login button').click()`, true);
    await wait(remote.webContents, `document.querySelector('.monitor-card .monitor-status')?.textContent==='正常'`);
    assert.equal(await remote.webContents.executeJavaScript(`!![...document.querySelectorAll('.monitor-center button')].find(e=>e.textContent==='添加监控'||e.textContent==='立即检测')`), false, 'Read-only visitor cannot edit or run checks');
    assert.equal(await remote.webContents.executeJavaScript(`document.querySelectorAll('.portal-sidebar nav button').length`), 1, 'Only monitoring service is exposed');
    for (const action of ['check', 'upsert', 'toggle', 'remove']) {
      assert.equal(await remote.webContents.executeJavaScript(`fetch('/api/monitor/${action}',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify({ id, revision: state.revision }))}}).then(r=>r.status)`), 403, 'Read-only API rejects ' + action);
    }
    for (const width of [1440, 768, 390]) {
      remote.setContentSize(width, 900); await new Promise(resolve => setTimeout(resolve, 200));
      assert.equal(await remote.webContents.executeJavaScript(`document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.monitor-center').scrollWidth<=document.querySelector('.monitor-center').clientWidth`), true, 'Monitor page fits width ' + width);
      remote.show(); remote.focus(); await fs.writeFile(path.join(output, `monitor-shared-${width}.png`), (await remote.webContents.capturePage()).toPNG());
    }
    remote.setContentSize(1440, 900);
    for (const style of ['default', 'minimal', 'organic', 'editorial', 'brutalist', 'soft', 'glass', 'gradient', 'retro']) for (const theme of ['light', 'dark']) {
      await remote.webContents.executeJavaScript(`document.documentElement.dataset.themeStyle=${JSON.stringify(style)};document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      assert.equal(await remote.webContents.executeJavaScript(`document.querySelector('.monitor-center').scrollWidth<=document.querySelector('.monitor-center').clientWidth`), true, style + '/' + theme);
    }
    console.log('Monitor UI passed: form CRUD, independent host scheduling, incidents and recovery, dirty draft protection, shared read-only status page and responsive widths.');
  } finally {
    remote?.destroy(); await js(`window.devkitProjects.request('stop')`); target.closeAllConnections(); await new Promise(resolve => target.close(resolve));
  }
};
