#!/usr/bin/env node
// S2 검증 프로브 #2 드라이버 — 시나리오 5(캐시 위조) / 6(오프라인 유예) / 7(게이트).
//
// 로컬 스택에 테스트 계정을 만들고, entitlement 캐시 파일을 페이즈별로 심은 뒤
// Electron 을 띄워 실제 IPC 핸들러를 직접 호출한다.
//
// [중요] electron.vite.config.ts 가 SUPABASE_URL / ENTITLEMENT_URL 을 빌드타임에
// 번들로 인라인한다. 따라서 실행 시 환경변수를 바꿔도 소용이 없다. 이 프로브는
// 반드시 로컬 스택 + 죽은 entitlement 주소로 빌드된 번들을 대상으로 돌려야 한다:
//
//   SUPABASE_URL=http://127.0.0.1:55321 \
//   SUPABASE_PUBLISHABLE_KEY=<로컬 anon> \
//   ENTITLEMENT_URL=http://127.0.0.1:1/functions/v1/entitlement \
//   npm run build && node scripts/probe-gate-driver.mjs
//
// 끝나면 평소 설정으로 `npm run build` 를 다시 돌려 번들을 원복할 것.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sign as nodeSign, createPrivateKey } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const API = 'http://127.0.0.1:55321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const PASSWORD = 'probe-pass-123';
/** 죽은 주소. 서버 장애/오프라인을 재현한다. */
const DEAD_URL = 'http://127.0.0.1:1/functions/v1/entitlement';

// 개발용 개인키. 프로브가 "서버가 예전에 발급했던" 토큰을 재현하기 위해서만
// 쓴다. 앱 코드에는 어디에도 들어가지 않는다.
const PRIV = readFileSync(join(root, 'supabase/functions/.env'), 'utf8')
  .split('\n')
  .find((l) => l.startsWith('ENTITLEMENT_PRIVATE_KEY='))
  .slice('ENTITLEMENT_PRIVATE_KEY='.length)
  .trim();

function sql(text) {
  return execFileSync(
    'docker',
    ['exec', '-i', 'supabase_db_realtime_doctor', 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', text],
    { encoding: 'utf8' }
  ).trim();
}

async function createUser(email) {
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(body));
  return body.id;
}

/** Edge Function 과 동일한 canonical 문자열 + ECDSA P-256 서명. */
function mintToken(claims) {
  const canonical = [
    'rdent.v1',
    '1',
    claims.userId,
    claims.entitled ? 'true' : 'false',
    claims.status,
    claims.rawStatus,
    claims.plan,
    String(claims.deviceLimit),
    claims.trialEndsAt ?? '',
    claims.periodEnd ?? '',
    claims.graceUntil ?? '',
    claims.coverageEnd ?? '',
    claims.reason,
    claims.issuedAt,
    claims.expiresAt
  ].join('\n');
  const key = createPrivateKey({
    key: Buffer.from(PRIV, 'base64'),
    format: 'der',
    type: 'pkcs8'
  });
  const sig = nodeSign('sha256', Buffer.from(canonical), { key, dsaEncoding: 'ieee-p1363' });
  return { ...claims, v: 1, sig: sig.toString('base64url') };
}

function claimsFor(userId, { issuedOffsetMs, entitled = true }) {
  const issued = Date.now() + issuedOffsetMs;
  return {
    v: 1,
    userId,
    entitled,
    status: entitled ? 'trialing' : 'expired',
    rawStatus: 'trialing',
    plan: 'standard',
    deviceLimit: entitled ? 2 : 0,
    trialEndsAt: new Date(Date.now() + 5 * 864e5).toISOString(),
    periodEnd: null,
    graceUntil: null,
    coverageEnd: new Date(Date.now() + 5 * 864e5).toISOString(),
    reason: entitled ? 'covered_by_trial_ends_at' : 'lapsed_trial_ends_at',
    issuedAt: new Date(issued).toISOString(),
    expiresAt: new Date(issued + 72 * 3600 * 1000).toISOString()
  };
}

function runPhase(name, { token, lastServerTimeMs, email, entitlementUrl }) {
  const userData = mkdtempSync(join(tmpdir(), 'rd-probe-'));
  const seed = JSON.stringify({
    bounds: {},
    opacity: {},
    cloudSync: { enabled: false, saveTranscripts: false, saveAudio: false },
    language: 'ko',
    firstLaunched: true,
    entitlement: { token, lastServerTimeMs }
  });
  writeFileSync(join(userData, 'realtime-doctor.json'), seed, 'utf8');
  const res = spawnSync(
    join(root, 'node_modules/.bin/electron'),
    [join(here, 'probe-gate.mjs'), `--user-data-dir=${userData}`],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 90_000,
      env: {
        ...process.env,
        PROBE_PHASE: name,
        PROBE_USER_DATA: userData,
        PROBE_EMAIL: email,
        PROBE_PASSWORD: PASSWORD,
        PROBE_SEED_STORE: seed,
        SUPABASE_URL: API,
        SUPABASE_PUBLISHABLE_KEY: ANON,
        ENTITLEMENT_URL: entitlementUrl,
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
      }
    }
  );
  const lines = (res.stdout ?? '')
    .split('\n')
    .filter((l) => l.startsWith('[probe]'))
    .map((l) => l.slice('[probe] '.length));
  if (lines.length === 0) {
    console.log(res.stdout);
    console.log(res.stderr);
  }
  return lines;
}

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures += 1;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

