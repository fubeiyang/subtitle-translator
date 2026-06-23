// Deepgram Nova-3 real-time streaming — hybrid chunking strategy
//
// Trigger hierarchy (earliest wins, all send to onFinal):
//   1. Punctuation in new interim content  → immediate
//   2. 300 ms pause without new words      → debounce flush
//   3. is_final (segment boundary)         → guaranteed flush
//   4. speech_final (utterance boundary)   → flush + full reset
//
// This ensures continuous speech never stalls — even without natural pauses.

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

// Punctuation that signals a good translation boundary
const PUNCT_RE = /[.!?,;:]\s*$/;
const MIN_CHUNK = 5;   // minimum chars to bother translating
const PAUSE_MS  = 300; // ms of silence before force-flush

export function createDeepgramService(
  apiKey: string,
  language: SourceLanguage,
  callbacks: DeepgramCallbacks
): DeepgramService {
  void apiKey; // auth injected by main.cjs webRequest interceptor

  const params = new URLSearchParams({
    model: 'nova-3',
    language,
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    punctuate: 'true',
    interim_results: 'true',
    vad_events: 'true',
    endpointing: '300',       // tighter VAD — 300 ms silence = segment end
    utterance_end_ms: '800',
  });

  const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  // ── Chunking state ─────────────────────────────────────────────────────────
  let sentBoundary = 0;  // byte-offset in current segment already sent to onFinal
  let currentInterim = '';
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;

  const clearPause = () => {
    if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null; }
  };

  // Send the slice of the current segment not yet translated.
  // sentBoundary advances so the same text is never sent twice.
  const flushChunk = (fullSegment: string) => {
    const chunk = fullSegment.slice(sentBoundary).trim();
    if (chunk.length < MIN_CHUNK) return;
    sentBoundary = fullSegment.length;
    callbacks.onFinal(chunk);
  };

  // Full reset between utterances
  const resetSegment = () => {
    sentBoundary = 0;
    currentInterim = '';
  };

  // ── WebSocket lifecycle ────────────────────────────────────────────────────
  ws.onopen = () => {
    console.log('[Deepgram] connected');
    callbacks.onOpen?.();
  };

  ws.onmessage = (event) => {
    let msg: DeepgramMessage;
    try {
      msg = JSON.parse(event.data as string) as DeepgramMessage;
    } catch { return; }

    if (msg.type !== 'Results') return;

    const alt = msg.channel?.alternatives?.[0];
    const transcript = alt?.transcript?.trim() ?? '';

    // ── speech_final: utterance boundary ─────────────────────────────────
    if (msg.speech_final) {
      clearPause();
      if (transcript) flushChunk(transcript);
      resetSegment();
      callbacks.onInterim(''); // clear "recognising..." in main window
      return;
    }

    // ── is_final: segment boundary (more speech likely follows) ───────────
    if (msg.is_final) {
      clearPause();
      if (transcript) flushChunk(transcript);
      resetSegment(); // next interim starts a new segment from index 0
      return;
    }

    // ── interim: streaming partial result ─────────────────────────────────
    if (!transcript) return;
    currentInterim = transcript;
    callbacks.onInterim(transcript);

    const newPart = transcript.slice(sentBoundary).trim();
    if (!newPart || newPart.length < MIN_CHUNK) return;

    if (PUNCT_RE.test(newPart)) {
      // Punctuation boundary → translate now, don't wait
      clearPause();
      flushChunk(transcript);
    } else {
      // No punctuation → wait for 300 ms pause then flush
      clearPause();
      pauseTimer = setTimeout(() => {
        const latest = currentInterim.slice(sentBoundary).trim();
        if (latest.length >= MIN_CHUNK) flushChunk(currentInterim);
      }, PAUSE_MS);
    }
  };

  ws.onerror = (event) => {
    console.error('[Deepgram] error', event);
    callbacks.onError(event);
  };

  ws.onclose = (event) => {
    clearPause();
    console.log(`[Deepgram] closed (${event.code})`);
    callbacks.onClose?.();
  };

  return {
    sendAudio(pcm) {
      if (ws.readyState === WebSocket.OPEN) ws.send(pcm);
    },
    close() {
      clearPause();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CloseStream' }));
        setTimeout(() => ws.close(1000, 'stopped'), 500);
      } else {
        ws.close();
      }
    },
    isConnected() { return ws.readyState === WebSocket.OPEN; },
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
