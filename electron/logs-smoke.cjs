const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { BrowserWindow } = require('electron');

module.exports = async (window, output) => {
  window.webContents.setBackgroundThrottling(false); window.show(); window.setContentSize(1440, 900);
  const js = source => window.webContents.executeJavaScript(source, true);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (contents, expression) => { for (let i = 0; i < 200; i++) { if (await contents.executeJavaScript(expression, true)) return; await delay(50); } throw Error('Log UI condition failed: ' + expression + '\n' + await contents.executeJavaScript('document.body.innerText')); };
  const ipc = async (module, action, value) => { const result = await js(`window.${module}.request(${JSON.stringify(action)},${JSON.stringify(value) ?? '{}'})`); assert.equal(result.error, undefined); return result.data; };
  const click = text => js(`[...document.querySelectorAll('.log-center button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`);
  const fill = async (label, value) => js(`(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const folder = path.join(output, 'logs-fixture'); await fs.mkdir(folder, { recursive: true });
  const main = path.resolve(folder, 'nginx.conf'), log = path.resolve(folder, 'gateway.log');
  await fs.writeFile(log, 'INFO gateway ready\nERROR upstream failed\n');
  await fs.writeFile(main, 'error_log gateway.log;\nevents {}\nhttp { access_log access.log; }\n'); await fs.writeFile(path.join(folder, 'access.log'), 'INFO request GET /\n');
  for (const [index, name] of ['应用 A', '应用 B'].entries()) {
    const filename = path.resolve(folder, `app${index}.jar`); await fs.writeFile(filename, 'fixture; never executed');
    await fs.writeFile(path.resolve(folder, `app${index}.log`), `INFO started ${index}\nERROR failure ${index} password=private-value\n`);
    const state = await ipc('devkitJar', 'get'); await ipc('devkitJar', 'upsert', { revision: state.revision, instance: { name, jar: filename, logMode: 'file' } });
  }
  const nginx = await ipc('devkitNginx', 'get'); await ipc('devkitNginx', 'upsert', { revision: nginx.revision, instance: { name: '网关', main, files: [], prefix: path.resolve(folder), executable: '', platform: process.platform } });
  let remote;
  try {
    await js(`document.querySelector('.sidebar [title="日志中心"]').click()`);
    assert.equal(await js(`document.querySelector('.sidebar-shared').open`), false, 'Shared sidebar starts collapsed');
    await js(`document.querySelector('.shared-sidebar-trigger').click()`);
    await wait(window.webContents, `document.querySelector('.sidebar-shared').open`);
    assert.equal(await js(`document.querySelectorAll('.sidebar-shared nav button').length`), 6);
    await js(`document.querySelector('.sidebar-shared [title="日志中心"]').click()`);
    await wait(window.webContents, `!document.querySelector('.sidebar-shared').open`);
    const minimum = window.getMinimumSize(); window.setMinimumSize(360, 600);
    for (const width of [1440, 1024, 768, 390]) {
      window.setContentSize(width, 900); await delay(150);
      await js(`document.querySelector('.shared-nav-trigger').click()`);
      await wait(window.webContents, `document.querySelector('.shared-nav-panel')?.matches(':popover-open')`);
      const geometry = await js(`(()=>{const p=document.querySelector('.shared-nav-panel'),r=p.getBoundingClientRect();return {count:p.querySelectorAll('[role=menuitem]').length,fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,hit:p.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
      assert.equal(geometry.count, 6); assert.equal(geometry.fits && geometry.hit, true, 'Shared submenu fits and receives input at ' + width);
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ArrowDown' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ArrowDown' });
      assert.equal(await js(`document.activeElement.getAttribute('role')==='menuitem'`), true);
      if (width === 1440) { window.show(); window.focus(); await delay(200); await fs.writeFile(path.join(output, 'shared-secondary-navigation.png'), (await window.webContents.capturePage()).toPNG()); }
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await wait(window.webContents, `!document.querySelector('.shared-nav-panel')&&document.activeElement.classList.contains('shared-nav-trigger')`);
    }
    window.setMinimumSize(...minimum); window.setContentSize(1440, 900);
    for (const name of ['HTTP 调试', '日志中心']) {
      await js(`document.querySelector('.shared-nav-trigger').click()`);
      await wait(window.webContents, `document.querySelector('.shared-nav-panel')?.matches(':popover-open')`);
      await js(`[...document.querySelectorAll('.shared-nav-panel [role=menuitem]')].find(e=>e.querySelector('strong').textContent===${JSON.stringify(name)}).click()`);
      await wait(window.webContents, `document.querySelector('.breadcrumb strong')?.textContent===${JSON.stringify(name)}&&!document.querySelector('.shared-nav-panel')`);
    }
    await wait(window.webContents, `document.querySelectorAll('.log-source-list>label').length===4`);
    await js(`document.querySelectorAll('.log-source-list input').forEach(e=>e.click())`);
    await wait(window.webContents, `document.querySelectorAll('.log-pane').length===4&&[...document.querySelectorAll('.log-pane pre')].every(e=>e.textContent.includes('INFO'))`);
    assert.equal(await js(`document.querySelector('.log-panels').textContent.includes('private-value')`), false, 'Display masking is on by default');
    await fill('筛选日志内容', 'ERROR'); await wait(window.webContents, `[...document.querySelectorAll('.log-pane pre')].filter(e=>e.textContent.includes('failure')).length===2&&![...document.querySelectorAll('.log-pane pre')].some(e=>e.textContent.includes('INFO started'))`);
    assert.equal(await js(`[...document.querySelectorAll('.log-pane pre')].some(e=>e.textContent.includes('INFO started'))`), false);
    await fill('筛选日志内容', ''); await delay(850);
    await fs.writeFile(path.join(output, 'logs-desktop-four.png'), (await window.webContents.capturePage()).toPNG());
    await click('暂停接收'); await fs.appendFile(path.join(folder, 'app0.log'), 'INFO paused-marker\n'); await delay(2200);
    assert.equal(await js(`document.querySelector('.log-panels').textContent.includes('paused-marker')`), false);
    await click('继续追踪'); await wait(window.webContents, `document.querySelector('.log-panels').textContent.includes('paused-marker')`);
    await js(`document.querySelector('.log-pane [title="清空本页显示"]').click()`); await delay(2300);
    assert.equal(await js(`document.querySelector('.log-pane pre').textContent.includes('paused-marker')`), false, 'Clear retains the cursor');
    await fs.appendFile(path.join(folder, 'app0.log'), 'INFO next-marker\n'); await wait(window.webContents, `document.querySelector('.log-pane pre').textContent.includes('next-marker')`);
    await js(`document.querySelector('.log-pane button[title^="导出来源"]').click()`); await wait(window.webContents, `!!document.querySelector('.log-center [role=status]')`);
    const exported = await fs.readFile(path.join(output, 'saved.txt'), 'utf8'); assert.match(exported, /INFO/); assert.equal(exported.includes('private-value'), false);
    await fs.appendFile(path.join(folder, 'app0.log'), 'a'.repeat(25000) + '!\n'); await delay(2300);
    await js(`document.querySelector('.log-toolbar input[type=checkbox]').click()`); await fill('筛选日志内容', '(a+)+$');
    await wait(window.webContents, `[...document.querySelectorAll('.log-pane-error')].some(e=>e.textContent.includes('超时'))`);
    await fill('筛选日志内容', ''); await js(`document.querySelector('.log-toolbar input[type=checkbox]').click()`);
    await fs.writeFile(path.join(folder, 'app0.log'), 'INFO rotated-marker\n'); await wait(window.webContents, `document.querySelector('.log-pane pre').textContent.includes('rotated-marker')`);
    const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    const services = { projects: { enabled: true, edit: false, probe: false }, nginx: { enabled: true, edit: false, control: false }, http: { enabled: true, edit: false, send: false }, jar: { enabled: true, edit: false, control: false }, monitor: { enabled: true, edit: false, control: false }, logs: { enabled: true, jar: true, nginx: true, export: false } };
    await ipc('devkitProjects', 'start', { host: '127.0.0.1', port, password: 'logs-smoke-only', services });
    remote = new BrowserWindow({ width: 1440, height: 900, show: true, webPreferences: { partition: `logs-${Date.now()}`, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await remote.loadURL(`http://127.0.0.1:${port}/#logs`); await wait(remote.webContents, `!!document.querySelector('.portal-login .run-button')&&!document.querySelector('.portal-login .run-button').disabled`);
    await remote.webContents.executeJavaScript(`(()=>{const e=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'logs-smoke-only');e.dispatchEvent(new Event('input',{bubbles:true}))})()`, true); await delay(100); await remote.webContents.executeJavaScript(`document.querySelector('.portal-login .run-button').click()`, true);
    await wait(remote.webContents, `document.querySelectorAll('.log-source-list>label').length===4`);
    assert.equal(await remote.webContents.executeJavaScript(`document.querySelectorAll('.portal-bar .portal-navigation').length`), 0);
    assert.equal(await remote.webContents.executeJavaScript(`document.querySelectorAll('.portal-sidebar .portal-navigation button').length`), 6);
    await remote.webContents.executeJavaScript(`document.querySelector('.log-source-list input').click()`, true); await wait(remote.webContents, `document.querySelector('.log-pane pre')?.textContent.includes('rotated-marker')`);
    assert.equal(await remote.webContents.executeJavaScript(`document.querySelectorAll('.log-pane button[title^="导出"]').length`), 0);
    const id = (await ipc('devkitLogs', 'sources')).sources[0].id;
    assert.equal(await remote.webContents.executeJavaScript(`fetch('/api/logs/export',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify({ sources: [{ id }] }))}}).then(r=>r.status)`), 403);
    for (const width of [1440, 768, 390]) {
      remote.setContentSize(width, 900); await delay(250);
      assert.equal(await remote.webContents.executeJavaScript(`document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.log-center').scrollWidth<=document.querySelector('.log-center').clientWidth`), true, 'Log layout fits ' + width);
      if (width <= 780) {
        await remote.webContents.executeJavaScript(`document.querySelector('[aria-label="打开共享导航"]').click()`, true); await wait(remote.webContents, `!!document.querySelector('.portal-drawer[open]')`);
        assert.equal(await remote.webContents.executeJavaScript(`document.querySelectorAll('.portal-drawer .portal-navigation button').length`), 6);
        remote.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); remote.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await wait(remote.webContents, `!document.querySelector('.portal-drawer[open]')`);
      }
      remote.show(); remote.focus(); await fs.writeFile(path.join(output, `logs-shared-${width}.png`), (await remote.webContents.capturePage()).toPNG());
    }
    console.log('Logs and navigation passed: four-source streaming, mask/filter/regex timeout, pause/resume/clear, rotation, export permissions, sidebar and keyboard-close mobile drawer.');
  } finally { remote?.destroy(); await ipc('devkitProjects', 'stop'); }
};
