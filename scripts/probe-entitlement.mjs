#!/usr/bin/env node
// S2 검증 프로브 #1 — entitlement Edge Function (시나리오 1~4) + 토큰 위·변조 (5).
//
// 로컬 Supabase 스택(포트 553xx)에만 붙는다. 실제 프로젝트는 건드리지 않는다.
//
// 실행:
//   supabase start && supabase functions serve --env-file supabase/functions/.env
//   node scripts/probe-entitlement.mjs

import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign as nodeSign } from 'node:crypto';
import {
  verifyToken,
  daysRemaining
} from '../src/main/subscriptionToken.ts';

const API = 'http://127.0.0.1:55321';
const FN = `${API}/functions/v1/entitlement`;
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const PUB =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAElr+E32CHs/FVYKCWZPivFoULd57Q6HCL7XpNJh/4ovF1JYE12LlykVKmHfLewFdr/xAfxTQqtcoYldxkid4fAw==';

function sql(text) {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_realtime_doctor',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-tAc',
      text
    ],
    { encoding: 'utf8' }
  ).trim();
}

async function createUser(email) {
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password: 'probe-pass-123', email_confirm: true })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`createUser ${email}: ${JSON.stringify(body)}`);
  return body.id;
}

async function tokenFor(email) {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'probe-pass-123' })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`signIn ${email}: ${JSON.stringify(body)}`);
  return body.access_token;
}

async function callEntitlement(jwt) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: '{}'
  });
  return { status: res.status, body: await res.json() };
}

let failures = 0;
function check(label, cond, detail) {
  const mark = cond ? 'PASS' : 'FAIL';
  if (!cond) failures += 1;
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
}

const stamp = Date.now();
const users = {
  trialing: `probe-trialing-${stamp}@example.com`,
  lapsedTrial: `probe-lapsed-${stamp}@example.com`,
  noRow: `probe-norow-${stamp}@example.com`,
  activeLapsed: `probe-activelapsed-${stamp}@example.com`
};

console.log('=== S2 probe 1: entitlement Edge Function ===\n');

const ids = {};
for (const [k, email] of Object.entries(users)) ids[k] = await createUser(email);

// 가입 트리거가 만든 기본 행을 시나리오별로 조정한다.
sql(
  `update public.subscriptions set status='trialing', trial_ends_at = now() + interval '5 days' where user_id='${ids.trialing}'`
);
sql(
  `update public.subscriptions set status='trialing', trial_ends_at = now() - interval '1 day' where user_id='${ids.lapsedTrial}'`
);
// 시나리오 3: 행 자체를 지운다 (가입 트리거가 fail-open 으로 실패한 상황 재현).
sql(`delete from public.subscriptions where user_id='${ids.noRow}'`);
sql(
  `update public.subscriptions set status='active', trial_ends_at=null, current_period_start = now() - interval '40 days', current_period_end = now() - interval '10 days' where user_id='${ids.activeLapsed}'`
);

console.log('DB 상태:');
console.log(
  sql(
    `select user_id, status, trial_ends_at, current_period_end from public.subscriptions where user_id in ('${ids.trialing}','${ids.lapsedTrial}','${ids.noRow}','${ids.activeLapsed}')`
  ) || '(빈 결과)'
);
console.log(
  `no-row 유저 행 수: ${sql(`select count(*) from public.subscriptions where user_id='${ids.noRow}'`)}\n`
);

const results = {};
for (const [k, email] of Object.entries(users)) {
  const jwt = await tokenFor(email);
  results[k] = await callEntitlement(jwt);
}

// ── 시나리오 1 ─────────────────────────────────────────────────────────────
console.log('시나리오 1: 체험 중(trial_ends_at = +5일) → 자격 있음');
{
  const { status, body } = results.trialing;
  const tok = body.token;
  console.log('  응답:', JSON.stringify(tok));
  const v = verifyToken(tok, {
    publicKeyB64: PUB,
    nowMs: Date.now(),
    expectedUserId: ids.trialing
  });
  const days = tok ? daysRemaining(tok.coverageEnd, Date.now()) : null;
  check('HTTP 200', status === 200, `status=${status}`);
  check('entitled = true', tok?.entitled === true);
  check("status = 'trialing'", tok?.status === 'trialing');
  check('서명 검증 통과', v.ok, v.ok ? '' : v.failure);
  check('남은 일수 = 5', days === 5, `days=${days}`);
  check(
    '72시간 만료',
    tok && Math.round((Date.parse(tok.expiresAt) - Date.parse(tok.issuedAt)) / 3600000) === 72
  );
  check('billing_key 미노출', tok && !('billing_key' in tok) && !('portone_customer_id' in tok));
}

// ── 시나리오 2 ─────────────────────────────────────────────────────────────
console.log('\n시나리오 2: 체험 만료(trial_ends_at = -1일) → 자격 없음');
{
  const tok = results.lapsedTrial.body.token;
  console.log('  응답:', JSON.stringify(tok));
  check('entitled = false', tok?.entitled === false);
  check("실효 status = 'expired'", tok?.status === 'expired');
  check('사유 = lapsed_trial_ends_at', tok?.reason === 'lapsed_trial_ends_at');
  check('deviceLimit = 0', tok?.deviceLimit === 0);
}

// ── 시나리오 3 ─────────────────────────────────────────────────────────────
console.log('\n시나리오 3: subscriptions 행 없음 → 자격 없음 (fail-closed)');
{
  const tok = results.noRow.body.token;
  console.log('  응답:', JSON.stringify(tok));
  check('entitled = false', tok?.entitled === false);
  check("status = 'none'", tok?.status === 'none');
  check('사유 = no_subscription_row', tok?.reason === 'no_subscription_row');
}

