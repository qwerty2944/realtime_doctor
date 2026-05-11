// Continuous 16kHz mono PCM Int16 chunks for streaming transcription
// (CLOVA Speech, future Gemini Live, etc.) — no VAD, just steady frames.
const WORKLET_SOURCE = `
class ContinuousProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.chunkSize = o.chunkSize ?? 1600; // 100ms @ 16kHz
    this.buffer = new Float32Array(this.chunkSize);
    this.offset = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buffer[this.offset++] = ch[i];
      if (this.offset >= this.chunkSize) {
        const out = new Int16Array(this.chunkSize);
        for (let j = 0; j < this.chunkSize; j++) {
          const s = Math.max(-1, Math.min(1, this.buffer[j]));
          out[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage(out.buffer, [out.buffer]);
        this.buffer = new Float32Array(this.chunkSize);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('continuous-pcm', ContinuousProcessor);
`;

export interface ContinuousAudioController {
  stop(): void;
}

export interface ContinuousAudioOptions {
  onChunk: (pcm: Int16Array) => void;
  onError?: (err: unknown) => void;
}

export async function startContinuousAudio({
  onChunk,
  onError
}: ContinuousAudioOptions): Promise<ContinuousAudioController> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true
    }
  });

  const ctx = new AudioContext({ sampleRate: 16000 });
  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'continuous-pcm', {
    processorOptions: { chunkSize: 1600 }
  });

  node.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
    try {
      onChunk(new Int16Array(ev.data));
    } catch (err) {
      onError?.(err);
    }
  };

  source.connect(node);

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        source.disconnect();
        node.disconnect();
        node.port.onmessage = null;
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
      } catch {
        /* ignore */
      }
    }
  };
}
