#!/usr/bin/env node
// B3/B4 진료행위 기록 — 화면 payload · 저장 · 월 리포트 프로브.
//
// 검증 대상은 전부 **진짜 앱 모듈**이다:
//   - src/shared/careActivities.ts   탐지 엔진 / 화면 게이트 / 월 집계 / CSV
//   - src/main/careActivities.ts     실제 DB 조회 · RPC 저장 · 월 리포트
//   - supabase/migrations/0007_...   저장 테이블 + supersede RPC + RLS/GRANT
//
// 로컬 Supabase 스택(포트 553xx)에만 붙는다. 실제 프로젝트는 건드리지 않는다.
//
// 실행:
//   supabase start
//   node scripts/load-care-activities.mjs
//   node --import ./scripts/probe-findings-register.mjs scripts/probe-care-report.mjs

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

/** 3분 넘게 이어진 식이·운동 교육이 담긴 진료실 대화. B2 프로브와 같은 대화다. */
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

/** 문진 대화(키오스크). 타임스탬프가 없다. */
const INTAKE_TURNS = [
  { role: 'agent', text: '오늘 어떤 점이 불편하신가요?' },
  { role: 'patient', text: '혈압약을 먹고 있는데 머리가 무겁습니다.' },
  { role: 'agent', text: '식단이나 운동은 어떻게 하고 계신가요?' },
  { role: 'patient', text: '짜게 먹는 편이고 운동은 거의 못 합니다.' }
];

function seedSession(userId, encounterId, startedAt) {
  const sessionId = sqlValue(
    `insert into public.sessions (user_id, encounter_id, started_at) values ('${userId}','${encounterId}','${startedAt}') returning id`
  );
  for (const [chunkId, speaker, ms, text] of CHUNKS) {
    sql(
      `insert into public.transcript_chunks (session_id, user_id, chunk_id, speaker, text, timestamp_ms)
       values ('${sessionId}','${userId}','${chunkId}','${speaker}','${esc(text)}',${ms})`
    );
  }
  return sessionId;
}

function monthOf(iso) {
  return iso.slice(0, 7);
}

