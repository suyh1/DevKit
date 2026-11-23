const { app, BrowserWindow, dialog, ipcMain, protocol, session, shell, Tray, Menu } = require('electron');
const { readFile, writeFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { origin, csp, isAppUrl, assetPath, validateSave, lanPortalUrl } = require('./policy.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'devkit', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.enableSandbox();
if (process.platform === 'linux') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}
app.setName('DevKit');
const previewProfile = !app.isPackaged && process.env.DEVKIT_PREVIEW_PROFILE;
if (previewProfile) {
  app.setPath('userData', previewProfile);
  app.setPath('sessionData', previewProfile);
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
let window;
let saving = false;
let projectStore, projectHost, projectError = '', closing = false;
let nginxManager, nginxError = '';
let jarManager, jarError = '';
let lan, lanError = '';
let collab, collabError = '', transferLinks, transferLinksError = '';
let knowledge, knowledgeError = '';
let gitWorkspace, gitError = '';
let fileShares, fileSharesError = '', projectTodos, projectTodosError = '';
let monitorManager, monitorError = '';
let logCenter;
let httpClient;
let apiWorkspace, apiWorkspaceError = '';
let closeAllowed = false, reloadAllowed = false, closeIntent = false, pendingUnload = null;
const desktopPreferences = require('./desktop-preferences.cjs').createDesktopPreferences(path.join(app.getPath('userData'), 'desktop-settings.json'));
let tray, choosingClose = false, quitRequested = false, rememberQuit = false;
const lanWindows = new Map();
let closingLanWindows = false;
function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}
async function requestQuit() {
  if (!window || window.isDestroyed()) { app.quit(); return; }
  if (closingLanWindows) return;
  closingLanWindows = true;
  try {
    for (const remote of lanWindows.values()) {
      const closed = await new Promise(resolve => {
        remote.resolveClose = resolve;
        remote.window.show();
        remote.window.close();
      });
      if (!closed) { rememberQuit = false; showWindow(); return; }
    }
  } finally { closingLanWindows = false; }
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
if (!primary) {
  if (previewProfile) {
    console.error('A DevKit source preview is already running. Quit it before previewing new changes.');
    app.exit(1);
  } else app.quit();
}
app.on('second-instance', showWindow);
app.on('activate', showWindow);

async function openLanWindow(address, module) {
  if (closingLanWindows) throw new Error('正在关闭远程窗口。');
  const url = lanPortalUrl(address, module);
  const key = url.href;
  const existing = lanWindows.get(key)?.window;
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return;
  }
  const partition = 'devkit-lan-' + createHash('sha256').update(url.origin).digest('hex');
  const isolated = session.fromPartition(partition);
  const sameHost = target => {
    try { return new URL(target).origin === url.origin; } catch { return false; }
  };
  isolated.setPermissionCheckHandler(() => false);
  isolated.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
  isolated.webRequest.onBeforeRequest((details, reply) => reply({ cancel: !sameHost(details.url) }));
  const title = `DevKit · ${module === 'jar' ? '远程 服务管理' : '远程 Nginx 配置'} · ${url.host}`;
  const remote = new BrowserWindow({
    width: 1240, height: 820, minWidth: 480, minHeight: 540, show: false, title, autoHideMenuBar: true,
    webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false },
  });
  const entry = { window: remote, resolveClose: null };
  lanWindows.set(key, entry);
  remote.on('closed', () => { lanWindows.delete(key); entry.resolveClose?.(true); });
  remote.on('page-title-updated', event => event.preventDefault());
  remote.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const name of ['will-frame-navigate', 'will-redirect']) {
    remote.webContents.on(name, (event, target) => {
      if (!sameHost(event.url ?? target)) event.preventDefault();
    });
  }
  remote.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(remote, {
      type: 'warning', title: '有未保存的更改', message: '远程工作台有未保存的更改。',
      buttons: ['继续编辑', '放弃并继续'], defaultId: 0, cancelId: 0,
    });
    if (choice === 1) event.preventDefault();
    else {
      entry.resolveClose?.(false);
      entry.resolveClose = null;
    }
  });
  let timer;
  try {
    await Promise.race([
      remote.loadURL(key),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('连接超时。')), 10_000); }),
    ]);
    remote.show();
  } catch {
    if (!remote.isDestroyed()) remote.destroy();
    throw new Error(`无法打开 ${url.host}。请检查主机地址、网络及 DevKit 共享状态。`);
  } finally { clearTimeout(timer); }
}

