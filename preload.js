const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickVideo: (opts) => ipcRenderer.invoke('dialog:openVideo', opts),
  probe: (filePath) => ipcRenderer.invoke('video:probe', filePath),
  extractFrames: (opts) => ipcRenderer.invoke('video:extractFrames', opts),
  extractAudio: (opts) => ipcRenderer.invoke('audio:extract', opts),
  onAudioProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('audio:progress', listener);
    return () => ipcRenderer.removeListener('audio:progress', listener);
  },
  readFrame: (framePath) => ipcRenderer.invoke('frame:read', framePath),
  saveOriginalFrame: (args) => ipcRenderer.invoke('frame:saveOriginal', args),
  savePngFromBase64: (args) => ipcRenderer.invoke('frame:savePngFromBase64', args),
  revealItem: (p) => ipcRenderer.invoke('shell:revealItem', p),
  cleanupSession: (id) => ipcRenderer.invoke('session:cleanup', id),
  openManual: () => ipcRenderer.invoke('manual:open'),
  // Resolve a dragged-File to its absolute path (Electron 32+ webUtils API).
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
  // Tell main which video the renderer is using (for vfs://video streaming).
  setActiveVideo: (filePath) => ipcRenderer.invoke('video:setActive', filePath),
  onProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('extract:progress', listener);
    return () => ipcRenderer.removeListener('extract:progress', listener);
  },
});

