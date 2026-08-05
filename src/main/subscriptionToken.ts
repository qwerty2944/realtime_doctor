import { createPublicKey, createVerify, verify as cryptoVerify } from 'node:crypto';

/**
 * entitlement 토큰의 순수 로직 (검증 + 파생값 계산).
 *
 * electron 에 의존하지 않는다. 게이트의 핵심 판정을 electron 런타임 없이도
 * 실행·검증할 수 있어야 하기 때문이다 (scripts/probe-entitlement.mjs 가 이
 * 파일을 그대로 import 해서 위·변조 시나리오를 돌린다).
 */

/** 서버(Edge Function)가 서명한 클레임. supabase/functions/entitlement 와 1:1. */
export interface EntitlementToken {
  v: 1;
  userId: string;
  entitled: boolean;
  status: 'trialing' | 'active' | 'past_due' | 'expired' | 'canceled' | 'none';
  rawStatus: string;
  plan: string;
  deviceLimit: number;
  trialEndsAt: string | null;
  periodEnd: string | null;
  graceUntil: string | null;
  coverageEnd: string | null;
  reason: string;
  issuedAt: string;
  expiresAt: string;
  sig: string;
}

export type VerifyFailure =
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'user_mismatch'
  | 'clock_rollback'
  | 'no_public_key';

export type VerifyResult =
  | { ok: true; token: EntitlementToken }
  | { ok: false; failure: VerifyFailure };

/**
 * 로컬 시계가 이만큼 뒤로 가는 건 NTP 보정으로 본다. 그 이상 뒤로 가면
 * 조작으로 간주. 5분은 넉넉하면서도 "만료를 며칠 되돌리는" 공격에는 무의미한 폭.
 */
export const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;

/** Edge Function 의 canonicalize 와 바이트 단위로 같아야 한다. 순서를 바꾸지 말 것. */
function canonicalize(c: EntitlementToken): string {
  return [
    'rdent.v1',
    String(c.v),
    c.userId,
    c.entitled ? 'true' : 'false',
    c.status,
    c.rawStatus,
    c.plan,
    String(c.deviceLimit),
    c.trialEndsAt ?? '',
    c.periodEnd ?? '',
    c.graceUntil ?? '',
    c.coverageEnd ?? '',
    c.reason,
    c.issuedAt,
    c.expiresAt
  ].join('\n');
}

function isIsoOrNull(v: unknown): boolean {
  if (v === null) return true;
  return typeof v === 'string' && Number.isFinite(Date.parse(v));
}

/** 구조 검사. 서명 검증 전에 형태부터 좁혀야 canonicalize 가 의미를 갖는다. */
export function isTokenShape(value: unknown): value is EntitlementToken {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  return (
    t.v === 1 &&
    typeof t.userId === 'string' &&
    t.userId.length > 0 &&
    typeof t.entitled === 'boolean' &&
    typeof t.status === 'string' &&
    typeof t.rawStatus === 'string' &&
    typeof t.plan === 'string' &&
    typeof t.deviceLimit === 'number' &&
    Number.isInteger(t.deviceLimit) &&
    isIsoOrNull(t.trialEndsAt ?? null) &&
    isIsoOrNull(t.periodEnd ?? null) &&
    isIsoOrNull(t.graceUntil ?? null) &&
    isIsoOrNull(t.coverageEnd ?? null) &&
    typeof t.reason === 'string' &&
    typeof t.issuedAt === 'string' &&
    Number.isFinite(Date.parse(t.issuedAt)) &&
    typeof t.expiresAt === 'string' &&
    Number.isFinite(Date.parse(t.expiresAt)) &&
    typeof t.sig === 'string' &&
    t.sig.length > 0
  );
}

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * 서명 검증.
 *
 * 공개키는 SPKI DER 의 base64. 앱 번들에 들어가도 안전한 유일한 절반이다 --
 * 이걸로는 검증만 되고 발급은 안 된다. (HMAC 이었다면 이 자리에 발급 능력이
 * 통째로 들어가서 게이트가 장식이 된다.)
 */
export function verifySignature(token: EntitlementToken, publicKeyB64: string): boolean {
  if (!publicKeyB64) return false;
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyB64, 'base64'),
      format: 'der',
      type: 'spki'
    });
    return cryptoVerify(
      'sha256',
      Buffer.from(canonicalize(token), 'utf8'),
      { key, dsaEncoding: 'ieee-p1363' },
      b64urlToBuffer(token.sig)
    );
  } catch {
    // 공개키 파싱 실패, 서명 길이 이상 등 -- 전부 검증 실패로 환원한다.
    return false;
  }
}

void createVerify;

export interface VerifyOptions {
  publicKeyB64: string;
  /** 지금 시각(ms). 테스트에서 주입 가능. */
  nowMs: number;
  /** 이 토큰이 이 사용자 것인지. 로그아웃 상태면 null 을 주고 검사를 건너뛴다. */
  expectedUserId?: string | null;
  /** 지금까지 관측한 가장 늦은 서버 시각(ms). 시계 되돌리기 방어. */
  lastServerTimeMs?: number | null;
}

/**
 * 캐시에서 읽은 토큰을 신뢰할 수 있는지.
 *
 * 캐시 파일(electron-store 의 JSON)은 사용자가 편집할 수 있다. 그러므로
 * "읽을 때마다" 서명과 만료를 다시 본다. 한 번 검증하고 메모리에 신뢰 상태로
 * 들고 있으면, 파일을 고친 뒤 앱을 재시작하는 것만으로 뚫린다.
 */
export function verifyToken(value: unknown, opts: VerifyOptions): VerifyResult {
  if (!opts.publicKeyB64) return { ok: false, failure: 'no_public_key' };
  if (!isTokenShape(value)) return { ok: false, failure: 'malformed' };
  const token = value;

  if (!verifySignature(token, opts.publicKeyB64)) {
    return { ok: false, failure: 'bad_signature' };
  }
  // 서명 검증 뒤에 시간을 본다. 순서가 반대면 위조 토큰의 만료 필드를 읽고
  // 판단하는 셈이 된다.
  if (opts.expectedUserId && token.userId !== opts.expectedUserId) {
    return { ok: false, failure: 'user_mismatch' };
  }
  if (
    typeof opts.lastServerTimeMs === 'number' &&
    opts.nowMs < opts.lastServerTimeMs - CLOCK_ROLLBACK_TOLERANCE_MS
  ) {
    return { ok: false, failure: 'clock_rollback' };
  }
  if (opts.nowMs >= Date.parse(token.expiresAt)) {
    return { ok: false, failure: 'expired' };
  }
  return { ok: true, token };
}

/** 체험/구독이 며칠 남았는지. 올림 -- "0일 남음"은 이미 끝난 것이므로. */
export function daysRemaining(coverageEnd: string | null, nowMs: number): number | null {
  if (!coverageEnd) return null;
  const end = Date.parse(coverageEnd);
  if (!Number.isFinite(end)) return null;
  const diff = end - nowMs;
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}
