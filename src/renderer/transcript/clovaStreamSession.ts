import {
  startContinuousAudio,
  type ContinuousAudioController
} from './audioContinuous';

export interface ClovaStreamCallbacks {
  onDelta: (itemId: string, text: string) => void;
  onCompleted: (itemId: string, text: string) => void;
  onError: (err: unknown) => void;
}

export interface ClovaStreamHandle {
  stop(): void;
}

export async function startClovaStreamSession(
  cb: ClovaStreamCallbacks
): Promise<ClovaStreamHandle> {
  await window.api.openClovaStream();

  const offPartial = window.api.onClovaPartial(({ itemId, text }) =>
    cb.onDelta(itemId, text)
  );
  const offFinal = window.api.onClovaFinal(({ itemId, text }) =>
    cb.onCompleted(itemId, text)
  );
  const offError = window.api.onClovaError(({ message }) =>
    cb.onError(new Error(message))
  );

  let audio: ContinuousAudioController | null = null;
  try {
    audio = await startContinuousAudio({
      onChunk: (pcm) => {
        const view = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        window.api.sendClovaAudio(view);
      },
      onError: cb.onError
    });
  } catch (err) {
    offPartial();
    offFinal();
    offError();
    window.api.closeClovaStream();
    throw err;
  }

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      audio?.stop();
      offPartial();
      offFinal();
      offError();
      window.api.closeClovaStream();
    }
  };
}
