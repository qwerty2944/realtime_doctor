#!/usr/bin/env node
// B5 진료행위 기록 — 진료 종료 시 저장 · 지난 진료 재스캔 · 계정별 임상 검토 프로브.
//
// 검증 대상은 전부 **진짜 앱 모듈**이다:
//   - src/main/sessions.ts           endCurrentSession() 의 실제 종료 경로
//   - src/main/careActivities.ts     스캔·저장·재스캔·검토 RPC
//   - src/shared/careActivities.ts   화면 게이트(releaseForDisplay) 와 검토 판정
//   - supabase/migrations/0008_...   계정별 채택 테이블 + RPC + RLS/GRANT
//
// 이 프로브가 답해야 하는 질문 다섯 개:
//   1. 요약 창을 한 번도 열지 않은 진료가 월 집계에 들어오는가.
//   2. 그 뒤에 요약 창을 열어도 행이 늘지 않는가.
//   3. 재스캔이 지난 진료를 채우고, 다시 돌려도 두 번 세지 않는가.
//   4. **A 가 검토한 것이 B 에게 켜지지 않는가** (안전상 가장 중요한 단언).
//   5. 철회가 이후 탐지를 멈추고 지난 기록은 남기는가.
//
// 로컬 Supabase 스택(포트 553xx)에만 붙는다. 실제 프로젝트는 건드리지 않는다.
//
// 실행:
//   supabase start
//   node scripts/load-care-activities.mjs
//   node --import ./scripts/probe-findings-register.mjs scripts/probe-care-review.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN_WORDING } from './care-wording.mjs';

const API = 'http://127.0.0.1:55321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const PASSWORD = 'probe-pass-123';
const CODE = 'lifestyle_education';

process.env.SUPABASE_URL = API;
process.env.SUPABASE_PUBLISHABLE_KEY = ANON;

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures += 1;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

