const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { dialog } = require('electron');

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
  const previousDialog = dialog.showOpenDialog;
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [jar] });
  try {
    window.setSize(1440, 1000);
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
    const { detectJava } = await import('../server/jar-process.mjs');
    const java = await detectJava();
    if (java.found) {
      const execute = require('node:util').promisify(require('node:child_process').execFile);
      const extension = process.platform === 'win32' ? '.exe' : '';
      const bin = path.dirname(java.executable), source = path.join(folder, 'ElectronJarFixture.java'), liveJar = path.join(folder, 'live.jar');
      await fs.writeFile(source, 'public class ElectronJarFixture { public static void main(String[] args)throws Exception{System.out.println("ELECTRON-SUPERVISOR-READY");while(true)Thread.sleep(100);}}');
      await execute(path.join(bin, `javac${extension}`), ['--release', '8', source]);
      await execute(path.join(bin, `jar${extension}`), ['cfe', liveJar, 'ElectronJarFixture', '-C', folder, 'ElectronJarFixture.class']);
      const result = await js(`window.devkitJar.request('get').then(r=>window.devkitJar.request('upsert',{revision:r.data.revision,instance:{name:'Electron 独立守护',jar:${JSON.stringify(liveJar)},executable:${JSON.stringify(java.executable)},logMode:'file'}}))`);
      assert.equal(result.error, undefined); const live = result.data.instances.find(item => item.jar === liveJar);
      try {
        await click('刷新'); await wait('document.querySelector(".jar-table")?.textContent.includes("Electron 独立守护")');
        await click('启动'); await wait('document.querySelector(".jar-table")?.textContent.includes("独立守护中")');
        const log = await js(`window.devkitJar.request('log-tail',{id:${JSON.stringify(live.id)}})`);
        assert.match(log.data.text, /ELECTRON-SUPERVISOR-READY/);
        await click('停止'); await wait('!!document.querySelector(".confirm-dialog[open]")'); await click('停止 JAR', '.confirm-dialog[open]');
        await wait('document.querySelector(".jar-status")?.textContent === "已停止"');
      } finally { await js(`window.devkitJar.request('command',{id:${JSON.stringify(live.id)},command:'force-stop'})`); }
    }
    console.log('JAR desktop smoke passed: IPC, file selection, alias, args, status, logs, dirty confirmation, themes, narrow layout and record-only removal.');
  } finally { dialog.showOpenDialog = previousDialog; }
};
