// Energy-based VAD running in an AudioWorklet. Emits a Float32Array of PCM
// samples (mono, AudioContext sampleRate) each time it detects a finished
// utterance.
const WORKLET_SOURCE = `
class VADProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return []; }
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.threshold = o.threshold ?? 0.012;
    this.silenceFrames = o.silenceFrames ?? 50;   // ~640ms @ 128/8000fps actually depends on sample rate
    this.minSamples = o.minSamples ?? 4000;       // ~250ms @ 16kHz
    this.maxSamples = o.maxSamples ?? 16000 * 15; // 15s
    this.buffer = [];
    this.speaking = false;
    this.silenceCount = 0;
    this.port.onmessage = (e) => {
      if (e && e.data && e.data.type === 'flush') this.flush();
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    const rms = Math.sqrt(sum / ch.length);

    if (rms > this.threshold) {
      this.speaking = true;
      this.silenceCount = 0;
      for (let i = 0; i < ch.length; i++) this.buffer.push(ch[i]);
      if (this.buffer.length >= this.maxSamples) this.flush();
    } else if (this.speaking) {
      this.silenceCount++;
      for (let i = 0; i < ch.length; i++) this.buffer.push(ch[i]);
      if (this.silenceCount >= this.silenceFrames) this.flush();
    }
    return true;
  }
  flush() {
    if (this.buffer.length >= this.minSamples) {
      const out = new Float32Array(this.buffer);
      this.port.postMessage(out, [out.buffer]);
    }
    this.buffer = [];
    this.speaking = false;
    this.silenceCount = 0;
  }
}
registerProcessor('vad-processor', VADProcessor);
`;

export interface VadController {
  stop(): void;
  sampleRate: number;
}

export interface VadOptions {
  onSpeechEnd: (samples: Float32Array, sampleRate: number) => void;
  onError?: (err: unknown) => void;
}

export async function startVad({
  onSpeechEnd,
  onError
}: VadOptions): Promise<VadController> {
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
  // Frame size at 16kHz is 128 samples = 8ms. silenceFrames=75 ≈ 600ms.
  const node = new AudioWorkletNode(ctx, 'vad-processor', {
    processorOptions: {
      threshold: 0.012,
      silenceFrames: 75,
      minSamples: 4000,
      maxSamples: ctx.sampleRate * 15
    }
  });

  node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
    try {
      onSpeechEnd(ev.data, ctx.sampleRate);
    } catch (err) {
      onError?.(err);
    }
  };

  source.connect(node);
  // Don't connect node to destination — we don't want to play audio back.

  let stopped = false;
  return {
    sampleRate: ctx.sampleRate,
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        // Ask the worklet to emit any buffered samples as one final utterance.
        node.port.postMessage({ type: 'flush' });
      } catch {
        /* ignore */
      }
      // Give the worklet a moment to deliver the final chunk via postMessage
      // before tearing down the audio graph.
      setTimeout(() => {
        try {
          source.disconnect();
          node.disconnect();
          node.port.onmessage = null;
          stream.getTracks().forEach((t) => t.stop());
          void ctx.close();
        } catch {
          /* ignore */
        }
      }, 150);
    }
  };
}
