#!/usr/bin/env node
// S2-1 / S2-2 검증 프로브 — 신뢰 기준점(공개키) 변조 + 시계 롤백 방어.
//
// 순수 프로브다. Supabase/도커/electron 불필요 — subscriptionToken.ts 의 순수
// 로직(resolveSecurityConfig, verifyToken)만 돌린다.
//
// 재현(reproduction-first):
//   S2-1: 수정 전 publicKey() 는 packaged 여부와 무관하게 process.env(→fallback)
//         를 읽었다. 공격자가 ~/.realtime-doctor.env 에 자기 공개키를 넣으면
//         self-signed 토큰이 검증을 통과했다. 아래 (a)-2 가 그걸 재현하며, 지금은
//         packaged 경로가 env 를 무시하므로 거부된다.
//   S2-2: 수정 전엔 평문 lastServerTimeMs 를 낮추면 롤백 검사가 무력화됐다.
//         아래 (b) 가 그걸 재현하며, 지금은 서명된 issuedAt 을 바닥값으로 함께
//         써서 낮춰도 통과하지 못한다.
//
// 실행: node scripts/probe-entitlement-tamper.mjs

import { generateKeyPairSync, sign as nodeSign } from 'node:crypto';
import { resolveSecurityConfig, verifyToken } from '../src/main/subscriptionToken.ts';

let failures = 0;
function check(label, cond, detail) {
  const mark = cond ? 'PASS' : 'FAIL';
  if (!cond) failures += 1;
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
}

// subscriptionToken.ts 의 canonicalize 와 바이트 단위로 같아야 한다.
function signToken(fields, privateKey) {
  const canonical = [
    'rdent.v1',
    String(fields.v),
    fields.userId,
    fields.entitled ? 'true' : 'false',
    fields.status,
    fields.rawStatus,
    fields.plan,
    String(fields.deviceLimit),
    fields.trialEndsAt ?? '',
    fields.periodEnd ?? '',
    fields.graceUntil ?? '',
    fields.coverageEnd ?? '',
    fields.reason,
    fields.issuedAt,
    fields.expiresAt
  ].join('\n');
  const sig = nodeSign('sha256', Buffer.from(canonical), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363'
  });
  return { ...fields, sig: sig.toString('base64url') };
}

const spkiB64 = (pub) => pub.export({ type: 'spki', format: 'der' }).toString('base64');

console.log('=== S2 probe: entitlement tamper ===\n');

const USER = 'user-under-test';
const REAL = generateKeyPairSync('ec', { namedCurve: 'P-256' }); // 서버(진짜) 키
const ATTACKER = generateKeyPairSync('ec', { namedCurve: 'P-256' }); // 공격자 키
const REAL_PUB = spkiB64(REAL.publicKey);
const ATTACKER_PUB = spkiB64(ATTACKER.publicKey);

const now = Date.now();
const baseFields = {
  v: 1,
  userId: USER,
  entitled: true,
  status: 'active',
  rawStatus: 'active',
  plan: 'standard',
  deviceLimit: 2,
  trialEndsAt: null,
  periodEnd: new Date(now + 30 * 864e5).toISOString(),
  graceUntil: null,
  coverageEnd: new Date(now + 30 * 864e5).toISOString(),
  reason: 'covered_by_current_period_end',
  issuedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 72 * 3600 * 1000).toISOString()
};

// 공격자가 자기 키로 서명한, entitled=true 위조 토큰.
const forged = signToken(baseFields, ATTACKER.privateKey);

