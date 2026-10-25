const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('devkitDesktop', {
  saveText: (text, filename) => ipcRenderer.invoke('devkit:save-text', { text, filename }),
});
contextBridge.exposeInMainWorld('devkitProjects', {
  request: (action, payload) => ipcRenderer.invoke('devkit:projects', action, payload),
});
contextBridge.exposeInMainWorld('devkitNginx', {
  request: (action, payload) => ipcRenderer.invoke('devkit:nginx', action, payload),
});
