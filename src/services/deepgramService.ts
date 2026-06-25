// Deepgram Nova-2 real-time streaming via main-process IPC
//
// The renderer's native WebSocket cannot send a custom Authorization header.
// Passing the key as ?token= causes Deepgram to return 401, which Chromium
// intercepts as an HTTP auth challenge and fails with "no credentials".
// Solution: route the WebSocket through the main process (Node.js ws library)
// which CAN set Authorization headers, and relay messages back via IPC.
//
// Trigger hierarchy:
//   1. is_final (segment boundary) → queued for cluster merge window
//   2. speech_final (utterance boundary) → flush cluster immediately
//   3. 500ms interim backup → queued for cluster merge window
//
// Cluster merge: consecutive is_final segments arriving within CLUSTER_HOLD_MS
// (800ms) of each other are concatenated before onFinal fires, preventing
// fragmentation from fast speech where natural pauses are < 1s.

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

const MIN_CHUNK       = 5;    // ignore segments shorter than this
const PAUSE_MS        = 500;  // backup flush if interim stalls
const CLUSTER_HOLD_MS = 800;  // merge window: segments within 800ms are concatenated

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
    endpointing: '500',
    utterance_end_ms: '1000',
  });
  if (language === 'multi') {
    params.set('detect_language', 'true');
  } else {
    params.set('language', language);
  }

  let connected = false;
  let closed = false;

  // ── Chunking + clustering state ────────────────────────────────────────────
  let currentInterim   = '';
  let lastAddedSegment = ''; // dedup: prevent is_final + speech_final from double-adding
  let lastEmitted      = ''; // dedup: prevent identical clusters from firing onFinal twice
  let pauseTimer:   ReturnType<typeof setTimeout> | null = null;
  let clusterBuf    = '';
  let clusterTimer: ReturnType<typeof setTimeout> | null = null;

  const clearPause = () => {
    if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null; }
  };

  const emitCluster = () => {
    if (clusterTimer) { clearTimeout(clusterTimer); clusterTimer = null; }
    const text = clusterBuf.trim();
    clusterBuf       = '';
    lastAddedSegment = ''; // reset so next utterance can add the same words
    if (text.length >= MIN_CHUNK && text !== lastEmitted) {
      lastEmitted = text;
      callbacks.onFinal(text);
    }
  };

  // Accumulate a segment into the cluster buffer.
  // The cluster timer resets on each addition; it fires when 800ms of silence
  // follows the last segment, emitting the concatenated result as one onFinal call.
  const addToCluster = (text: string) => {
    const t = text.trim();
    if (!t || t.length < MIN_CHUNK || t === lastAddedSegment) return;
    lastAddedSegment = t;
    clusterBuf = clusterBuf ? clusterBuf + ' ' + t : t;
    if (clusterTimer) clearTimeout(clusterTimer);
    clusterTimer = setTimeout(emitCluster, CLUSTER_HOLD_MS);
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

    // Natural utterance boundary → merge with any pending cluster, emit immediately
    if (msg.speech_final) {
      clearPause();
      if (transcript) addToCluster(transcript);
      emitCluster();
      lastEmitted  = ''; // allow identical words in the next utterance
      currentInterim = '';
      callbacks.onInterim('');
      return;
    }

    // Segment boundary → add to cluster, wait for merge window
    if (msg.is_final) {
      clearPause();
      if (transcript) addToCluster(transcript);
      currentInterim = '';
      return;
    }

    // Interim: show preview in main window only, arm backup flush
    if (!transcript) return;
    currentInterim = transcript;
    callbacks.onInterim(transcript);
    clearPause();
    if (transcript.length >= MIN_CHUNK) {
      pauseTimer = setTimeout(() => addToCluster(currentInterim), PAUSE_MS);
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
      if (clusterTimer) { clearTimeout(clusterTimer); clusterTimer = null; }
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
