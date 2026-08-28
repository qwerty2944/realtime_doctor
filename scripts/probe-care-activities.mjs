#!/usr/bin/env node
// B1/B2 진료행위 기록 탐지 프로브.
//
// 검증 대상은 전부 **진짜 앱 모듈**이다:
//   - src/shared/careActivities.ts  탐지 엔진 / 원문 대조 / 화면 게이트
//   - src/main/careActivities.ts    실제 DB 조회 (정의 · 전사 · 문진 대화)
//   - scripts/load-care-activities.mjs 로 넣은 실제 정의 행
//
// 로컬 Supabase 스택(포트 553xx)에만 붙는다. 실제 프로젝트는 건드리지 않는다.
//
// 실행:
//   supabase start && supabase db reset
//   node scripts/load-care-activities.mjs
//   node --import ./scripts/probe-findings-register.mjs scripts/probe-care-activities.mjs

import { execFileSync } from 'node:child_process';
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

/**
 * 실제 진료실 대화처럼 생긴 녹취. ms 는 녹음 시작 기준 경과 시간이다.
 *
 * 일부러 네 종류를 섞었다:
 *   (a) 명확히 일어난 행위  — 3분 넘게 이어진 식이·운동 교육
 *   (b) 애매한 언급        — 복약을 한 번 스치듯 말한 것
 *   (c) 하지 않겠다고 말한 것 — "금연 상담은 다음에"
 *   (d) 환자가 물어본 것    — 주사를 맞아야 하냐는 질문
 * (b)(c)(d) 는 전부 후보가 되어서는 안 된다.
 */
const CHUNKS = [
  ['c01', 'doctor', 0, '어서 오세요. 지난번 혈압 수치 보고 오늘 좀 자세히 말씀드리려고 합니다.'],
  ['c02', 'patient', 12_000, '네, 요즘 머리가 좀 무겁고 그렇습니다.'],
  ['c03', 'doctor', 30_000, '식단부터 보겠습니다. 국물을 싱겁게 드시고 염분을 확 줄이셔야 합니다.'],
  ['c04', 'patient', 62_000, '국을 안 먹으면 밥이 잘 안 넘어가는데요.'],
  ['c05', 'doctor', 78_000, '국물은 남기시고 건더기 위주로 드시면 됩니다. 기름진 반찬도 주 2회 이내로 줄여보시죠.'],
  ['c06', 'patient', 150_000, '알겠습니다. 운동은 어떻게 할까요?'],
  ['c07', 'doctor', 168_000, '유산소 운동으로 하루 삼십 분 걷기부터 시작하시고, 체중은 석 달 안에 3킬로만 줄여봅시다.'],
  ['c08', 'patient', 240_000, '걷기는 할 수 있을 것 같습니다.'],
  ['c09', 'doctor', 262_000, '운동 강도는 숨이 조금 찰 정도가 좋습니다. 식단은 아까 말씀드린 대로 염분부터 줄이세요.'],
  ['c10', 'doctor', 320_000, '혈압약은 식후에 드세요.'],
  ['c11', 'patient', 336_000, '담배는 좀 줄였습니다.'],
  ['c12', 'doctor', 350_000, '금연 상담은 다음에 시간 잡아서 따로 하겠습니다.'],
  ['c13', 'patient', 366_000, '주사도 맞아야 하나요?'],
  ['c14', 'doctor', 380_000, '오늘은 필요 없습니다. 다음에 뵙겠습니다.']
];

/** 문진 대화(키오스크). 타임스탬프가 없다 — 시각 구간을 만들 수 없다. */
const INTAKE_TURNS = [
  { role: 'agent', text: '오늘 어떤 점이 불편하신가요?' },
  { role: 'patient', text: '혈압약을 먹고 있는데 머리가 무겁습니다.' },
  { role: 'agent', text: '식단이나 운동은 어떻게 하고 계신가요?' },
  { role: 'patient', text: '짜게 먹는 편이고 운동은 거의 못 합니다.' }
];

