// Floating subtitle overlay — always-on-top, transparent, draggable
// Shows English original (small) + Chinese translation (large)
// Stays visible until next sentence arrives; auto-hides after 6s of silence
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

  useEffect(() => {
    const cleanup = window.electronAPI.onSubtitleUpdate((payload: SubtitlePayload) => {
      // Clear any pending auto-hide
      if (hideTimer.current) clearTimeout(hideTimer.current);

      // Empty payload = explicit clear (stop button)
      if (!payload.zh && !payload.en) {
        setVisible(false);
        return;
      }

      // Update text and show — new sentence replaces old one smoothly
      setEn(payload.en ?? '');
      setZh(payload.zh ?? '');
      setVisible(true);

      // Auto-hide after 6 seconds of silence (no new sentence)
      hideTimer.current = setTimeout(() => setVisible(false), 6000);
    });

    return () => {
      cleanup();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <div className="overlay-root">
      <div className={`subtitle-bar ${visible ? 'subtitle-bar--visible' : ''}`}>
        {en && <p className="subtitle-en">{en}</p>}
        {zh && <p className="subtitle-zh">{zh}</p>}
      </div>
    </div>
  );
}
