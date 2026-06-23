// Translation service
//
// Request chain (in order):
//   1. Google Translate via Electron main process  — uses system proxy (Clash)
//   2. Youdao (有道) unofficial API               — China-accessible, no key
//   3. Google Translate direct fetch               — last resort / dev mode

export type TranslationService = 'google' | 'deepl';

export interface TranslateOptions {
  service: TranslationService;
  deeplApiKey?: string;
  sourceLang: string; // 'en' | 'ja' | 'ko' | 'multi'
}

export async function translateToZh(text: string, opts: TranslateOptions): Promise<string> {
  if (!text.trim()) return '';

  const from = opts.sourceLang === 'multi' ? 'auto' : opts.sourceLang;

  try {
    if (opts.service === 'deepl' && opts.deeplApiKey) {
      return await translateDeepL(text, from, opts.deeplApiKey);
    }
    return await translateWithFallback(text, from);
  } catch (err) {
    console.warn('[Translate] All services failed, returning original:', err);
    return text;
  }
}

// ── Fetch helper: try main-process proxy first, then direct ──────────────────
async function fetchText(url: string): Promise<string> {
  if (typeof window !== 'undefined' && window.electronAPI?.translate) {
    return window.electronAPI.translate(url);
  }
  // Dev mode fallback (no Electron context)
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ── Multi-layer translation with automatic fallback ──────────────────────────
async function translateWithFallback(text: string, from: string): Promise<string> {
  // 1. Google via main process (goes through Clash system proxy)
  try {
    const result = await translateGoogle(text, from, true);
    if (result) return result;
  } catch (e) {
    console.warn('[Translate] Google (proxy) failed:', e);
  }

  // 2. Youdao — Chinese service, no proxy needed, no key required
  try {
    const result = await translateYoudao(text, from);
    if (result) return result;
  } catch (e) {
    console.warn('[Translate] Youdao failed:', e);
  }

  // 3. Google direct (works if Clash has global/rule for Google)
  try {
    const result = await translateGoogle(text, from, false);
    if (result) return result;
  } catch (e) {
    console.warn('[Translate] Google (direct) failed:', e);
  }

  return text;
}

// ── Google Translate (unofficial) ────────────────────────────────────────────
async function translateGoogle(text: string, from: string, viaMain: boolean): Promise<string> {
  const url =
    `https://translate.googleapis.com/translate_a/single` +
    `?client=gtx&sl=${from}&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;

  let raw: string;
  if (viaMain) {
    raw = await fetchText(url);
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.text();
  }

  const data = JSON.parse(raw) as unknown[][];
  return (data[0] as string[][])
    .map((item) => item[0])
    .filter(Boolean)
    .join('');
}

// ── Youdao (有道) unofficial — works in China without proxy ──────────────────
async function translateYoudao(text: string, from: string): Promise<string> {
  const langMap: Record<string, string> = {
    en: 'en', ja: 'ja', ko: 'ko', auto: 'auto',
  };
  const srcLang = langMap[from] ?? 'auto';
  const url =
    `https://dict.youdao.com/translate` +
    `?i=${encodeURIComponent(text)}&doctype=json&from=${srcLang}&to=zh-CHS`;

  const raw = await fetchText(url);
  const data = JSON.parse(raw) as {
    errorCode: number;
    translateResult: Array<Array<{ tgt: string }>>;
  };

  if (data.errorCode !== 0) throw new Error(`Youdao error ${data.errorCode}`);
  return data.translateResult
    .flat()
    .map((s) => s.tgt)
    .join('');
}

// ── DeepL API ────────────────────────────────────────────────────────────────
async function translateDeepL(text: string, from: string, apiKey: string): Promise<string> {
  const isFree = apiKey.endsWith(':fx');
  const base = isFree ? 'https://api-free.deepl.com' : 'https://api.deepl.com';

  const langMap: Record<string, string> = {
    en: 'EN', ja: 'JA', ko: 'KO', auto: 'auto',
  };
  const sourceLang = langMap[from] ?? from.toUpperCase();

  const res = await fetch(`${base}/v2/translate`, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: [text],
      target_lang: 'ZH',
      source_lang: sourceLang === 'auto' ? undefined : sourceLang,
    }),
  });

  if (!res.ok) throw new Error(`DeepL HTTP ${res.status}`);
  const data = (await res.json()) as { translations: Array<{ text: string }> };
  return data.translations[0]?.text ?? text;
}
