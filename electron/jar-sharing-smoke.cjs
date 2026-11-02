const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { promisify } = require('node:util');
const execute = promisify(require('node:child_process').execFile);
const root = path.dirname(__dirname), windows = [];
const output = path.join(root, 'artifacts/jar-sharing-ui');
const profile = path.join(output, `profile-${randomUUID()}`);
require('node:fs').mkdirSync(profile, { recursive: true }); app.setPath('userData', profile);
let manager, store, host, item;
const timeout = setTimeout(() => { console.error('JAR sharing UI timed out'); app.exit(1); }, 150000);
// Keep the host alive when switching between isolated browser clients and during cleanup.
app.on('window-all-closed', () => {});
async function wait(window, expression) {
  for (let i = 0; i < 150; i++) { if (await window.webContents.executeJavaScript(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('JAR portal condition failed: ' + expression + '\n' + await window.webContents.executeJavaScript('document.body.innerText'));
}
const js = (window, source) => window.webContents.executeJavaScript(source, true);
const click = (window, label) => js(window, `[...document.querySelectorAll('.jar-center button')].find(button=>button.textContent.trim()===${JSON.stringify(label)})?.click()`);
app.whenReady().then(async () => {
  let failed = false;
  try {
    await fs.mkdir(output, { recursive: true }); const folder = await fs.mkdtemp(path.join(output, 'installation-'));
    const { detectJava } = await import('../server/jar-process.mjs');
    const { createJarManager } = await import('../server/jar-manager.mjs');
    const { createProjectStore } = await import('../server/project-store.mjs');
    const { createProjectHost } = await import('../server/project-host.mjs');
    const { emptySharingServices } = await import('../shared/sharing.mjs');
    const java = await detectJava(); if (!java.found) throw new Error('JDK required for JAR sharing UI smoke');
    const source = path.join(folder, 'PortalJarFixture.java'), jar = path.join(folder, 'portal app.jar'), suffix = process.platform === 'win32' ? '.exe' : '', bin = path.dirname(java.executable);
    await fs.writeFile(source, 'public class PortalJarFixture{public static void main(String[] a)throws Exception{System.setOut(new java.io.PrintStream(System.out,true,"UTF-8"));System.out.println("PORTAL-CONSOLE-READY");java.io.BufferedReader r=new java.io.BufferedReader(new java.io.InputStreamReader(System.in,"UTF-8"));String line;while((line=r.readLine())!=null)System.out.println("PORTAL-ECHO:"+line);while(true)Thread.sleep(100);}}');
    await execute(path.join(bin, `javac${suffix}`), ['--release', '8', source]);
    await execute(path.join(bin, `jar${suffix}`), ['cfe', jar, 'PortalJarFixture', '-C', folder, 'PortalJarFixture.class']);
    const configs = path.join(folder, 'configs'); store = await createProjectStore(configs); manager = await createJarManager(configs);
    item = (await manager.request('upsert', { revision: 0, instance: { name: '共享交互应用', jar, executable: java.executable, logMode: 'console', env: { SECRET: 'not-for-viewers' } } })).instances[0];
    await manager.request('command', { id: item.id, command: 'start' });
    host = await createProjectHost(store, path.join(root, 'dist'), { jar: () => manager });
    const listener = require('node:net').createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
    const services = emptySharingServices(); services.jar.enabled = true;
    const settings = { host: '127.0.0.1', port, services, password: 'jar-portal-test' };
    await host.start(settings);
    async function portal() {
      const window = new BrowserWindow({ show: true, width: 1400, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: `jar-${randomUUID()}` } }); windows.push(window);
      await window.loadURL(`http://127.0.0.1:${port}/#jar`);
      await js(window, `Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true})`);
      await wait(window, '!!document.querySelector(\'.portal-login input[type="password"]\')');
      await js(window, `{const input=document.querySelector('.portal-login input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'jar-portal-test');input.dispatchEvent(new Event('input',{bubbles:true}));}`);
      await js(window, 'document.querySelector(\'.portal-login button[type="submit"], .portal-login button.run-button\').click()');
      await wait(window, 'document.querySelector(".jar-table")?.textContent.includes("共享交互应用")');
      await wait(window, 'document.querySelector(".jar-status")?.textContent === "运行中" && [...document.querySelectorAll(".jar-center button")].some(b=>b.textContent.trim()==="控制台"&&!b.disabled)');
      await click(window, '控制台'); await wait(window, 'document.querySelector(".jar-console pre")?.textContent.includes("PORTAL-CONSOLE-READY")');
      return window;
    }
    const viewer = await portal();
    assert.equal(await js(viewer, `[...document.querySelectorAll('.jar-center button')].find(b=>b.textContent.trim()==='添加 JAR').disabled`), true);
    assert.equal(await js(viewer, `[...document.querySelectorAll('.jar-center button')].find(b=>b.textContent.trim()==='取得输入控制权').disabled`), true);
    await fs.writeFile(path.join(output, 'readonly-console.png'), (await viewer.webContents.capturePage()).toPNG()); viewer.destroy();
    services.jar.control = true; await host.start(settings);
    const first = await portal(), second = await portal();
    await click(first, '取得输入控制权'); await wait(first, '!document.querySelector(".jar-console-input input").disabled');
    await wait(second, 'document.querySelector(".jar-console-control")?.textContent.includes("输入控制者")');
    assert.equal(await js(second, 'document.querySelector(".jar-console-input input").disabled'), true);
    await js(first, `{const input=document.querySelector('.jar-console-input input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'远程 console');input.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await click(first, '发送'); await wait(second, 'document.querySelector(".jar-console pre")?.textContent.includes("PORTAL-ECHO:远程 console")');
    await assert.rejects(manager.request('command', { id: item.id, command: 'start' }), /已在运行/);
    await js(first, 'document.querySelector(\'button[aria-label="关闭控制台"]\').click()');
    await wait(first, '!document.querySelector(".jar-console")');
    await wait(second, 'document.querySelector(".jar-console-control")?.textContent.includes("当前无人控制输入")');
    await click(second, '取得输入控制权'); await wait(second, '!document.querySelector(".jar-console-input input").disabled');
    assert.equal((await manager.request('statuses'))[0].state, 'running');
    second.show(); second.focus(); await new Promise(resolve => setTimeout(resolve, 500));
    await fs.writeFile(path.join(output, 'shared-console.png'), (await second.webContents.capturePage()).toPNG());
    second.setMinimumSize(360, 600); second.setContentSize(430, 850); await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(await js(second, 'document.documentElement.scrollWidth<=innerWidth'), true);
    await fs.writeFile(path.join(output, 'shared-console-narrow.png'), (await second.webContents.capturePage()).toPNG());
    console.log('JAR portal passed: JAR-only login, read grants, no randomUUID dependency, two readers/one writer, UTF-8 input/output, view close/reclaim, local duplicate rejection and narrow layout.');
  } catch (error) { failed = true; console.error(error); }
  finally {
    console.log('JAR portal cleanup: windows');
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    console.log('JAR portal cleanup: process');
    if (item) await manager?.request('command', { id: item.id, command: 'force-stop' }).catch(() => {});
    console.log('JAR portal cleanup: host');
    await host?.stop(); await manager?.close(); await store?.close(); clearTimeout(timeout); app.exit(failed ? 1 : 0);
  }
});