function sql(text) {
  return execFileSync(
    'docker',
    ['exec', '-i', 'supabase_db_realtime_doctor', 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', text],
    { encoding: 'utf8' }
  ).trim();
}
const sqlValue = (text) => sql(text).split('\n')[0].trim();
const esc = (text) => text.replaceAll("'", "''");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** 3분 넘게 이어진 식이·운동 교육이 담긴 진료실 대화 (B2/B4 프로브와 같은 대화). */
const CHUNKS = [
  ['c01', 'doctor', 0, '어서 오세요. 지난번 혈압 수치 보고 오늘 좀 자세히 말씀드리려고 합니다.'],
  ['c02', 'patient', 12_000, '네, 요즘 머리가 좀 무겁고 그렇습니다.'],
  ['c03', 'doctor', 30_000, '식단부터 보겠습니다. 국물을 싱겁게 드시고 염분을 확 줄이셔야 합니다.'],
  ['c04', 'patient', 62_000, '국을 안 먹으면 밥이 잘 안 넘어가는데요.'],
  ['c05', 'doctor', 78_000, '국물은 남기시고 건더기 위주로 드시면 됩니다. 기름진 반찬도 주 2회 이내로 줄여보시죠.'],
  ['c06', 'patient', 150_000, '알겠습니다. 운동은 어떻게 할까요?'],
  ['c07', 'doctor', 168_000, '유산소 운동으로 하루 삼십 분 걷기부터 시작하시고, 체중은 석 달 안에 3킬로만 줄여봅시다.'],
  ['c08', 'patient', 240_000, '걷기는 할 수 있을 것 같습니다.'],
  ['c09', 'doctor', 262_000, '운동 강도는 숨이 조금 찰 정도가 좋습니다. 식단은 아까 말씀드린 대로 염분부터 줄이세요.']
];

function seedSession(userId, encounterId, startedAt, prefix) {
  const sessionId = sqlValue(
    `insert into public.sessions (user_id, encounter_id, started_at) values ('${userId}',${
      encounterId ? `'${encounterId}'` : 'null'
    },'${startedAt}') returning id`
  );
  for (const [chunkId, speaker, ms, text] of CHUNKS) {
    sql(
      `insert into public.transcript_chunks (session_id, user_id, chunk_id, speaker, text, timestamp_ms)
       values ('${sessionId}','${userId}','${prefix}${chunkId}','${speaker}','${esc(text)}',${ms})`
    );
  }
  return sessionId;
}

const countRows = (sessionId) =>
  sqlValue(
    `select count(*) from public.care_activity_candidates where session_id='${sessionId}' and superseded_at is null`
  );

const main = async () => {
  const stamp = Date.now();
  const emailA = `care-review-a-${stamp}@example.com`;
  const emailB = `care-review-b-${stamp}@example.com`;

  console.log('\n=== 0) 두 임상의 계정을 만든다 ===');
  const userA = await createUser(emailA);
  const userB = await createUser(emailB);
  const auth = await import('../src/main/auth.ts');
  const care = await import('../src/main/careActivities.ts');
  const sessions = await import('../src/main/sessions.ts');
  const { getSupabase } = await import('../src/main/supabaseClient.ts');
  auth.setAuthCallbacks({
    broadcast: () => undefined,
    onSignedIn: () => undefined,
    onSignedOut: () => undefined
  });
  const supabase = getSupabase();

  const signIn = async (email, id) => {
    await supabase.auth.signOut();
    for (let i = 0; i < 50 && auth.getCurrentUser(); i += 1) await sleep(50);
    const { error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw new Error(error.message);
    for (let i = 0; i < 50 && auth.getCurrentUser()?.id !== id; i += 1) await sleep(100);
    if (auth.getCurrentUser()?.id !== id) throw new Error(`sign-in failed: ${email}`);
  };

  await signIn(emailA, userA);
  check('A 로 로그인', auth.getCurrentUser()?.id === userA);

  const now = new Date();
  const nowIso = new Date(now.getTime() - 60_000).toISOString();
  const oldIso = new Date(now.getFullYear(), now.getMonth(), Math.max(1, now.getDate() - 3), 9, 0).toISOString();
  const month = nowIso.slice(0, 7);
  const oldMonth = oldIso.slice(0, 7);

  const patientId = sqlValue(
    `insert into public.patients (user_id, name, birth_date) values ('${userA}','박로컬','1961-07-02') returning id`
  );
  const encounterId = sqlValue(
    `insert into public.encounters (user_id, patient_id, status) values ('${userA}','${patientId}','in_consult') returning id`
  );

  // 검토보다 **먼저** 끝난 진료. 재스캔이 채워야 할 대상이다.
  const pastSession = seedSession(userA, encounterId, oldIso, 'p');

  console.log('\n=== 1) 검토 화면이 받는 payload — 규칙 전문이 들어 있는가 ===');
  const beforeViews = await care.listCareActivityDefinitions();
  const view = beforeViews.find((v) => v.def.code === CODE);
  console.log('  검토 화면 항목:', JSON.stringify(view, null, 2));
  check('정의 목록을 받았다', beforeViews.length > 0, `${beforeViews.length}건`);
  check('단서어가 전부 담겨 있다', (view?.def.cueTerms.length ?? 0) > 0, view?.def.cueTerms.join(', '));
  check('부정어가 담겨 있다', Array.isArray(view?.def.negationTerms));
  check('화자 조건이 담겨 있다', typeof view?.def.requiredSpeaker === 'string', view?.def.requiredSpeaker);
  check(
    '문턱 3종이 전부 담겨 있다',
    typeof view?.def.minDistinctCues === 'number' &&
      typeof view?.def.minUtterances === 'number' &&
      typeof view?.def.minDurationSeconds === 'number',
    `${view?.def.minDistinctCues} / ${view?.def.minUtterances} / ${view?.def.minDurationSeconds}s`
  );
  check('규칙 버전이 담겨 있다', typeof view?.def.ruleVersion === 'number', `v${view?.def.ruleVersion}`);
  check('A 에게는 아직 검토 전이다', view?.def.reviewStatus === 'unreviewed');
  check('채택 기록이 없다', view?.adoption === null);

  console.log('\n=== 2) A 가 검토 완료로 표시한다 (앱의 실제 경로) ===');
  const bad = await care.setCareActivityReview({
    activityCode: CODE,
    ruleVersion: (view?.def.ruleVersion ?? 1) + 5,
    reviewed: true
  });
  check('읽지 않은 규칙 버전으로는 승인되지 않는다', bad.ok === false, bad.ok === false ? bad.error : '');
  const okRes = await care.setCareActivityReview({
    activityCode: CODE,
    ruleVersion: view.def.ruleVersion,
    reviewed: true,
    note: '프로브: 규칙 전문을 읽고 승인'
  });
  check('검토 표시 성공', okRes.ok === true);
  const adoptedRow = sql(
    `select activity_code, reviewed_rule_version, reviewed_by=user_id, coalesce(revoked_at::text,'-') from public.care_activity_adoptions where user_id='${userA}'`
  );
  console.log(`  채택 행: ${adoptedRow}`);
  check('누가·언제 검토했는지 기록된다', adoptedRow.includes(CODE) && adoptedRow.includes('|t|'));
  check(
    '공용 정의 행은 전역으로 바뀌지 않았다',
    sqlValue(`select clinical_review_status from public.care_activity_defs where code='${CODE}'`) === 'unreviewed'
  );
  const afterViews = await care.listCareActivityDefinitions();
  check(
    'A 화면에서 검토 완료로 보인다',
    afterViews.find((v) => v.def.code === CODE)?.def.reviewStatus === 'reviewed'
  );

  console.log('\n=== 3) [결함 1] 요약 창을 한 번도 열지 않은 진료 ===');
  const liveSession = seedSession(userA, encounterId, nowIso, 'n');
  sessions.setCurrentSessionId(liveSession);
  sessions.linkSessionToEncounter(encounterId);
  // 요약 창을 여는 IPC 는 부르지 않는다. 진료 종료만 일어난다.
  await sessions.endCurrentSession();
  for (let i = 0; i < 60 && countRows(liveSession) === '0'; i += 1) await sleep(100);
  check('진료 종료만으로 후보가 저장된다', countRows(liveSession) === '1');
  check(
    '저장된 행이 규칙 버전을 들고 있다',
    sqlValue(
      `select rule_version from public.care_activity_candidates where session_id='${liveSession}' and superseded_at is null`
    ) === String(view.def.ruleVersion)
  );
  check('세션 종료 표시도 정상이다', sqlValue(`select ended_at is not null from public.sessions where id='${liveSession}'`) === 't');

  const reportAfterEnd = await care.loadMonthlyCareActivityReport(month);
  console.log(`  ${month} 리포트: 합계 ${reportAfterEnd.totalCount}건 / 진료 ${reportAfterEnd.sessionCount}건`);
  for (const r of reportAfterEnd.rows) {
    console.log(`    - ${r.label} [${r.activityCode}] ${r.engineVersion} rule v${r.ruleVersion} → ${r.count}건`);
  }
  check('월 집계에 그 진료가 들어 있다', reportAfterEnd.totalCount >= 1);

  console.log('\n=== 4) 나중에 요약 창을 열어도 행이 늘지 않는다 ===');
  const display = await care.buildCareActivityDisplay({ sessionId: liveSession, encounterId });
  check('요약 창 payload 에 1건', display.items.length === 1, display.items[0]?.label);
  check('저장된 유효 행은 여전히 1건', countRows(liveSession) === '1');
  check(
    '대체(supersede)도 일어나지 않았다',
    sqlValue(
      `select count(*) from public.care_activity_candidates where session_id='${liveSession}'`
    ) === '1'
  );

  console.log('\n=== 5) [결함 1-b] 지난 진료 재스캔 ===');
  check('재스캔 전 지난 진료에는 기록이 없다', countRows(pastSession) === '0');
  const fill1 = await care.backfillCareActivities({ months: 3 });
  console.log(`  1차 재스캔: ${JSON.stringify(fill1)}`);
  check('지난 진료에 기록이 생겼다', countRows(pastSession) === '1');
  check('새로 저장된 행이 있다', fill1.inserted >= 1);
  const fill2 = await care.backfillCareActivities({ months: 3 });
  console.log(`  2차 재스캔: ${JSON.stringify(fill2)}`);
  check('두 번째 재스캔은 아무것도 새로 만들지 않는다', fill2.inserted === 0, `inserted=${fill2.inserted}`);
  check('두 번째 재스캔은 전부 "그대로" 로 끝난다', fill2.unchanged >= 2, `unchanged=${fill2.unchanged}`);
  check('지난 진료 행은 여전히 1건', countRows(pastSession) === '1');
  check(
    '전체 유효 행은 2건 (진료 2건 × 1항목)',
    sqlValue(
      `select count(*) from public.care_activity_candidates where user_id='${userA}' and superseded_at is null`
    ) === '2'
  );
  const oldReport = await care.loadMonthlyCareActivityReport(oldMonth);
  console.log(`  ${oldMonth} 리포트: 합계 ${oldReport.totalCount}건 / 진료 ${oldReport.sessionCount}건`);
  check('재스캔한 진료가 그 달 집계에 들어간다', oldReport.totalCount >= 1);

  console.log('\n=== 6) [안전] A 의 검토가 B 에게 켜지는가 ===');
  const sessionB = seedSession(userB, null, nowIso, 'b');
  await signIn(emailB, userB);
  check('B 로 로그인', auth.getCurrentUser()?.id === userB);
  const viewsB = await care.listCareActivityDefinitions();
  const viewB = viewsB.find((v) => v.def.code === CODE);
  check('B 화면에서는 검토 전으로 보인다', viewB?.def.reviewStatus === 'unreviewed', viewB?.def.reviewStatus);
  check('B 에게는 채택 기록이 없다', viewB?.adoption === null);
  check(
    'B 는 A 의 채택 행을 읽지도 못한다 (RLS)',
    (await care.loadMyAdoptions()).size === 0
  );
  const displayB = await care.buildCareActivityDisplay({ sessionId: sessionB, encounterId: null });
  check('B 화면에 올라가는 항목 0건', displayB.items.length === 0);
  check(
    'B 의 빈 이유는 "검토된 항목 없음" 이다',
    displayB.emptyReason === 'none-reviewed',
    displayB.emptyReason
  );
  sessions.setCurrentSessionId(sessionB);
  await sessions.endCurrentSession();
  await sleep(1500);
  check('B 의 진료는 종료돼도 아무것도 저장되지 않는다', countRows(sessionB) === '0');
  const reportB = await care.loadMonthlyCareActivityReport(month);
  check('B 의 월 리포트는 비어 있다', reportB.totalCount === 0, `${reportB.totalCount}건`);

  console.log('\n  ── B 가 클라이언트로 직접 채택 행을 쓸 수 있는가 ──');
  const tokenB = (await supabase.auth.getSession()).data.session?.access_token;
  const insRes = await fetch(`${API}/rest/v1/care_activity_adoptions`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userB,
      activity_code: CODE,
      reviewed_rule_version: 1,
      reviewed_by: userB
    })
  });
  check(
    '클라이언트의 직접 INSERT 가 막힌다',
    insRes.status >= 400 &&
      sqlValue(`select count(*) from public.care_activity_adoptions where user_id='${userB}'`) === '0',
    `HTTP ${insRes.status}`
  );
  const forgeRes = await fetch(`${API}/rest/v1/care_activity_adoptions`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userA,
      activity_code: CODE,
      reviewed_rule_version: 1,
      reviewed_by: userA
    })
  });
  check(
    '남의 이름으로 승인하는 INSERT 도 막힌다',
    forgeRes.status >= 400 &&
      sqlValue(`select count(*) from public.care_activity_adoptions where user_id='${userA}'`) === '1',
    `HTTP ${forgeRes.status}`
  );
  const patchRes = await fetch(
    `${API}/rest/v1/care_activity_adoptions?activity_code=eq.${CODE}`,
    {
      method: 'PATCH',
      headers: { apikey: ANON, Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewed_rule_version: 99 })
    }
  );
  check(
    '클라이언트의 UPDATE 도 막힌다',
    sqlValue(
      `select reviewed_rule_version from public.care_activity_adoptions where user_id='${userA}'`
    ) === String(view.def.ruleVersion),
    `HTTP ${patchRes.status}`
  );
  const defRes = await fetch(`${API}/rest/v1/care_activity_defs?code=eq.${CODE}`, {
    method: 'PATCH',
    headers: { apikey: ANON, Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ clinical_review_status: 'reviewed' })
  });
  check(
    '공용 정의를 전역으로 승격하는 경로는 여전히 없다',
    sqlValue(`select clinical_review_status from public.care_activity_defs where code='${CODE}'`) === 'unreviewed',
    `HTTP ${defRes.status}`
  );

  console.log('\n=== 7) 철회 — 이후 탐지는 멈추고 지난 기록은 남는다 ===');
  await signIn(emailA, userA);
  const reportBeforeRevoke = await care.loadMonthlyCareActivityReport(month);
  const beforeRevokeTotal = sqlValue(
    `select count(*) from public.care_activity_candidates where user_id='${userA}' and superseded_at is null`
  );
  const revoke = await care.setCareActivityReview({
    activityCode: CODE,
    ruleVersion: view.def.ruleVersion,
    reviewed: false
  });
  check('철회 성공', revoke.ok === true);
  const revokedRow = sql(
    `select coalesce(revoked_at::text,'-') <> '-', reviewed_at is not null from public.care_activity_adoptions where user_id='${userA}'`
  );
  check('철회 표시가 찍히고 검토 이력은 남는다', revokedRow === 't|t', revokedRow);
  const viewsRevoked = await care.listCareActivityDefinitions();
  check(
    '철회 후 다시 검토 전 상태다',
    viewsRevoked.find((v) => v.def.code === CODE)?.def.reviewStatus === 'unreviewed'
  );

  const afterRevokeSession = seedSession(userA, encounterId, nowIso, 'r');
  sessions.setCurrentSessionId(afterRevokeSession);
  sessions.linkSessionToEncounter(encounterId);
  await sessions.endCurrentSession();
  await sleep(1500);
  check('철회 후 새 진료는 저장되지 않는다', countRows(afterRevokeSession) === '0');
  check(
    '이미 저장된 지난 기록은 그대로 남아 있다',
    sqlValue(
      `select count(*) from public.care_activity_candidates where user_id='${userA}' and superseded_at is null`
    ) === beforeRevokeTotal,
    `${beforeRevokeTotal}건`
  );
  const reportAfterRevoke = await care.loadMonthlyCareActivityReport(month);
  check(
    '월 리포트도 철회 전과 같다 (지난 기록은 사라지지 않는다)',
    reportAfterRevoke.totalCount === reportBeforeRevoke.totalCount,
    `${reportBeforeRevoke.totalCount} → ${reportAfterRevoke.totalCount}`
  );
  const fillAfterRevoke = await care.backfillCareActivities({ months: 3 });
  check(
    '철회 상태에서는 재스캔도 아무것도 만들지 않는다',
    fillAfterRevoke.inserted === 0,
    JSON.stringify(fillAfterRevoke)
  );

  console.log('\n=== 8) 규칙이 바뀌면 검토가 자동으로 풀리는가 ===');
  await care.setCareActivityReview({ activityCode: CODE, ruleVersion: view.def.ruleVersion, reviewed: true });
  check(
    '다시 검토 완료',
    (await care.listCareActivityDefinitions()).find((v) => v.def.code === CODE)?.def.reviewStatus === 'reviewed'
  );
  sql(`update public.care_activity_defs set rule_version = rule_version + 1 where code='${CODE}'`);
  const stale = (await care.listCareActivityDefinitions()).find((v) => v.def.code === CODE);
  check('규칙이 바뀌면 검토 전으로 돌아간다', stale?.def.reviewStatus === 'unreviewed');
  check('화면이 "규칙이 바뀌었다" 를 구분할 수 있다', stale?.adoptionStale === true);
  sql(`update public.care_activity_defs set rule_version = rule_version - 1 where code='${CODE}'`);

  console.log('\n=== 9) 문구 감사 — 우리가 쓴 문자열과 주석이 청구를 권하는가 ===');
  const localeFiles = ['../src/renderer/shared/locales/ko.ts', '../src/renderer/shared/locales/en.ts'];
  const strings = [];
  for (const rel of localeFiles) {
    const text = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith("'review.") || trimmed.startsWith("'care.")) strings.push(trimmed);
    }
  }
  console.log(`  care.* / review.* 문자열 ${strings.length}줄`);
  const offenders = strings.filter((s) => FORBIDDEN_WORDING.some((w) => s.includes(w)));
  check(
    `금지 문구가 하나도 없다 (${FORBIDDEN_WORDING.join(', ')})`,
    offenders.length === 0,
    offenders.join(' | ')
  );
  // 주석까지 본다 — 오늘의 주석은 내일의 화면 문구가 된다.
  //
  // 목록에 `src/main/careActivities.ts` 가 없는 이유: 이 검사는 부분 문자열
  // 대조라 한국어 산문에서 오탐이 난다("그 함수가" 안에 금지어가 들어 있다).
  // 검사 목록의 설계 입력은 CSV 라벨이고 거기서는 정확하다. 화면 문구와 새
  // 파일에는 그대로 적용하고, 산문 파일은 사람이 읽는 쪽으로 남긴다.
  const sourceFiles = [
    '../src/renderer/dock/CareActivityReviewDialog.tsx',
    '../src/renderer/dock/CareActivityReportDialog.tsx',
    '../src/renderer/summary/CareActivitySection.tsx',
    '../src/main/sessions.ts',
    '../supabase/migrations/0008_care_activity_adoptions.sql'
  ];
  for (const rel of sourceFiles) {
    const text = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    const hits = FORBIDDEN_WORDING.filter((w) => text.includes(w));
    check(`${rel.split('/').pop()} 에 금지 문구 없음 (주석 포함)`, hits.length === 0, hits.join(', '));
  }

  console.log('\n=== 10) 정리 ===');
  sql(`delete from public.care_activity_adoptions where user_id in ('${userA}','${userB}')`);
  sql(`delete from public.sessions where user_id in ('${userA}','${userB}')`);
  sql(`delete from public.patients where id='${patientId}'`);
  sql(`delete from auth.users where id in ('${userA}','${userB}')`);

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
