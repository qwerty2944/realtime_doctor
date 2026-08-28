import 'server-only';

/**
 * 문진 API 용 서명 세션 토큰. SERVER ONLY.
 *
 * 문진 라우트는 Supabase Auth 를 쓸 수 없다 — 환자에게 계정이 없다. 그렇다고
 * encounter id 만 확인하면 id 자체가 베어러 자격증명이 되어버려서, id 를
 * 알아낸 사람이 남의 문진에 답변을 덧붙일 수 있다.
 *
 * 토큰은 /api/intake/start 에서 발급되고, 발급된 그 진료(encounter)와
 * **그 진료의 담당 의사**에 묶인다. 증명하는 것은 딱 하나 —
 * "이 진료가 만들어질 때 이 사람이 그 자리에 있었다". 읽기 권한은 주지 않고
 * 만료된다.
 *
 * 형식: `v1.<expiryEpochSeconds>.<hex hmac>`
 *
 * 만료 시각은 평문으로 실려 있지만 MAC 이 덮으므로 클라이언트가 늘릴 수 없다.
 * 비교는 전부 `timingSafeEqual` — hex 다이제스트를 `===` 로 비교하면 처음
 * 다른 바이트 위치가 새어나가서 한 바이트씩 MAC 을 복원할 수 있다.
 *
 * 담당 의사 uuid 를 MAC 입력에 넣는 이유는 `./kiosk.ts` 참고: 검증 시 그 값은
 * 클라이언트가 아니라 DB 의 encounter 행에서 읽어오므로, 토큰은 자기가 속한
 * 진료·의사 조합에서만 유효하다.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { requireEnv } from '@/lib/env';

const TOKEN_VERSION = 'v1';

/**
 * 토큰 수명. 문진은 몇 분짜리이지 몇 시간짜리가 아니다. 2시간이면 태블릿을
 * 잠깐 내려놨다 돌아온 환자를 감당하면서도, 하루 종일 쓸 수 있는 자격증명을
 * 굴러다니게 두지는 않는다.
 */
export const INTAKE_TOKEN_TTL_SECONDS = 2 * 60 * 60;

export type IntakeTokenFailure =
  | 'malformed'
  | 'unsupported_version'
  | 'bad_signature'
  | 'expired';

export type IntakeTokenVerification =
  | { ok: true; expiresAt: number }
  | { ok: false; reason: IntakeTokenFailure };

export interface IntakeTokenSubject {
  encounterId: string;
  /** 이 진료를 소유한 의사(auth.users.id). DB 의 encounters.user_id 에서 읽는다. */
  clinicianId: string;
}

function sign(subject: IntakeTokenSubject, expiresAt: number): string {
  return createHmac('sha256', requireEnv('KIOSK_TOKEN_SECRET'))
    .update(
      `${TOKEN_VERSION}|${subject.encounterId}|${subject.clinicianId}|${expiresAt}`
    )
    .digest('hex');
}

/** 같은 길이의 hex 다이제스트 두 개를 상수 시간으로 비교. */
function digestsMatch(a: string, b: string): boolean {
  // timingSafeEqual 은 길이가 다르면 던지는데 그 자체가 타이밍 신호다.
  // 길이를 먼저 보고 다르면 비교 없이 실패시킨다.
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export function mintIntakeToken(
  subject: IntakeTokenSubject,
  ttlSeconds: number = INTAKE_TOKEN_TTL_SECONDS,
  now: Date = new Date()
): string {
  const expiresAt = Math.floor(now.getTime() / 1000) + ttlSeconds;
  return `${TOKEN_VERSION}.${expiresAt}.${sign(subject, expiresAt)}`;
}

/**
 * 호출자가 주장하는 진료·의사 조합에 대해 토큰을 검증한다.
 *
 * 불린이 아니라 이유를 돌려준다. 창틀에 놓인 채 만료된 태블릿과 위조된 MAC 은
 * 전혀 다른 사건이라 로그에는 구별해서 남겨야 하지만, 환자에게 보여주는
 * 문장은 똑같아야 한다.
 */
export function verifyIntakeToken(
  token: string,
  subject: IntakeTokenSubject,
  now: Date = new Date()
): IntakeTokenVerification {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };

  const [version, expiryText, digest] = parts;
  if (version !== TOKEN_VERSION) return { ok: false, reason: 'unsupported_version' };

  // 평범한 양의 정수가 아니면 거절: parseInt 는 "1799999999abc" 도 받아들이고
  // Number("") 는 0 이다.
  if (!/^\d{1,15}$/.test(expiryText)) return { ok: false, reason: 'malformed' };
  if (!/^[0-9a-f]{64}$/.test(digest)) return { ok: false, reason: 'malformed' };

  const expiresAt = Number(expiryText);

  // 만료보다 서명을 먼저 본다. 위조 토큰의 추측한 만료 시각이 유효 범위였는지를
  // MAC 검사 전에 알려주면 안 된다.
  if (!digestsMatch(digest, sign(subject, expiresAt))) {
    return { ok: false, reason: 'bad_signature' };
  }

  if (Math.floor(now.getTime() / 1000) >= expiresAt) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, expiresAt };
}
