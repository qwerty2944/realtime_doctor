import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { requireEnv } from '@/lib/env';

/**
 * Electron -> 브라우저 자동 로그인 핸드오프 (S3).
 *
 * 앱 안에서 이미 로그인한 의사에게 브라우저에서 비밀번호를 다시 치게 하는 것은
 * 하필 결제 직전이라는 최악의 지점에 마찰을 넣는 일이다. 그래서 1회용 링크로
 * 넘긴다.
 *
 * URL 에 실리는 것은 **Supabase 가 발급한 1회용 OTP 해시(token_hash)** 뿐이다.
 * access token 도, refresh token 도, 어떤 장기 JWT 도 URL 에 넣지 않는다.
 * token_hash 는 서버(/billing/handoff)에서 verifyOtp 로 교환되고, 세션은 그때
 * HttpOnly 쿠키로만 설정된다. GoTrue 는 교환된 OTP 를 즉시 폐기하므로 링크는
 * 문자 그대로 한 번만 쓸 수 있다.
 *
 * 여기에 우리 쪽 봉투(HMAC + exp)를 한 겹 더 씌운다. 이유:
 *   * Supabase 의 OTP 기본 만료는 1시간이다. 결제 화면으로 넘어가는 데 1시간이
 *     필요한 사람은 없고, 브라우저 히스토리·프록시 로그에 1시간짜리 로그인
 *     링크가 남는 것은 필요 이상의 노출이다. 봉투로 120초로 줄인다.
 *   * 봉투 서명이 없으면 /billing/handoff 는 아무 token_hash 나 받아 교환을
 *     시도하는 엔드포인트가 된다.
 */

/** 핸드오프 링크 유효기간. 앱에서 브라우저가 뜨는 데 걸리는 시간의 몇 배면 충분하다. */
export const HANDOFF_TTL_MS = 120_000;

function sign(tokenHash: string, expSec: number): string {
  return createHmac('sha256', requireEnv('BILLING_HANDOFF_SECRET'))
    .update(`v1\n${tokenHash}\n${expSec}`)
    .digest('base64url');
}

export function buildHandoffUrl(origin: string, tokenHash: string, nowMs = Date.now()): string {
  const expSec = Math.floor((nowMs + HANDOFF_TTL_MS) / 1000);
  const params = new URLSearchParams({
    t: tokenHash,
    e: String(expSec),
    s: sign(tokenHash, expSec)
  });
  return `${origin}/billing/handoff?${params.toString()}`;
}

export type HandoffCheck =
  | { ok: true; tokenHash: string }
  | { ok: false; reason: 'missing' | 'expired' | 'bad_signature' };

export function verifyHandoff(params: URLSearchParams, nowMs = Date.now()): HandoffCheck {
  const tokenHash = params.get('t');
  const expRaw = params.get('e');
  const sig = params.get('s');
  if (!tokenHash || !expRaw || !sig) return { ok: false, reason: 'missing' };

  const expSec = Number(expRaw);
  if (!Number.isFinite(expSec)) return { ok: false, reason: 'missing' };

  const expected = Buffer.from(sign(tokenHash, expSec));
  const given = Buffer.from(sig);
  // 서명을 만료보다 먼저 본다. 만료 검사를 먼저 하면 서명 없는 요청에도
  // "만료됨"이라는 정보를 주게 된다.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'bad_signature' };
  }
  if (nowMs > expSec * 1000) return { ok: false, reason: 'expired' };
  return { ok: true, tokenHash };
}
