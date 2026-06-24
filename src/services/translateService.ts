// Translation service with context buffer and filler-word cleaning
//
// Request chain (in order):
//   1. Google Translate via Electron main process  — uses system proxy (Clash)
//   2. Youdao (有道) unofficial API               — China-accessible, no key
//   3. Google Translate direct fetch               — last resort / dev mode
//
// Context buffer keeps the last 2 completed (EN, ZH) pairs.
// pushContext() is called by MainPage after each successful translation.
// resetContext() is called on stop to clear state between sessions.

export type TranslationService = 'google' | 'deepl' | 'claude';

export interface TranslateOptions {
  service: TranslationService;
  deeplApiKey?: string;
  claudeApiKey?: string;
  sourceLang: string; // 'en' | 'ja' | 'ko' | 'multi'
}

// ── Context buffer ────────────────────────────────────────────────────────────
interface ContextEntry { en: string; zh: string }
const _ctx: ContextEntry[] = [];

export function pushContext(en: string, zh: string): void {
  if (!en || !zh) return;
  _ctx.push({ en, zh });
  if (_ctx.length > 2) _ctx.shift();
}

export function resetContext(): void {
  _ctx.length = 0;
}

// ── Filler-word cleaning (EN only) ────────────────────────────────────────────
// Strips common spoken filler words so they don't end up in subtitles.
const FILLER_RE =
  /\b(um+h?|uh+|er+|ah+|hmm+|mm+|you know|i mean|i guess|sort of|kind of|you see|well i|basically|actually i|i think i)\b[,.]?\s*/gi;

function cleanFillers(text: string): string {
  return text.replace(FILLER_RE, ' ').replace(/\s{2,}/g, ' ').trim();
}

// ── Public entry point ────────────────────────────────────────────────────────
export async function translateToZh(text: string, opts: TranslateOptions): Promise<string> {
  const cleaned = cleanFillers(text);
  if (!cleaned) return '';

  const from = opts.sourceLang === 'multi' ? 'auto' : opts.sourceLang;
  // Previous translated sentence as context (improves coherence in DeepL)
  const prevZh = _ctx.length > 0 ? _ctx[_ctx.length - 1].zh : undefined;

  try {
    if (opts.service === 'claude' && opts.claudeApiKey) {
      return await translateClaude(cleaned, opts.claudeApiKey, prevZh);
    }
    if (opts.service === 'deepl' && opts.deeplApiKey) {
      return await translateDeepL(cleaned, from, opts.deeplApiKey, prevZh);
    }
    return await translateWithFallback(cleaned, from);
  } catch (err) {
    console.warn('[Translate] All services failed, returning original:', err);
    return cleaned;
  }
}

// ── Fetch helper: try main-process proxy first, then direct ──────────────────
async function fetchText(url: string): Promise<string> {
  if (typeof window !== 'undefined' && window.electronAPI?.translate) {
    return window.electronAPI.translate(url);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ── Multi-layer translation with automatic fallback ──────────────────────────
async function translateWithFallback(text: string, from: string): Promise<string> {
  try {
    const result = await translateGoogle(text, from, true);
    if (result) return result;
  } catch (e) {
    console.warn('[Translate] Google (proxy) failed:', e);
  }

  try {
    const result = await translateYoudao(text, from);
    if (result) return result;
  } catch (e) {
    console.warn('[Translate] Youdao failed:', e);
  }

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

// ── Claude API (via main-process IPC — uses system proxy, supports context) ───
async function translateClaude(text: string, apiKey: string, prevZh?: string): Promise<string> {
  return window.electronAPI.translateClaude(text, prevZh, apiKey);
}

// ── DeepL API (supports optional context for better coherence) ────────────────
async function translateDeepL(
  text: string,
  from: string,
  apiKey: string,
  context?: string
): Promise<string> {
  const isFree = apiKey.endsWith(':fx');
  const base = isFree ? 'https://api-free.deepl.com' : 'https://api.deepl.com';

  const langMap: Record<string, string> = {
    en: 'EN', ja: 'JA', ko: 'KO', auto: 'auto',
  };
  const sourceLang = langMap[from] ?? from.toUpperCase();

  const bodyObj: Record<string, unknown> = {
    text: [text],
    target_lang: 'ZH',
    source_lang: sourceLang === 'auto' ? undefined : sourceLang,
  };
  // DeepL Pro supports context parameter to improve translation coherence
  if (context) bodyObj.context = context;

  const res = await fetch(`${base}/v2/translate`, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyObj),
  });

  if (!res.ok) throw new Error(`DeepL HTTP ${res.status}`);
  const data = (await res.json()) as { translations: Array<{ text: string }> };
  return data.translations[0]?.text ?? text;
}
