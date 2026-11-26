const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { BrowserWindow, dialog } = require('electron');

// With an interactive Windows desktop, exercise the actual common file dialog.
// Only click Cancel on the native dialog owned by this test window.
async function cancelReplacementPicker(window, selector, js) {
  await js(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('cancel', { bubbles: true }))`);
  assert.ok(await js(`!!document.querySelector(${JSON.stringify(selector)})`), 'A bubbling file-input cancel leaves the dialog open');
  if (process.platform !== 'win32' || process.env.DEVKIT_TEST_NATIVE_PICKER !== '1') return;
  const chooseAndWait = () => js(`new Promise((resolve, reject) => {
    const input = document.querySelector(${JSON.stringify(selector)});
    const timer = setTimeout(() => reject(new Error('No file chooser cancel event')), 20000);
    input.addEventListener('cancel', event => { clearTimeout(timer); resolve(event.isTrusted); }, { once: true });
    input.showPicker();
  })`);
  const script = `
      Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Picker {
  [DllImport("user32.dll")] public static extern IntPtr GetLastActivePopup(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h, int id);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
'@
      $owner = [IntPtr]::new(${window.getNativeWindowHandle().readBigUInt64LE()})
      $deadline = [DateTime]::UtcNow.AddSeconds(12)
      do {
        $popup = [Picker]::GetLastActivePopup($owner)
        $class = [Text.StringBuilder]::new(128)
        $null = [Picker]::GetClassName($popup, $class, 128)
        if ($popup -ne $owner -and $class.ToString() -eq '#32770') {
          $cancel = [Picker]::GetDlgItem($popup, 2)
          if ($cancel -ne [IntPtr]::Zero) {
            if ([Picker]::PostMessage($cancel, 245, [IntPtr]::Zero, [IntPtr]::Zero)) { exit 0 }
          }
        }
        Start-Sleep -Milliseconds 100
      } while ([DateTime]::UtcNow -lt $deadline)
      throw "No native Cancel button for owner $owner (popup $popup, class $class)"
    `;
  window.show();
  const [, cancelled] = await Promise.all([
    require('node:util').promisify(require('node:child_process').execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20000 }),
    chooseAndWait(),
  ]);
  assert.equal(cancelled, true, 'The browser delivered a trusted file-input cancel event');
}

async function openShared(window, name, wait) {
  const selector = `#shared-sidebar-panel [title="${name}"]`;
  await window.webContents.executeJavaScript('document.querySelector(".shared-sidebar-trigger").click()');
  await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
  await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);
}

