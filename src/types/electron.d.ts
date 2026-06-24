// Global type declarations for window.electronAPI (injected by Electron preload)

interface SubtitlePayload {
  en: string;
  zh: string;
  isInterim: boolean;
}

interface ElectronAPI {
  platform: 'win32' | 'darwin' | 'linux';

  getSettings: () => Promise<Partial<AppSettings>>;
  setSettings: (data: Partial<AppSettings>) => Promise<boolean>;

  getDesktopSources: () => Promise<Array<{ id: string; name: string }>>;

  // Translation proxy — routes fetch through main process (uses system proxy)
  translate: (url: string) => Promise<string>;
  translateClaude: (text: string, contextZh: string | undefined, apiKey: string, baseUrl?: string, model?: string) => Promise<string>;

  updateSubtitle: (payload: SubtitlePayload) => void;
  onSubtitleUpdate: (cb: (payload: SubtitlePayload) => void) => () => void;

  showOverlay: () => void;
  hideOverlay: () => void;
  toggleOverlay: () => void;

  minimizeWindow: () => void;
  closeWindow: () => void;

  // Deepgram via main-process Node.js WebSocket (proxy-safe, crash-safe)
  deepgramConnect: (params: string, apiKey: string) => Promise<{ success: boolean; message?: string }>;
  deepgramSendAudio: (buffer: ArrayBuffer) => void;
  deepgramClose: () => void;
  onDeepgramMessage: (cb: (data: string) => void) => () => void;
  onDeepgramStatus: (cb: (status: { type: string; message?: string; code?: number; reason?: string }) => void) => () => void;
}

interface AppSettings {
  deepgramApiKey: string;
  translationService: 'google' | 'deepl' | 'claude';
  deeplApiKey: string;
  claudeApiKey: string;
  claudeBaseUrl: string;
  claudeModel: string;
  sourceLanguage: 'en' | 'ja' | 'ko' | 'multi';
  overlayFontSize: number;
  overlayOpacity: number;
  proxyPort: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