const main = async () => {
  const stamp = Date.now();
  const email = `care-report-${stamp}@example.com`;

  console.log('\n=== 0) 로그인 ===');
  const userId = await createUser(email);
  const auth = await import('../src/main/auth.ts');
  const care = await import('../src/main/careActivities.ts');
  const engine = await import('../src/shared/careActivities.ts');
  const { getSupabase } = await import('../src/main/supabaseClient.ts');
  auth.setAuthCallbacks({
    broadcast: () => undefined,
    onSignedIn: () => undefined,
    onSignedOut: () => undefined
  });
  const supabase = getSupabase();
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInErr) throw new Error(signInErr.message);
  for (let i = 0; i < 50 && !auth.getCurrentUser(); i += 1) await sleep(100);
  check('로그인 성공', auth.getCurrentUser()?.id === userId);

  console.log('\n=== 1) 두 달치 진료를 심는다 ===');
  // 지난달과 이번달. occurred_on 은 sessions.started_at 에서 나온다.
  const now = new Date();
  const thisMonthAt = new Date(now.getFullYear(), now.getMonth(), 10, 10, 30).toISOString();
  const lastMonthAt = new Date(now.getFullYear(), now.getMonth() - 1, 10, 10, 30).toISOString();
  const thisMonth = monthOf(thisMonthAt);
  const lastMonth = monthOf(lastMonthAt);

  const patientId = sqlValue(
    `insert into public.patients (user_id, name, birth_date) values ('${userId}','박로컬','1961-07-02') returning id`
  );
  const encounterId = sqlValue(
    `insert into public.encounters (user_id, patient_id, status) values ('${userId}','${patientId}','in_consult') returning id`
  );
  const intakeSoap = JSON.stringify({ s: { chief_complaint: '두중감' }, transcript: INTAKE_TURNS });
  sql(
    `insert into public.intake_results (encounter_id, soap_json, version) values ('${encounterId}','${esc(intakeSoap)}'::jsonb, 1)`
  );
  const lastMonthSession = seedSession(userId, encounterId, lastMonthAt);
  const thisMonthSession = seedSession(userId, encounterId, thisMonthAt);
  check('두 달치 세션을 심었다', lastMonthSession.length > 0 && thisMonthSession.length > 0, `${lastMonth} / ${thisMonth}`);

  console.log('\n=== 2) 임상 검토 전 — UI 가 받는 payload ===');
  const before = await care.buildCareActivityDisplay({
    sessionId: thisMonthSession,
    encounterId
  });
  console.log('  UI payload:', JSON.stringify(before, null, 2).split('\n').slice(0, 8).join('\n'));
  check('화면에 올라갈 항목 0건', before.items.length === 0);
  check(
    '빈 이유가 "검토된 항목 없음" 이다 (오류가 아니다)',
    before.emptyReason === 'none-reviewed',
    before.emptyReason
  );
  check(
    '미검토 상태에서는 아무것도 저장되지 않는다',
    sqlValue(`select count(*) from public.care_activity_candidates where user_id='${userId}'`) === '0'
  );

  console.log('\n=== 2b) 환자 모드(문진 대화만) — 정직한 빈 상태 ===');
  const intakeOnly = await care.buildCareActivityDisplay({ sessionId: null, encounterId });
  check('항목 0건', intakeOnly.items.length === 0);
  check(
    '이유가 "문진 대화에는 시각이 없다" 이다',
    intakeOnly.emptyReason === 'intake-no-timestamps',
    intakeOnly.emptyReason
  );
  check('출처가 문진으로 표시된다', intakeOnly.source === 'intake');

  console.log('\n=== 3) service_role 로 임상 검토 완료 표시 ===');
  sql(
    `update public.care_activity_defs set clinical_review_status='reviewed', reviewed_at=now(), review_note='프로브: 검토 완료 가정' where code='lifestyle_education'`
  );
  const view = await care.buildCareActivityDisplay({
    sessionId: thisMonthSession,
    encounterId
  });
  check('화면에 1건 나간다', view.items.length === 1, view.items[0]?.label);
  check('빈 이유가 없다', view.emptyReason === null);

  console.log('\n  ── UI 가 실제로 그리는 값 ──');
  for (const item of view.items) {
    console.log(`  ● ${item.label} — ${engine.formatTimeRange(item.timeRange)} (${item.timeRange.durationSeconds}초)`);
    console.log(`    ${item.description}`);
    console.log(`    provenance: ${item.provenance.engineVersion} / rule v${item.provenance.ruleVersion} / ${item.provenance.generatedAt}`);
    for (const q of item.quotes) {
      console.log(`    - [발화 ${q.utteranceId} @${q.timestampMs}ms] "${q.quote}"`);
      console.log(`      클릭 → window.api.focusUtterance('${q.utteranceId}') → 전사 창 포커스·강조`);
    }
  }
  check(
    '인용은 전부 원문 그대로다',
    view.items[0].quotes.every((q) => CHUNKS.find((c) => c[0] === q.utteranceId)?.[3] === q.quote)
  );
  check(
    '클릭 대상 발화 id 가 전사 창의 chunk_id 와 같다',
    view.items[0].quotes.every((q) => CHUNKS.some((c) => c[0] === q.utteranceId))
  );
  check(
    '확신 점수 필드가 없다',
    !JSON.stringify(view).includes('confidence') && !JSON.stringify(view).includes('score')
  );

  console.log('\n=== 4) 저장 — 화면에 올린 것만, RPC 로만 ===');
  check(
    '이번 달 진료 1건이 저장됐다',
    sqlValue(`select count(*) from public.care_activity_candidates where session_id='${thisMonthSession}'`) === '1'
  );
  const storedRule = sqlValue(
    `select rule_version from public.care_activity_candidates where session_id='${thisMonthSession}' and superseded_at is null`
  );
  check('저장된 행이 규칙 버전을 들고 있다', storedRule === '1', `rule_version=${storedRule}`);
  check(
    'occurred_on 이 진료 날짜를 따른다 (스캔 날짜가 아니다)',
    sqlValue(
      `select to_char(occurred_on,'YYYY-MM') from public.care_activity_candidates where session_id='${thisMonthSession}' and superseded_at is null`
    ) === thisMonth
  );

  // 같은 스캔을 다시 돌려도 건수가 늘지 않아야 한다 (요약 창을 여러 번 여는 흐름).
  await care.buildCareActivityDisplay({ sessionId: thisMonthSession, encounterId });
  await care.buildCareActivityDisplay({ sessionId: thisMonthSession, encounterId });
  check(
    '같은 결과를 다시 스캔해도 행이 늘지 않는다 (멱등)',
    sqlValue(`select count(*) from public.care_activity_candidates where session_id='${thisMonthSession}'`) === '1'
  );

  console.log('\n  ── 클라이언트가 저장된 행을 직접 고칠 수 있는가 ──');
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const rowId = sqlValue(
    `select id from public.care_activity_candidates where session_id='${thisMonthSession}' limit 1`
  );
  const patchRes = await fetch(`${API}/rest/v1/care_activity_candidates?id=eq.${rowId}`, {
    method: 'PATCH',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ label_ko: '위조된 라벨', rule_version: 99 })
  });
  check(
    '클라이언트의 UPDATE 가 막힌다',
    sqlValue(`select label_ko from public.care_activity_candidates where id='${rowId}'`) !== '위조된 라벨',
    `HTTP ${patchRes.status}`
  );
  const insRes = await fetch(`${API}/rest/v1/care_activity_candidates`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      session_id: thisMonthSession,
      activity_code: 'forged',
      label_ko: '위조 항목',
      engine_version: 'x',
      rule_version: 1,
      generated_at: new Date().toISOString(),
      quotes: [{ quote: '지어낸 문장' }],
      utterance_ids: ['zz'],
      start_ms: 0,
      end_ms: 0,
      duration_seconds: 0,
      occurred_on: thisMonth + '-01'
    })
  });
  check(
    '클라이언트의 직접 INSERT 도 막힌다',
    insRes.status >= 400 &&
      sqlValue(`select count(*) from public.care_activity_candidates where activity_code='forged'`) === '0',
    `HTTP ${insRes.status}`
  );
  const delRes = await fetch(`${API}/rest/v1/care_activity_candidates?id=eq.${rowId}`, {
    method: 'DELETE',
    headers: { apikey: ANON, Authorization: `Bearer ${token}` }
  });
  check(
    '클라이언트의 DELETE 도 막힌다',
    sqlValue(`select count(*) from public.care_activity_candidates where id='${rowId}'`) === '1',
    `HTTP ${delRes.status}`
  );

  console.log('\n=== 5) 지난달 진료도 스캔한다 (규칙 v1) ===');
  const lastView = await care.buildCareActivityDisplay({
    sessionId: lastMonthSession,
    encounterId
  });
  check('지난달 진료에서도 1건', lastView.items.length === 1);

  const reportBefore = {
    last: await care.loadMonthlyCareActivityReport(lastMonth),
    this: await care.loadMonthlyCareActivityReport(thisMonth)
  };
  console.log(`\n  ── 월 리포트 (규칙 변경 전) ──`);
  for (const [name, r] of [[lastMonth, reportBefore.last], [thisMonth, reportBefore.this]]) {
    console.log(`  ${name}: 합계 ${r.totalCount}건 / 진료 ${r.sessionCount}건`);
    for (const row of r.rows) {
      console.log(`    - ${row.label} [${row.activityCode}] ${row.engineVersion} rule v${row.ruleVersion} → ${row.count}건 (진료 ${row.sessionCount}건)`);
    }
  }
  check('지난달 1건', reportBefore.last.totalCount === 1, `rule v${reportBefore.last.rows[0]?.ruleVersion}`);
  check('이번달 1건', reportBefore.this.totalCount === 1);
  check(
    '리포트 어디에도 금액이 없다',
    !JSON.stringify(reportBefore).match(/원|amount|fee|revenue|price/i)
  );

  console.log('\n=== 6) 규칙을 바꾼다 — 지난달 숫자가 다시 쓰이는가 ===');
  // 규칙 변경 = rule_version 상승. 로더의 실제 동작과 같이 검토 상태도 내려가지만,
  // 여기서는 화면 경로를 계속 보기 위해 검토 완료를 유지한다.
  sql(
    `update public.care_activity_defs
     set rule_version = rule_version + 1,
         cue_terms = cue_terms || array['숨이 조금']
     where code='lifestyle_education'`
  );
  const afterRuleChange = await care.buildCareActivityDisplay({
    sessionId: thisMonthSession,
    encounterId
  });
  check('이번 달 진료를 새 규칙으로 다시 스캔했다', afterRuleChange.items[0]?.provenance.ruleVersion === 2);

  const rows = sql(
    `select session_id, rule_version, coalesce(superseded_at::text,'-') from public.care_activity_candidates where user_id='${userId}' order by created_at`
  );
  console.log('\n  ── 저장된 행 (session / rule_version / superseded_at) ──');
  console.log(rows.split('\n').map((l) => `    ${l}`).join('\n'));

  check(
    '이번 달의 v1 행은 지워지지 않고 superseded 로 남는다',
    sqlValue(
      `select count(*) from public.care_activity_candidates where session_id='${thisMonthSession}' and rule_version=1 and superseded_at is not null and superseded_by is not null`
    ) === '1'
  );
  check(
    '이번 달의 현재 유효한 행은 v2 하나뿐이다',
    sqlValue(
      `select count(*) from public.care_activity_candidates where session_id='${thisMonthSession}' and superseded_at is null and rule_version=2`
    ) === '1'
  );
  check(
    '지난달 행은 손대지 않았다 (여전히 v1, superseded 아님)',
    sqlValue(
      `select count(*) from public.care_activity_candidates where session_id='${lastMonthSession}' and rule_version=1 and superseded_at is null`
    ) === '1'
  );

  const reportAfter = {
    last: await care.loadMonthlyCareActivityReport(lastMonth),
    this: await care.loadMonthlyCareActivityReport(thisMonth)
  };
  console.log(`\n  ── 월 리포트 (규칙 변경 후) ──`);
  for (const [name, r] of [[lastMonth, reportAfter.last], [thisMonth, reportAfter.this]]) {
    console.log(`  ${name}: 합계 ${r.totalCount}건 / 진료 ${r.sessionCount}건`);
    for (const row of r.rows) {
      console.log(`    - ${row.label} [${row.activityCode}] ${row.engineVersion} rule v${row.ruleVersion} → ${row.count}건 (진료 ${row.sessionCount}건)`);
    }
  }
  check(
    '지난달 리포트가 규칙 변경으로 달라지지 않았다',
    JSON.stringify({ ...reportBefore.last, generatedAt: null }) ===
      JSON.stringify({ ...reportAfter.last, generatedAt: null })
  );
  check('지난달 줄은 여전히 rule v1', reportAfter.last.rows[0]?.ruleVersion === 1);
  check('이번달 줄은 rule v2', reportAfter.this.rows[0]?.ruleVersion === 2);
  check('이번달 건수는 여전히 1건 (중복 집계 없음)', reportAfter.this.totalCount === 1);

  console.log('\n  ── CSV (그대로 세어 갈 수 있어야 한다) ──');
  const csv = engine.monthlyReportToCsv(reportAfter.this);
  console.log(csv.split('\n').map((l) => `    ${l}`).join('\n'));
  check('CSV 에 금액 열이 없다', !/amount|fee|revenue|price|won/i.test(csv));

  console.log('\n=== 7) 문구 감사 — 우리가 쓴 문자열이 청구를 권하는가 ===');
  const localeFiles = ['../src/renderer/shared/locales/ko.ts', '../src/renderer/shared/locales/en.ts'];
  const uiFiles = [
    '../src/renderer/summary/CareActivitySection.tsx',
    '../src/renderer/dock/CareActivityReportDialog.tsx'
  ];
  const careStrings = [];
  for (const rel of localeFiles) {
    const text = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    for (const line of text.split('\n')) {
      if (line.trim().startsWith("'care.")) careStrings.push(line.trim());
    }
  }
  console.log(`  care.* 문자열 ${careStrings.length}줄:`);
  for (const s of careStrings) console.log(`    ${s}`);
  const offenders = careStrings.filter((s) => FORBIDDEN_WORDING.some((w) => s.includes(w)));
  check(
    `금지 문구가 하나도 없다 (${FORBIDDEN_WORDING.join(', ')})`,
    offenders.length === 0,
    offenders.join(' | ')
  );
  // 화면 컴포넌트에 하드코딩된 한국어가 새어 들어가지 않았는지도 본다.
  for (const rel of uiFiles) {
    const text = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    const bad = FORBIDDEN_WORDING.filter((w) => text.includes(w));
    check(`${rel.split('/').pop()} 에 금지 문구 없음`, bad.length === 0, bad.join(', '));
  }
  check(
    'payload 어디에도 "청구" 가 없다',
    !JSON.stringify(view).includes('청구') && !JSON.stringify(reportAfter).includes('청구')
  );

  console.log('\n=== 8) 정리 ===');
  sql(
    `update public.care_activity_defs set clinical_review_status='unreviewed', reviewed_at=null, review_note=null, rule_version=1, cue_terms=array_remove(cue_terms,'숨이 조금') where code='lifestyle_education'`
  );
  sql(`delete from public.sessions where user_id='${userId}'`);
  sql(`delete from public.patients where id='${patientId}'`);
  sql(`delete from auth.users where id='${userId}'`);

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
