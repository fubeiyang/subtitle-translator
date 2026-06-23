// Translation service — Google Translate (free, no key) + optional DeepL
//
// Strategy:
//   - Default: Google Translate unofficial API — no key required, works instantly
//   - Optional: DeepL API — higher quality, requires paid/free API key

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
    return await translateGoogle(text, from);
  } catch (err) {
    console.warn('[Translate] Failed, returning original:', err);
    return text;
  }
}

// ── Google Translate (unofficial, free) ──────────────────────────────────────
// Uses the same endpoint the Google Translate web page calls.
// No API key required. Rate limits apply for very high volume.
async function translateGoogle(text: string, from: string): Promise<string> {
  const url =
    `https://translate.googleapis.com/translate_a/single` +
    `?client=gtx&sl=${from}&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Translate HTTP ${res.status}`);

  const data = (await res.json()) as unknown[][];
  // Response structure: [[["translated","original",null,null,10],...],...]
  return (data[0] as string[][])
    .map((item) => item[0])
    .filter(Boolean)
    .join('');
}

// ── DeepL API ────────────────────────────────────────────────────────────────
// Free tier: 500,000 chars/month. Sign up at https://www.deepl.com/pro-api
// Free plan uses api-free.deepl.com; paid uses api.deepl.com
async function translateDeepL(text: string, from: string, apiKey: string): Promise<string> {
  const isFree = apiKey.endsWith(':fx');
  const base = isFree ? 'https://api-free.deepl.com' : 'https://api.deepl.com';

  // DeepL language codes
  const langMap: Record<string, string> = {
    en: 'EN',
    ja: 'JA',
    ko: 'KO',
    auto: 'auto',
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