async function createWindow() {
  httpClient = (await import('./server/http-client.mjs')).createHttpClient();
  window = new BrowserWindow({
    width: 1360, height: 880, minWidth: 800, minHeight: 600, title: previewProfile ? 'DevKit · 源码预览' : 'DevKit · 本地开发工作台',
    backgroundColor: '#11171f', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false },
  });
  if (previewProfile) window.on('page-title-updated', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) { httpClient?.cancelAll(); lan?.closeTerminals(); } });
  window.webContents.on('render-process-gone', () => lan?.closeTerminals());
  window.on('closed', () => {
    httpClient?.close();
    lan?.closeTerminals();
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
    try { lan = await (await import('./server/lan-workspaces.mjs')).createLanWorkspaces(projectStorage.directory); }
    catch (error) { lanError = error.message; }
    try { gitWorkspace = await (await import('./server/git-workspace.mjs')).createGitWorkspace(projectStorage.directory); }
    catch (error) { gitError = error.message; }
    try { fileShares = await (await import('./server/file-shares.mjs')).createFileShares(projectStorage.directory); }
    catch (error) { fileSharesError = error.message; }
    try { knowledge = await (await import('./server/knowledge-base.mjs')).createKnowledgeBase(projectStorage.directory); }
    catch (error) { knowledgeError = error.message; }
    try { projectTodos = await (await import('./server/todo-lists.mjs')).createTodoLists(projectStorage.directory); }
    catch (error) { projectTodosError = error.message; }
    try { collab = await (await import('./server/collab-store.mjs')).createCollabStore(projectStorage.directory); }
    catch (error) { collabError = error.message; }
    if (collab) {
      try {
        const { createTransferLinks } = await import('./server/transfer-links.mjs');
        transferLinks = await createTransferLinks(projectStorage.directory, path.join(__dirname, 'dist'), collab);
      } catch (error) { transferLinksError = error.message; }
    }
    projectHost = await createProjectHost(projectStore, path.join(__dirname, 'dist'), { git: () => gitWorkspace, nginx: () => nginxManager, library: () => apiWorkspace, jar: () => jarManager, monitor: () => monitorManager, logs: () => logCenter, lan: () => lan, fileShares: () => fileShares, projectTodos: () => projectTodos, knowledge: () => knowledge, collab: () => collab });
    const sharing = await projectStore.settings();
    if (sharing.autoStart) {
      try { await projectHost.start(sharing); }
      catch (error) { dialog.showErrorBox('局域网共享未启动', `${error.message}\n项目数据与其他工具仍可使用，请在共享设置中检查端口。`); }
    }
  } catch (error) { projectError = error.message; }
  try {
    const { createNginxManager } = await import('./server/nginx-manager.mjs');
    nginxManager = await createNginxManager(projectStorage.directory);
  } catch (error) { nginxError = error.message; }
  try {
    jarManager = await (await import('./server/jar-manager.mjs')).createJarManager(projectStorage.directory);
  } catch (error) { jarError = error.message; }
  try {
    monitorManager = await (await import('./server/monitor-manager.mjs')).createMonitorManager(projectStorage.directory, { projects: () => projectStore, jar: () => jarManager, lan: () => lan });
  } catch (error) { monitorError = error.message; }
  logCenter = (await import('./server/log-center.mjs')).createLogCenter({ jar: () => jarManager, nginx: () => nginxManager, lan: () => lan });
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
      if (action === 'open') {
        if (typeof value?.url !== 'string' || value.url.length > 12000) throw new Error('入口地址无效。');
        const url = new URL(value.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('仅允许打开 HTTP(S) 入口。');
        await shell.openExternal(url.href);
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
        case 'sharing-audit': data = await projectHost.audit(); break;
        case 'start': data = await projectHost.start(value); break;
        case 'stop': data = await projectHost.stop(true); break;
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
      if (!lan && action === 'browse') {
        if (value?.hostId) throw new Error('目标主机连接尚未准备好。');
        const { managedRequest } = await import('./server/managed-workspace.mjs');
        return { data: await managedRequest(nginxManager, 'nginx', action, value) };
      }
      return { data: await (lan ? lan.request(nginxManager, 'nginx', action, value) : nginxManager.request(action, value)) };
    } catch (error) { return { error: error.message || 'Nginx 操作失败。' }; }
  });
  const trustedDesktop = event => window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && isAppUrl(event.senderFrame.url);
  let directSave;
  ipcMain.handle('devkit:collab', async (event, module, action, value) => {
    if (!trustedDesktop(event)) throw new Error('拒绝未知页面的请求。');
    try {
      if (!collab) throw new Error(collabError || '共享工具尚未准备好。');
      if (module === 'transfer' && ['links-get', 'links-save'].includes(action)) {
        if (!transferLinks) throw new Error(transferLinksError || '快速链接尚未准备好。');
        return { data: action === 'links-get' ? transferLinks.status() : await transferLinks.save(value) };
      }
      if (module === 'transfer' && ['directsave', 'directwrite', 'directfinish', 'directabort'].includes(action)) {
        directSave ??= require('./direct-save.cjs')(window);
        return { data: await directSave(action, value) };
      }
      if (module === 'transfer' && action === 'save-file') {
        const { file, name } = await collab.openTransfer(value, { owner: event.sender.id });
        try {
          const result = await dialog.showSaveDialog(window, { title: '保存快传文件', defaultPath: ['.', '..'].includes(name) ? 'download' : name });
          if (result.canceled || !result.filePath) return { data: '已取消保存' };
          const { atomicFile } = await import('./server/atomic-file.mjs');
          await atomicFile(result.filePath, file.createReadStream());
          return { data: '文件已保存' };
        } finally { await file.close(); }
      }
      return { data: await collab.request(module, action, value, { owner: event.sender.id, actor: '主机' }) };
    } catch (error) { return { error: error.message, status: error.status }; }
  });
  ipcMain.handle('devkit:git', async (event, action, value) => {
    if (!trustedDesktop(event)) throw new Error('拒绝未知页面的仓库请求。');
    try {
      if (!gitWorkspace) throw new Error(gitError || projectError || 'Git 工作台尚未准备好。');
      if (action === 'choose' || action === 'choose-parent') {
        const selection = await dialog.showOpenDialog(window, { title: action === 'choose-parent' ? '选择克隆目标父目录' : '选择 Git 工作目录', properties: ['openDirectory'] });
        return { data: selection.filePaths[0] || '' };
      }
      return { data: await gitWorkspace.request(action, value) };
    } catch (error) { return { error: error.message, status: error.status }; }
  });
  ipcMain.handle('devkit:file-shares', async (event, action, value) => {
    if (!trustedDesktop(event)) throw new Error('拒绝未知页面的文件共享请求。');
    try {
      if (!fileShares) throw new Error(fileSharesError || projectError || '本机文件共享尚未准备好。');
      if (action === 'choose-files' || action === 'choose-directory') {
        const result = await dialog.showOpenDialog(window, action === 'choose-files'
          ? { title: '选择要共享的文件', properties: ['openFile', 'multiSelections'] }
          : { title: '选择要共享的文件夹', properties: ['openDirectory'] });
        return { data: result.canceled ? [] : result.filePaths };
      }
      if (action === 'open') {
        const share = fileShares.get(false).shares.find(item => item.id === value?.id);
        if (!share?.links[0]) throw new Error('请先启动此共享。');
        await shell.openExternal(share.links[0]);
        return { data: true };
      }
      return { data: await fileShares.request(action, value) };
    } catch (error) { return { error: error.message, status: error.status }; }
  });
  ipcMain.handle('devkit:knowledge', async (event, action, value) => {
    if (!trustedDesktop(event)) throw new Error('拒绝未知页面的知识库请求。');
    try {
      if (!knowledge) throw new Error(knowledgeError || projectError || '知识库尚未准备好。');
      return { data: await knowledge.request(action, value) };
    } catch (error) { return { error: error.message, status: error.status }; }
  });
  ipcMain.handle('devkit:project-todos', async (event, action, value) => {
    if (!trustedDesktop(event)) throw new Error('拒绝未知页面的待办清单请求。');
    try {
      if (!projectTodos) throw new Error(projectTodosError || projectError || '待办清单尚未准备好。');
      return { data: await projectTodos.request(action, value) };
    } catch (error) { return { error: error.message, status: error.status }; }
  });
  ipcMain.handle('devkit:lan-hosts', async (event, action, value) => {
    if (!trustedDesktop(event)) throw new Error('拒绝未知页面的局域网主机请求。');
    try {
      if (!lan) throw new Error(lanError || '局域网主机管理器尚未准备好。');
      if (action === 'pick-ssh-key') {
        const result = await dialog.showOpenDialog(window, { title: '选择 SSH 私钥', properties: ['openFile', 'showHiddenFiles'] });
        return { data: result.canceled ? null : result.filePaths[0] };
      }
      if (action === 'open-rdp') {
        if (process.platform !== 'win32') throw new Error('在 Windows 桌面端可打开系统远程桌面。');
        const endpoint = await lan.hostRequest('rdp-target', value);
        const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'mstsc.exe');
        await new Promise((resolve, reject) => {
          const child = spawn(executable, [`/v:${endpoint}`], { detached: true, stdio: 'ignore' });
          child.once('error', error => reject(new Error(`无法打开 Windows 远程桌面：${error.message}`)));
          child.once('spawn', () => { child.unref(); resolve(); });
        });
        return { data: true };
      }
      let localFile;
      if (action === 'file-upload') {
        const result = await dialog.showOpenDialog(window, { title: '选择要上传的文件', properties: ['openFile'] });
        if (result.canceled) return { data: null };
        [localFile] = result.filePaths;
      } else if (action === 'file-download') {
        const remote = value?.path;
        if (typeof remote !== 'string' || !remote.trim() || remote.length > 4096) throw new Error('远程文件路径无效。');
        const defaultPath = remote.split(/[\\/]/).at(-1).replace(/[\x00-\x1f<>:"|?*]/g, '_');
        const result = await dialog.showSaveDialog(window, { title: '保存远程文件', defaultPath: ['.', '..'].includes(defaultPath) ? '' : defaultPath });
        if (result.canceled) return { data: null };
        localFile = result.filePath;
      }
      return { data: await lan.hostRequest(action, value, localFile) };
    } catch (error) { return { error: error.message }; }
  });
  ipcMain.handle('devkit:lan-host', async (event, address, module) => {
    if (!trustedDesktop(event)) throw new Error('拒绝未知页面的主机连接请求。');
    try { await openLanWindow(address, module); return {}; }
    catch (error) { return { error: error.message }; }
  });
  ipcMain.handle('devkit:jar', async (event, action, value) => {
    if (!trustedDesktop(event)) throw new Error('拒绝未知页面的服务管理请求。');
    try {
      if (action === 'pick') {
        if (!['jar', 'executable', 'directory', 'script'].includes(value?.kind)) throw new Error('无效的文件选择类型。');
        const result = await dialog.showOpenDialog(window, {
          title: value.kind === 'jar' ? '选择 JAR 文件' : value.kind === 'directory' ? '选择服务目录' : value.kind === 'script' ? '选择入口脚本' : '选择程序', properties: [value.kind === 'directory' ? 'openDirectory' : 'openFile'],
          ...(value.kind === 'jar' ? { filters: [{ name: 'Java 应用', extensions: ['jar'] }] } : {}),
        });
        return { data: result.canceled ? [] : result.filePaths };
      }
      if (!jarManager) throw new Error(jarError || '服务管理器尚未准备好。');
      if (!lan && action === 'browse') {
        if (value?.hostId) throw new Error('目标主机连接尚未准备好。');
        const { managedRequest } = await import('./server/managed-workspace.mjs');
        return { data: await managedRequest(jarManager, 'jar', action, value) };
      }
      return { data: await (lan ? lan.request(jarManager, 'jar', action, value) : jarManager.request(action, value)) };
    } catch (error) { return { error: error.message || '应用服务操作失败。' }; }
  });
  ipcMain.handle('devkit:monitor', async (event, action, value) => {
    if (!trustedDesktop(event)) throw new Error('拒绝未知页面的监控请求。');
    try {
      if (!monitorManager) throw new Error(monitorError || '监控管理器尚未准备好。');
      return { data: await monitorManager.request(action, value) };
    } catch (error) { return { error: error.message || '监控操作失败。' }; }
  });
  ipcMain.handle('devkit:logs', async (event, action, value) => {
    if (!trustedDesktop(event)) throw new Error('拒绝未知页面的日志请求。');
    try { return { data: await logCenter.request(action, value) }; }
    catch (error) { return { error: error.message || '日志读取失败。' }; }
  });
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
  if ((!projectStore && !nginxManager && !apiWorkspace && !jarManager && !monitorManager) || closing) return;
  event.preventDefault(); closing = true;
  (async () => { try { await projectHost?.stop(); await transferLinks?.close(); await collab?.close(); await fileShares?.close(); await projectTodos?.close(); await knowledge?.close(); lan?.close(); await monitorManager?.close(); await projectStore?.close(); await nginxManager?.close(); await jarManager?.close(); await apiWorkspace?.close(); } finally { app.quit(); } })().catch(() => app.exit(1));
});
app.on('will-quit', () => tray?.destroy());
