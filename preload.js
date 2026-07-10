const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  exportData: (data) => ipcRenderer.invoke('data:export', data),
  importData: () => ipcRenderer.invoke('data:import'),

  chooseFolder: () => ipcRenderer.invoke('scan:chooseFolder'),
  scan: (folders) => ipcRenderer.invoke('scan:run', folders),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  exists: (p) => ipcRenderer.invoke('fs:exists', p),
  pickFiles: () => ipcRenderer.invoke('pick:files'),

  aiGetConfig: () => ipcRenderer.invoke('ai:getConfig'),
  aiSetConfig: (cfg) => ipcRenderer.invoke('ai:setConfig', cfg),
  aiClearKey: () => ipcRenderer.invoke('ai:clearKey'),
  aiChat: (messages) => ipcRenderer.invoke('ai:chat', { messages }),

  // Build a streamable URL for a local media file.
  mediaUrl: (p) => 'trackmedia://x/' + encodeURIComponent(p)
});
