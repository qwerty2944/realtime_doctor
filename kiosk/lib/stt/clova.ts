import 'server-only';

/**
 * CLOVA Speech 전송 계층. SERVER ONLY.
 *
 * 엔드포인트: POST {CLOVA_SPEECH_INVOKE_URL}/recognizer/upload
 * 인증:       X-CLOVASPEECH-API-KEY: {CLOVA_SPEECH_SECRET}
 * 본문:       multipart/form-data — `media` 파일 파트 + `params` JSON 파트
 *
 * `completion: sync` 라서 한 번의 응답으로 완성된 전사가 돌아온다. 녹음이
 * 끝난 뒤 일괄 전사하는 용도에는 맞는 거래지만, 긴 녹음이 요청을 붙잡고 있게
 * 되므로 {@link MAX_SYNC_MS} 로 상한을 둔다.
 *
 * ── 선택 기능이다 ────────────────────────────────────────────────────────
 * 음성 입력은 편의이지 필수가 아니다. 문진 화면에는 항상 글자 입력이 함께
 * 있고, CLOVA 자격증명이 설정되지 않은 배포에서는 녹음 버튼이 아예 뜨지
 * 않는다. 그래서 CLOVA 변수는 `REQUIRED_ENV_VARS` 에 없다 — 없어도 문진은
 * 끝까지 돌아간다.
 */

import { optionalEnv } from '@/lib/env';

/**
 * 동기 인식 응답을 기다리는 상한. 문진 답변은 몇 초짜리라 넉넉하다.
 */
export const MAX_SYNC_MS = 2 * 60 * 1000;

/** CLOVA 전사 실패. 라우트가 이걸 잡아서 비-500 로 환자에게 알린다. */
export class SttError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SttError';
  }
}

export interface ClovaCredentials {
  invokeUrl: string;
  secret: string;
}

/**
 * CLOVA 자격증명. 둘 다 있을 때만 돌려준다.
 *
 * 하나만 설정된 상태는 오타일 가능성이 높으므로 조용히 "음성 없음" 으로
 * 취급하지 않고 로그를 남긴다 — 병원에서는 "왜 마이크가 안 나오지" 로
 * 보이고, 그 원인이 어디에도 안 적혀 있으면 찾을 수가 없다.
 */
export function clovaCredentials(): ClovaCredentials | null {
  const invokeUrl = optionalEnv('CLOVA_SPEECH_INVOKE_URL');
  const secret = optionalEnv('CLOVA_SPEECH_SECRET');

  if (invokeUrl && secret) {
    return { invokeUrl: invokeUrl.replace(/\/+$/, ''), secret };
  }

  if (invokeUrl || secret) {
    console.warn(
      '[stt:clova] Only one of CLOVA_SPEECH_INVOKE_URL / CLOVA_SPEECH_SECRET is set. Voice input stays disabled; set both or neither.'
    );
  }

  return null;
}

export function isVoiceInputEnabled(): boolean {
  return clovaCredentials() !== null;
}

interface ClovaResponse {
  result?: unknown;
  message?: unknown;
  /** `fullText` 를 요청했을 때 CLOVA 가 돌려주는 전체 녹음 전사. */
  text?: unknown;
}

export interface SttAudio {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

/**
 * 단일 화자 녹음을 평문으로 전사한다.
 *
 * diarization 은 끈다: 문진은 한 환자가 한 질문에 답하는 것이라 화자 분리는
 * 잡음(과 비용)만 더한다. `fullText` 는 세그먼트별 텍스트 대신 녹음 전체를
 * 하나의 `text` 필드로 달라는 요청이다.
 *
 * 빈 전사는 빈 답변이 아니라 실패로 취급한다: 말을 했는데 아무것도 못 받은
 * 환자는 조용히 비어 있는 입력창이 아니라 "글자로 입력해 주세요" 안내를
 * 봐야 한다.
 */
export async function transcribePlainText(
  audio: SttAudio,
  options?: { language?: string }
): Promise<string> {
  const credentials = clovaCredentials();
  if (!credentials) {
    throw new SttError('CLOVA credentials are not configured.');
  }

  const form = new FormData();
  // Uint8Array 를 그대로 Blob 에 넣으면 런타임에 따라 SharedArrayBuffer 뷰로
  // 취급될 수 있어, 명시적으로 복사한 ArrayBuffer 를 넘긴다.
  const buffer = audio.bytes.slice().buffer as ArrayBuffer;
  form.append('media', new Blob([buffer], { type: audio.mimeType }), audio.fileName);
  form.append(
    'params',
    JSON.stringify({
      language: options?.language ?? 'ko-KR',
      completion: 'sync',
      fullText: true,
      wordAlignment: false,
      diarization: { enable: false }
    })
  );

  let response: Response;
  try {
    response = await fetch(`${credentials.invokeUrl}/recognizer/upload`, {
      method: 'POST',
      headers: { 'X-CLOVASPEECH-API-KEY': credentials.secret },
      body: form,
      signal: AbortSignal.timeout(MAX_SYNC_MS)
    });
  } catch (error) {
    throw new SttError('The recognition request failed to complete.', { cause: error });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new SttError(`Recognition returned HTTP ${response.status}. ${body.slice(0, 500)}`);
  }

  let payload: ClovaResponse;
  try {
    payload = (await response.json()) as ClovaResponse;
  } catch (error) {
    throw new SttError('Recognition returned a body that is not JSON.', { cause: error });
  }

  if (typeof payload.result === 'string' && payload.result !== 'COMPLETED') {
    const message = typeof payload.message === 'string' ? payload.message : '';
    throw new SttError(`Recognition did not complete (result=${payload.result}). ${message}`);
  }

  if (typeof payload.text !== 'string') {
    throw new SttError('Recognition response contained no text field.');
  }
  const text = payload.text.trim();
  if (text === '') {
    throw new SttError('Recognition produced an empty transcript.');
  }

  return text;
}
