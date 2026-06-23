// Floating subtitle overlay — always-on-top, transparent, draggable
// Receives subtitle text via Electron IPC from the main control window
import { useState, useEffect, useRef } from 'react';

interface SubtitlePayload {
  text: string;
  isInterim: boolean;
}

export default function OverlayApp() {
  const [current, setCurrent] = useState<SubtitlePayload>({ text: '', isInterim: false });
  const [visible, setVisible] = useState(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const cleanup = window.electronAPI.onSubtitleUpdate((payload) => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);

      if (!payload.text) {
        setVisible(false);
        return;
      }

      setCurrent(payload);
      setVisible(true);

      // Auto-hide final subtitles after 4 seconds of no update
      if (!payload.isInterim) {
        fadeTimer.current = setTimeout(() => setVisible(false), 4000);
      }
    });

    return cleanup;
  }, []);

  return (
    <div
      className="overlay-root"
      // Entire overlay is draggable (via Electron -webkit-app-region: drag)
      // so the window can be repositioned by dragging anywhere on it
    >
      <div className={`subtitle-bar ${visible ? 'subtitle-bar--visible' : ''}`}>
        <p
          className={`subtitle-text ${current.isInterim ? 'subtitle-text--interim' : ''}`}
        >
          {current.text}
        </p>
      </div>
    </div>
  );
}
