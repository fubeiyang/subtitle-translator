// Floating subtitle overlay
//
// Rendering strategy:
//   • Streaming tokens (isInterim=true) are shown immediately — zero pre-buffering.
//   • formatZh (smart 2-line split) only fires when text > 15 chars; short sentences
//     pass through as-is to avoid any processing overhead.
//   • MIN_DISPLAY_TIME is dynamic: short sentences (≤15 chars) = 1000ms,
//     long sentences (>15 chars) = 1500ms.
//   • When a new sentence arrives before the current one has met its min time,
//     it is queued; streaming updates to the queued sentence silently update it
//     so the latest translation shows when it fires.
//   • Zero CSS animations — instant replacement only.
import { useState, useEffect, useRef } from 'react';

const MIN_TIME_SHORT  = 1000; // ms — short sentences ≤ 15 chars
const MIN_TIME_LONG   = 1500; // ms — long sentences  > 15 chars
const SILENCE_HIDE_MS = 8000; // ms — auto-hide after sustained silence

interface SubtitlePayload { en: string; zh: string; isInterim: boolean }
interface Pending         { en: string; zh: string; isInterim: boolean }

// ── Text formatter ────────────────────────────────────────────────────────────
// Short sentences (≤ 15 chars): pass through unchanged.
// Long sentences: truncate at 30 chars, then split into two balanced lines
// at the nearest punctuation mark to the midpoint.
const MAX_TOTAL  = 30;
const MAX_LINE   = 15;
const PUNCT_SPLIT = '，。！？、；：,!?.;: ';

function formatZh(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  if (t.length <= 15) return t; // short sentence: output directly

  const text = t.length > MAX_TOTAL ? t.slice(0, MAX_TOTAL - 1) + '…' : t;

  const mid = Math.floor(text.length / 2);
  let splitAt = -1;
  for (let i = mid; i >= Math.max(0, mid - 8); i--) {
    if (PUNCT_SPLIT.includes(text[i])) { splitAt = i + 1; break; }
  }
  if (splitAt === -1) {
    for (let i = mid + 1; i <= Math.min(text.length - 1, mid + 8); i++) {
      if (PUNCT_SPLIT.includes(text[i])) { splitAt = i + 1; break; }
    }
  }
  if (splitAt === -1) splitAt = mid;

  const line1 = text.slice(0, splitAt).trim();
  let   line2 = text.slice(splitAt).trim();
  if (line2.length > MAX_LINE) line2 = line2.slice(0, MAX_LINE - 1) + '…';

  return line1 + '\n' + line2;
}

function getMinTime(zh: string): number {
  return zh.trim().length > 15 ? MIN_TIME_LONG : MIN_TIME_SHORT;
}

function applyDisplaySettings(s: { fontSize: number; opacity?: number }) {
  document.documentElement.style.setProperty('--overlay-font-size', `${s.fontSize}px`);
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function OverlayApp() {
  const [en, setEn]           = useState('');
  const [zh, setZh]           = useState('');
  const [visible, setVisible] = useState(false);

  const currentEnRef      = useRef('');
  const currentZhRef      = useRef('');      // tracks currently displayed zh (interim or final)
  const displayStartRef   = useRef(0);
  const pendingRef        = useRef<Pending | null>(null);
  const minTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armSilenceTimer = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => setVisible(false), SILENCE_HIDE_MS);
  };

  const applyZh = (incoming: Pending): string => {
    return incoming.isInterim ? incoming.zh : formatZh(incoming.zh);
  };

  const showNow = (p: Pending) => {
    if (minTimerRef.current) clearTimeout(minTimerRef.current);
    pendingRef.current    = null;
    currentEnRef.current  = p.en;
    displayStartRef.current = Date.now();
    const zhDisplay = applyZh(p);
    currentZhRef.current  = zhDisplay;
    setEn(p.en);
    setZh(zhDisplay);
    setVisible(true);
    armSilenceTimer();
  };

  // Apply font size from settings on startup, then keep in sync with live changes
  useEffect(() => {
    window.electronAPI.getSettings().then((s) => {
      applyDisplaySettings({ fontSize: s.overlayFontSize ?? 18 });
    });
    return window.electronAPI.onOverlaySettings(applyDisplaySettings);
  }, []);

  useEffect(() => {
    const cleanup = window.electronAPI.onSubtitleUpdate((payload: SubtitlePayload) => {
      // ── Stop / clear ─────────────────────────────────────────────────────────
      if (!payload.en && !payload.zh) {
        if (minTimerRef.current)     clearTimeout(minTimerRef.current);
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        pendingRef.current    = null;
        currentEnRef.current  = '';
        currentZhRef.current  = '';
        displayStartRef.current = 0;
        setEn(''); setZh(''); setVisible(false);
        return;
      }

      const incoming: Pending = {
        en: payload.en ?? '',
        zh: payload.zh ?? '',
        isInterim: payload.isInterim,
      };

      // ── Streaming update for the CURRENTLY displayed sentence ─────────────────
      if (incoming.en === currentEnRef.current) {
        const zhDisplay = applyZh(incoming);
        currentZhRef.current = zhDisplay;
        setZh(zhDisplay);
        armSilenceTimer();
        return;
      }

      // ── Streaming update for the QUEUED sentence ──────────────────────────────
      if (pendingRef.current && incoming.en === pendingRef.current.en) {
        pendingRef.current = incoming;
        return;
      }

      // ── New sentence — enforce dynamic min display time ───────────────────────
      const minTime  = getMinTime(currentZhRef.current);
      const elapsed  = displayStartRef.current > 0
        ? Date.now() - displayStartRef.current
        : minTime;
      const remaining = Math.max(0, minTime - elapsed);

      if (remaining === 0) {
        showNow(incoming);
      } else {
        if (minTimerRef.current) clearTimeout(minTimerRef.current);
        pendingRef.current = incoming;
        minTimerRef.current = setTimeout(() => {
          const p = pendingRef.current;
          if (p) showNow(p);
        }, remaining);
      }
    });

    return () => {
      cleanup();
      if (minTimerRef.current)     clearTimeout(minTimerRef.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, []);

  if (!visible) return <div className="overlay-root" />;

  return (
    <div className="overlay-root">
      <div className="subtitle-container">
        {en && <p className="subtitle-en">{en}</p>}
        {zh && <p className="subtitle-zh">{zh}</p>}
      </div>
    </div>
  );
}
