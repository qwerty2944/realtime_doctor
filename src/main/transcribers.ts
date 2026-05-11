import type {
  EphemeralSession,
  TranscribeProviderId,
  TranscribeProviderInfo
} from '../shared/types.js';
import {
  hasClovaCredentials,
  transcribeWithClova
} from './clovaTranscriber.js';
import { hasClovaSpeechSecret } from './clovaStream.js';
import { transcribeWithGemini } from './geminiTranscriber.js';
import { mintOpenAIRealtimeSession } from './openaiStream.js';
import { getTranscribeProvider } from './store.js';

export function listProviders(): TranscribeProviderInfo[] {
  return [
    {
      id: 'gemini',
      label: 'Gemini (gemini-2.5-flash)',
      mode: 'chunk',
      available: !!process.env.GEMINI_API_KEY,
      notes: '발화 청크 (클라이언트 VAD → audio inline)'
    },
    {
      id: 'openai',
      label: 'OpenAI Realtime (gpt-4o-transcribe)',
      mode: 'stream',
      available: !!process.env.OPENAI_API_KEY,
      notes: '실시간 스트리밍 (WebRTC + server VAD + partial)'
    },
    {
      id: 'clova-csr',
      label: 'CLOVA CSR (한국어)',
      mode: 'chunk',
      available: hasClovaCredentials(),
      notes: 'NCP API Gateway · 단문 인식 (≤60초/청크)'
    },
    {
      id: 'clova-stream',
      label: 'CLOVA Speech Streaming',
      mode: 'stream',
      available: hasClovaSpeechSecret(),
      notes: 'gRPC bidi · 장문 인식 도메인 Secret 필요'
    }
  ];
}

function currentInfo(): TranscribeProviderInfo {
  const id = getTranscribeProvider();
  const info = listProviders().find((p) => p.id === id);
  if (!info) throw new Error(`Unknown provider: ${id}`);
  return info;
}

export async function transcribeAudio(base64Wav: string): Promise<string> {
  const info = currentInfo();
  if (info.mode !== 'chunk') {
    throw new Error(
      `현재 선택된 공급자(${info.id})는 chunk 모드를 지원하지 않습니다. 스트리밍 세션을 사용하세요.`
    );
  }
  switch (info.id) {
    case 'gemini':
      return transcribeWithGemini(base64Wav);
    case 'clova-csr':
      return transcribeWithClova(base64Wav);
    default:
      throw new Error(`No chunk transcriber registered for ${info.id}`);
  }
}

export async function mintStreamSession(): Promise<EphemeralSession> {
  const info = currentInfo();
  if (info.mode !== 'stream') {
    throw new Error(
      `현재 선택된 공급자(${info.id})는 stream 모드를 지원하지 않습니다.`
    );
  }
  switch (info.id) {
    case 'openai':
      return mintOpenAIRealtimeSession();
    case 'clova-stream':
      throw new Error(
        'CLOVA Speech Streaming은 ephemeral key 방식이 아닌 IPC 브리지로 동작합니다. clova-stream:open IPC를 사용하세요.'
      );
    default:
      throw new Error(`No stream provider registered for ${info.id}`);
  }
}

export function getCurrentProviderInfo(): TranscribeProviderInfo {
  return currentInfo();
}

// Convenience for IPC consumers that just want the mode without listing.
export function getCurrentMode(): TranscribeProviderInfo['mode'] {
  return currentInfo().mode;
}

// Eliminate unused-import warnings for IDs we may extend.
export type _Id = TranscribeProviderId;
