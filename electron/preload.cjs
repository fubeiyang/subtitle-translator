// Preload script — contextBridge exposes safe IPC APIs to renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // Settings — persisted to userData/settings.json
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (data) => ipcRenderer.invoke('settings:set', data),

  // Desktop audio sources (needed for getDisplayMedia on Windows)
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),

  // Subtitle relay: main control window → overlay window
  updateSubtitle: (payload) => ipcRenderer.send('subtitle:update', payload),
  onSubtitleUpdate: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('subtitle:update', handler);
    return () => ipcRenderer.removeListener('subtitle:update', handler);
  },

  // Overlay visibility
  showOverlay: () => ipcRenderer.send('overlay:show'),
  hideOverlay: () => ipcRenderer.send('overlay:hide'),
  toggleOverlay: () => ipcRenderer.send('overlay:toggle'),

  // Translation proxy — routes fetch through main process so it uses system proxy
  translate: (url) => ipcRenderer.invoke('translate:request', url),

  // Frameless window controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),
});
