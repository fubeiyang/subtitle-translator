// Main control page — language selector, start/stop button, live status
import { useState, useRef, useEffect } from 'react';
import { createAudioCapture, type AudioCapture } from '../../services/audioCapture';
import {
  createDeepgramService,
  type DeepgramService,
  type SourceLanguage,
} from '../../services/deepgramService';
import { translateToZh } from '../../services/translateService';
import { loadSettings, getCachedSettings } from '../../services/settingsStore';

type Status = 'idle' | 'connecting' | 'live' | 'error';

const LANGUAGES: { code: SourceLanguage; label: string; flag: string }[] = [
  { code: 'en', label: '英语', flag: '🇺🇸' },
  { code: 'ja', label: '日语', flag: '🇯🇵' },
  { code: 'ko', label: '韩语', flag: '🇰🇷' },
  { code: 'multi', label: '自动', flag: '🌐' },
];

export default function MainPage() {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [sourceLang, setSourceLang] = useState<SourceLanguage>('en');
  const [interimText, setInterimText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const audioRef = useRef<AudioCapture | null>(null);
  const deepgramRef = useRef<DeepgramService | null>(null);
  // Accumulate interim text while Deepgram streams
  const interimRef = useRef('');

  // Load settings once on mount
  useEffect(() => {
    loadSettings().catch(console.error);
  }, []);

  const start = async () => {
    setErrorMsg('');
    const settings = getCachedSettings();

    if (!settings.deepgramApiKey) {
      setErrorMsg('请先在设置中填入 Deepgram API Key');
      return;
    }

    setStatus('connecting');

    try {
      // ── Step 1: Capture system audio ────────────────────────────────────
      const audio = createAudioCapture();

      // ── Step 2: Connect to Deepgram WebSocket ───────────────────────────
      const dg = createDeepgramService(settings.deepgramApiKey, sourceLang, {
        onOpen() {
          setStatus('live');
          setIsRunning(true);
          window.electronAPI.showOverlay();
        },

        onInterim(transcript) {
          interimRef.current = transcript;
          setInterimText(transcript);
          // Push interim to overlay immediately — no translation yet (too fast)
          window.electronAPI.updateSubtitle({ text: transcript, isInterim: true });
        },

        async onFinal(transcript) {
          interimRef.current = '';
          setInterimText('');
          // Translate sentence-final result to Chinese
          try {
            const zh = await translateToZh(transcript, {
              service: settings.translationService,
              deeplApiKey: settings.deeplApiKey,
              sourceLang: settings.sourceLanguage,
            });
            window.electronAPI.updateSubtitle({ text: zh, isInterim: false });
          } catch {
            // If translation fails, show original
            window.electronAPI.updateSubtitle({ text: transcript, isInterim: false });
          }
        },

        onError(err) {
          console.error('[Deepgram]', err);
          setStatus('error');
          setErrorMsg('Deepgram 连接失败，请检查 API Key 和网络');
          stop();
        },

        onClose() {
          if (isRunning) setStatus('idle');
        },
      });

      deepgramRef.current = dg;

      // ── Step 3: Start streaming audio to Deepgram ───────────────────────
      await audio.start((pcmChunk) => {
        dg.sendAudio(pcmChunk);
      });

      audioRef.current = audio;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setStatus('error');
      cleanup();
    }
  };

  const stop = () => {
    cleanup();
    setIsRunning(false);
    setStatus('idle');
    setInterimText('');
    interimRef.current = '';
    window.electronAPI.hideOverlay();
    window.electronAPI.updateSubtitle({ text: '', isInterim: false });
  };

  const cleanup = () => {
    audioRef.current?.stop();
    deepgramRef.current?.close();
    audioRef.current = null;
    deepgramRef.current = null;
  };

  const statusInfo = {
    idle: { dot: '', text: '准备就绪' },
    connecting: { dot: '⏳', text: '正在连接...' },
    live: { dot: '🔴', text: '实时翻译中' },
    error: { dot: '⚠️', text: errorMsg || '发生错误' },
  }[status];

  return (
    <div className="main-page">
      {/* Language selector */}
      <div className="section-label">识别语言 → 中文</div>
      <div className="lang-tabs">
        {LANGUAGES.map(({ code, label, flag }) => (
          <button
            key={code}
            className={`lang-tab ${sourceLang === code ? 'active' : ''}`}
            onClick={() => !isRunning && setSourceLang(code)}
            disabled={isRunning}
          >
            <span className="lang-flag">{flag}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Big action button */}
      <button
        className={`action-btn ${isRunning ? 'action-btn--stop' : 'action-btn--start'}`}
        onClick={isRunning ? stop : start}
        disabled={status === 'connecting'}
      >
        {status === 'connecting' ? (
          <span className="spinner" />
        ) : isRunning ? (
          '停止翻译'
        ) : (
          '开始翻译'
        )}
      </button>

      {/* Status indicator */}
      <div className={`status-badge status-badge--${status}`}>
        <span>{statusInfo.dot}</span>
        <span>{statusInfo.text}</span>
      </div>

      {/* Live transcript preview */}
      {interimText && (
        <div className="transcript-preview">
          <div className="transcript-label">识别中...</div>
          <div className="transcript-text">{interimText}</div>
        </div>
      )}

      {/* Overlay toggle hint */}
      {isRunning && (
        <button className="overlay-toggle-btn" onClick={() => window.electronAPI.toggleOverlay()}>
          显示 / 隐藏 字幕条
        </button>
      )}
    </div>
  );
}
