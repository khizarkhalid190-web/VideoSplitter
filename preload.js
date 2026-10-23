const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopAPI', {
  chooseVideo: () => ipcRenderer.invoke('choose-video'),
  getVideoInfo: p => ipcRenderer.invoke('get-video-info', p),
  splitVideo: p => ipcRenderer.invoke('split-video', p),
  openFolder: p => ipcRenderer.invoke('open-folder', p),
  setupEngine: () => ipcRenderer.invoke('download-engine'),
  onProgress: cb => { const fn=(_e,data)=>cb(data); ipcRenderer.on('split-progress',fn); return ()=>ipcRenderer.removeListener('split-progress',fn); }
});