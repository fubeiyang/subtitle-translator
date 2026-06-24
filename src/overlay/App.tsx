// Floating subtitle overlay — always-on-top, transparent, draggable
//
// Dual-line rolling buffer:
//   - Keeps at most 2 subtitle entries (previous + current)
//   - Previous line dimmed to 0.6 opacity; current line at full 1.0
//   - New subtitle pushes old one up into the "prev" slot
//   - ZH fills in for current entry when translation arrives (same EN key)
//   - Entire container fades out after 3 s of silence
import { useState, useEffect, useRef } from 'react';

interface SubtitlePayload {
  en: string;
  zh: string;
  isInterim: boolean;
}

interface SubtitleEntry {
  id: number;
  en: string;
  zh: string;
}

let _nextId = 0;

export default function OverlayApp() {
  const [queue, setQueue] = useState<SubtitleEntry[]>([]);
  const [visible, setVisible] = useState(false);

  const lastEnRef = useRef('');
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetFadeTimer = () => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    setVisible(true);
    fadeTimerRef.current = setTimeout(() => setVisible(false), 3000);
  };

  useEffect(() => {
    const cleanup = window.electronAPI.onSubtitleUpdate((payload: SubtitlePayload) => {
      // Explicit clear from stop button
      if (!payload.en && !payload.zh) {
        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
        setVisible(false);
        setQueue([]);
        lastEnRef.current = '';
        return;
      }

      if (payload.en === lastEnRef.current) {
        // Same sentence: ZH translation arrived — update last item in place
        if (payload.zh) {
          setQueue(prev => {
            if (!prev.length) return prev;
            const next = [...prev];
            next[next.length - 1] = { ...next[next.length - 1], zh: payload.zh };
            return next;
          });
          resetFadeTimer();
        }
      } else {
        // New sentence: push into queue, cap at 2
        lastEnRef.current = payload.en;
        const entry: SubtitleEntry = { id: _nextId++, en: payload.en, zh: payload.zh ?? '' };
        setQueue(prev => {
          const next = [...prev, entry];
          return next.length > 2 ? next.slice(next.length - 2) : next;
        });
        resetFadeTimer();
      }
    });

    return () => {
      cleanup();
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  return (
    <div className="overlay-root">
      <div className={`subtitle-container ${visible ? 'subtitle-container--visible' : ''}`}>
        {queue.map((item, i) => {
          const isCurrent = i === queue.length - 1;
          return (
            <div
              key={item.id}
              className={`subtitle-row ${isCurrent ? 'subtitle-row--current' : 'subtitle-row--prev'}`}
            >
              {isCurrent && item.en && <p className="subtitle-en">{item.en}</p>}
              {item.zh && <p className="subtitle-zh">{item.zh}</p>}
              {/* Show EN placeholder while translation is pending */}
              {isCurrent && !item.zh && item.en && (
                <p className="subtitle-zh subtitle-zh--pending">{item.en}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
