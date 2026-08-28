import 'server-only';

/**
 * 알림톡 발송 (Solapi) — 서버 전용. SERVER ONLY.
 *
 * **왜 SDK 를 쓰지 않는가.** 필요한 것은 HTTP 한 번과 서명 헤더 한 줄이다.
 * 그 둘을 위해 의존성을 하나 늘리면, 그 패키지가 담고 있는 나머지 전부가
 * 환자 데이터를 다루는 서버의 공격 표면이 된다. 서명 규격은 아래 한 곳에만
 * 있고 표준 HMAC-SHA256 이다.
 *
 * **왜 키오스크 서버인가.** 데스크톱 앱이 직접 보내면 Solapi 자격증명이
 * 번들에 들어간다 — A1 이 provider 키를 걷어낸 이유가 그대로 되살아난다
 * (빌드를 가진 누구나 우리 계정으로 문자를 보내고, 유출돼도 전 설치본을
 * 재배포하기 전에는 회수할 수 없다).
 */

import { createHmac, randomBytes } from 'node:crypto';

import { optionalEnv } from '@/lib/env';

const SOLAPI_ENDPOINT = 'https://api.solapi.com/messages/v4/send';

export interface AlimtalkConfig {
  apiKey: string;
  apiSecret: string;
  /** 카카오 발신 프로필 id. */
  pfId: string;
  templateId: string;
  /** 등록된 발신번호. 알림톡 실패 시 문자 대체 발송의 발신자이기도 하다. */
  senderPhone: string;
  /** 템플릿의 병원명 변수에 넣을 값. */
  clinicName: string;
}

/**
 * 설정이 갖춰졌는지 본다.
 *
 * [HARD] 하나라도 없으면 **미설정**이고, 미설정은 실패와 다른 값이다.
 * 자리표시자를 채워 넣고 보내는 시늉을 하면, 설정 누락이 원장에게 "환자에게
 * 안내가 갔다" 로 도착한다. 라우트는 이 null 을 그대로 `configured: false` 로
 * 돌려주고 데스크톱 화면은 "링크를 복사해서 보내세요" 를 말한다.
 */
export function loadAlimtalkConfig(): AlimtalkConfig | null {
  const apiKey = optionalEnv('SOLAPI_API_KEY');
  const apiSecret = optionalEnv('SOLAPI_API_SECRET');
  const pfId = optionalEnv('SOLAPI_PF_ID');
  const templateId = optionalEnv('SOLAPI_TEMPLATE_ID');
  const senderPhone = optionalEnv('SOLAPI_SENDER_PHONE');

  if (!apiKey || !apiSecret || !pfId || !templateId || !senderPhone) return null;

  return {
    apiKey,
    apiSecret,
    pfId,
    templateId,
    senderPhone,
    clinicName: optionalEnv('SOLAPI_CLINIC_NAME') ?? '병원'
  };
}

/**
 * Solapi 표준 서명 헤더.
 *
 *   Authorization: HMAC-SHA256 apiKey=…, date=…, salt=…, signature=…
 *   signature = hex(hmac_sha256(apiSecret, date + salt))
 *
 * date 는 ISO8601, salt 는 매 요청 새로 만든다 — 재전송을 막는 것이 salt 의
 * 목적이므로 상수로 두면 헤더가 그냥 두 번째 비밀번호가 된다.
 */
function authorizationHeader(config: AlimtalkConfig): string {
  const date = new Date().toISOString();
  const salt = randomBytes(32).toString('hex');
  const signature = createHmac('sha256', config.apiSecret)
    .update(date + salt)
    .digest('hex');

  return `HMAC-SHA256 apiKey=${config.apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

export type AlimtalkSendResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * 알림톡 한 통.
 *
 * 템플릿 변수 이름은 카카오에 등록한 템플릿과 **정확히** 같아야 한다.
 * 등록 절차와 본문 예시는 `kiosk/README.md` 에 있다.
 *
 * 실패를 던지지 않고 값으로 돌려준다: 호출자는 접수처 화면이고, 화면은 왜
 * 안 됐는지 한 문장으로 말할 수 있어야 한다.
 */
export async function sendAlimtalk(
  config: AlimtalkConfig,
  input: { to: string; patientName: string; link: string }
): Promise<AlimtalkSendResult> {
  const body = {
    message: {
      to: input.to.replace(/[^0-9]/g, ''),
      from: config.senderPhone.replace(/[^0-9]/g, ''),
      type: 'ATA',
      kakaoOptions: {
        pfId: config.pfId,
        templateId: config.templateId,
        variables: {
          '#{병원명}': config.clinicName,
          '#{환자명}': input.patientName,
          '#{문진링크}': input.link
        }
      }
    }
  };

  let response: Response;
  try {
    response = await fetch(SOLAPI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authorizationHeader(config)
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    console.error('[alimtalk] Solapi request failed.', error);
    return { ok: false, message: '알림톡 서버에 연결하지 못했습니다.' };
  }

  const payload = (await response.json().catch(() => null)) as
    | { statusCode?: string; statusMessage?: string; errorMessage?: string; failedMessageList?: unknown[] }
    | null;

  if (!response.ok) {
    // 응답 본문을 그대로 흘려보내지 않는다 — 자격증명이나 계정 정보가 섞여
    // 나올 수 있다. 로그에는 남기고, 화면에는 한 문장만 보낸다.
    console.error(
      `[alimtalk] Solapi refused the message: ${response.status} ${JSON.stringify(payload)}`
    );
    return {
      ok: false,
      message: payload?.errorMessage ?? '알림톡 발송이 거절되었습니다.'
    };
  }

  // 200 인데 개별 메시지가 실패한 경우가 있다. 이걸 성공으로 읽으면 "보냈다" 는
  // 화면과 "안 왔다" 는 환자가 동시에 존재하게 된다.
  if (Array.isArray(payload?.failedMessageList) && payload.failedMessageList.length > 0) {
    console.error(
      `[alimtalk] Solapi accepted the request but the message failed: ${JSON.stringify(payload.failedMessageList)}`
    );
    return { ok: false, message: '알림톡이 발송되지 않았습니다. 번호를 확인해 주세요.' };
  }

  return { ok: true };
}
