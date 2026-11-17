const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { BrowserWindow, dialog } = require('electron');

module.exports = async (window, output) => {
  const js = source => window.webContents.executeJavaScript(source, true);
  async function wait(expression) {
    for (let index = 0; index < 180; index++) {
      if (await js(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 70));
    }
    throw new Error(`JAR UI condition failed: ${expression}\n${await js('document.querySelector(".jar-center")?.innerText')}`);
  }
  const click = async (text, root = '.jar-center, .jar-dialog[open]') => {
    await js(`[...document.querySelectorAll(${JSON.stringify(root)})].flatMap(el => [...el.querySelectorAll('button')]).find(b => b.textContent.trim() === ${JSON.stringify(text)})?.click()`);
  };
  const fill = async (label, value) => {
    await js(`{const input=[...document.querySelectorAll('.jar-dialog label')].find(el=>el.firstChild?.textContent===${JSON.stringify(label)})?.querySelector('input,textarea'); if(!input)throw Error('missing field'); Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  };
  const folder = await fs.mkdtemp(path.join(output, 'jar-ui-')), jar = path.join(folder, 'order service.jar');
  await fs.writeFile(jar, 'Not executable; used only for UI registration');
  const configFile = path.join(folder, 'application.yml');
  await fs.writeFile(configFile, '\uFEFFport: 9000\r\n');
  const previousDialog = dialog.showOpenDialog;
  const previousMode = await js('document.documentElement.dataset.displayMode') || 'normal';
  const previousThrottling = window.webContents.getBackgroundThrottling();
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [jar] });
  try {
    window.setSize(1440, 1000);
    window.webContents.setBackgroundThrottling(false);
    await js('document.documentElement.dataset.theme="light"');
    await js('document.querySelector(\'.nav-item[title="JAR 管理"]\').click()');
    await wait('!document.querySelector(".jar-center button.run-button").disabled');
    await click('添加 JAR'); await wait('!!document.querySelector(".jar-dialog[open]")');
    await click('选择文件'); await wait(`document.querySelector('.jar-dialog input[placeholder="选择已有 .jar 文件"]').value === ${JSON.stringify(jar)}`);
    await fill('显示名称', '订单服务 · 测试环境');
    await fill('JVM 参数（每行一个）', '-Xms64m\n-Xmx256m');
    await js(`{const section=[...document.querySelectorAll('.jar-setting-section')].find(el=>el.querySelector('summary').textContent.includes('HTTP'));section.open=true; const input=section.querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,'tcp');input.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await wait('!![...document.querySelectorAll(".jar-dialog label")].find(el=>el.firstChild?.textContent === "TCP 端口")');
    await fill('TCP 端口', '8123');
    await fill('公共环境变量', 'APP_MODE=base\nTOKEN=a=b');
    await js(`{const input=[...document.querySelectorAll('.jar-dialog label')].find(el=>el.firstChild?.textContent==='本次启动的环境档案').querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,'test');input.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await js(`{const input=[...document.querySelectorAll('.jar-profile')].find(el=>el.querySelector('summary').textContent.startsWith('测试')).querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'APP_MODE=test');input.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await js(`{const input=[...document.querySelectorAll('.jar-check')].find(el=>el.textContent.includes('非正常退出')).querySelector('input');input.click();}`);
    await fill('重试上限', '3');
    await click('保存 JAR'); await wait('!document.querySelector(".jar-dialog[open]")');
    await wait('document.querySelector(".jar-table")?.textContent.includes("订单服务 · 测试环境")');
    await wait('document.querySelector(".jar-status")?.textContent === "已停止"');
    const state = await js('window.devkitJar.request("get").then(r=>r.data)');
    const item = state.instances.find(item => item.jar === jar);
    assert.ok(item); assert.deepEqual(item.jvmArgs, ['-Xms64m', '-Xmx256m']);
    assert.equal(item.pidName, 'order service.pid');
    assert.equal(item.health.type, 'tcp'); assert.equal(item.health.port, 8123);
    assert.equal(item.restart.enabled, true); assert.equal(item.restart.maxRetries, 3);
    assert.equal(item.profile, 'test'); assert.equal(item.profiles.find(profile => profile.id === 'test').env.APP_MODE, 'test');
    assert.equal(item.env.TOKEN, 'a=b');
    await click('配置文件');
    await wait("!!document.querySelector('.jar-configs option[value=\"application.yml\"]')");
    await js(`{ const field = document.querySelector('.jar-configs select'); field.value = 'application.yml'; field.dispatchEvent(new Event('change',{bubbles:true})); }`);
    await wait('!!document.querySelector(".jar-configs .cm-content")');
    await js("document.querySelector('.jar-configs .cm-content').focus()");
    await window.webContents.insertText('name: sample\n');
    await click('预览修改', '.jar-configs');
    await wait('!!document.querySelector(".jar-configs .change-preview")');
    await click('保存配置', '.jar-configs');
    await wait('document.querySelector(".pc-dialog[open] [role=status]")?.textContent.includes("已保存")');
    assert.match(await fs.readFile(configFile, 'utf8'), /^\uFEFF.*\r\n/s);
    assert.match(await fs.readFile(configFile, 'utf8'), /name: sample/);
    await click('查看上一版', '.jar-configs');
    await wait('!!document.querySelector(".jar-configs .change-preview")');
    await js('document.querySelector(\'button[aria-label="关闭 JAR 配置文件"]\').click()');
    await fs.writeFile(path.join(folder, item.logName), 'fixture log 中文\nready for inspection\n');
    await click('日志'); await wait('document.querySelector(".jar-log pre")?.textContent.includes("fixture log 中文")');
    await new Promise(resolve => setTimeout(resolve, 450));
    await fs.writeFile(path.join(output, 'jar-list-light.png'), (await window.webContents.capturePage()).toPNG());
    await click('设置'); await wait('!!document.querySelector(".jar-dialog[open]")');
    await new Promise(resolve => setTimeout(resolve, 250));
    await fs.writeFile(path.join(output, 'jar-runtime-settings.png'), (await window.webContents.capturePage()).toPNG());
    await fill('显示名称', '未保存名称'); await click('取消');
    await wait('!!document.querySelector(".confirm-dialog[open]")');
    await click('继续编辑', '.confirm-dialog[open]');
    assert.equal(await js('document.querySelector(".jar-dialog input").value'), '未保存名称');
    await click('取消'); await click('放弃修改', '.confirm-dialog[open]');
    await wait('!document.querySelector(".jar-dialog[open]")');
    await click('系统自启'); await wait('document.querySelector(".jar-startup-content")?.textContent.includes("未启用")');
    await fs.writeFile(path.join(output, 'jar-startup-settings.png'), (await window.webContents.capturePage()).toPNG());
    await click('关闭', '.jar-dialog[open]'); await wait('!document.querySelector(".jar-dialog[open]")');
    await js('document.documentElement.dataset.theme="dark"');
    await new Promise(resolve => setTimeout(resolve, 350));
    await fs.writeFile(path.join(output, 'jar-list-dark.png'), (await window.webContents.capturePage()).toPNG());
    const [width, height] = window.getMinimumSize(); window.setMinimumSize(360, 600); window.setSize(430, 850);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(await js('document.documentElement.scrollWidth > innerWidth'), false);
    await fs.writeFile(path.join(output, 'jar-list-narrow.png'), (await window.webContents.capturePage()).toPNG());
    window.setMinimumSize(width, height); window.setSize(1440, 1000);
    await js('document.documentElement.dataset.theme="light"');
    await click('移除'); await wait('!!document.querySelector(".confirm-dialog[open]")');
    await click('移除记录', '.confirm-dialog[open]');
    await wait('!document.querySelector(".jar-table tbody tr")');
    assert.match(await fs.readFile(jar, 'utf8'), /Not executable/);
    await js('document.querySelector(\'.nav-item[title="设置"]\').click()');
    await wait('!!document.querySelector(\'.settings-page option[value="performance"]\')');
    await js(`{const select=document.querySelector('.settings-page option[value="performance"]').parentElement; select.value='performance'; select.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await wait('document.documentElement.dataset.displayMode === "performance"');
    assert.equal(await js('JSON.parse(localStorage.getItem("devkit:preferences")).displayMode'), 'performance');
    await js('document.querySelector(\'.nav-item[title="JAR 管理"]\').click()');
    await wait('document.querySelector(".jar-summary").textContent.includes("每 15 秒")');
    window.show();
    window.focus();
    const { detectJava } = await import('../server/jar-process.mjs');
    const java = await detectJava();
    if (java.found) {
      const execute = require('node:util').promisify(require('node:child_process').execFile);
      const extension = process.platform === 'win32' ? '.exe' : '';
      const bin = path.dirname(java.executable), source = path.join(folder, 'ElectronJarFixture.java'), liveJar = path.join(folder, 'live.jar');
      await fs.writeFile(source, 'public class ElectronJarFixture { public static void main(String[] args)throws Exception{System.setOut(new java.io.PrintStream(System.out,true,"UTF-8"));System.out.println("ELECTRON-SUPERVISOR-READY");java.io.BufferedReader in=new java.io.BufferedReader(new java.io.InputStreamReader(System.in,"UTF-8"));String line;while((line=in.readLine())!=null)System.out.println("ECHO:"+line);while(true)Thread.sleep(100);}}');
      await execute(path.join(bin, `javac${extension}`), ['--release', '8', source]);
      await execute(path.join(bin, `jar${extension}`), ['cfe', liveJar, 'ElectronJarFixture', '-C', folder, 'ElectronJarFixture.class']);
      const result = await js(`window.devkitJar.request('get').then(r=>window.devkitJar.request('upsert',{revision:r.data.revision,instance:{name:'Electron 独立守护',jar:${JSON.stringify(liveJar)},executable:${JSON.stringify(java.executable)},logMode:'console'}}))`);
      assert.equal(result.error, undefined); const live = result.data.instances.find(item => item.jar === liveJar);
      try {
        await click('刷新'); await wait('document.querySelector(".jar-table")?.textContent.includes("Electron 独立守护")');
        await click('启动'); await wait('document.querySelector(".jar-table")?.textContent.includes("独立守护中")');
        await wait('document.querySelector(".jar-console pre")?.textContent.includes("ELECTRON-SUPERVISOR-READY")');
        await click('取得输入控制权'); await wait('!document.querySelector(".jar-console-input input").disabled');
        await js(`{const input=document.querySelector('.jar-console-input input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'console 中文');input.dispatchEvent(new Event('input',{bubbles:true}));}`);
        await click('发送'); await wait('document.querySelector(".jar-console pre")?.textContent.includes("ECHO:console 中文")');
        await fs.writeFile(path.join(output, 'jar-console-light.png'), (await window.webContents.capturePage()).toPNG());
        await js('document.querySelector(\'button[aria-label="关闭控制台"]\').click()');
        assert.equal(await js('document.querySelector(".jar-status").textContent'), '运行中');
        await click('控制台'); await wait('document.querySelector(".jar-console pre")?.textContent.includes("ECHO:console 中文")');
        await click('停止'); await wait('!!document.querySelector(".confirm-dialog[open]")'); await click('停止 JAR', '.confirm-dialog[open]');
        await wait('document.querySelector(".jar-status")?.textContent === "已停止"');
      } finally { await js(`window.devkitJar.request('command',{id:${JSON.stringify(live.id)},command:'force-stop'})`); }
      await verifyLanHost(window, folder, liveJar, java.executable, click, wait);
    }
    console.log('JAR desktop smoke passed: local and remote registration, Java launch, configuration preview and backup, performance mode, logs, themes and narrow layout.');
  } finally {
    dialog.showOpenDialog = previousDialog;
    await js(`{
      const select = document.querySelector('.settings-page option[value="performance"]')?.parentElement;
      if (select && select.value !== ${JSON.stringify(previousMode)}) {
        select.value = ${JSON.stringify(previousMode)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }`);
    await wait(`document.documentElement.dataset.displayMode === ${JSON.stringify(previousMode)}`);
    window.webContents.setBackgroundThrottling(previousThrottling);
  }
};

async function verifyLanHost(window, folder, jar, executable, click, wait) {
  const { createProjectHost } = await import('../server/project-host.mjs');
  const { createProjectStore } = await import('../server/project-store.mjs');
  const { createJarManager } = await import('../server/jar-manager.mjs');
  const { createNginxManager } = await import('../server/nginx-manager.mjs');
  const { emptySharingServices } = await import('../shared/sharing.mjs');
  const remote = path.join(folder, 'remote');
  await fs.mkdir(remote);
  const remoteJar = path.join(remote, 'remote.jar');
  await fs.copyFile(jar, remoteJar);
  const store = await createProjectStore(path.join(remote, 'configs'));
  const jvm = await createJarManager(path.join(remote, 'configs'));
  const nginx = await createNginxManager(path.join(remote, 'configs'));
  const host = await createProjectHost(store, path.join(__dirname, '..', 'dist'), { jar: () => jvm, nginx: () => nginx });
  const service = require('node:net').createServer();
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  const port = service.address().port;
  await new Promise(resolve => service.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const services = emptySharingServices();
  services.jar = { enabled: true, edit: true, control: true };
  services.nginx.enabled = true;
  const find = hash => BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL() === origin + '/#' + hash);
  const js = (target, source) => target.webContents.executeJavaScript(source, true);
  async function when(target, expression, timeout = 12_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await js(target, expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Remote window condition failed: ' + expression + '\n' + await js(target, 'document.body.innerText'));
  }
  const input = (target, selector, value) => js(target, `{const field=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true}));}`);
  let id;
  try {
    await host.start({ host: '127.0.0.1', port, services, password: 'devkit-lan-smoke' });
    await click('局域网主机');
    await wait('!!document.querySelector("dialog[open] .lan-hosts form")');
    await input(window, '.lan-hosts input[placeholder="例如：测试服务器"]', '远程测试主机');
    await input(window, '.lan-hosts input[placeholder="http://192.168.1.20:8765"]', origin);
    await click('添加主机', '.lan-hosts');
    await wait('!!document.querySelector(".lan-host-list li")');
    await click('JAR 管理', '.lan-host-list li');
    await wait('document.querySelector(".pc-dialog[open]")?.textContent.includes("已打开")');
    const remoteWindow = find('jar');
    assert.ok(remoteWindow);
    remoteWindow.webContents.setBackgroundThrottling(false);
    assert.equal(await js(remoteWindow, 'typeof window.devkitDesktop'), 'undefined');
    await when(remoteWindow, '!!document.querySelector(".portal-login input[type=password]")');
    await input(remoteWindow, '.portal-login input[type=password]', 'devkit-lan-smoke');
    await js(remoteWindow, 'document.querySelector(".portal-login .run-button").click()');
    await when(remoteWindow, 'document.querySelector(".jar-center button.run-button")?.disabled === false');
    await js(remoteWindow, 'document.querySelector(".jar-center button.run-button").click()');
    await when(remoteWindow, '!!document.querySelector(".jar-dialog[open]")');
    await input(remoteWindow, '.jar-dialog input[placeholder^="填写共享主机"]', remoteJar);
    await input(remoteWindow, '.jar-dialog input[placeholder^="例如"]', '远端 Java');
    await input(remoteWindow, '.jar-dialog input[placeholder^="留空"]', executable);
    await js(remoteWindow, 'document.querySelector(".jar-dialog button[type=submit]").click()');
    await when(remoteWindow, 'document.querySelector(".jar-status")?.textContent === "已停止" && [...document.querySelectorAll(".jar-row-actions button")].some(b => b.textContent.trim() === "启动" && !b.disabled)');
    id = (await jvm.request('get')).instances[0].id;
    await js(remoteWindow, '[...document.querySelectorAll(".jar-row-actions button")].find(b=>b.textContent.trim()==="启动").click()');
    await when(remoteWindow, 'document.querySelector(".jar-status")?.textContent === "运行中"', 35_000);
    assert.ok((await jvm.request('statuses'))[0].pid > 1);
    assert.equal(await js(window, `window.devkitJar.request('get').then(result => result.data.instances.some(item => item.jar === ${JSON.stringify(remoteJar)}))`), false);
    await js(window, 'document.querySelector(\'button[aria-label="关闭局域网主机"]\').click();document.querySelector(\'.nav-item[title="Nginx 配置"]\').click()');
    await click('局域网主机', '.ng-center');
    await wait('document.querySelector(".lan-host-list")?.textContent.includes("远程测试主机")');
    await click('Nginx 配置', '.lan-host-list li');
    await wait('document.querySelector(".pc-dialog[open]")?.textContent.includes("已打开")');
    const nginxWindow = find('nginx');
    assert.ok(nginxWindow);
    await when(nginxWindow, '!!document.querySelector(".portal-page:not([hidden]) .ng-center")');
  } finally {
    find('jar')?.destroy();
    find('nginx')?.destroy();
    await js(window, 'document.querySelector(\'dialog[open] button[aria-label="关闭局域网主机"]\')?.click()');
    await wait('!document.querySelector("dialog[open] .lan-hosts")');
    if (id) await jvm.request('command', { id, command: 'force-stop' }).catch(() => {});
    await host.stop();
    await jvm.close();
    await nginx.close();
    await store.close();
  }
}
