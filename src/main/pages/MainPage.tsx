// Main control page — language selector, start/stop button, live status
import { useState, useRef, useEffect, useCallback } from 'react';
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

  // Translation queue: one request in flight at a time; pending holds next
  const translatingRef = useRef(false);
  const pendingFinalRef = useRef<string | null>(null);

  useEffect(() => {
    loadSettings().catch(console.error);
  }, []);

  // ── Translation with single-inflight queue ───────────────────────────────
  const doTranslate = useCallback(async (transcript: string, settings: ReturnType<typeof getCachedSettings>) => {
    translatingRef.current = true;
    try {
      const zh = await translateToZh(transcript, {
        service: settings.translationService,
        deeplApiKey: settings.deeplApiKey,
        sourceLang: settings.sourceLanguage,
      });
      window.electronAPI.updateSubtitle({ en: transcript, zh, isInterim: false });
    } catch {
      // Show original English when translation fails
      window.electronAPI.updateSubtitle({ en: transcript, zh: transcript, isInterim: false });
    } finally {
      translatingRef.current = false;
      // If a new sentence arrived while we were translating, translate it now
      if (pendingFinalRef.current !== null) {
        const next = pendingFinalRef.current;
        pendingFinalRef.current = null;
        doTranslate(next, settings);
      }
    }
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
      const audio = createAudioCapture();

      const dg = createDeepgramService(settings.deepgramApiKey, sourceLang, {
        onOpen() {
          setStatus('live');
          setIsRunning(true);
          window.electronAPI.showOverlay();
        },

        // Interim: update main-window transcript preview ONLY — never touch overlay
        onInterim(transcript) {
          setInterimText(transcript);
        },

        // speech_final: translate and push to overlay; queue if already translating
        onFinal(transcript) {
          setInterimText('');
          const s = getCachedSettings();
          if (translatingRef.current) {
            // Drop older pending, keep only the latest sentence
            pendingFinalRef.current = transcript;
          } else {
            doTranslate(transcript, s);
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
    translatingRef.current = false;
    pendingFinalRef.current = null;
    window.electronAPI.hideOverlay();
    window.electronAPI.updateSubtitle({ en: '', zh: '', isInterim: false });
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

      <div className={`status-badge status-badge--${status}`}>
        <span>{statusInfo.dot}</span>
        <span>{statusInfo.text}</span>
      </div>

      {/* Live transcript preview — interim text shown here, NOT in overlay */}
      {interimText && (
        <div className="transcript-preview">
          <div className="transcript-label">识别中...</div>
          <div className="transcript-text">{interimText}</div>
        </div>
      )}

      {isRunning && (
        <button className="overlay-toggle-btn" onClick={() => window.electronAPI.toggleOverlay()}>
          显示 / 隐藏 字幕条
        </button>
      )}
    </div>
  );
}
