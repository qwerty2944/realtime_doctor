/**
 * POST /api/intake/transcribe   (multipart/form-data: encounterId, token, audio)
 *
 * 문진 답변의 서버측 음성 전사. 환자 브라우저가 MediaRecorder 로 답변을 녹음해
 * 올리면 CLOVA Speech 가 글자로 바꿔주고, 클라이언트는 그걸 입력창에 채운다.
 * 브라우저 Web Speech 인식 API 는 쓰지 않는다 — 카카오톡 인앱 브라우저와 iOS
 * Safari 에서 동작하지 않고 안드로이드 Chrome 에서는 전사가 중복된다.
 *
 * 인가를 가장 먼저 확인한다. 이 라우트는 CLOVA 쿼터를 쓰므로, 인증되지 않은
 * 호출자는 벤더에 1바이트가 닿기 전에 돌려보내야 한다. 검증 방식은
 * `/api/intake/turn` 과 똑같다: 담당 의사 uuid 는 DB 의 encounter 행에서 읽는다.
 *
 * 모든 실패는 500 이 아닌 구조화된 에러이고, 클라이언트는 그걸 "글자로
 * 입력해 주세요" 로 보여준다. 입력창은 항상 떠 있으므로 전사 문제로 환자가
 * 갇히는 일은 없다.
 */

import { GENERIC_SERVER_ERROR, jsonError } from '@/lib/api';
import { verifyIntakeToken } from '@/lib/intake/token';
import { SttError, isVoiceInputEnabled, transcribePlainText } from '@/lib/stt/clova';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export interface IntakeTranscribeResponse {
  /** 인식된 답변, 트림됨. 200 일 때는 항상 비어 있지 않다. */
  text: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 업로드 녹음 상한. 문진 답변은 몇 초짜리 발화라 10MB 면 높은 비트레이트로도
 * 넉넉하다. 핵심은 멈춰 있거나 악의적인 녹음이 동기 CLOVA 호출을 열어둔 채
 * 붙잡거나 거대한 파일로 쿼터를 태우지 못하게 하는 것이다.
 */
export const MAX_INTAKE_AUDIO_BYTES = 10 * 1024 * 1024;

const STT_FAILURE_MESSAGE = '음성 변환에 실패했습니다. 글자로 입력해 주세요.';
const BAD_TOKEN_MESSAGE =
  '문진 세션 정보가 올바르지 않습니다. 처음부터 다시 시작해 주세요.';

/** 허용 컨테이너. 브라우저 MediaRecorder 가 실제로 내놓는 것들. */
const ALLOWED_MIME_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav'
]);

/** "audio/webm;codecs=opus" 에서 파라미터를 떼어낸다. */
function baseMimeType(value: string): string {
  return value.split(';')[0]?.trim().toLowerCase() ?? '';
}

/** multipart 파트 이름용 확장자. CLOVA 가 그럴듯한 컨테이너로 보도록. */
function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case 'audio/webm':
      return 'webm';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/mp4':
      return 'm4a';
    case 'audio/wav':
      return 'wav';
    default:
      return 'bin';
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isVoiceInputEnabled()) {
    // 클라이언트는 이 배포에 음성이 없다는 걸 이미 알고 녹음 버튼을 숨기지만,
    // 캐시된 화면이 남아 있을 수 있으므로 라우트도 스스로 방어한다.
    return jsonError(503, '이 기기에서는 음성 입력을 사용할 수 없습니다. 글자로 입력해 주세요.');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, '녹음 파일을 읽지 못했습니다. 다시 시도해 주세요.');
  }

  const encounterId = form.get('encounterId');
  const token = form.get('token');
  const audio = form.get('audio');

  // MAC 을 계산하기 전에 형태부터 싸게 확인한다.
  if (typeof encounterId !== 'string' || !UUID_PATTERN.test(encounterId)) {
    return jsonError(400, '세션 정보가 올바르지 않습니다.');
  }
  if (typeof token !== 'string' || token === '' || token.length > 300) {
    return jsonError(401, BAD_TOKEN_MESSAGE);
  }

  try {
    const supabase = createSupabaseAdminClient();

    const { data: encounter, error: encounterError } = await supabase
      .from('encounters')
      .select('user_id')
      .eq('id', encounterId)
      .maybeSingle();

    if (encounterError) {
      throw new Error(`Failed to load encounter ${encounterId}: ${encounterError.message}`);
    }
    if (!encounter) {
      console.warn(`[POST /api/intake/transcribe] Unknown encounter ${encounterId}.`);
      return jsonError(401, BAD_TOKEN_MESSAGE);
    }

    // 돈이 들거나 벤더에 닿는 어떤 것보다 먼저 인가한다.
    const verification = verifyIntakeToken(token, {
      encounterId,
      clinicianId: (encounter as { user_id: string }).user_id
    });
    if (!verification.ok) {
      console.warn(
        `[POST /api/intake/transcribe] Rejected transcription on encounter ${encounterId}: token ${verification.reason}.`
      );
      return jsonError(
        401,
        verification.reason === 'expired'
          ? '문진 시간이 만료되었습니다. 접수처에 알려 주시고 처음부터 다시 시작해 주세요.'
          : BAD_TOKEN_MESSAGE
      );
    }

    if (!(audio instanceof File) || audio.size === 0) {
      return jsonError(400, '녹음된 내용이 없습니다. 다시 녹음하거나 글자로 입력해 주세요.');
    }
    if (audio.size > MAX_INTAKE_AUDIO_BYTES) {
      return jsonError(
        413,
        '녹음이 너무 깁니다. 짧게 나누어 다시 녹음하거나 글자로 입력해 주세요.'
      );
    }

    const mimeType = baseMimeType(audio.type);
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return jsonError(415, '지원하지 않는 녹음 형식입니다. 글자로 입력해 주세요.');
    }

    const bytes = new Uint8Array(await audio.arrayBuffer());
    const text = await transcribePlainText(
      {
        bytes,
        mimeType,
        fileName: audio.name === '' ? `intake.${extensionFor(mimeType)}` : audio.name
      },
      { language: 'ko-KR' }
    );

    return Response.json({ text } satisfies IntakeTranscribeResponse);
  } catch (error) {
    // CLOVA 실패는 서버 버그가 아니다. 클라이언트가 대체 안내로 띄울 수 있는
    // 비-500 을 돌려준다. 그 밖의 에러는 예상 밖이므로 일반 500.
    if (error instanceof SttError) {
      console.warn(
        `[POST /api/intake/transcribe] CLOVA transcription failed for encounter ${String(encounterId)}.`,
        error
      );
      return jsonError(502, STT_FAILURE_MESSAGE);
    }
    console.error(
      `[POST /api/intake/transcribe] Unexpected failure for encounter ${String(encounterId)}.`,
      error
    );
    return jsonError(500, GENERIC_SERVER_ERROR);
  }
}
