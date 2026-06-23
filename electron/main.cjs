// Electron main process — manages windows, WASAPI loopback, IPC, settings
const { app, BrowserWindow, ipcMain, desktopCapturer, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = process.env.NODE_ENV === 'development';
const DEV_URL = 'http://localhost:5173';

// ── Settings persistence ─────────────────────────────────────────────────────
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeSettings(data) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

// ── Window handles ───────────────────────────────────────────────────────────
let mainWindow = null;
let overlayWindow = null;

// ── Main control window ──────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 700,
    frame: false,
    transparent: true,
    // Windows 11 Acrylic frosted glass
    backgroundMaterial: process.platform === 'win32' ? 'acrylic' : undefined,
    // macOS frosted glass
    vibrancy: process.platform === 'darwin' ? 'hud' : undefined,
    resizable: false,
    center: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    overlayWindow?.close();
  });
}

// ── Always-on-top subtitle overlay ──────────────────────────────────────────
function createOverlayWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 900,
    height: 130,
    x: Math.round((sw - 900) / 2),
    y: Math.round(sh * 0.78), // 78% down — over video content
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Highest possible z-order so it floats above any video player
  overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  if (isDev) {
    overlayWindow.loadURL(`${DEV_URL}/overlay.html`);
  } else {
    overlayWindow.loadFile(path.join(__dirname, '../dist/overlay.html'));
  }
}

// ── WASAPI Loopback — the key to system audio capture on Windows ─────────────
// On Windows, setting audio:'loopback' in setDisplayMediaRequestHandler
// triggers WASAPI loopback capture (captures whatever is playing through speakers),
// bypassing the need for VB-Cable or any virtual audio device.
function setupAudioCapture() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        if (process.platform === 'win32') {
          // Windows: WASAPI loopback — system audio with zero setup
          callback({ video: sources[0], audio: 'loopback' });
        } else {
          // macOS: audio loopback requires BlackHole or ScreenCaptureKit.
          // Here we pass undefined audio; the user picks a window that includes audio.
          // See README for macOS BlackHole setup guide.
          callback({ video: sources[0] });
        }
      })
      .catch(() => callback({}));
  });
}

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  setupAudioCapture();
  createMainWindow();
  createOverlayWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createMainWindow();
});

// ── IPC: Settings ────────────────────────────────────────────────────────────
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_event, data) => {
  writeSettings(data);
  return true;
});

// ── IPC: Subtitle relay (main renderer → overlay) ────────────────────────────
ipcMain.on('subtitle:update', (_event, payload) => {
  overlayWindow?.webContents.send('subtitle:update', payload);
});

// ── IPC: Overlay window control ───────────────────────────────────────────────
ipcMain.on('overlay:show', () => overlayWindow?.show());
ipcMain.on('overlay:hide', () => overlayWindow?.hide());
ipcMain.on('overlay:toggle', () => {
  if (overlayWindow?.isVisible()) overlayWindow.hide();
  else overlayWindow?.show();
});

// ── IPC: Desktop capture sources (for getDisplayMedia) ───────────────────────
ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    fetchWindowIcons: false,
  });
  return sources.map((s) => ({ id: s.id, name: s.name }));
});

// ── IPC: Frameless window drag / controls ─────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => mainWindow?.close());
