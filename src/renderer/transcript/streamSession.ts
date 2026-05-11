import axios from 'axios';

export interface StreamSessionHandle {
  stop(): void;
}

export interface StreamSessionCallbacks {
  onDelta: (itemId: string, delta: string) => void;
  onCompleted: (itemId: string, transcript: string) => void;
  onError: (err: unknown) => void;
}

interface RealtimeEvent {
  type: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  error?: unknown;
}

export async function startStreamSession(
  cb: StreamSessionCallbacks
): Promise<StreamSessionHandle> {
  const session = await window.api.mintStreamSession();
  const ephemeralKey = session.client_secret.value;

  const pc = new RTCPeerConnection();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true
    }
  });
  stream.getAudioTracks().forEach((t) => pc.addTrack(t, stream));

  const dc = pc.createDataChannel('oai-events');
  dc.addEventListener('message', (ev: MessageEvent<string>) => {
    try {
      const event = JSON.parse(ev.data) as RealtimeEvent;
      switch (event.type) {
        case 'conversation.item.input_audio_transcription.delta':
          if (event.item_id && typeof event.delta === 'string') {
            cb.onDelta(event.item_id, event.delta);
          }
          break;
        case 'conversation.item.input_audio_transcription.completed':
          if (event.item_id && typeof event.transcript === 'string') {
            cb.onCompleted(event.item_id, event.transcript);
          }
          break;
        case 'error':
          cb.onError(
            event.error instanceof Object
              ? JSON.stringify(event.error)
              : String(event.error ?? event)
          );
          break;
      }
    } catch (err) {
      console.warn('[stream] failed to parse event', err);
    }
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const { data: answerSdp } = await axios.post<string>(
    'https://api.openai.com/v1/realtime/calls',
    offer.sdp,
    {
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        'Content-Type': 'application/sdp'
      },
      responseType: 'text',
      transformResponse: (raw) => raw
    }
  );

  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      // Stop sending mic audio immediately; server VAD will trigger a final
      // transcript completion which arrives via the data channel.
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      // Nudge the server to commit any buffered input so the tail isn't lost.
      try {
        dc.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      } catch {
        /* ignore */
      }
      // Keep the peer connection alive briefly so the final completion event
      // can arrive before we close.
      setTimeout(() => {
        try {
          dc.close();
          pc.close();
        } catch {
          /* ignore */
        }
        window.api.endRealtimeSession();
      }, 2000);
    }
  };
}