module.exports = async (window, output) => {
  const js = source => window.webContents.executeJavaScript(source, true);
  async function checkServiceHeader() {
    assert.deepEqual(await js("[...document.querySelectorAll('.jar-heading button')].map(b => b.textContent.trim())"), ['添加服务']);
    assert.equal(await js("document.querySelector('.jar-heading select') === null"), true);
  }
  async function wait(expression) {
    for (let index = 0; index < 180; index++) {
      if (await js(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 70));
    }
    throw new Error(`JAR UI condition failed: ${expression}\n${await js('document.querySelector(".jar-center")?.innerText')}`);
  }
  const click = async (text, root = '.jar-center, .jar-dialog[open]') => {
    const target = `[...document.querySelectorAll(${JSON.stringify(root)})].flatMap(el => [...el.querySelectorAll('button')]).find(b => !b.disabled && b.textContent.trim() === ${JSON.stringify(text)})`;
    await wait('!!' + target);
    await js(target + '.click()');
  };
  const fill = async (label, value) => {
    await js(`{const input=[...document.querySelectorAll('.jar-dialog label')].find(el=>el.firstChild?.textContent===${JSON.stringify(label)})?.querySelector('input,textarea'); if(!input)throw Error('missing field'); Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  };
  const folder = await fs.mkdtemp(path.join(output, 'jar-ui-')), jar = path.join(folder, 'order service.jar');
  await fs.writeFile(jar, 'Not executable; used only for UI registration');
  const configFile = path.join(folder, 'application.yml');
  await fs.writeFile(configFile, '\uFEFFport: 9000\r\n');
  await fs.writeFile(path.join(folder, `application-${'example-'.repeat(18)}.yaml`), 'port: 9001\n');
  const previousDialog = dialog.showOpenDialog;
  const previousMode = await js('document.documentElement.dataset.displayMode') || 'normal';
  const previousThrottling = window.webContents.getBackgroundThrottling();
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [jar] });
  try {
    window.setSize(1440, 1000);
    window.webContents.setBackgroundThrottling(false);
    await verifyHostEditor(window, output, click, wait);
    await js('document.documentElement.dataset.theme="light"');
    await openShared(window, '服务管理', wait);
    await wait('!document.querySelector(".jar-center button.run-button").disabled');
    await checkServiceHeader();
    const project = path.join(folder, 'npm project');
    await fs.mkdir(project);
    await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ scripts: { 'serve:test': 'node server.cjs' } }));
    await fs.writeFile(path.join(project, 'server.cjs'), "console.log('npm desktop ready'); setInterval(() => {}, 1000)");
    await click('添加服务');
    await wait('!!document.querySelector(".jar-dialog[open]")');
    await click('查找已安装版本', '.jar-runtime-field');
    await wait('!!document.querySelector(".jar-runtime-field li button")');
    const selectedJava = await js('document.querySelector(".jar-runtime-field li span").textContent');
    await js('document.querySelector(".jar-runtime-field li button").click()');
    await wait('document.querySelector(".jar-runtime-field input").value === ' + JSON.stringify(selectedJava));
    await click('检测 Java', '.jar-dialog');
    await wait('!!document.querySelector(".jar-dialog .jar-runtime-probe [role=status]")?.textContent.trim()');
    await click('可执行程序', '.jar-dialog');
    assert.ok(!await js("document.querySelector('.jar-dialog').textContent.includes('检测 Java')"));
    assert.equal(await js("document.querySelector('.jar-dialog .jar-runtime-probe button').disabled"), true);
    await fill('可执行程序绝对路径', process.execPath);
    await click('检查可执行文件', '.jar-dialog');
    await wait('document.querySelector(".jar-dialog .jar-runtime-probe .jar-help")?.textContent.includes("检查通过")');
    await fill('可执行程序绝对路径', path.join(folder, 'missing.exe'));
    assert.equal(await js("document.querySelector('.jar-dialog .jar-runtime-probe [role=status]')"), null);
    await click('检查可执行文件', '.jar-dialog');
    await wait('document.querySelector(".jar-dialog .jar-runtime-probe .jar-error")?.textContent.includes("不存在")');
    await click('npm 项目', '.jar-dialog');
    assert.ok(!await js("document.querySelector('.jar-dialog').textContent.includes('检测 Java')"));
    await click('检测 Node.js 和 npm', '.jar-dialog');
    await wait('document.querySelectorAll(".jar-dialog .jar-runtime-probe .jar-help").length === 2');
    await fill('公共环境变量', 'PATH=' + folder);
    assert.equal(await js("document.querySelector('.jar-dialog .jar-runtime-probe [role=status]')"), null);
    await click('检测 Node.js 和 npm', '.jar-dialog');
    await wait('document.querySelectorAll(".jar-dialog .jar-runtime-probe .jar-error").length === 2');
    const chosenNode = require('node:child_process').execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8', windowsHide: true }).trim();
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosenNode] });
    await click('手动选文件', '.jar-runtime-field');
    await click('系统选择…', '.host-directory');
    await wait('document.querySelector(".jar-dialog input[placeholder*=PATH]").value === ' + JSON.stringify(chosenNode));
    assert.equal(await js("document.querySelector('.jar-dialog .jar-runtime-probe [role=status]')"), null);
    await click('检测 Node.js 和 npm', '.jar-dialog');
    await wait('document.querySelectorAll(".jar-dialog .jar-runtime-probe .jar-help").length === 2');
    await fill('公共环境变量', '');
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
    await click('选择目录', '.jar-dialog');
    await click('系统选择…', '.host-directory');
    await wait('document.querySelector(".jar-dialog code")?.textContent === "npm run serve:test"');
    await click('保存服务', '.jar-dialog');
    await wait('!document.querySelector(".jar-dialog[open]") && !!document.querySelector(".jar-table")');
    const service = await js('window.devkitJar.request("get").then(r => r.data.instances.find(i => i.kind === "npm"))');
    assert.equal(service.nodePath, await fs.realpath(chosenNode));
    await js(`(async () => {
      const { data } = await window.devkitProjects.request('get');
      data.profiles[0].projects.push({ id: 'service-ui', name: '服务关联测试', code: 'service-ui', url: 'http://localhost/', enabled: true, group: '', description: '', query: [] });
      const result = await window.devkitProjects.request('save', { data, revision: data.revision });
      if (result.error) throw Error(result.error);
    })()`);
    await click('关联项目', '.jar-instance');
    await wait('document.querySelector(".service-projects")?.textContent.includes("服务关联测试")');
    const association = 'Array.from(document.querySelectorAll(".service-projects li")).find(row=>row.textContent.includes("服务关联测试"))';
    await js(association + '.querySelector(".secondary-button").click()');
    await wait(association + '.textContent.includes("解除关联")');
    assert.equal(await js("window.devkitProjects.request('get').then(r=>r.data.profiles[0].projects.find(p=>p.id==='service-ui').resources.jar)"), service.id);
    await js(association + '.querySelector(".secondary-button").click()');
    await wait(association + '.querySelector(".secondary-button").textContent === "关联项目"');
    await click('新建关联项目', 'dialog[open]');
    await wait('document.querySelector("dialog[open] h2")?.textContent.includes("项目定义")');
    await js(`{ const field = [...document.querySelectorAll('dialog[open] label')].find(label => label.querySelector('span')?.textContent === '项目名称').querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, '从服务新建的项目');
      field.dispatchEvent(new Event('input', { bubbles: true })); }`);
    await click('保存项目定义', 'dialog[open]');
    await wait('!document.querySelector("dialog[open]") && !!document.querySelector(".jar-instance")');
    assert.equal(await js("window.devkitProjects.request('get').then(r=>r.data.profiles.flatMap(p=>p.projects).find(p=>p.name==='从服务新建的项目')?.resources?.jar)"), service.id);
    await click('设置', '.jar-instance');
    await wait('document.querySelector(".jar-dialog[open] input[placeholder*=PATH]")?.value === ' + JSON.stringify(service.nodePath));
    await click('取消', '.jar-dialog');
    await wait('!document.querySelector(".jar-dialog[open]")');
    const backend = async (action, payload) => {
      const response = await js('window.devkitJar.request(' + JSON.stringify(action) + ',' + JSON.stringify(payload) + ')');
      assert.ok(!response.error, response.error); return response.data;
    };
    try {
      await backend('command', { id: service.id, command: 'start' });
      assert.match((await backend('log-tail', { id: service.id })).text, /npm desktop ready/);
    } finally {
      await backend('command', { id: service.id, command: 'force-stop' });
      await backend('remove', { id: service.id, revision: (await backend('get')).revision });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [jar] });
    }
    await click('刷新');
    await wait('!document.querySelector(".jar-table") && !document.querySelector(".jar-heading .run-button").disabled');
    await click('添加服务'); await wait('!!document.querySelector(".jar-dialog[open]")');
    if (await js('!matchMedia("(forced-colors: active)").matches')) {
      await js('document.querySelector(".jar-dialog select").showPicker()');
      await wait('!!document.querySelector(".jar-dialog select:open")');
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await wait('!!document.querySelector(".jar-dialog[open]") && !document.querySelector(".jar-dialog select:open")');
    }
    assert.equal(await js(`(() => {
      const dialog = document.querySelector('.jar-instance-editor'), body = dialog.querySelector('.jar-form-body');
      body.scrollTop = body.scrollHeight;
      const header = dialog.querySelector('header').getBoundingClientRect(), footer = dialog.querySelector('footer').getBoundingClientRect();
      const ok = body.scrollTop > 0 && dialog.scrollHeight <= dialog.clientHeight + 1 &&
        header.bottom <= body.getBoundingClientRect().top + 1 && footer.top >= body.getBoundingClientRect().bottom - 1;
      body.scrollTop = 0;
      return ok;
    })()`), true, 'JAR registration scrolls the settings independently of its header and save actions');
    await click('选择文件');
    await wait('!!document.querySelector(".host-directory-current")');
    await js(`{const field=document.querySelector('.host-directory-path input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(folder)});field.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await wait('!document.querySelector(".host-directory-actions .secondary-button").disabled');
    await click('打开', '.host-directory-actions');
    await wait('document.querySelector(".host-directory-list")?.textContent.includes("order service.jar")');
    await click('order service.jar', '.host-directory-list'); await wait(`document.querySelector('.jar-dialog input[placeholder="选择已有 .jar 文件"]').value === ${JSON.stringify(jar)}`);
    await fill('显示名称', '订单服务 · 测试环境');
    await fill('JVM 参数（每行一个）', '-Xms64m\n-Xmx256m');
    await js(`{const section=[...document.querySelectorAll('.jar-setting-section')].find(el=>el.querySelector('summary').textContent.includes('HTTP'));section.open=true; section.querySelector('[aria-label="检测方式"] button[value=tcp]').click();}`);
    await wait('!![...document.querySelectorAll(".jar-dialog label")].find(el=>el.firstChild?.textContent === "TCP 端口")');
    await fill('TCP 端口', '8123');
    await fill('公共环境变量', 'APP_MODE=base\nTOKEN=a=b');
    await js(`{const input=[...document.querySelectorAll('.jar-dialog label')].find(el=>el.firstChild?.textContent==='本次启动的环境档案').querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,'test');input.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await js(`{const input=[...document.querySelectorAll('.jar-profile')].find(el=>el.querySelector('summary').textContent.startsWith('测试')).querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'APP_MODE=test');input.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await js(`{const input=[...document.querySelectorAll('.jar-check')].find(el=>el.textContent.includes('非正常退出')).querySelector('input');input.click();}`);
    await fill('重试上限', '3');
    await click('保存服务'); await wait('!document.querySelector(".jar-dialog[open]")');
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
    await click('替换服务文件', '.jar-instance td > .jar-row-actions');
    const replacement = 'dialog[open].pc-dialog';
    const uploadButton = replacement + ' .run-button';
    await wait(`document.querySelector('${replacement}')?.textContent.includes('替换服务文件')`);
    await wait(`parseFloat(document.querySelector('${uploadButton} .motion-label-slot').style.minWidth) > 0`);
    await click('停止服务并继续', replacement);
    await wait(`!!document.querySelector('${replacement} input[type=file]')`);
    async function checkUploadLabel() {
      const { left, right } = await js(`{
        const button = document.querySelector('${uploadButton}');
        const bounds = button.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(button.querySelector('.motion-text-current'));
        const label = range.getBoundingClientRect();
        ({ left: label.left - bounds.left, right: bounds.right - label.right });
      }`);
      assert.ok(Math.abs(left - right) < 1, `Upload label should be centered (left ${left}px, right ${right}px)`);
    }
    await js(`Promise.allSettled(document.querySelector('${replacement}').getAnimations({subtree:true})
      .filter(animation => animation.effect.getComputedTiming().endTime < Infinity).map(animation => animation.finished))`);
    await checkUploadLabel();
    const buttonRect = await js(`{
      const r = document.querySelector('${uploadButton}').getBoundingClientRect();
      ({ x: Math.floor(r.x) - 5, y: Math.floor(r.y) - 5, width: Math.ceil(r.width) + 10, height: Math.ceil(r.height) + 10 });
    }`);
    await fs.writeFile(path.join(output, 'jar-upload-button.png'), (await window.webContents.capturePage(buttonRect)).toPNG());
    assert.deepEqual(await js(`[...document.querySelectorAll('${replacement} input[type=checkbox]')].map(input => input.checked)`), [true, true]);
    await js(`document.querySelectorAll('${replacement} input[type=checkbox]')[1].click()`);
    await cancelReplacementPicker(window, replacement + ' input[type=file]', js);
    assert.ok(await js(`!!document.querySelector('${replacement} input[type=file]')`), 'Cancel in the file chooser keeps the stopped-service dialog open');
    assert.equal(await js(`document.querySelectorAll('${replacement} input[type=checkbox]')[1].checked`), false);
    const updatedJar = path.join(folder, 'updated.jar');
    await fs.writeFile(updatedJar, 'replacement fixture');
    window.webContents.debugger.attach('1.3');
    try {
      const { root } = await window.webContents.debugger.sendCommand('DOM.getDocument');
      const { nodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: replacement + ' input[type=file]' });
      await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [updatedJar] });
    } finally { window.webContents.debugger.detach(); }
    await wait(`document.querySelector('${replacement} input[type=file]').files[0]?.name === 'updated.jar' && !document.querySelector('${replacement} .run-button').disabled`);
    await checkUploadLabel();
    await js(`document.querySelector('${replacement} .run-button').click()`);
    await wait(`document.querySelector('${replacement} [role=status]')?.textContent.includes('文件已替换，服务已停止')`);
    assert.equal(await fs.readFile(jar, 'utf8'), 'replacement fixture');
    const backupName = (await fs.readdir(folder)).find(name => name.startsWith('order service.jar.') && name.endsWith('.bak'));
    assert.equal(await fs.readFile(path.join(folder, backupName), 'utf8'), 'Not executable; used only for UI registration');
    await click('关闭', replacement);
    await wait(`!document.querySelector('${replacement}')`);
    const cardSize = window.getSize(), cardMinimum = window.getMinimumSize();
    window.setMinimumSize(360, 600); window.setSize(391, 830);
    await wait('innerWidth < 430 && getComputedStyle(document.querySelector(".jar-instance")).display === "grid" && document.querySelector(".sidebar").getBoundingClientRect().right <= 0');
    await checkServiceHeader();
    assert.equal(await js(`(() => {
      const row = document.querySelector('.jar-instance'), bounds = row.getBoundingClientRect();
      const actions = [...row.querySelectorAll('td > .jar-row-actions button')];
      return bounds.right <= innerWidth && ['启动', '停止', '替换服务文件', '日志'].every(label => actions.some(button => button.textContent.trim() === label))
        && actions.every(button => button.offsetWidth > 0 && button.getBoundingClientRect().right <= bounds.right) && !row.querySelector('details').open;
    })()`), true, 'Narrow JAR cards expose replacement and other primary actions without horizontal scrolling');
    await js('document.querySelector(".jar-instance").scrollIntoView({ block: "center", behavior: "instant" })');
    await fs.writeFile(path.join(output, 'jar-mobile-card.png'), (await window.webContents.capturePage()).toPNG());
    window.setMinimumSize(...cardMinimum); window.setSize(...cardSize);
    await wait('innerWidth > 920');
    await js('document.querySelector(".top-actions [aria-label=配置文件]").click()');
    await wait('document.querySelector(".config-source select")?.options.length > 1');
    await js('document.querySelector(".config-source select").selectedIndex = 1; document.querySelector(".config-source select").dispatchEvent(new Event("change",{bubbles:true}))');
    await wait("!!document.querySelector('.jar-configs option[value=\"application.yml\"]')");
    assert.equal(await js(`{
      const toolbar = document.querySelector('.jar-config-source .pc-field-action');
      const field = toolbar.querySelector('select').getBoundingClientRect();
      const label = toolbar.querySelector('label span').getBoundingClientRect();
      const refresh = toolbar.querySelector('button').getBoundingClientRect();
      label.bottom < field.top && refresh.left - field.right >= 8 && Math.abs(refresh.bottom - field.bottom) <= 1;
    }`), true, 'File label sits above the selector and refresh aligns alongside it with a gap');
    await js(`{ const field = document.querySelector('.jar-configs select'); field.value = 'application.yml'; field.dispatchEvent(new Event('change',{bubbles:true})); }`);
    await wait('!!document.querySelector(".jar-configs .cm-content")');
    await js(`Promise.allSettled(document.querySelector('.jar-config-dialog').getAnimations().map(animation => animation.finished))`);
    await fs.writeFile(path.join(output, 'jar-config-light.png'), (await window.webContents.capturePage()).toPNG());
    const configWindowSize = window.getSize(), configMinimumSize = window.getMinimumSize();
    window.setMinimumSize(360, 600);
    window.setSize(390, 700);
    await js('document.documentElement.dataset.theme="dark"');
    await wait('innerWidth < 440');
    await js('new Promise(resolve => setTimeout(resolve, 200))');
    assert.equal(await js(`{
      const modal = document.querySelector('.jar-config-dialog');
      const editor = modal.querySelector('.jar-config-editor').getBoundingClientRect();
      const footer = modal.querySelector('footer');
      const bounds = footer.getBoundingClientRect();
      const save = footer.querySelector('.run-button').getBoundingClientRect();
      modal.scrollWidth <= modal.clientWidth + 1 && editor.height >= 180 && save.right <= bounds.right && save.bottom <= innerHeight;
    }`), true, 'The configuration editor and save button remain usable in a narrow window');
    await fs.writeFile(path.join(output, 'jar-config-dark-narrow.png'), (await window.webContents.capturePage()).toPNG());
    window.setMinimumSize(...configMinimumSize);
    window.setSize(...configWindowSize);
    await js('document.documentElement.dataset.theme="light"');
    await js("document.querySelector('.jar-configs .cm-content').focus()");
    await window.webContents.insertText('name: sample\n');
    await click('预览修改', '.jar-config-actions');
    await wait('!!document.querySelector(".jar-configs .change-preview")');
    await click('保存配置', '.jar-config-actions');
    await wait('document.querySelector(".pc-dialog[open] [role=status]")?.textContent.includes("已保存")');
    assert.match(await fs.readFile(configFile, 'utf8'), /^\uFEFF.*\r\n/s);
    assert.match(await fs.readFile(configFile, 'utf8'), /name: sample/);
    await click('查看上一版', '.jar-config-actions');
    await wait('!!document.querySelector(".jar-configs .change-preview")');
    await js('document.querySelector(\'button[aria-label="关闭服务配置文件"]\').click()');
    await fs.writeFile(path.join(folder, item.logName), 'fixture log 中文\nready for inspection\n');
    await click('日志'); await wait('document.querySelector(".jar-log pre")?.textContent.includes("fixture log 中文")');
    await new Promise(resolve => setTimeout(resolve, 450));
    await fs.writeFile(path.join(output, 'jar-list-light.png'), (await window.webContents.capturePage()).toPNG());
    await js('document.querySelector(\'[aria-label="关闭日志"]\').click()');
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
    assert.equal(await fs.readFile(jar, 'utf8'), 'replacement fixture');
    await js('document.querySelector(\'.nav-item[title="设置"]\').click()');
    await wait('!!document.querySelector(\'.settings-page button[value="performance"]\')');
    await js(`document.querySelector('.settings-page button[value="performance"]').click()`);
    await wait('document.documentElement.dataset.displayMode === "performance"');
    assert.equal(await js('JSON.parse(localStorage.getItem("devkit:preferences")).displayMode'), 'performance');
    await openShared(window, '服务管理', wait);
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
        await wait(`[...document.querySelectorAll('.jar-table .jar-row-actions button:enabled')].some(button => button.textContent.trim() === '启动')`);
        await click('启动'); await wait('document.querySelector(".jar-table")?.textContent.includes("独立守护中")');
        await wait('document.querySelector(".jar-console pre")?.textContent.includes("ELECTRON-SUPERVISOR-READY")');
        await click('取得输入控制权'); await wait('!document.querySelector(".jar-console-input input").disabled');
        await js(`{const input=document.querySelector('.jar-console-input input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'console 中文');input.dispatchEvent(new Event('input',{bubbles:true}));}`);
        await click('发送'); await wait('document.querySelector(".jar-console pre")?.textContent.includes("ECHO:console 中文")');
        await fs.writeFile(path.join(output, 'jar-console-light.png'), (await window.webContents.capturePage()).toPNG());
        await js('document.querySelector(\'button[aria-label="关闭控制台"]\').click()');
        assert.equal(await js('document.querySelector(".jar-status").textContent'), '运行中');
        await click('控制台'); await wait('document.querySelector(".jar-console pre")?.textContent.includes("ECHO:console 中文")');
        await click('停止应用', '.jar-console'); await wait('!!document.querySelector(".confirm-dialog[open]")'); await click('停止服务', '.confirm-dialog[open]');
        await wait('document.querySelector(".jar-status")?.textContent === "已停止"');
        await js('document.querySelector(\'[aria-label="关闭控制台"]\').click()');
        const request = async (action, payload) => {
          const response = await js(`window.devkitJar.request(${JSON.stringify(action)},${JSON.stringify({ id: live.id, ...payload })})`);
          assert.equal(response.error, undefined); return response.data;
        };
        const validJar = await fs.readFile(liveJar);
        const { token } = await request('replace-begin', { expectedPath: live.jar });
        await request('replace-chunk', { token, offset: 0, data: 'YWJj' });
        const archived = await request('replace-finish', { token, size: 3, backup: true, start: false });
        await click('替换服务文件', '.jar-instance td > .jar-row-actions');
        await click('恢复历史备份', replacement);
        await wait(`!!document.querySelector('${replacement} select option[value]:not([value=""])')`);
        assert.equal(await js(`document.querySelector('${replacement} .run-button').disabled`), true);
        await js(`{const s=document.querySelector('${replacement} select');s.value=${JSON.stringify(path.basename(archived.backup))};s.dispatchEvent(new Event('change',{bubbles:true}));}`);
        await click('恢复并启动', replacement);
        await wait(`document.querySelector('${replacement} [role=status]')?.textContent.includes('备份已恢复，服务已启动')`);
        assert.deepEqual(await fs.readFile(liveJar), validJar);
        assert.deepEqual(await fs.readFile(archived.backup), validJar);
        const statuses = await request('statuses', {});
        assert.equal(statuses.find(status => status.id === live.id).state, 'running');
        await click('关闭', replacement);
      } finally { await js(`window.devkitJar.request('command',{id:${JSON.stringify(live.id)},command:'force-stop'})`); }
      await verifyLanHost(window, folder, liveJar, java.executable, click, wait);
    }
    console.log('JAR desktop smoke passed: local and remote registration, Java launch, configuration preview and backup, performance mode, logs, themes and narrow layout.');
  } finally {
    dialog.showOpenDialog = previousDialog;
    await js(`{
      document.querySelector('.settings-page [aria-label="运行模式"] button[value=${JSON.stringify(previousMode)}]')?.click();
    }`);
    await wait(`document.documentElement.dataset.displayMode === ${JSON.stringify(previousMode)}`);
    window.webContents.setBackgroundThrottling(previousThrottling);
  }
};