const main = async () => {
  const stamp = Date.now();
  const email = `care-${stamp}@example.com`;

  console.log('\n=== 0) 로그인하고 실제 로더로 정의를 읽는다 ===');
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

  const defs = await care.loadCareActivityDefs();
  check('정의를 DB 에서 읽었다', defs.length >= 5, `${defs.length}건: ${defs.map((d) => d.code).join(', ')}`);
  check(
    '씨드된 정의는 전부 임상 검토 전이다',
    defs.every((d) => d.reviewStatus === 'unreviewed')
  );
  check(
    '정의 문구에 청구 어휘가 없다',
    defs.every((d) =>
      FORBIDDEN_WORDING.every(
        (w) => !d.code.includes(w) && !d.labelKo.includes(w) && !d.descriptionKo.includes(w)
      )
    ),
    FORBIDDEN_WORDING.join(', ')
  );

  console.log('\n=== 1) 진료 한 건을 실제 DB 에 심는다 ===');
  const patientId = sqlValue(
    `insert into public.patients (user_id, name, birth_date) values ('${userId}','박로컬','1961-07-02') returning id`
  );
  const encounterId = sqlValue(
    `insert into public.encounters (user_id, patient_id, status) values ('${userId}','${patientId}','in_consult') returning id`
  );
  const sessionId = sqlValue(
    `insert into public.sessions (user_id, encounter_id) values ('${userId}','${encounterId}') returning id`
  );
  for (const [chunkId, speaker, ms, text] of CHUNKS) {
    sql(
      `insert into public.transcript_chunks (session_id, user_id, chunk_id, speaker, text, timestamp_ms)
       values ('${sessionId}','${userId}','${chunkId}','${speaker}','${esc(text)}',${ms})`
    );
  }
  const intakeSoap = JSON.stringify({ s: { chief_complaint: '두중감' }, transcript: INTAKE_TURNS });
  sql(
    `insert into public.intake_results (encounter_id, soap_json, version) values ('${encounterId}','${esc(intakeSoap)}'::jsonb, 1)`
  );
  check('전사 발화 저장', sql(`select count(*) from public.transcript_chunks where session_id='${sessionId}'`) === String(CHUNKS.length));

  console.log('\n=== 2) 진짜 엔진을 돌린다 (미검토 상태 그대로) ===');
  const scan = await care.scanSessionForCareActivities(sessionId, { encounterId });
  check('전사 + 문진 발화가 모두 입력에 들어갔다', scan.utterances.length === CHUNKS.length + INTAKE_TURNS.length, `${scan.utterances.length}건`);

  for (const c of scan.detection.candidates) {
    console.log(`\n  ● ${c.label} [${c.activityCode}] — ${engine.formatTimeRange(c.timeRange)} (${c.timeRange.durationSeconds}초)`);
    console.log(`    ${c.description}`);
    console.log(`    provenance: ${c.provenance.engineVersion} / rule v${c.provenance.ruleVersion} / ${c.provenance.generatedAt}`);
    for (const q of c.quotes) {
      console.log(`    - [${q.utteranceId} @${engine.formatTimeRange({ startMs: q.timestampMs, endMs: q.timestampMs }).split('–')[0]}] "${q.quote}"`);
      console.log(`      걸린 단서: ${q.matchedCues.join(', ')}`);
    }
  }
  console.log('\n  ── 후보를 만들지 않은 것들 (내부 정보, 화면에 올리지 않는다) ──');
  for (const s of scan.detection.skipped) {
    console.log(`  ○ ${s.activityCode} — ${s.reason}: ${s.detail}`);
  }

  console.log('');
  check('후보는 생활습관 교육 한 건뿐이다', scan.detection.candidates.length === 1, scan.detection.candidates.map((c) => c.activityCode).join(', '));
  const lifestyle = scan.detection.candidates[0];
  check('시각 구간이 실제 chunk 타임스탬프에서 나왔다', lifestyle.timeRange.startMs === 30_000 && lifestyle.timeRange.endMs === 262_000, `${lifestyle.timeRange.startMs}–${lifestyle.timeRange.endMs}`);
  check(
    '모든 인용문이 원문 그대로다',
    lifestyle.quotes.every((q) => CHUNKS.find((c) => c[0] === q.utteranceId)?.[3] === q.quote)
  );
  check('인용은 전부 의사 발화다', lifestyle.quotes.every((q) => CHUNKS.find((c) => c[0] === q.utteranceId)?.[1] === 'doctor'));
  check('후보에 확신 점수 같은 필드가 없다', !('confidence' in lifestyle) && !('score' in lifestyle) && !('probability' in lifestyle));

  console.log('\n=== 3) 보수적 편향 — 애매한 것은 후보가 되지 않는다 ===');
  const skipByCode = Object.fromEntries(scan.detection.skipped.map((s) => [s.activityCode, s]));
  check(
    '복약: 스치듯 한 번 언급된 것은 후보가 아니다',
    skipByCode.medication_counseling?.reason === 'too-few-utterances',
    skipByCode.medication_counseling?.detail
  );
  check(
    '금연: "다음에 하겠다"는 한 기록이 아니다',
    skipByCode.smoking_cessation_counseling?.reason === 'negated',
    skipByCode.smoking_cessation_counseling?.detail
  );
  check(
    '주사: 환자가 물어본 것은 시행 기록이 아니다',
    skipByCode.injection_administered?.reason === 'speaker-mismatch',
    skipByCode.injection_administered?.detail
  );
  check(
    '상처 소독: 단서 자체가 없다',
    skipByCode.wound_dressing?.reason === 'no-cue-match',
    skipByCode.wound_dressing?.detail
  );

  console.log('\n=== 3b) 시각 없는 문진 대화만으로는 후보가 만들어지지 않는다 ===');
  const intakeOnly = await care.loadIntakeUtterances(encounterId);
  const intakeScan = engine.detectCareActivities(intakeOnly, defs);
  check('문진 발화를 읽었다', intakeOnly.length === INTAKE_TURNS.length);
  check('타임스탬프가 없다', intakeOnly.every((u) => u.timestampMs === null));
  check(
    '후보 0건 — 시각 구간을 지어내지 않는다',
    intakeScan.candidates.length === 0,
    intakeScan.skipped.map((s) => `${s.activityCode}:${s.reason}`).join(', ')
  );

  // 문진 대화는 화자가 doctor 로 잡히지 않아 화자 조건에서 먼저 걸린다.
  // 타임스탬프 없음 자체가 후보를 막는지 따로 확인한다 — 같은 발화에서
  // 시각만 걷어낸다.
  const timeless = CHUNKS.map(([id, speaker, , text]) => ({ id, speaker, text, timestampMs: null }));
  const timelessScan = engine.detectCareActivities(timeless, defs);
  check(
    '타임스탬프를 걷어내면 같은 대화도 후보가 되지 않는다',
    timelessScan.candidates.length === 0 &&
      timelessScan.skipped.some((s) => s.activityCode === 'lifestyle_education' && s.reason === 'missing-timestamp'),
    timelessScan.skipped.find((s) => s.activityCode === 'lifestyle_education')?.detail
  );

  console.log('\n=== 4) 미검토 게이트 — 검토 전 정의는 화면에 닿지 않는다 ===');
  check('탐지는 됐다', scan.detection.candidates.length === 1);
  check('그러나 화면으로 나가는 것은 0건이다', scan.released.length === 0);
  check(
    '이유가 남는다',
    scan.withheld.length === 1 && scan.withheld[0].reason === 'unreviewed-definition',
    scan.withheld[0]?.detail
  );

  console.log('\n  ── 로그인한 의사가 스스로 검토 완료로 올릴 수 있는가 ──');
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const patchRes = await fetch(`${API}/rest/v1/care_activity_defs?code=eq.wound_dressing`, {
    method: 'PATCH',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ clinical_review_status: 'reviewed', reviewed_at: new Date().toISOString() })
  });
  const patchBody = await patchRes.text();
  const stillUnreviewed = sqlValue(
    `select clinical_review_status from public.care_activity_defs where code='wound_dressing'`
  );
  check('클라이언트의 검토 승격이 막힌다', stillUnreviewed === 'unreviewed', `HTTP ${patchRes.status} ${patchBody.slice(0, 80)}`);
  const insertRes = await fetch(`${API}/rest/v1/care_activity_defs`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: `forged_${stamp}`, label_ko: '위조 항목', cue_terms: ['아무거나'], clinical_review_status: 'reviewed', reviewed_at: new Date().toISOString() })
  });
  check(
    '클라이언트가 검토 완료 정의를 직접 만들 수도 없다',
    insertRes.status >= 400 && sqlValue(`select count(*) from public.care_activity_defs where code='forged_${stamp}'`) === '0',
    `HTTP ${insertRes.status}`
  );

  console.log('\n=== 5) 임상 검토를 마친 뒤에야 화면으로 나간다 (계정별 채택, B5) ===');
  // 공용 행을 service_role 로 올려도 **아무에게도 켜지지 않는다** (0008).
  // 정의는 모든 계정이 같이 읽는 템플릿이라, 한 사람의 판단이 전역이 되면
  // 다른 의원의 탐지까지 켜진다.
  sql(
    `update public.care_activity_defs set clinical_review_status='reviewed', reviewed_at=now(), review_note='프로브: 공용 행만 올린 상태' where code='lifestyle_education'`
  );
  const scanGlobalOnly = await care.scanSessionForCareActivities(sessionId, { encounterId });
  check(
    '공용 행만 올려서는 화면에 나가지 않는다',
    scanGlobalOnly.released.length === 0,
    `released ${scanGlobalOnly.released.length}건`
  );
  const reviewRes = await care.setCareActivityReview({
    activityCode: 'lifestyle_education',
    ruleVersion: 1,
    reviewed: true,
    note: '프로브: 규칙 전문을 읽고 승인'
  });
  check('이 계정이 스스로 검토 표시', reviewRes.ok === true);
  const scan2 = await care.scanSessionForCareActivities(sessionId, { encounterId });
  check('검토 완료 후 화면으로 1건 나간다', scan2.released.length === 1, scan2.released[0]?.label);
  const released = scan2.released[0];
  console.log(`\n  화면에 올라갈 문구:`);
  console.log(`    ${released.label} — ${engine.formatTimeRange(released.timeRange)}, ${Math.round(released.timeRange.durationSeconds / 60)}분간`);
  for (const q of released.quotes) console.log(`      해당 발화: "${q.quote}"`);
  check(
    '나머지 정의는 여전히 미검토라 나가지 않는다',
    scan2.withheld.every((w) => w.reason === 'unreviewed-definition') || scan2.withheld.length === 0,
    `withheld ${scan2.withheld.length}건`
  );

  console.log('\n=== 6) 지어낸 후보가 화면까지 살아 나가는가 ===');
  const forgedUnknown = JSON.parse(JSON.stringify(released));
  forgedUnknown.quotes = [{ utteranceId: 'c99', quote: '오늘 스케일링과 물리치료를 시행했습니다.', matchedCues: ['운동'], timestampMs: 400_000 }];
  forgedUnknown.utteranceIds = ['c99'];
  forgedUnknown.timeRange = { startMs: 400_000, endMs: 400_000, durationSeconds: 0 };
  const r1 = engine.releaseForDisplay([forgedUnknown], scan2.utterances);
  check('존재하지 않는 발화를 인용한 후보는 화면에 못 나간다', r1.released.length === 0);
  check('이유가 unknown-utterance 로 남는다', r1.withheld[0]?.detail.includes('unknown-utterance'), r1.withheld[0]?.detail);

  const forgedQuote = JSON.parse(JSON.stringify(released));
  forgedQuote.quotes[0].quote = '체중을 10킬로 줄이라고 강력히 지시했습니다.';
  const r2 = engine.releaseForDisplay([forgedQuote], scan2.utterances);
  check('실재하는 발화 id 에 다른 문장을 붙인 후보도 막힌다', r2.released.length === 0, r2.withheld[0]?.detail);

  const forgedTime = JSON.parse(JSON.stringify(released));
  forgedTime.timeRange = { startMs: 0, endMs: 900_000, durationSeconds: 900 };
  const r3 = engine.releaseForDisplay([forgedTime], scan2.utterances);
  check('시각 구간을 부풀린 후보도 막힌다', r3.released.length === 0, r3.withheld[0]?.detail);

  const forgedEmpty = JSON.parse(JSON.stringify(released));
  forgedEmpty.quotes = [];
  const r4 = engine.releaseForDisplay([forgedEmpty], scan2.utterances);
  check('인용이 비어 있는 후보는 화면에 못 나간다', r4.released.length === 0, r4.withheld[0]?.detail);

  check(
    '지어낸 문장은 어디에도 남지 않는다',
    ![r1, r2, r3, r4].some((r) => JSON.stringify(r.released).includes('스케일링') || JSON.stringify(r.released).includes('10킬로'))
  );

  console.log('\n=== 7) 정리 ===');
  sql(`update public.care_activity_defs set clinical_review_status='unreviewed', reviewed_at=null, review_note=null where code='lifestyle_education'`);
  sql(`delete from public.sessions where id='${sessionId}'`);
  sql(`delete from public.patients where id='${patientId}'`);
  sql(`delete from auth.users where id='${userId}'`);

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
