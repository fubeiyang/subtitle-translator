// Electron main process — manages windows, WASAPI loopback, IPC, settings
const { app, BrowserWindow, ipcMain, desktopCapturer, session, screen, net } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Process-level crash guard ─────────────────────────────────────────────────
// Prevents the entire app from crashing when the network layer throws (e.g.
// "Network service crashed" under Clash proxy). Errors are caught here and
// forwarded to the renderer as a graceful error message instead.
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException in main process:', err);
  try {
    mainWindow?.webContents.send('deepgram:status', {
      type: 'error',
      message: `主进程异常: ${err.message}`,
    });
  } catch {}
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection in main process:', reason);
  try {
    mainWindow?.webContents.send('deepgram:status', {
      type: 'error',
      message: `主进程异步异常: ${String(reason)}`,
    });
  } catch {}
});

// ── Node.js WebSocket + proxy (bypasses Electron's crash-prone network stack) ─
const WS = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');

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
    backgroundMaterial: process.platform === 'win32' ? 'acrylic' : undefined,
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
    // Clean up any active Deepgram connection
    safeTerminateDeepgram();
  });
}

// ── Always-on-top subtitle overlay ──────────────────────────────────────────
function createOverlayWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 900,
    height: 180,
    x: Math.round((sw - 900) / 2),
    y: Math.round(sh * 0.76),
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

  overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  if (isDev) {
    overlayWindow.loadURL(`${DEV_URL}/overlay.html`);
  } else {
    overlayWindow.loadFile(path.join(__dirname, '../dist/overlay.html'));
  }
}

// ── WASAPI Loopback ──────────────────────────────────────────────────────────
function setupAudioCapture() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        if (process.platform === 'win32') {
          callback({ video: sources[0], audio: 'loopback' });
        } else {
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
  safeTerminateDeepgram();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createMainWindow();
});

// ── IPC: Settings ────────────────────────────────────────────────────────────
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_event, data) => {
  writeSettings(data);
  // Push display settings to overlay window so changes take effect without restart
  const saved = readSettings();
  overlayWindow?.webContents.send('overlay:settings', {
    fontSize: saved.overlayFontSize ?? 18,
    opacity:  saved.overlayOpacity  ?? 90,
  });
  return true;
});

// ── IPC: Deepgram key test (REST, not WebSocket) ──────────────────────────────
ipcMain.handle('deepgram:test-key', async (_event, apiKey) => {
  try {
    const res = await net.fetch('https://api.deepgram.com/v1/projects', {
      headers: { Authorization: `Token ${apiKey}` },
    });
    const body = await res.text();
    return { status: res.status, body };
  } catch (e) {
    return { status: -1, body: e.message };
  }
});

// ── IPC: Subtitle relay ───────────────────────────────────────────────────────
ipcMain.on('subtitle:update', (_event, payload) => {
  overlayWindow?.webContents.send('subtitle:update', payload);
});

// ── IPC: Overlay controls ─────────────────────────────────────────────────────
ipcMain.on('overlay:show', () => overlayWindow?.show());
ipcMain.on('overlay:hide', () => overlayWindow?.hide());
ipcMain.on('overlay:toggle', () => {
  if (overlayWindow?.isVisible()) overlayWindow.hide();
  else overlayWindow?.show();
});

// ── IPC: Desktop capture sources ──────────────────────────────────────────────
ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    fetchWindowIcons: false,
  });
  return sources.map((s) => ({ id: s.id, name: s.name }));
});

// ── IPC: Translation proxy (Google / Youdao — GET) ───────────────────────────
ipcMain.handle('translate:request', async (_event, url) => {
  const res = await net.fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
});

// ── IPC: AI 翻译（支持 Anthropic 原生格式 & OpenAI 兼容格式）────────────────
// 无 baseUrl → Anthropic 官方 API (api.anthropic.com)
// 有 baseUrl → OpenAI 兼容接口 ({baseUrl}/v1/chat/completions)，适配国内大厂及中转
ipcMain.handle('translate:claude', async (_event, { text, contextZh, apiKey, baseUrl, model }) => {
  const systemPrompt = '你是一个专业电影字幕组同声传译。请将英文意译为简体中文，语言简洁口语化，严禁字面翻译，优先意译，单句不超过20个字。在流式输出过程中，请根据上下文语境实时修正翻译，保持语义流畅自然。只输出翻译结果，不加任何解释或额外文字。';
  let userContent = '';
  if (contextZh) userContent += `上一句中文参考：${contextZh}\n\n`;
  userContent += `请将以下英文翻译为简体中文字幕：\n${text}`;

  // ── 无自定义 URL：走 Anthropic 原生 /v1/messages ─────────────────────────
  if (!baseUrl) {
    const res = await net.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    return data.content?.[0]?.text?.trim() ?? text;
  }

  // ── 自定义 Base URL：走 OpenAI 兼容 /v1/chat/completions ─────────────────
  const endpoint = baseUrl.replace(/\/+$/, '') + '/v1/chat/completions';
  const res = await net.fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      max_tokens: 200,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI API HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? text;
});

