// Floating subtitle overlay — always-on-top, transparent, draggable
// Flow: speech_final → English shown immediately → Chinese fills in when translated
// Subtitle stays until replaced by next sentence; auto-hides after 10s silence
import { useState, useEffect, useRef } from 'react';

interface SubtitlePayload {
  en: string;
  zh: string;
  isInterim: boolean;
}

export default function OverlayApp() {
  const [en, setEn] = useState('');
  const [zh, setZh] = useState('');
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetHideTimer = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 10000);
  };

  useEffect(() => {
    const cleanup = window.electronAPI.onSubtitleUpdate((payload: SubtitlePayload) => {
      // Explicit clear from stop button
      if (!payload.zh && !payload.en) {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        setVisible(false);
        setEn('');
        setZh('');
        return;
      }

      // Show immediately — if en arrives first without zh, show en;
      // when zh arrives (same en), just fill in the Chinese line without flicker
      setEn(payload.en ?? '');
      setZh(payload.zh ?? '');
      setVisible(true);

      // Only reset the 10s hide timer when a complete translation arrives (zh present)
      // so rapid en-only updates don't keep resetting the clock
      if (payload.zh) {
        resetHideTimer();
      } else if (!visible) {
        // First time showing (en-only interim display), start the timer
        resetHideTimer();
      }
    });

    return () => {
      cleanup();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="overlay-root">
      <div className={`subtitle-bar ${visible ? 'subtitle-bar--visible' : ''}`}>
        {en && <p className="subtitle-en">{en}</p>}
        {zh && <p className="subtitle-zh">{zh}</p>}
      </div>
    </div>
  );
}
