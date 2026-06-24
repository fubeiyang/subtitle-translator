// Main control page — language selector, start/stop button, live status
import { useState, useRef, useEffect, useCallback } from 'react';
import { createAudioCapture, type AudioCapture } from '../../services/audioCapture';
import {
  createDeepgramService,
  type DeepgramService,
  type SourceLanguage,
} from '../../services/deepgramService';
import { translateToZh, pushContext, resetContext } from '../../services/translateService';
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

  // Translation queue: one request in-flight, one pending slot
  const translatingRef = useRef(false);
  const pendingFinalRef = useRef<string | null>(null);
  // Tracks the EN text currently shown in overlay so stale translations are discarded
  const latestEnRef = useRef('');
  // Ref mirror of isRunning so callbacks don't capture stale closure values
  const isRunningRef = useRef(false);

  useEffect(() => { loadSettings().catch(console.error); }, []);

  // ── Translation engine ────────────────────────────────────────────────────
  // Shows English immediately; fills in Chinese when translation completes.
  // If a newer EN chunk arrived while translating, the old ZH result is dropped.
  const doTranslate = useCallback(async (
    transcript: string,
    settings: ReturnType<typeof getCachedSettings>
  ) => {
    translatingRef.current = true;
    try {
      const zh = await translateToZh(transcript, {
        service: settings.translationService,
        deeplApiKey: settings.deeplApiKey,
        claudeApiKey: settings.claudeApiKey,
        claudeBaseUrl: settings.claudeBaseUrl,
        claudeModel: settings.claudeModel,
        sourceLang: settings.sourceLanguage,
      });
      pushContext(transcript, zh);
      // Only update if overlay is still showing this English chunk
      if (latestEnRef.current === transcript) {
        window.electronAPI.updateSubtitle({ en: transcript, zh, isInterim: false });
      }
    } catch {
      if (latestEnRef.current === transcript) {
        window.electronAPI.updateSubtitle({ en: transcript, zh: transcript, isInterim: false });
      }
    } finally {
      translatingRef.current = false;
      if (pendingFinalRef.current !== null) {
        const next = pendingFinalRef.current;
        pendingFinalRef.current = null;
        doTranslate(next, getCachedSettings());
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
          console.log('[START] onOpen fired → going live');
          isRunningRef.current = true;
          setStatus('live');
          setIsRunning(true);
          window.electronAPI.showOverlay();
        },

        // Interim: main window "识别中..." preview only — overlay untouched
        onInterim(transcript) {
          setInterimText(transcript);
        },

        // Final chunk (from punctuation / pause / segment / utterance boundary):
        //   1. Immediately push English to overlay (zero latency)
        //   2. Queue translation; discard result if a newer chunk has arrived
        onFinal(transcript) {
          setInterimText('');
          latestEnRef.current = transcript;
          window.electronAPI.updateSubtitle({ en: transcript, zh: '', isInterim: false });

          const s = getCachedSettings();
          if (translatingRef.current) {
            pendingFinalRef.current = transcript;
          } else {
            doTranslate(transcript, s);
          }
        },

        onError(err) {
          console.error('[START] onError fired:', err);
          const msg = typeof err === 'string' ? err : 'Deepgram 连接失败，请检查 API Key 和网络';
          setErrorMsg(msg);
          setStatus('error');
          // Don't call stop() here — it sets status back to 'idle', hiding the error.
          // Do the same teardown manually, preserving 'error' status.
          isRunningRef.current = false;
          setIsRunning(false);
          setInterimText('');
          translatingRef.current = false;
          pendingFinalRef.current = null;
          latestEnRef.current = '';
          cleanup();
          window.electronAPI.hideOverlay();
          window.electronAPI.updateSubtitle({ en: '', zh: '', isInterim: false });
        },

        onClose() {
          console.log('[START] onClose fired, isRunningRef=', isRunningRef.current);
          if (isRunningRef.current) {
            // Was live → connection dropped unexpectedly (Deepgram closed it)
            isRunningRef.current = false;
            setIsRunning(false);
            setInterimText('');
            setErrorMsg('连接已断开：Deepgram 未收到音频，请确认系统有音频输出且音量不为零');
            setStatus('error');
            cleanup();
            window.electronAPI.hideOverlay();
            window.electronAPI.updateSubtitle({ en: '', zh: '', isInterim: false });
          }
        },
      });

      deepgramRef.current = dg;
      console.log('[START] calling audio.start()...');
      await audio.start((pcmChunk) => dg.sendAudio(pcmChunk));
      console.log('[START] audio.start() resolved');
      // If onError fired during audio.start(), deepgramRef was nulled by cleanup().
      // In that case stop audio instead of leaking it.
      if (deepgramRef.current === dg) {
        audioRef.current = audio;
      } else {
        audio.stop();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[START] catch block:', msg);
      setErrorMsg(msg);
      setStatus('error');
      cleanup();
    }
  };

  const stop = () => {
    resetContext();
    cleanup();
    isRunningRef.current = false;
    setIsRunning(false);
    setStatus('idle');
    setInterimText('');
    translatingRef.current = false;
    pendingFinalRef.current = null;
    latestEnRef.current = '';
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
    idle:       { dot: '',   text: '准备就绪' },
    connecting: { dot: '⏳', text: '正在连接...' },
    live:       { dot: '🔴', text: '实时翻译中' },
    error:      { dot: '⚠️', text: errorMsg || '发生错误' },
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
        {status === 'connecting' ? <span className="spinner" /> : isRunning ? '停止翻译' : '开始翻译'}
      </button>

      <div className={`status-badge status-badge--${status}`}>
        <span>{statusInfo.dot}</span>
        <span>{statusInfo.text}</span>
      </div>

      {/* Interim text shown here — NOT in overlay */}
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