// ── IPC: AI 翻译 · 流式输出（SSE，支持 AbortController 取消过期请求）─────────
// Each new request aborts the previous in-flight HTTP stream so stale chunks
// never reach the renderer after a newer audio segment has been queued.
let _streamController = null;

ipcMain.handle('translate:claude:stream', async (event, { text, contextZh, apiKey, baseUrl, model }) => {
  // Abort any previous in-flight stream immediately
  if (_streamController) { _streamController.abort(); _streamController = null; }
  const controller = new AbortController();
  _streamController = controller;

  const systemPrompt = '你是一个专业电影字幕组同声传译。请将英文意译为简体中文，语言简洁口语化，严禁字面翻译，优先意译，单句不超过20个字。在流式输出过程中，请根据上下文语境实时修正翻译，保持语义流畅自然。只输出翻译结果，不加任何解释或额外文字。';
  let userContent = '';
  if (contextZh) userContent += `上一句中文参考：${contextZh}\n\n`;
  userContent += `请将以下英文翻译为简体中文字幕：\n${text}`;

  const endpoint = (baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '') + '/v1/chat/completions';
  const headers = baseUrl
    ? { 'Authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' }
    : { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };

  const decoder = new TextDecoder();
  let accumulated = '';
  let reader = null;

  try {
    const res = await net.fetch(endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: model || (baseUrl ? 'deepseek-chat' : 'claude-haiku-4-5-20251001'),
        max_tokens: 200,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`AI API HTTP ${res.status}: ${body.slice(0, 300)}`);
    }

    reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done || controller.signal.aborted) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') continue;
        try {
          const data = JSON.parse(trimmed.slice(6));
          const token = data.choices?.[0]?.delta?.content ?? '';
          if (token) {
            accumulated += token;
            if (!controller.signal.aborted && !event.sender.isDestroyed()) {
              event.sender.send('translate:stream-chunk', accumulated);
            }
          }
        } catch {}
      }
    }
  } catch (err) {
    if (controller.signal.aborted || err?.name === 'AbortError') return '';
    throw err;
  } finally {
    try { reader?.releaseLock(); } catch {}
    if (_streamController === controller) _streamController = null;
  }

  return accumulated || text;
});

// ── IPC: Frameless window controls ────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => mainWindow?.close());

// ── Deepgram WebSocket via Node.js ws + system proxy ─────────────────────────
// Strategy: try proxy first (8 s), then fall back to direct (8 s).
// This covers TUN mode (direct works), system-proxy mode (proxy works),
// and wrong-port configs (error message tells the user exactly what failed).

let activeWs = null; // current ws.WebSocket instance

function safeTerminateDeepgram() {
  if (!activeWs) return;
  try { activeWs.terminate(); } catch {}
  activeWs = null;
}

// Build an HttpsProxyAgent from multiple sources (priority order).
async function buildProxyAgent(userProxyPort) {
  // 1. Windows / macOS system proxy (what Clash's "System Proxy" switch sets)
  try {
    const pac = await app.resolveProxy('https://api.deepgram.com');
    const match = pac && pac.match(/PROXY\s+([\w.[\]]+:\d+)/i);
    if (match) {
      console.log('[Deepgram] system proxy:', match[1]);
      return new HttpsProxyAgent(`http://${match[1]}`);
    }
  } catch {}

  // 2. Environment variables (set by some proxy tools)
  const envProxy =
    process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.HTTP_PROXY  || process.env.http_proxy;
  if (envProxy) {
    console.log('[Deepgram] env proxy:', envProxy);
    return new HttpsProxyAgent(envProxy);
  }

  // 3. User-configured port in settings (default 7890)
  const fallback = `http://127.0.0.1:${userProxyPort}`;
  console.log('[Deepgram] fallback proxy:', fallback);
  return new HttpsProxyAgent(fallback);
}

