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

  updateSubtitle: (payload: SubtitlePayload) => void;
  onSubtitleUpdate: (cb: (payload: SubtitlePayload) => void) => () => void;

  showOverlay: () => void;
  hideOverlay: () => void;
  toggleOverlay: () => void;

  minimizeWindow: () => void;
  closeWindow: () => void;
}

interface AppSettings {
  deepgramApiKey: string;
  translationService: 'google' | 'deepl';
  deeplApiKey: string;
  sourceLanguage: 'en' | 'ja' | 'ko' | 'multi';
  overlayFontSize: number;
  overlayOpacity: number;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