async function verifyHostEditor(window, output, click, wait) {
  const js = source => window.webContents.executeJavaScript(source, true);
  const [width, height] = window.getSize(), minimum = window.getMinimumSize();
  const theme = await js('document.documentElement.dataset.theme');
  const painted = () => js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const visible = '!!document.querySelector(".lan-host-dialog[open]")';
  async function capture(name) {
    await painted();
    await js(`Promise.allSettled(document.querySelector('.lan-host-dialog').getAnimations({subtree:true})
      .filter(animation => animation.playState === 'running' && animation.effect.getComputedTiming().endTime < Infinity).map(animation => animation.finished))`);
    await painted();
    const rectangle = await js(`{ const rect = document.querySelector('.lan-host-dialog').getBoundingClientRect();
      ({ x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) }); }`);
    await fs.writeFile(path.join(output, name), (await window.webContents.capturePage(rectangle)).toPNG());
  }
  try {
    window.show(); window.focus();
    await openShared(window, '局域网主机', wait);
    await js('document.documentElement.dataset.theme="dark"');
    await click('添加主机', '.lan-center');
    await wait(visible);
    assert.equal(await js(`{
      const icon = document.querySelector('.lan-host-dialog .pc-dialog-icon').getBoundingClientRect();
      const title = document.querySelector('.lan-host-dialog h2').getBoundingClientRect();
      title.left > icon.right && title.height < 30;
    }`), true, 'Host title fits on one line next to the icon');
    assert.equal(await js(`Array.from(document.querySelectorAll('.lan-host-form .lan-field')).every(field => {
      const label = field.firstElementChild.getBoundingClientRect(), control = field.querySelector('input,select,[role=group]').getBoundingClientRect();
      return label.bottom < control.top && Math.abs(label.left - control.left) < 2;
    })`), true, 'Host labels sit above left-aligned inputs');
    await capture('lan-host-ssh-dark.png');
    await js(`document.querySelector('.lan-host-form input[value="share"]').click(); document.documentElement.dataset.theme="light"`);
    await wait('!!document.querySelector(\'.lan-address input[placeholder^="http"]\')');
    await capture('lan-host-share-light.png');
    await js('document.querySelector(\'.lan-host-form input[value="ssh"]\').click()');
    window.setMinimumSize(360, 450);
    window.setContentSize(420, 590);
    await wait('innerWidth <= 460');
    await painted();
    const thumbColors = await js(`(() => {
      const root = document.documentElement, body = document.querySelector('.lan-host-body');
      if (matchMedia('(forced-colors: active)').matches) return [];
      const { theme, themeStyle } = root.dataset, colors = [];
      try {
        for (const style of ['default','minimal','organic','editorial','brutalist','soft','glass','gradient','retro']) {
          root.dataset.themeStyle = style;
          for (const brightness of ['light','dark']) {
            root.dataset.theme = brightness;
            if (getComputedStyle(body).scrollbarWidth !== 'auto' || getComputedStyle(body, '::-webkit-scrollbar-button').display !== 'none')
              throw new Error('Host dialog reverted to a system scrollbar: ' + style + '/' + brightness);
            colors.push(getComputedStyle(body, '::-webkit-scrollbar-thumb').backgroundColor);
          }
        }
      } finally {
        root.dataset.theme = theme;
        if (themeStyle === undefined) delete root.dataset.themeStyle;
        else root.dataset.themeStyle = themeStyle;
      }
      return colors;
    })()`);
    assert.ok(thumbColors.every((color, index) => index % 2 === 0 || color !== thumbColors[index - 1]), 'Scrollbar follows each light/dark palette');
    const narrow = await js(`{ const dialog = document.querySelector('.lan-host-dialog'), body = dialog.querySelector('.lan-host-body'), footer = dialog.querySelector('.lan-host-footer');
      ({ inside: footer.getBoundingClientRect().bottom <= dialog.getBoundingClientRect().bottom + 1, width: body.clientWidth, scrollWidth: body.scrollWidth, height: body.clientHeight, scrollHeight: body.scrollHeight }); }`);
    await capture('lan-host-ssh-narrow.png');
    await js('document.documentElement.dataset.theme="dark"');
    await capture('lan-host-ssh-narrow-dark.png');
    await js('document.documentElement.dataset.theme="light"');
    assert.ok(narrow.scrollHeight > narrow.height && narrow.scrollWidth <= narrow.width && narrow.inside,
    'Host editor scrolls vertically with the footer visible on narrow windows: ' + JSON.stringify(narrow));
    assert.ok(await js(`(() => {
      const platform = document.querySelector('.lan-platform .segmented-control');
      return platform.scrollWidth <= platform.clientWidth + 1;
    })()`), 'The platform options fit beside the scrollbar');
    assert.ok(await js(`(() => {
      const dialog = document.querySelector('.lan-host-dialog'), body = dialog.querySelector('.lan-host-body');
      const last = body.querySelector('input[placeholder="00:11:22:33:44:55"]');
      last.focus();
      return body.scrollTop > 0 && dialog.scrollTop === 0 &&
        last.getBoundingClientRect().bottom <= dialog.querySelector('footer').getBoundingClientRect().top;
    })()`), 'Focusing the final field scrolls the form while keeping the header and actions in place');
    const password = '.lan-password input';
    await js(`{ const input = document.querySelector('${password}');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'fixture-only');
      input.dispatchEvent(new Event('input', { bubbles: true })); }
      document.querySelector('.lan-password-toggle').click()`);
    await wait(`document.querySelector('${password}').type === 'text'`);
    await click('取消', '.lan-host-footer');
    await wait('!!document.querySelector(".lan-host-dialog .pc-discard")');
    await click('放弃更改', '.lan-host-dialog .pc-discard');
    await wait('!(' + visible + ')');
  } finally {
    window.setMinimumSize(...minimum);
    window.setSize(width, height);
    await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)};`);
  }
}

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
  await fs.writeFile(path.join(remote, 'remote.yml'), 'port: 9002\n');
  const store = await createProjectStore(path.join(remote, 'configs'));
  const jvm = await createJarManager(path.join(remote, 'configs'));
  const nginx = await createNginxManager(path.join(remote, 'configs'));
  const host = await createProjectHost(store, path.join(__dirname, '..', 'dist'), { jar: () => jvm, nginx: () => nginx });
  const service = require('node:net').createServer();
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  const port = service.address().port;
  await new Promise(resolve => service.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const gateway = require('node:net').createServer();
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const gatewayPort = gateway.address().port, gatewayOrigin = `http://127.0.0.1:${gatewayPort}`;
  await new Promise(resolve => gateway.close(resolve));
  const services = emptySharingServices();
  services.jar = { enabled: true, edit: true, control: true, backend: true };
  services.nginx.enabled = true;
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
  let id, gatewayWindow, gatewayStarted = false;
  const go = name => openShared(window, name, wait);
  try {
    await host.start({ host: '127.0.0.1', port, services, password: 'devkit-lan-smoke' });
    await go('局域网主机');
    await click('添加主机', '.lan-center');
    await wait('!!document.querySelector("dialog[open] .lan-host-form")');
    await js(window, 'document.querySelector(\'.lan-host-form input[value="share"]\').click()');
    await input(window, '.lan-host-form input[placeholder="例如：测试服务器"]', '远程测试主机');
    await input(window, '.lan-host-form input[placeholder="http://192.168.1.20:8765"]', origin);
    await input(window, '.lan-host-form input[type=password]', 'devkit-lan-smoke');
    await js(window, 'document.querySelectorAll(".lan-module-settings input").forEach(field => field.click())');
    await click('保存连接', '.lan-host-form');
    await wait('document.querySelector(".lan-host-list")?.textContent.includes("远程测试主机")');
    const selectRemoteHost = () => js(window, '[...document.querySelectorAll(".lan-connection-select")].find(row => row.querySelector("strong").textContent === "远程测试主机").click()');
    await selectRemoteHost();
    await js(window, 'document.querySelector(\'.lan-host-list button[aria-label="编辑 远程测试主机"]\').click()');
    await wait('document.querySelector(".lan-host-dialog h2")?.textContent === "编辑主机连接"');
    assert.deepEqual(await js(window, `{
      const input = document.querySelector('.lan-host-dialog input[type="password"]');
      ({ value: input.value, placeholder: input.placeholder, methods: document.querySelector('.lan-host-form input[value="share"]').checked });
    }`), { value: '', placeholder: '已保存，留空沿用', methods: true });
    await click('取消', '.lan-host-footer');
    await wait('!document.querySelector(".lan-host-dialog[open]")');
    await selectRemoteHost();
    await click('测试连接', '.lan-host-list');
    await when(window, 'document.querySelector(".lan-diagnostic")?.textContent.includes("共享口令有效")');
    await js(window, `document.querySelector('button[aria-label="关闭连接诊断"]').click()`);
    await selectRemoteHost();
    await click('启用端口监控', '.lan-host-list');
    await when(window, 'document.querySelector(".workspace:not([hidden]) .monitor-detail h2")?.textContent === "远程测试主机"');
    await go('局域网主机');
    await when(window, 'document.querySelector(".lan-monitor-status")?.textContent.includes("端口可达")', 22_000);
    await click('导入主机', '.lan-heading');
    await when(window, '!!document.querySelector("dialog[open] textarea")');
    const csv = `name,address,user,port,group,tags\n测试档案,192.0.2.5,ops,22,测试,demo|ssh\n重复档案,192.0.2.5,ops,22,测试,demo`;
    await js(window, `{ const field = document.querySelector('dialog[open] textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(csv)}); field.dispatchEvent(new Event('input', { bubbles: true })); }`);
    await click('预览导入', 'dialog[open]');
    await when(window, 'document.querySelector(".lan-import-results")?.textContent.includes("重复连接")');
    await click('导入选中的 1 条', 'dialog[open]');
    await when(window, 'document.querySelector(".lan-host-tags")?.textContent.includes("demo")');
    await js(window, `document.querySelector('[aria-label="置顶 测试档案"]').click()`);
    await when(window, 'document.querySelector(".lan-group-label")?.textContent === "置顶"');
    await click('发现主机', '.lan-heading');
    await when(window, '!!document.querySelector(".lan-scan-fields")');
    await js(window, `document.querySelector('[aria-label="关闭主机扫描"]').click()`);
    await when(window, '!document.querySelector(".lan-scan-fields")');
    await go('服务管理');
    await wait('!document.querySelector(".jar-center button.run-button")?.disabled');
    await click('添加服务');
    await js(window, '{const field=document.querySelector(".jar-dialog select");field.selectedIndex=1;field.dispatchEvent(new Event("change",{bubbles:true}));}');
    await wait('[...document.querySelectorAll(".jar-dialog button")].some(b => b.textContent === "npm 项目" && !b.disabled)');
    await click('npm 项目', '.jar-dialog');
    const remoteNode = require('node:child_process').execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8', windowsHide: true }).trim();
    const nodePath = JSON.stringify(await fs.realpath(remoteNode));
    await click('查找已安装版本', '.jar-runtime-field');
    await wait('[...document.querySelectorAll(".jar-runtime-field li span")].some(el => el.textContent === ' + nodePath + ')');
    await js(window, '[...document.querySelectorAll(".jar-runtime-field li span")].find(el => el.textContent === ' + nodePath + ').closest("button").click()');
    await wait('document.querySelector(".jar-runtime-field input").value === ' + nodePath);
    await click('检测 Node.js 和 npm', '.jar-dialog');
    await wait('document.querySelectorAll(".jar-dialog .jar-runtime-probe .jar-help").length === 2');
    await click('Java JAR', '.jar-dialog');
    await click('选择文件', '.jar-dialog');
    await wait('!!document.querySelector(".host-directory-path")');
    await when(window, '!document.querySelector(".host-directory-path .secondary-button")?.disabled');
    await input(window, '.host-directory-path input', remote);
    await click('打开', '.host-directory');
    await when(window, 'document.querySelector(".host-directory-list")?.textContent.includes("remote.jar")');
    await click('remote.jar', '.host-directory-list');
    await input(window, '.jar-dialog input[placeholder^="例如"]', '远端 Java');
    await input(window, '.jar-dialog input[placeholder^="留空"]', executable);
    await click('保存服务', '.jar-dialog');
    await when(window, '[...document.querySelectorAll(".jar-table tbody")].some(group => group.textContent.includes("远程测试主机") && group.textContent.includes("远端 Java") && group.textContent.includes("已停止"))');
    id = (await jvm.request('get')).instances[0].id;
    assert.equal(await js(window, `window.devkitJar.request('get').then(result => result.data.instances.some(item => item.jar === ${JSON.stringify(remoteJar)}))`), false);
    const started = await js(window, `window.devkitProjects.request('start', ${JSON.stringify({ host: '127.0.0.1', port: gatewayPort, services, password: 'devkit-gateway-smoke' })})`);
    assert.ok(!started.error, started.error);
    gatewayStarted = true;
    gatewayWindow = new BrowserWindow({ show: false, webPreferences: { partition: 'devkit-gateway-smoke', sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    await gatewayWindow.loadURL(`${gatewayOrigin}/#jar`);
    assert.equal(await js(gatewayWindow, 'typeof window.devkitDesktop'), 'undefined');
    await when(gatewayWindow, '!!document.querySelector(".portal-login .run-button:enabled")');
    await input(gatewayWindow, '.portal-login input[type=password]', 'devkit-gateway-smoke');
    await js(gatewayWindow, 'document.querySelector(".portal-login .run-button").click()');
    const group = 'Array.from(document.querySelectorAll(".jar-table tbody")).find(group => group.textContent.includes("远程测试主机"))';
    await when(gatewayWindow, `${group}?.querySelector('.jar-status')?.textContent === '已停止'`);
    await js(gatewayWindow, 'document.querySelector(".portal-account [aria-label=配置文件]").click()');
    await when(gatewayWindow, 'document.querySelector(".config-source select")?.options.length > 1');
    await js(gatewayWindow, `{const select=document.querySelector('.config-source select');const name=(${group}).querySelector('.jar-instance-title strong').textContent;select.value=[...select.options].find(o=>o.textContent.endsWith(' · '+name)).value;select.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await when(gatewayWindow, "!!document.querySelector('.jar-configs option[value=\"remote.yml\"]')");
    await js(gatewayWindow, `{
      const field = document.querySelector('.jar-configs select');
      field.value = 'remote.yml';
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }`);
    await when(gatewayWindow, 'document.querySelector(".jar-configs .cm-content")?.textContent.includes("port: 9002")');
    await js(gatewayWindow, 'document.querySelector(\'button[aria-label="关闭服务配置文件"]\').click()');
    await when(gatewayWindow, '!document.querySelector(".jar-config-dialog[open]")');
    await js(gatewayWindow, `Array.from((${group}).querySelectorAll('.jar-row-actions button')).find(b=>b.textContent.trim()==='启动').click()`);
    await when(gatewayWindow, `${group}?.querySelector('.jar-status')?.textContent === '运行中'`, 35_000);
    assert.ok((await jvm.request('statuses'))[0].pid > 1);
    await go('Nginx 配置');
    await when(window, '!document.querySelector(".ng-center .ng-heading .run-button")?.disabled');
    await click('添加实例', '.ng-center');
    assert.match(await js(window, 'document.querySelector(".ng-form-modal select")?.textContent'), /远程测试主机（只读）/);
    await js(window, 'document.querySelector(\'.ng-form-modal button[aria-label="关闭对话框"]\').click()');
  } finally {
    gatewayWindow?.destroy();
    if (gatewayStarted) await js(window, "window.devkitProjects.request('stop')");
    if (id) await jvm.request('command', { id, command: 'force-stop' }).catch(() => {});
    await host.stop();
    await jvm.close();
    await nginx.close();
    await store.close();
  }
}
