const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('crocAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),

  // Version
  getVersion: () => ipcRenderer.invoke('croc:version'),

  // Dialogs
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  pickFolders: () => ipcRenderer.invoke('dialog:pickFolders'),
  pickSaveDir: () => ipcRenderer.invoke('dialog:pickSaveDir'),
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // Send
  sendFiles: (data) => ipcRenderer.invoke('croc:send', data),

  // Receive
  receiveFiles: (data) => ipcRenderer.invoke('croc:receive', data),

  // Cancel
  cancelTransfer: () => ipcRenderer.invoke('croc:cancel'),

  // File system
  getFileStats: (p) => ipcRenderer.invoke('fs:stat', p),
  getHomeDir: () => ipcRenderer.invoke('os:homedir'),

  // Shell
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),

  // Listeners
  onCode: (cb) => ipcRenderer.on('croc:code', (_, code) => cb(code)),
  onProgress: (cb) => ipcRenderer.on('croc:progress', (_, text) => cb(text)),
  onOutput: (cb) => ipcRenderer.on('croc:output', (_, text) => cb(text)),
  onPrompt: (cb) => ipcRenderer.on('croc:prompt', (_, data) => cb(data)),
  answerPrompt: (answer) => ipcRenderer.invoke('croc:answer', answer),

  // Cleanup
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('croc:code');
    ipcRenderer.removeAllListeners('croc:progress');
    ipcRenderer.removeAllListeners('croc:output');
    ipcRenderer.removeAllListeners('croc:prompt');
  }
});