function stateOf(lines) {
  const l = lines.find((x) => x.startsWith('subscription:get ='));
  return l ? JSON.parse(l.slice('subscription:get = '.length)) : null;
}
function resultOf(lines, prefix, channel) {
  const l = lines.find((x) => x.startsWith(`${prefix} ${channel} ->`));
  return l ? JSON.parse(l.slice(`${prefix} ${channel} -> `.length)) : null;
}

const stamp = Date.now();
const email = `probe-gate-${stamp}@example.com`;
const userId = await createUser(email);
sql(
  `update public.subscriptions set status='trialing', trial_ends_at = now() + interval '5 days' where user_id='${userId}'`
);

console.log('=== S2 probe 2: 오프라인 유예 + IPC 게이트 ===');
console.log(`테스트 계정 ${email} (${userId})\n`);

// ── 시나리오 6a ────────────────────────────────────────────────────────────
console.log('시나리오 6a: 네트워크 장애 + 유효한 캐시 토큰 → 계속 사용 가능');
{
  const token = mintToken(claimsFor(userId, { issuedOffsetMs: -2 * 3600 * 1000 }));
  const lines = runPhase('offline-valid', {
    token,
    lastServerTimeMs: Date.parse(token.issuedAt),
    email,
    entitlementUrl: DEAD_URL
  });
  lines.forEach((l) => console.log('   ', l));
  const s = stateOf(lines);
  check('entitled = true', s?.entitled === true);
  check("source = 'cache'", s?.source === 'cache');
  check('offline = true (네트워크 실패로 분류)', s?.offline === true);
  check('남은 일수 = 5', s?.daysRemaining === 5, `days=${s?.daysRemaining}`);
  const mint = resultOf(lines, 'GATED', 'stream:mint');
  check(
    'stream:mint 이 구독 사유로 막히지 않음',
    mint && !(mint.error ?? '').includes('구독'),
    JSON.stringify(mint)
  );
  const analysis = resultOf(lines, 'GATED', 'analysis:request');
  check('analysis:request 허용', analysis?.value?.ok === true, JSON.stringify(analysis));
}

// ── 시나리오 6b + 7 ────────────────────────────────────────────────────────
console.log('\n시나리오 6b: 네트워크 장애 + 만료된 캐시 토큰 → 잠금');
console.log('시나리오 7 : 잠긴 상태에서 IPC 직접 호출');
{
  // 4일 전에 발급된 토큰 = 72시간을 넘겼다.
  const token = mintToken(claimsFor(userId, { issuedOffsetMs: -4 * 864e5 }));
  const lines = runPhase('offline-expired', {
    token,
    lastServerTimeMs: Date.parse(token.issuedAt),
    email,
    entitlementUrl: DEAD_URL
  });
  lines.forEach((l) => console.log('   ', l));
  const s = stateOf(lines);
  check('entitled = false', s?.entitled === false);
  check("사유 = 'expired'", s?.reason === 'expired', `reason=${s?.reason}`);

  for (const ch of ['stream:mint', 'clova-stream:open']) {
    const r = resultOf(lines, 'GATED', ch);
    check(`${ch} 거부`, r && r.ok === false && /구독|인터넷/.test(r.error), JSON.stringify(r));
  }
  const analysis = resultOf(lines, 'GATED', 'analysis:request');
  check('analysis:request 거부', analysis?.value?.ok === false, JSON.stringify(analysis));
  for (const ch of ['summary:request', 'dictation:request']) {
    const r = resultOf(lines, 'GATED', ch);
    check(`${ch} 거부`, r?.value?.state === 'error', JSON.stringify(r));
  }
  const sel = resultOf(lines, 'GATED', 'patients:select');
  check('patients:select 거부(null)', sel?.ok === true && sel.value === null, JSON.stringify(sel));

  // 잠겨도 열려 있어야 하는 것들 — 의료 기록 열람.
  for (const ch of [
    'sessions:list-mine',
    'sessions:load',
    'patients:list-waiting',
    'patients:load-detail',
    'localSave:get',
    'subscription:get'
  ]) {
    const r = resultOf(lines, 'OPEN', ch);
    check(`${ch} 는 잠금과 무관하게 응답`, r?.ok === true, JSON.stringify(r));
  }
}

// ── 시나리오 5(앱 경로): 캐시 파일 위조 ────────────────────────────────────
console.log('\n시나리오 5(앱 경로): 캐시 파일을 손으로 고치면 앱이 거부하는가');
{
  const valid = mintToken(claimsFor(userId, { issuedOffsetMs: -2 * 3600 * 1000, entitled: false }));
  // 서명은 그대로 두고 entitled 와 expiresAt 만 유리하게 고친다.
  const tampered = {
    ...valid,
    entitled: true,
    status: 'active',
    expiresAt: new Date(Date.now() + 365 * 864e5).toISOString()
  };
  const lines = runPhase('tampered-cache', {
    token: tampered,
    lastServerTimeMs: Date.parse(valid.issuedAt),
    email,
    entitlementUrl: DEAD_URL
  });
  lines.forEach((l) => console.log('   ', l));
  const s = stateOf(lines);
  check('entitled = false', s?.entitled === false);
  check("사유 = 'bad_signature'", s?.reason === 'bad_signature', `reason=${s?.reason}`);
  const mint = resultOf(lines, 'GATED', 'stream:mint');
  check('stream:mint 거부', mint?.ok === false, JSON.stringify(mint));
}

await fetch(`${API}/auth/v1/admin/users/${userId}`, {
  method: 'DELETE',
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }
});

console.log(`\n=== probe 2 결과: ${failures === 0 ? '전부 PASS' : `${failures}건 FAIL`} ===`);
process.exit(failures === 0 ? 0 : 1);