// Attempt to open a WS connection; resolves with the ready ws instance,
// rejects on error or after timeoutMs.
function openWs(url, wsOptions, label, timeoutMs) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WS(url, wsOptions); }
    catch (e) { return reject(new Error(`${label}: 初始化失败 ${e.message}`)); }

    const t = setTimeout(() => {
      ws.terminate();
      reject(new Error(`${label}: 超时 (${timeoutMs / 1000}s)`));
    }, timeoutMs);

    const onError = (err) => {
      clearTimeout(t);
      ws.off('error', onError);
      ws.terminate();
      // Read Deepgram's HTTP response body for the exact rejection reason
      if (err.response) {
        let body = '';
        err.response.on('data', (chunk) => { body += chunk.toString(); });
        err.response.on('end', () => {
          reject(new Error(`${label}: ${err.message} → ${body}`));
        });
        err.response.on('error', () => {
          reject(new Error(`${label}: ${err.message}`));
        });
      } else {
        reject(new Error(`${label}: ${err.message}`));
      }
    };

    ws.once('open', () => {
      clearTimeout(t);
      ws.off('error', onError);
      resolve(ws);
    });
    ws.on('error', onError);
  });
}

// Attach persistent event handlers to a connected ws and notify renderer.
function attachAndNotify(ws) {
  activeWs = ws;
  mainWindow?.webContents.send('deepgram:status', { type: 'open' });

  ws.on('message', (data) => {
    mainWindow?.webContents.send('deepgram:message', data.toString('utf8'));
  });
  ws.on('error', (err) => {
    console.error('[Deepgram] ws error:', err.message);
    mainWindow?.webContents.send('deepgram:status', { type: 'error', message: err.message });
  });
  ws.on('close', (code, reason) => {
    const reasonStr = reason ? reason.toString('utf8') : '';
    console.log(`[Deepgram] closed: ${code} ${reasonStr}`);
    mainWindow?.webContents.send('deepgram:status', { type: 'close', code, reason: reasonStr });
    if (activeWs === ws) activeWs = null;
  });

  return { success: true };
}

ipcMain.handle('deepgram:connect', async (_event, { params, apiKey }) => {
  safeTerminateDeepgram();

  const url = `wss://api.deepgram.com/v1/listen?${params}`;
  const wsHeaders = { Authorization: `Token ${apiKey}` };
  const userProxyPort = readSettings().proxyPort || '7890';
  const errors = [];

  let agent = null;
  try { agent = await buildProxyAgent(userProxyPort); } catch {}

  // ── Attempt 1: via proxy ──────────────────────────────────────────────────
  if (agent) {
    try {
      const ws = await openWs(url, { headers: wsHeaders, agent }, `代理 127.0.0.1:${userProxyPort}`, 8000);
      console.log('[Deepgram] connected via proxy');
      return attachAndNotify(ws);
    } catch (e) {
      errors.push(e.message);
      console.log('[Deepgram] proxy failed:', e.message, '-> trying direct');
    }
  }

  // ── Attempt 2: direct (works when Clash is in TUN mode) ──────────────────
  try {
    const ws = await openWs(url, { headers: wsHeaders }, '直连', 8000);
    console.log('[Deepgram] connected directly');
    return attachAndNotify(ws);
  } catch (e) {
    errors.push(e.message);
    console.log('[Deepgram] direct also failed:', e.message);
  }

  return { success: false, message: errors.join(' | ') };
});

ipcMain.on('deepgram:audio', (_event, buffer) => {
  if (activeWs && activeWs.readyState === WS.OPEN) {
    try {
      // buffer arrives as ArrayBuffer; convert to Node.js Buffer for ws.send()
      activeWs.send(Buffer.from(buffer));
    } catch (err) {
      console.error('[Deepgram] send error:', err.message);
    }
  }
});

ipcMain.on('deepgram:close', () => {
  if (!activeWs) return;
  try {
    if (activeWs.readyState === WS.OPEN) {
      activeWs.send(JSON.stringify({ type: 'CloseStream' }));
      const ws = activeWs;
      setTimeout(() => { try { ws.terminate(); } catch {} }, 500);
    } else {
      activeWs.terminate();
    }
  } catch (err) {
    console.error('[Deepgram] close error:', err.message);
  }
  activeWs = null;
});
