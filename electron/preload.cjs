const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('devkitDesktop', {
  saveText: (text, filename) => ipcRenderer.invoke('devkit:save-text', { text, filename }),
  onCloseRequest: listener => {
    const handler = (_event, intent) => listener(intent);
    ipcRenderer.on('devkit:close-request', handler);
    return () => ipcRenderer.removeListener('devkit:close-request', handler);
  },
  answerClose: allow => ipcRenderer.send('devkit:answer-close', allow === true),
  closeSettings: (action, value) => ipcRenderer.invoke('devkit:desktop-settings', action, value),
  chooseClose: (action, remember) => ipcRenderer.invoke('devkit:choose-close', action, remember),
});
contextBridge.exposeInMainWorld('devkitProjects', {
  request: (action, payload) => ipcRenderer.invoke('devkit:projects', action, payload),
});
contextBridge.exposeInMainWorld('devkitNginx', {
  request: (action, payload) => ipcRenderer.invoke('devkit:nginx', action, payload),
});
contextBridge.exposeInMainWorld('devkitHttp', {
  request: (action, payload) => ipcRenderer.invoke('devkit:http', action, payload),
});