// ── 시나리오 4 ─────────────────────────────────────────────────────────────
console.log("\n시나리오 4: status='active' 인데 current_period_end 가 과거 → 자격 없음");
{
  const tok = results.activeLapsed.body.token;
  console.log('  응답:', JSON.stringify(tok));
  check('entitled = false', tok?.entitled === false);
  check("실효 status = 'expired'", tok?.status === 'expired');
  check("rawStatus 는 'active' 로 보존", tok?.rawStatus === 'active');
  check('사유 = lapsed_current_period_end', tok?.reason === 'lapsed_current_period_end');
}

// ── 시나리오 5a: 클레임 위조 ────────────────────────────────────────────────
console.log('\n시나리오 5a: 유효 토큰의 필드를 고치면 거부되는가');
{
  const good = results.trialing.body.token;
  const now = Date.now();
  const base = { publicKeyB64: PUB, nowMs: now, expectedUserId: ids.trialing };

  const flipped = { ...results.lapsedTrial.body.token, entitled: true, status: 'active' };
  const r1 = verifyToken(flipped, { ...base, expectedUserId: ids.lapsedTrial });
  console.log('  entitled=false → true 로 변조:', JSON.stringify(r1));
  check('거부 (bad_signature)', !r1.ok && r1.failure === 'bad_signature');

  const pushed = {
    ...good,
    expiresAt: new Date(now + 365 * 24 * 3600 * 1000).toISOString()
  };
  const r2 = verifyToken(pushed, base);
  console.log('  expiresAt 을 1년 뒤로 밀기:', JSON.stringify(r2));
  check('거부 (bad_signature)', !r2.ok && r2.failure === 'bad_signature');

  const other = { ...good, userId: ids.noRow };
  const r3 = verifyToken(other, { ...base, expectedUserId: ids.noRow });
  console.log('  userId 바꿔치기:', JSON.stringify(r3));
  check('거부 (bad_signature)', !r3.ok && r3.failure === 'bad_signature');

  const r4 = verifyToken(good, { ...base, expectedUserId: ids.activeLapsed });
  console.log('  남의 토큰을 내 계정에서 쓰기:', JSON.stringify(r4));
  check('거부 (user_mismatch)', !r4.ok && r4.failure === 'user_mismatch');
}

// ── 시나리오 5b: 다른 키로 서명한 토큰 ──────────────────────────────────────
console.log('\n시나리오 5b: 공격자가 자기 키로 서명한 토큰');
{
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const forged = {
    v: 1,
    userId: ids.lapsedTrial,
    entitled: true,
    status: 'active',
    rawStatus: 'active',
    plan: 'standard',
    deviceLimit: 99,
    trialEndsAt: null,
    periodEnd: new Date(Date.now() + 3.15e10).toISOString(),
    graceUntil: null,
    coverageEnd: new Date(Date.now() + 3.15e10).toISOString(),
    reason: 'covered_by_current_period_end',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString()
  };
  const canonical = [
    'rdent.v1',
    '1',
    forged.userId,
    'true',
    forged.status,
    forged.rawStatus,
    forged.plan,
    String(forged.deviceLimit),
    '',
    forged.periodEnd,
    '',
    forged.coverageEnd,
    forged.reason,
    forged.issuedAt,
    forged.expiresAt
  ].join('\n');
  const sig = nodeSign('sha256', Buffer.from(canonical), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363'
  });
  forged.sig = sig.toString('base64url');

  // 자기 키로는 당연히 검증된다 — 서명 자체는 정상이라는 증거.
  const selfPub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const withAttackerKey = verifyToken(forged, {
    publicKeyB64: selfPub,
    nowMs: Date.now(),
    expectedUserId: forged.userId
  });
  console.log('  (참고) 공격자 공개키로 검증:', JSON.stringify(withAttackerKey.ok));
  const withAppKey = verifyToken(forged, {
    publicKeyB64: PUB,
    nowMs: Date.now(),
    expectedUserId: forged.userId
  });
  console.log('  앱에 박힌 공개키로 검증:', JSON.stringify(withAppKey));
  check('공격자 서명은 그 자체로는 유효', withAttackerKey.ok === true);
  check('앱은 거부 (bad_signature)', !withAppKey.ok && withAppKey.failure === 'bad_signature');
}

// ── 시나리오 5c: 만료 / 시계 되돌리기 ───────────────────────────────────────
console.log('\n시나리오 5c: 만료 토큰과 시계 되돌리기');
{
  const good = results.trialing.body.token;
  const past = Date.parse(good.expiresAt) + 1000;
  const r1 = verifyToken(good, {
    publicKeyB64: PUB,
    nowMs: past,
    expectedUserId: ids.trialing
  });
  console.log('  만료 1초 후:', JSON.stringify(r1));
  check('거부 (expired)', !r1.ok && r1.failure === 'expired');

  const r2 = verifyToken(good, {
    publicKeyB64: PUB,
    nowMs: Date.now() - 3 * 24 * 3600 * 1000, // 로컬 시계를 3일 뒤로
    expectedUserId: ids.trialing,
    lastServerTimeMs: Date.parse(good.issuedAt)
  });
  console.log('  로컬 시계를 3일 뒤로:', JSON.stringify(r2));
  check('거부 (clock_rollback)', !r2.ok && r2.failure === 'clock_rollback');
}

// 뒷정리 — 프로브가 만든 계정을 남기지 않는다.
for (const id of Object.values(ids)) {
  await fetch(`${API}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }
  });
}

console.log(`\n=== probe 1 결과: ${failures === 0 ? '전부 PASS' : `${failures}건 FAIL`} ===`);
process.exit(failures === 0 ? 0 : 1);
