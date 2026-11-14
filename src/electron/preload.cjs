// Мост между страницей матч-центра и приложением.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mc', {
  openPlayer: (source) => ipcRenderer.invoke('player:open', source),
  // обновление: { state: none | available | downloading | ready | error, version, percent, notes, error }
  getUpdate: () => ipcRenderer.invoke('update:get'),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, u) => cb(u)),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  // клик по уведомлению: раскрыть матч
  onOpenMatch: (cb) => ipcRenderer.on('open-match', (_e, m) => cb(m)),
});
