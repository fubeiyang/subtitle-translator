// System audio capture via Electron's getDisplayMedia + WASAPI Loopback
//
// On Windows: Electron's setDisplayMediaRequestHandler (main.cjs) intercepts
// getDisplayMedia() and returns WASAPI loopback audio — zero extra software needed.
//
// On macOS: User must install BlackHole (https://github.com/ExistentialAudio/BlackHole)
// and select it as audio output. The captured stream will be that loopback device.
//
// Audio pipeline:
//   getDisplayMedia() → MediaStream
//     → AudioContext (resampled to 16 kHz)
//       → ScriptProcessorNode (4096 samples ≈ 256 ms)
//         → Float32 → Int16 PCM conversion
//           → callback(ArrayBuffer) → Deepgram WebSocket

export interface AudioCapture {
  start: (onChunk: (pcm: ArrayBuffer) => void) => Promise<void>;
  stop: () => void;
}

const SAMPLE_RATE = 16_000; // Deepgram linear16 requires 16 kHz
const BUFFER_SIZE = 4096;   // ~256 ms chunks; small enough for <500 ms latency

export function createAudioCapture(): AudioCapture {
  let audioContext: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let stream: MediaStream | null = null;

  return {
    async start(onChunk) {
      // getDisplayMedia() is intercepted by main.cjs setDisplayMediaRequestHandler.
      // On Windows this returns WASAPI loopback (system audio playing through speakers).
      const rawStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,  // required for the API call; we discard the video track immediately
        audio: true,
      });

      // Discard video — we only need audio
      rawStream.getVideoTracks().forEach((t) => t.stop());

      const audioTracks = rawStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error(
          '未获取到音频轨道。Windows 请确保系统有音频输出；macOS 请安装 BlackHole 并将其设为输出设备。'
        );
      }

      stream = new MediaStream(audioTracks);

      // Resample to 16 kHz for Deepgram linear16 encoding
      audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

      source = audioContext.createMediaStreamSource(stream);

      // ScriptProcessorNode is deprecated but still works in Electron's Chromium.
      // For a production upgrade, replace with AudioWorkletNode + pcm-processor.js.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

      processor.onaudioprocess = (event) => {
        const float32 = event.inputBuffer.getChannelData(0);
        onChunk(float32ToPcm16(float32));
      };

      source.connect(processor);
      // Must connect to destination to keep the graph alive (Chromium requirement)
      processor.connect(audioContext.destination);
    },

    stop() {
      processor?.disconnect();
      source?.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
      audioContext?.close();
      processor = null;
      source = null;
      stream = null;
      audioContext = null;
    },
  };
}

// Convert [-1, 1] Float32Array to signed Int16 PCM ArrayBuffer (little-endian)
function float32ToPcm16(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const clamped = Math.max(-1, Math.min(1, input[i]));
    // Map to Int16 range [-32768, 32767]
    view.setInt16(i * 2, clamped < 0 ? clamped * 32768 : clamped * 32767, true);
  }
  return buffer;
}
