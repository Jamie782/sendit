const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('launcher', {
  state: () => ipcRenderer.invoke('state'),
  check: () => ipcRenderer.invoke('check'),
  install: () => ipcRenderer.invoke('install'),
  play: () => ipcRenderer.invoke('play'),
  set: (k, v) => ipcRenderer.invoke('set', k, v),
  chooseDir: () => ipcRenderer.invoke('chooseDir'),
  openDir: () => ipcRenderer.invoke('openDir'),
  uninstall: () => ipcRenderer.invoke('uninstall'),
  open: url => ipcRenderer.invoke('open', url),
  win: a => ipcRenderer.invoke('win', a),
  on: (ch, f) => ipcRenderer.on(ch, (e, d) => f(d)),
});
