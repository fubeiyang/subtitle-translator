// Deepgram Nova-2 real-time streaming via main-process IPC
//
// The renderer's native WebSocket cannot send a custom Authorization header.
// Passing the key as ?token= causes Deepgram to return 401, which Chromium
// intercepts as an HTTP auth challenge and fails with "no credentials".
// Solution: route the WebSocket through the main process (Node.js ws library)
// which CAN set Authorization headers, and relay messages back via IPC.
//
// Trigger hierarchy (earliest wins, all call onFinal):
//   1. Punctuation in new interim content  → immediate
//   2. 300 ms pause without new words      → debounce flush
//   3. is_final (segment boundary)         → guaranteed flush
//   4. speech_final (utterance boundary)   → flush + full reset

export type SourceLanguage = 'en' | 'ja' | 'ko' | 'multi';

export interface DeepgramCallbacks {
  onInterim: (transcript: string) => void;
  onFinal: (transcript: string) => void;
  onError: (err: Event | string) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export interface DeepgramService {
  sendAudio: (pcm: ArrayBuffer) => void;
  close: () => void;
  isConnected: () => boolean;
}

const PUNCT_RE = /[.!?,;:]\s*$/;
const MIN_CHUNK = 5;
const PAUSE_MS  = 300;

export function createDeepgramService(
  apiKey: string,
  language: SourceLanguage,
  callbacks: DeepgramCallbacks
): DeepgramService {
  const params = new URLSearchParams({
    model: 'nova-2',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    punctuate: 'true',
    interim_results: 'true',
    vad_events: 'true',
    endpointing: '300',
    utterance_end_ms: '1000',
  });
  if (language === 'multi') {
    params.set('detect_language', 'true');
  } else {
    params.set('language', language);
  }

  let connected = false;
  let closed = false;

  // ── Chunking state ─────────────────────────────────────────────────────────
  let sentBoundary = 0;
  let currentInterim = '';
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;

  const clearPause = () => {
    if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null; }
  };

  const flushChunk = (fullSegment: string) => {
    const chunk = fullSegment.slice(sentBoundary).trim();
    if (chunk.length < MIN_CHUNK) return;
    sentBoundary = fullSegment.length;
    callbacks.onFinal(chunk);
  };

  const resetSegment = () => {
    sentBoundary = 0;
    currentInterim = '';
  };

  // ── IPC listeners ──────────────────────────────────────────────────────────
  const cleanupMessage = window.electronAPI.onDeepgramMessage((raw: string) => {
    if (closed) return;
    let msg: DeepgramMessage;
    try { msg = JSON.parse(raw) as DeepgramMessage; }
    catch { return; }

    if (msg.type === 'Error') {
      callbacks.onError(msg.message ?? `Deepgram 错误: ${JSON.stringify(msg)}`);
      return;
    }

    if (msg.type !== 'Results') return;

    const alt = msg.channel?.alternatives?.[0];
    const transcript = alt?.transcript?.trim() ?? '';

    if (msg.speech_final) {
      clearPause();
      if (transcript) flushChunk(transcript);
      resetSegment();
      callbacks.onInterim('');
      return;
    }

    if (msg.is_final) {
      clearPause();
      if (transcript) flushChunk(transcript);
      resetSegment();
      return;
    }

    if (!transcript) return;
    currentInterim = transcript;
    callbacks.onInterim(transcript);

    const newPart = transcript.slice(sentBoundary).trim();
    if (!newPart || newPart.length < MIN_CHUNK) return;

    if (PUNCT_RE.test(newPart)) {
      clearPause();
      flushChunk(transcript);
    } else {
      clearPause();
      pauseTimer = setTimeout(() => {
        const latest = currentInterim.slice(sentBoundary).trim();
        if (latest.length >= MIN_CHUNK) flushChunk(currentInterim);
      }, PAUSE_MS);
    }
  });

  const cleanupStatus = window.electronAPI.onDeepgramStatus(
    (status: { type: string; message?: string; code?: number; reason?: string }) => {
      if (closed) return;
      console.log('[DG] status:', status.type, status.message ?? '', status.code ?? '');

      if (status.type === 'open') {
        connected = true;
        callbacks.onOpen?.();
      } else if (status.type === 'error') {
        clearPause();
        callbacks.onError(status.message ?? 'Deepgram 连接错误');
      } else if (status.type === 'close') {
        clearPause();
        connected = false;
        if (status.code && status.code !== 1000) {
          const reason = status.reason ? `: ${status.reason}` : '';
          callbacks.onError(`连接被关闭 (code ${status.code}${reason})`);
        } else {
          callbacks.onClose?.();
        }
      }
    }
  );

  // ── Initiate connection (non-blocking; result comes back via onDeepgramStatus) ──
  window.electronAPI.deepgramConnect(params.toString(), apiKey).then(
    (result: { success: boolean; message?: string }) => {
      if (closed) return;
      if (!result.success) {
        clearPause();
        callbacks.onError(result.message ?? 'Deepgram 连接失败');
      }
      // success=true → 'open' status arrives via onDeepgramStatus
    }
  );

  return {
    sendAudio(pcm) {
      if (connected) {
        window.electronAPI.deepgramSendAudio(pcm);
      }
    },
    close() {
      closed = true;
      clearPause();
      window.electronAPI.deepgramClose();
      connected = false;
      cleanupMessage?.();
      cleanupStatus?.();
    },
    isConnected() { return connected; },
  };
}

interface DeepgramMessage {
  type: 'Results' | 'Metadata' | 'UtteranceEnd' | 'Error' | string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: Array<{ transcript: string; confidence: number }> };
  message?: string;
  [key: string]: unknown;
}
