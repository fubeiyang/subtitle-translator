// Deepgram Nova-3 real-time streaming via WebSocket
//
// Protocol:
//   1. Open WS to wss://api.deepgram.com/v1/listen with query params
//   2. Stream raw PCM16 audio ArrayBuffers as binary messages
//   3. Receive JSON "Results" messages:
//      - is_final=false  → interim result (still speaking, may change)
//      - speech_final=true → sentence boundary (safe to translate)
//   4. Send {"type":"CloseStream"} to flush remaining audio, then close WS

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

export function createDeepgramService(
  apiKey: string,
  language: SourceLanguage,
  callbacks: DeepgramCallbacks
): DeepgramService {
  // Auth is injected by Electron's webRequest.onBeforeSendHeaders in main.cjs
  // (adds "Authorization: Token KEY" to the WS upgrade request transparently).
  // The apiKey param is kept for signature compatibility but not used in the URL.
  void apiKey;

  const params = new URLSearchParams({
    model: 'nova-3',           // Latest Nova-3 model (best accuracy + speed)
    language,                  // en / ja / ko / multi (auto-detect)
    encoding: 'linear16',      // Raw PCM 16-bit signed integers
    sample_rate: '16000',      // Must match AudioContext sampleRate
    channels: '1',             // Mono audio
    punctuate: 'true',         // Add punctuation automatically
    interim_results: 'true',   // Stream partial results for low latency
    vad_events: 'true',        // Voice activity detection events
    endpointing: '380',        // Silence (ms) before treating as sentence end
    utterance_end_ms: '1000',  // Additional silence for final utterance flush
  });

  const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    console.log('[Deepgram] WebSocket connected');
    callbacks.onOpen?.();
  };

  ws.onmessage = (event) => {
    let msg: DeepgramMessage;
    try {
      msg = JSON.parse(event.data as string) as DeepgramMessage;
    } catch {
      return; // Non-JSON frames (keep-alive, etc.) — ignore
    }

    if (msg.type === 'Results') {
      const alt = msg.channel?.alternatives?.[0];
      const transcript = alt?.transcript?.trim() ?? '';

      if (!transcript) return;

      if (msg.speech_final) {
        // Sentence boundary — translate this
        callbacks.onFinal(transcript);
      } else if (!msg.is_final) {
        // Mid-utterance interim — show immediately without translation
        callbacks.onInterim(transcript);
      }
    } else if (msg.type === 'Metadata') {
      console.log('[Deepgram] Metadata:', msg);
    } else if (msg.type === 'Error') {
      callbacks.onError(`Deepgram error: ${msg.message ?? JSON.stringify(msg)}`);
    }
  };

  ws.onerror = (event) => {
    console.error('[Deepgram] WebSocket error', event);
    callbacks.onError(event);
  };

  ws.onclose = (event) => {
    console.log(`[Deepgram] WebSocket closed (code ${event.code})`);
    callbacks.onClose?.();
  };

  return {
    sendAudio(pcm) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(pcm);
      }
    },

    close() {
      if (ws.readyState === WebSocket.OPEN) {
        // Flush remaining audio before closing
        ws.send(JSON.stringify({ type: 'CloseStream' }));
        setTimeout(() => ws.close(1000, 'User stopped'), 500);
      } else {
        ws.close();
      }
    },

    isConnected() {
      return ws.readyState === WebSocket.OPEN;
    },
  };
}

// ── Deepgram message types ────────────────────────────────────────────────────
interface DeepgramMessage {
  type: 'Results' | 'Metadata' | 'UtteranceEnd' | 'Error' | string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: {
    alternatives?: Array<{
      transcript: string;
      confidence: number;
    }>;
  };
  message?: string;
  [key: string]: unknown;
}
