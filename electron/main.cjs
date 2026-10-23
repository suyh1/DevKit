const { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } = require('electron');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { origin, csp, isAppUrl, assetPath, validateSave } = require('./policy.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'devkit', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.enableSandbox();
if (process.platform === 'linux') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}
app.setName('DevKit');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
let window;
let saving = false;
let projectStore, projectHost, projectError = '', closing = false;
let projectStorage = { directory: path.join(app.isPackaged ? path.dirname(app.getPath('exe')) : (process.env.DEVKIT_DEV_ROOT || app.getAppPath()), 'configs'), portable: true, migratedFrom: '' };
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });

async function createWindow() {
  window = new BrowserWindow({
    width: 1360, height: 880, minWidth: 800, minHeight: 600, title: 'DevKit · 本地开发工作台',
    backgroundColor: '#11171f', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(window, { type: 'question', title: '尚有未保存的项目配置', message: '关闭 DevKit 并放弃当前草稿？', buttons: ['继续编辑', '放弃更改并关闭'], defaultId: 0, cancelId: 0, noLink: true });
    if (choice === 1) event.preventDefault();
  });
  window.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  await window.loadURL(`${origin}/index.html`);
}

app.whenReady().then(async () => {
  if (!primary) return;
  try {
    const { createProjectStore } = await import('./server/project-store.mjs');
    const { createProjectHost } = await import('./server/project-host.mjs');
    const { prepareProjectConfigs } = await import('./server/project-configs.mjs');
    projectStorage = await prepareProjectConfigs(projectStorage.directory, [path.join(app.getPath('userData'), 'project-center')]);
    projectStore = await createProjectStore(projectStorage.directory);
    projectHost = await createProjectHost(projectStore, path.join(__dirname, 'dist'));
    const sharing = await projectStore.settings();
    if (sharing.autoStart) {
      try { await projectHost.start(sharing); }
      catch (error) { dialog.showErrorBox('项目中心共享未启动', `${error.message}\n项目数据与其他工具仍可使用，请在共享设置中检查端口。`); }
    }
  } catch (error) { projectError = error.message; }
  const root = path.join(__dirname, 'dist');
  protocol.handle('devkit', async request => {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    const file = assetPath(root, request.url);
    if (!file) return new Response(null, { status: 403 });
    try {
      return new Response(await readFile(file), { headers: { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff' } });
    } catch { return new Response(null, { status: 404 }); }
  });
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isAppUrl(details.url) && !details.url.startsWith('blob:devkit://app/') && !details.url.startsWith('data:') }));
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(isAppUrl(contents.getURL()) && permission === 'clipboard-sanitized-write'));
  session.defaultSession.setPermissionCheckHandler((contents, permission) => !!contents && isAppUrl(contents.getURL()) && permission === 'clipboard-sanitized-write');
  ipcMain.handle('devkit:save-text', async (event, value) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isAppUrl(event.senderFrame.url)) throw new Error('拒绝未知页面的保存请求。');
    const { text, filename } = validateSave(value);
    if (saving) throw new Error('请先完成当前保存操作。');
    saving = true;
    try {
      const extension = path.extname(filename).slice(1);
      const result = await dialog.showSaveDialog(window, { defaultPath: filename, filters: extension ? [{ name: '文件', extensions: [extension] }] : [] });
      if (result.canceled || !result.filePath) return '已取消保存';
      await writeFile(result.filePath, text, 'utf8');
      return `已保存：${result.filePath}`;
    } finally { saving = false; }
  });
  ipcMain.handle('devkit:projects', async (event, action, value) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isAppUrl(event.senderFrame.url)) throw new Error('拒绝未知页面的项目中心请求。');
    try {
      if (action === 'session') return { data: { authenticated: true, role: 'owner' } };
      if (action === 'storage') return { data: { ...projectStorage, error: projectError } };
      if (action === 'open-configs') {
        const failure = await shell.openPath(projectStorage.directory);
        if (failure) throw new Error(failure);
        return { data: true };
      }
      if (!projectStore || !projectHost) throw new Error(projectError || '项目中心尚未准备好。');
      let data;
      switch (action) {
        case 'session': data = { authenticated: true, role: 'owner' }; break;
        case 'get': data = await projectStore.get(); break;
        case 'save': data = await projectStore.save(value?.data, value?.revision); break;
        case 'snapshots': data = await projectStore.snapshots(); break;
        case 'snapshot': data = await projectStore.snapshot(value?.id); break;
        case 'backup': data = { id: await projectStore.backup(value?.name) }; break;
        case 'restore': data = await projectStore.restore(value?.id, value?.revision); break;
        case 'probe': data = await (await import('./server/project-probe.mjs')).probeProjects(projectStore, value); break;
        case 'sharing': data = projectHost.status(); break;
        case 'start': data = await projectHost.start(value); break;
        case 'stop': data = await projectHost.stop(true); break;
        case 'open': {
          if (typeof value?.url !== 'string' || value.url.length > 12000) throw new Error('入口地址无效。');
          const url = new URL(value.url);
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('仅允许打开 HTTP(S) 入口。');
          await shell.openExternal(url.href); data = true; break;
        }
        default: throw new Error('未知项目中心操作。');
      }
      return { data };
    } catch (error) { return { error: error.message || '项目中心操作失败。' }; }
  });
  await createWindow();
}).catch(error => { dialog.showErrorBox('DevKit 启动失败', String(error)); app.quit(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (!projectStore || closing) return;
  event.preventDefault(); closing = true;
  (async () => { try { await projectHost?.stop(); await projectStore.close(); } finally { app.quit(); } })().catch(() => app.exit(1));
});
