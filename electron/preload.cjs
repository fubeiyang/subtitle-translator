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
  translateClaude: (text, contextZh, apiKey, baseUrl, model) =>
    ipcRenderer.invoke('translate:claude', { text, contextZh, apiKey, baseUrl, model }),

  // Frameless window controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  // Test Deepgram API key via REST (no WebSocket)
  deepgramTestKey: (apiKey) => ipcRenderer.invoke('deepgram:test-key', apiKey),

  // ── Deepgram via main-process Node.js WebSocket (proxy-safe, crash-safe) ────
  // The renderer never touches wss:// directly; all traffic goes through the
  // main process ws library which routes via the system proxy and is not
  // affected by Electron's "Network service crashed" failure mode.
  deepgramConnect: (params, apiKey) =>
    ipcRenderer.invoke('deepgram:connect', { params, apiKey }),
  deepgramSendAudio: (buffer) =>
    ipcRenderer.send('deepgram:audio', buffer),
  deepgramClose: () =>
    ipcRenderer.send('deepgram:close'),
  onDeepgramMessage: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('deepgram:message', handler);
    return () => ipcRenderer.removeListener('deepgram:message', handler);
  },
  onDeepgramStatus: (cb) => {
    const handler = (_event, status) => cb(status);
    ipcRenderer.on('deepgram:status', handler);
    return () => ipcRenderer.removeListener('deepgram:status', handler);
  },
});
