const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('ncAPI', {

  /* finestra */
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),

  /* filesystem (sola lettura + edit) */
  list: (dir) => ipcRenderer.invoke('fs:list', dir),
  stat: (p) => ipcRenderer.invoke('fs:stat', p),
  read: (p) => ipcRenderer.invoke('fs:read', p),
  readHex: (p) => ipcRenderer.invoke('fs:readHex', p),
  readImage: (p) => ipcRenderer.invoke('fs:readImage', p),
  write: (data) => ipcRenderer.invoke('fs:write', data),
  drives: () => ipcRenderer.invoke('fs:drives'),
  disk: (p) => ipcRenderer.invoke('fs:disk', p),
  search: (data) => ipcRenderer.invoke('fs:search', data),

  /* shell */
  exec: (data) => ipcRenderer.invoke('shell:exec', data),
  kill: () => ipcRenderer.invoke('shell:kill'),
  onShellOutput: (cb) => ipcRenderer.on('shell:output', (_, d) => cb(d)),

  /* croc */
  crocVersion: () => ipcRenderer.invoke('croc:version'),
  crocSend: (data) => ipcRenderer.invoke('croc:send', data),
  crocReceive: (data) => ipcRenderer.invoke('croc:receive', data),
  crocCancel: () => ipcRenderer.invoke('croc:cancel'),
  crocAnswer: (answer) => ipcRenderer.invoke('croc:answer', answer),
  onCrocCode: (cb) => ipcRenderer.on('croc:code', (_, c) => cb(c)),
  onCrocProgress: (cb) => ipcRenderer.on('croc:progress', (_, t) => cb(t)),
  onCrocOutput: (cb) => ipcRenderer.on('croc:output', (_, t) => cb(t)),
  onCrocPrompt: (cb) => ipcRenderer.on('croc:prompt', (_, d) => cb(d)),

  /* vari */
  pickSaveDir: () => ipcRenderer.invoke('dialog:pickSaveDir'),
  home: () => ipcRenderer.invoke('os:homedir'),
  osInfo: () => ipcRenderer.invoke('os:info'),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  clipboardWrite: (t) => ipcRenderer.invoke('clipboard:writeText', t),
  getPathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch { return null; } },

  removeListeners: () => {
    ['croc:code', 'croc:progress', 'croc:output', 'croc:prompt', 'shell:output']
      .forEach((ch) => ipcRenderer.removeAllListeners(ch));
  }
});
