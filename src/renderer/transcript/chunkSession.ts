import { startVad, type VadController } from './audioVad';
import { bytesToBase64, floatTo16BitWav } from './wav';

export interface ChunkSessionHandle {
  stop(): void;
}

export interface ChunkSessionCallbacks {
  onPending: (id: string) => void;
  onComplete: (id: string, text: string) => void;
  onFailed: (id: string) => void;
  onEmpty: (id: string) => void;
  onError: (err: unknown) => void;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `u_${Date.now()}_${counter}`;
}

export async function startChunkSession(
  cb: ChunkSessionCallbacks
): Promise<ChunkSessionHandle> {
  let vad: VadController | null = null;

  const onSpeechEnd = (samples: Float32Array, sampleRate: number) => {
    // VAD itself stops emitting after `stop()` is called, but a final
    // flush still arrives. Always accept it — let in-flight transcribes
    // resolve into the utterance list so nothing gets cut off.
    const id = nextId();
    cb.onPending(id);
    void (async () => {
      try {
        const wav = floatTo16BitWav(samples, sampleRate);
        const base64Wav = bytesToBase64(wav);
        const text = await window.api.transcribeAudio({ id, base64Wav });
        if (!text) cb.onEmpty(id);
        else cb.onComplete(id, text);
      } catch (err) {
        console.error('[chunk transcribe] failed', err);
        cb.onFailed(id);
        cb.onError(err);
      }
    })();
  };

  vad = await startVad({ onSpeechEnd, onError: cb.onError });

  return {
    stop() {
      vad?.stop();
      vad = null;
    }
  };
}
