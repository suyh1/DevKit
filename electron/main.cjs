const { app, BrowserWindow, dialog, ipcMain, protocol, session, shell, Tray, Menu } = require('electron');
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
let nginxManager, nginxError = '';
let httpClient;
let apiWorkspace, apiWorkspaceError = '';
let closeAllowed = false, reloadAllowed = false, closeIntent = false, pendingUnload = null;
const desktopPreferences = require('./desktop-preferences.cjs').createDesktopPreferences(path.join(app.getPath('userData'), 'desktop-settings.json'));
let tray, choosingClose = false, quitRequested = false, rememberQuit = false;
function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}
function requestQuit() {
  if (!window || window.isDestroyed()) { app.quit(); return; }
  choosingClose = false; quitRequested = true; showWindow(); window.close();
}
function hideToTray() {
  if (!tray || tray.isDestroyed()) {
    const created = new Tray(path.join(__dirname, 'tray-icon.png'));
    try {
      created.setToolTip('DevKit · 本地开发工作台');
      created.setContextMenu(Menu.buildFromTemplate([
        { label: '打开 DevKit', click: showWindow },
        { type: 'separator' },
        { label: '退出 DevKit', click: requestQuit },
      ]));
      created.on('click', showWindow); created.on('double-click', showWindow);
      tray = created;
    } catch (error) { created.destroy(); throw error; }
  }
  window.hide();
}
let projectStorage = { directory: path.join(app.isPackaged ? path.dirname(app.getPath('exe')) : (process.env.DEVKIT_DEV_ROOT || app.getAppPath()), 'configs'), portable: true, migratedFrom: '' };
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance', showWindow);
app.on('activate', showWindow);