// ── (a) S2-1: packaged 모드에서 env 공개키 스왑은 무시된다 ────────────────────
console.log('(a) S2-1: 신뢰 기준점(공개키) 변조 무력화');
{
  // (a)-1: packaged 는 baked(진짜) 공개키만. env 의 공격자 공개키는 무시.
  const cfg = resolveSecurityConfig({
    packaged: true,
    baked: { publicKey: REAL_PUB, entitlementUrl: undefined, supabaseUrl: 'https://real.supabase.co' },
    env: { publicKey: ATTACKER_PUB, entitlementUrl: 'https://evil.example/e', supabaseUrl: 'https://evil.example' },
    fallbackPublicKey: REAL_PUB
  });
  check('packaged: 공개키는 baked(진짜)만 사용', cfg.publicKey === REAL_PUB);
  check('packaged: env 의 공격자 공개키 무시', cfg.publicKey !== ATTACKER_PUB);
  check('packaged: entitlementUrl 은 baked SUPABASE_URL 에서 유도', cfg.entitlementUrl === 'https://real.supabase.co/functions/v1/entitlement');
  check('packaged: env 의 evil URL 무시', !String(cfg.entitlementUrl).includes('evil'));

  const v = verifyToken(forged, { publicKeyB64: cfg.publicKey, nowMs: now, expectedUserId: USER });
  check('packaged: 공격자 self-signed 토큰 거부 (bad_signature)', !v.ok && v.failure === 'bad_signature');

  // (a)-2: 재현 — dev 모드는 env 를 신뢰하므로 스왑이 먹힌다(수정 전 packaged 동작).
  const devCfg = resolveSecurityConfig({
    packaged: false,
    baked: {},
    env: { publicKey: ATTACKER_PUB },
    fallbackPublicKey: REAL_PUB
  });
  const devV = verifyToken(forged, { publicKeyB64: devCfg.publicKey, nowMs: now, expectedUserId: USER });
  check('(재현) dev 모드는 env 공개키를 신뢰해 위조가 통과', devCfg.publicKey === ATTACKER_PUB && devV.ok === true);

  // (a)-3: packaged 인데 baked 공개키가 없으면 fail-closed (fallback 도 안 씀).
  const emptyCfg = resolveSecurityConfig({
    packaged: true,
    baked: { publicKey: undefined },
    env: { publicKey: ATTACKER_PUB },
    fallbackPublicKey: REAL_PUB
  });
  check('packaged+baked없음: 공개키 빈 문자열 (fail-closed)', emptyCfg.publicKey === '');
  const realToken = signToken(baseFields, REAL.privateKey);
  const failClosed = verifyToken(realToken, { publicKeyB64: emptyCfg.publicKey, nowMs: now, expectedUserId: USER });
  check('packaged+baked없음: 진짜 토큰조차 no_public_key 로 잠김', !failClosed.ok && failClosed.failure === 'no_public_key');
}

// ── (b) S2-2: 시계 롤백 + lastServerTimeMs 낮추기 거부 ────────────────────────
console.log('\n(b) S2-2: 시계 롤백 방어');
{
  const realToken = signToken(baseFields, REAL.privateKey); // issuedAt = now
  const rolledBackNow = now - 3 * 864e5; // 로컬 시계를 3일 뒤로
  const loweredStore = 0; // 공격자가 평문 electron-store 에서 낮춤

  // subscription.ts 의 바닥값 계산을 그대로 재현: max(저장값, 서명된 issuedAt).
  const cachedIssuedMs = Date.parse(realToken.issuedAt);
  const floor = Math.max(loweredStore, Number.isFinite(cachedIssuedMs) ? cachedIssuedMs : 0);

  // 낮춘 저장값만 썼다면(수정 전) 통과했을 것을 먼저 보인다.
  const naive = verifyToken(realToken, {
    publicKeyB64: REAL_PUB,
    nowMs: rolledBackNow,
    expectedUserId: USER,
    lastServerTimeMs: loweredStore
  });
  check('(재현) 낮춘 lastServerTimeMs 만 쓰면 롤백이 통과', naive.ok === true);

  // 서명된 issuedAt 바닥값을 함께 쓰면 거부된다.
  const hardened = verifyToken(realToken, {
    publicKeyB64: REAL_PUB,
    nowMs: rolledBackNow,
    expectedUserId: USER,
    lastServerTimeMs: floor
  });
  check('issuedAt 바닥값과 함께면 롤백 거부 (clock_rollback)', !hardened.ok && hardened.failure === 'clock_rollback');

  // 공격자가 issuedAt 을 낮춰 바닥값을 무너뜨리려 하면 서명이 깨진다.
  const tampered = { ...realToken, issuedAt: new Date(rolledBackNow).toISOString() };
  const tamperedV = verifyToken(tampered, { publicKeyB64: REAL_PUB, nowMs: rolledBackNow, expectedUserId: USER });
  check('issuedAt 낮추기 시도는 서명 깨짐으로 거부 (bad_signature)', !tamperedV.ok && tamperedV.failure === 'bad_signature');
}

console.log(`\n=== entitlement-tamper 결과: ${failures === 0 ? '전부 PASS' : `${failures}건 FAIL`} ===`);
process.exit(failures === 0 ? 0 : 1);
