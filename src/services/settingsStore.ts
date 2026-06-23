// Settings store — persists to userData/settings.json via Electron IPC

const DEFAULTS: AppSettings = {
  deepgramApiKey: '',
  translationService: 'google',
  deeplApiKey: '',
  sourceLanguage: 'en',
  overlayFontSize: 28,
  overlayOpacity: 90,
};

let _cache: AppSettings | null = null;

export async function loadSettings(): Promise<AppSettings> {
  const raw = await window.electronAPI.getSettings();
  _cache = { ...DEFAULTS, ...raw };
  return _cache;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  _cache = { ...(_cache ?? DEFAULTS), ...patch };
  await window.electronAPI.setSettings(_cache);
  return _cache;
}

export function getCachedSettings(): AppSettings {
  return _cache ?? { ...DEFAULTS };
}