async function createWindow() {
  httpClient = (await import('./server/http-client.mjs')).createHttpClient();
  window = new BrowserWindow({
    width: 1360, height: 880, minWidth: 800, minHeight: 600, title: 'DevKit · 本地开发工作台',
    backgroundColor: '#11171f', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) httpClient?.cancelAll(); });
  window.on('closed', () => {
    httpClient?.close();
    if (rememberQuit) { try { desktopPreferences.set('quit'); } catch (error) { dialog.showErrorBox('关闭偏好未保存', error.message); } rememberQuit = false; }
  });
  window.on('close', event => {
    if (closeAllowed || quitRequested) { closeIntent = true; return; }
    event.preventDefault();
    if (choosingClose || pendingUnload) return;
    const action = desktopPreferences.get().closeAction;
    if (action === 'quit') { setImmediate(requestQuit); return; }
    if (action === 'tray') {
      try { hideToTray(); return; }
      catch (error) { dialog.showErrorBox('无法最小化到托盘', `窗口仍保持打开。${error.message}`); }
    }
    choosingClose = true; window.webContents.send('devkit:close-request', 'choose');
  });
  window.webContents.on('will-prevent-unload', event => {
    if (closeAllowed || reloadAllowed) { reloadAllowed = false; event.preventDefault(); return; }
    if (pendingUnload) return;
    choosingClose = false;
    pendingUnload = closeIntent ? 'close' : 'reload';
    window.webContents.send('devkit:close-request', pendingUnload);
  });
  window.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('did-finish-load', () => { reloadAllowed = false; closeIntent = false; pendingUnload = null; choosingClose = false; quitRequested = false; });
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
    projectHost = await createProjectHost(projectStore, path.join(__dirname, 'dist'), { nginx: () => nginxManager, library: () => apiWorkspace });
    const sharing = await projectStore.settings();
    if (sharing.autoStart) {
      try { await projectHost.start(sharing); }
      catch (error) { dialog.showErrorBox('项目中心共享未启动', `${error.message}\n项目数据与其他工具仍可使用，请在共享设置中检查端口。`); }
    }
  } catch (error) { projectError = error.message; }
  try {
    const { createNginxManager } = await import('./server/nginx-manager.mjs');
    nginxManager = await createNginxManager(projectStorage.directory);
  } catch (error) { nginxError = error.message; }
  try {
    apiWorkspace = await (await import('./server/api-workspace.mjs')).createApiWorkspace(projectStorage.directory);
  } catch (error) { apiWorkspaceError = error.message; }
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
  ipcMain.handle('devkit:http', async (event, action, value) => {
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isAppUrl(event.senderFrame.url)) throw new Error('拒绝未知页面的 HTTP 请求。');
    try {
      if (['get-library', 'save-library', 'restore-library'].includes(action)) {
        if (!apiWorkspace) throw new Error(apiWorkspaceError || 'API工作区尚未准备好。');
        if (action === 'get-library') return { data: await apiWorkspace.get() };
        if (action === 'save-library') return { data: await apiWorkspace.save(value?.data, value?.revision) };
        return { data: await apiWorkspace.restore(value?.revision) };
      }
      if (!httpClient) throw new Error('HTTP 客户端尚未准备好。');
      if (action === 'send') return { data: await httpClient.send(value?.id, value?.request) };
      if (action === 'cancel') return { data: httpClient.cancel(value?.id) };
      throw new Error('未知 HTTP 操作。');
    } catch (error) { return { error: error.message || 'HTTP 请求失败。' }; }
  });
  ipcMain.handle('devkit:nginx', async (event, action, value) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isAppUrl(event.senderFrame.url)) throw new Error('拒绝未知页面的 Nginx 管理请求。');
    try {
      if (action === 'pick') {
        if (!['main', 'files', 'executable', 'prefix', 'directory'].includes(value?.kind)) throw new Error('无效的文件选择类型。');
        const result = await dialog.showOpenDialog(window, {
          title: value.kind === 'directory' ? '选择新建配置的目录' : value.kind === 'prefix' ? '选择 Nginx 运行目录' : value.kind === 'executable' ? '选择 nginx 程序' : '选择 Nginx 配置文件',
          properties: ['prefix', 'directory'].includes(value.kind) ? ['openDirectory'] : value.kind === 'files' ? ['openFile', 'multiSelections'] : ['openFile'],
        });
        return { data: result.canceled ? [] : result.filePaths };
      }
      if (!nginxManager) throw new Error(nginxError || 'Nginx 管理器尚未准备好。');
      return { data: await nginxManager.request(action, value) };
    } catch (error) { return { error: error.message || 'Nginx 操作失败。' }; }
  });
  const trustedDesktop = event => window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && isAppUrl(event.senderFrame.url);
  ipcMain.handle('devkit:desktop-settings', (event, action, value) => {
    if (!trustedDesktop(event)) throw new Error('拒绝未知页面的桌面设置请求。');
    if (action === 'get') return desktopPreferences.get();
    if (action === 'set') return desktopPreferences.set(value);
    throw new Error('未知桌面设置操作。');
  });
  ipcMain.handle('devkit:choose-close', (event, action, remember) => {
    if (!trustedDesktop(event) || !choosingClose) return;
    if (!['cancel', 'tray', 'quit'].includes(action) || typeof remember !== 'boolean') throw new Error('无效的关闭选择。');
    if (action === 'tray') {
      // Establish a usable tray before persisting or hiding anything.
      try { hideToTray(); if (remember) desktopPreferences.set('tray'); }
      catch (error) { showWindow(); throw error; }
    }
    choosingClose = false;
    if (action === 'quit') { rememberQuit = remember; setImmediate(requestQuit); }
  });
  ipcMain.on('devkit:answer-close', (event, allow) => {
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isAppUrl(event.senderFrame.url) || !pendingUnload) return;
    const intent = pendingUnload; pendingUnload = null;
    if (allow !== true) { closeIntent = false; quitRequested = false; rememberQuit = false; return; }
    if (intent === 'reload') { reloadAllowed = true; window.webContents.reload(); }
    else {
      if (rememberQuit) { try { desktopPreferences.set('quit'); } catch (error) { dialog.showErrorBox('关闭偏好未保存', error.message); } }
      rememberQuit = false; closeAllowed = true; window.close();
    }
  });
  await createWindow();
}).catch(error => { dialog.showErrorBox('DevKit 启动失败', String(error)); app.quit(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (window && !window.isDestroyed() && !closeAllowed) { event.preventDefault(); requestQuit(); return; }
  if ((!projectStore && !nginxManager && !apiWorkspace) || closing) return;
  event.preventDefault(); closing = true;
  (async () => { try { await projectHost?.stop(); await projectStore?.close(); await nginxManager?.close(); await apiWorkspace?.close(); } finally { app.quit(); } })().catch(() => app.exit(1));
});
app.on('will-quit', () => tray?.destroy());
