const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  authStatus: () => ipcRenderer.invoke('auth:status'),
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  search: (q) => ipcRenderer.invoke('yt:search', q),
  library: () => ipcRenderer.invoke('yt:library'),
  playlist: (id) => ipcRenderer.invoke('yt:playlist', id),
  recommended: () => ipcRenderer.invoke('yt:recommended'),
  stream: (videoId) => ipcRenderer.invoke('yt:stream', videoId),
  version: () => ipcRenderer.invoke('app:version'),
  restart: () => ipcRenderer.invoke('app:restart'),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, msg) => cb(msg)),
});
