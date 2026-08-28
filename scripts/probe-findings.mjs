#!/usr/bin/env node
// E1 근거 검증 프로브 — 확신도 퍼센트를 대체한 `supporting_findings` 경로가
// 실제 코드로 도는지 확인한다.
//
// 검증 대상은 전부 **진짜 앱 모듈**이다:
//   - kiosk/lib/intake/result.ts       assembleRow (저장 전 근거 검증)
//   - kiosk/lib/intake/prompts.ts      buildResultUserMessage ([#N] 번호)
//   - src/main/patients.ts             loadPatientDetail (실제 DB 조회)
//   - src/renderer/shared/patientMode.ts  patientDifferentialsPartitioned
//   - src/shared/findings.ts           partitionDifferentials
//
// 로컬 Supabase 스택(포트 553xx)에만 붙는다. 실제 프로젝트는 건드리지 않는다.
//
// 실행:
//   supabase start
//   node --import ./scripts/probe-findings-register.mjs scripts/probe-findings.mjs

import { execFileSync } from 'node:child_process';

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

/** returning 이 있는 문장은 psql 이 "INSERT 0 1" 을 덧붙인다 — 첫 줄만 쓴다. */
function sqlValue(text) {
  return sql(text).split('\n')[0].trim();
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 실제 안과 문진처럼 생긴 대화. 번호는 이 배열의 인덱스와 같다. */
const TURNS = [
  { role: 'agent', text: '어떤 불편함으로 오셨는지 편하게 말씀해 주세요.' },
  {
    role: 'patient',
    text: '사흘 전부터 오른쪽 눈이 빨갛고 아침에 눈곱이 껴서 눈이 잘 안 떠져요.'
  },
  { role: 'agent', text: '시력이 흐려지거나 눈이 아프시지는 않나요?' },
  {
    role: 'patient',
    text: '아프지는 않고 시력도 그대로예요. 그냥 이물감이 있고 가렵습니다.'
  },
  { role: 'agent', text: '콘택트렌즈를 쓰시나요? 드시는 약이나 알레르기가 있으신가요?' },
  {
    role: 'patient',
    text: '렌즈는 안 쓰고요, 고혈압 약을 먹습니다. 알레르기는 없어요.'
  },
  { role: 'agent', text: '말씀 감사합니다. 진료실에서 뵙겠습니다.' }
];

/**
 * 모델이 냈다고 가정하는 출력.
 *
 * 셋째 감별진단(포도막염)이 **존재하지 않는 발화 #99 를 인용한다** — 이것이
 * 화면까지 살아 나가면 안 된다. 넷째(급성 폐쇄각 녹내장)는 근거를 아예 대지
 * 않는다(빈 배열) — 프롬프트가 지시한 정직한 실패 방식이다.
 */
const MODEL_OUTPUT = {
  soap: {
    s: {
      chief_complaint: '우안 충혈과 눈곱',
      hpi: '3일 전부터 우안 충혈, 아침 분비물, 이물감과 소양감. 통증과 시력 저하는 없음.',
      pmh: '고혈압',
      medications: '고혈압 약',
      allergies: '없음'
    },
    a: '세균성 결막염(bacterial conjunctivitis)을 우선 고려하며 확정 진단 아님.',
    p: '세극등검사와 시력검사를 시행한다.'
  },
  differentials: [
    {
      rank: 1,
      name_kr: '세균성 결막염',
      name_en: 'Bacterial conjunctivitis',
      rationale: '3일간의 우안 충혈과 아침 분비물.',
      supporting_findings: [
        { finding: '3일 전부터 우안 충혈과 아침 눈곱', source: '#1' },
        { finding: '통증 없고 시력 변화 없음', source: '#3' }
      ]
    },
    {
      rank: 2,
      name_kr: '알레르기성 결막염',
      name_en: 'Allergic conjunctivitis',
      rationale: '가려움과 이물감이 동반됨.',
      // 표기 흔들림(대괄호)도 번호만 맞으면 받아준다.
      supporting_findings: [{ finding: '이물감과 소양감 호소', source: '[#3]' }]
    },
    {
      rank: 3,
      name_kr: '전방 포도막염',
      name_en: 'Anterior uveitis',
      rationale: '충혈 감별에 포함.',
      // 존재하지 않는 발화 — 반드시 떨어져야 한다.
      supporting_findings: [{ finding: '심한 눈부심을 호소함', source: '#99' }]
    },
    {
      rank: 4,
      name_kr: '급성 폐쇄각 녹내장',
      name_en: 'Acute angle-closure glaucoma',
      rationale: '응급 감별로 배제 필요.',
      // 근거를 지어내지 않고 비워둔 경우.
      supporting_findings: []
    }
  ],
  recommended_tests: [
    { name_kr: '세극등검사', name_en: 'Slit lamp examination', reason: '결막과 각막 상태 확인.' },
    { name_kr: '시력검사', name_en: 'Visual acuity test', reason: '시력 저하 동반 여부 확인.' }
  ],
  follow_up_questions: [
    { question: '분비물의 성상은 화농성인가?', rationale: '세균성과 알레르기성을 가른다.' },
    { question: '반대편 눈으로 번졌는가?', rationale: '감염성 결막염의 경과를 본다.' },
    { question: '최근 상기도 감염이 있었는가?', rationale: '바이러스성 결막염을 시사한다.' }
  ],
  medical_terms: [
    { term: '결막염', term_en: 'Conjunctivitis', definition: '눈 흰자를 덮는 얇은 막에 생긴 염증입니다.' },
    { term: '이물감', term_en: 'Foreign body sensation', definition: '눈에 무언가 들어간 듯한 느낌입니다.' },
    { term: '세극등검사', term_en: 'Slit lamp examination', definition: '현미경으로 눈 앞부분을 자세히 보는 검사입니다.' }
  ]
};

const main = async () => {
  const stamp = Date.now();
  const email = `findings-${stamp}@example.com`;

  console.log('\n=== 0) 키오스크 프롬프트가 발화에 번호를 붙이는가 ===');
  const { buildResultUserMessage } = await import('../kiosk/lib/intake/prompts.ts');
  const userMessage = buildResultUserMessage(TURNS);
  check(
    '대화 각 줄에 [#N] 번호가 붙는다',
    userMessage.includes('[#1 환자] 사흘 전부터 오른쪽 눈이 빨갛고'),
    userMessage.split('\n')[2]
  );
  check(
    '번호가 배열 인덱스와 같다',
    TURNS.every((turn, i) => userMessage.includes(`[#${i} `))
  );

  console.log('\n=== 1) 키오스크가 저장 전에 지어낸 참조를 떨어내는가 ===');
  const { assembleRow } = await import('../kiosk/lib/intake/result.ts');
  const row = assembleRow(MODEL_OUTPUT, TURNS);
  const byName = Object.fromEntries(row.differentials_json.map((d) => [d.name_kr, d]));
  check(
    '세균성 결막염: 근거 2건 유지',
    byName['세균성 결막염'].supporting_findings.length === 2,
    JSON.stringify(byName['세균성 결막염'].supporting_findings)
  );
  check(
    '알레르기성 결막염: [#3] 표기도 #3 으로 정규화',
    byName['알레르기성 결막염'].supporting_findings[0]?.source === '#3'
  );
  check(
    '전방 포도막염: 존재하지 않는 #99 가 저장 전에 떨어졌다',
    byName['전방 포도막염'].supporting_findings.length === 0
  );
  check(
    '급성 폐쇄각 녹내장: 빈 배열 그대로',
    byName['급성 폐쇄각 녹내장'].supporting_findings.length === 0
  );

  console.log('\n=== 2) 실제 DB 에 문진 기록을 넣고 실제 로더로 읽는다 ===');
  const userId = await createUser(email);
  const patientId = sqlValue(
    `insert into public.patients (user_id, name, birth_date) values ('${userId}','김로컬','1958-03-11') returning id`
  );
  const encounterId = sqlValue(
    `insert into public.encounters (user_id, patient_id, status, red_flag) values ('${userId}','${patientId}','intake_done', false) returning id`
  );
  const payload = JSON.stringify(row).replaceAll("'", "''");
  sql(
    `insert into public.intake_results (encounter_id, soap_json, differentials_json, recommended_tests_json, version)
     select '${encounterId}', j->'soap_json', j->'differentials_json', j->'recommended_tests_json', 1
     from (select '${payload}'::jsonb as j) t`
  );
  check('intake_results 행이 저장됐다', sql(`select count(*) from public.intake_results where encounter_id='${encounterId}'`) === '1');

  const auth = await import('../src/main/auth.ts');
  const patients = await import('../src/main/patients.ts');
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

  const detail = await patients.loadPatientDetail(encounterId);
  check('loadPatientDetail 이 문진 결과를 돌려준다', !!detail?.intakeResult, detail?.patient.name);

  console.log('\n=== 3) 실제 매퍼 출력 (renderer patientMode) ===');
  const patientMode = await import('../src/renderer/shared/patientMode.ts');
  const turns = patientMode.patientTranscript(detail);
  const { supported, unverified } = patientMode.patientDifferentialsPartitioned(detail);

  for (const d of supported) {
    console.log(`\n  ● ${d.name}${d.nameEn ? ` (${d.nameEn})` : ''}`);
    console.log(`    reasoning: ${d.reasoning}`);
    for (const f of d.supportingFindings ?? []) {
      console.log(`    - ${f.finding}`);
      console.log(`      source=${f.source} → utteranceId=${f.utteranceId}`);
      console.log(`      quote="${f.quote}"`);
    }
  }
  console.log('\n  ── 근거 미확인 ──');
  for (const u of unverified) {
    console.log(
      `  ○ ${u.diagnosis.name} — reason=${u.reason} rejected=${JSON.stringify(u.rejectedSources)}`
    );
  }

  console.log('');
  check('근거 확인된 감별진단 2건', supported.length === 2, supported.map((d) => d.name).join(', '));
  check(
    '모든 렌더 대상 진단이 근거를 최소 1개 갖는다 (E1 검증 기준)',
    supported.every((d) => (d.supportingFindings?.length ?? 0) > 0)
  );
  check('근거 미확인 2건이 사라지지 않고 남았다', unverified.length === 2, unverified.map((u) => u.diagnosis.name).join(', '));
  check(
    '어떤 감별진단에도 confidence 필드가 남아 있지 않다',
    [...supported, ...unverified.map((u) => u.diagnosis)].every((d) => !('confidence' in d))
  );

  const first = supported[0].supportingFindings[0];
  const target = turns.find((t) => t.id === first.utteranceId);
  check(
    'source 가 전사 창의 실제 발화로 해석된다',
    !!target && target.text === first.quote,
    `${first.utteranceId} → "${target?.text}"`
  );
  check(
    '인용문이 원문 그대로다 (모델이 쓴 문장이 아니다)',
    first.quote === TURNS[1].text,
    first.quote
  );

  console.log('\n=== 4) 지어낸 참조가 화면까지 살아 나가는가 (Electron 쪽 방어) ===');
  // 키오스크 검증을 우회해 DB 에 직접 지어낸 참조를 심는다. 구버전 키오스크가
  // 쓴 행이나 손으로 고친 행이 이 모습이다.
  const forged = JSON.parse(JSON.stringify(row.differentials_json));
  forged[0].supporting_findings = [{ finding: '환자가 실명 위험을 호소함', source: '#42' }];
  const forgedPayload = JSON.stringify(forged).replaceAll("'", "''");
  sql(
    `update public.intake_results set differentials_json='${forgedPayload}'::jsonb where encounter_id='${encounterId}'`
  );
  const forgedDetail = await patients.loadPatientDetail(encounterId);
  const forgedResult = patientMode.patientDifferentialsPartitioned(forgedDetail);
  check(
    '지어낸 참조를 단 진단은 정상 목록에 없다',
    !forgedResult.supported.some((d) => d.name === '세균성 결막염'),
    forgedResult.supported.map((d) => d.name).join(', ')
  );
  const routed = forgedResult.unverified.find((u) => u.diagnosis.name === '세균성 결막염');
  check('근거 미확인으로 라우팅됐다', !!routed, routed && `reason=${routed.reason}`);
  check(
    '왜 내려갔는지 근거(거부된 참조)가 남는다',
    routed?.rejectedSources.includes('#42'),
    JSON.stringify(routed?.rejectedSources)
  );
  check(
    '지어낸 근거 문장은 어디에도 렌더되지 않는다',
    !JSON.stringify(forgedResult.supported).includes('실명 위험')
  );

  console.log('\n=== 5) 구버전 기록 (근거 필드 자체가 없던 시절) ===');
  const legacy = JSON.parse(JSON.stringify(row.differentials_json)).map((d) => {
    delete d.supporting_findings;
    return d;
  });
  sql(
    `update public.intake_results set differentials_json='${JSON.stringify(legacy).replaceAll("'", "''")}'::jsonb where encounter_id='${encounterId}'`
  );
  const legacyResult = patientMode.patientDifferentialsPartitioned(
    await patients.loadPatientDetail(encounterId)
  );
  check('정상 목록은 비어 있다', legacyResult.supported.length === 0);
  check(
    '전부 근거 미확인 = no-findings 로 보존된다',
    legacyResult.unverified.length === legacy.length &&
      legacyResult.unverified.every((u) => u.reason === 'no-findings'),
    `${legacyResult.unverified.length}건`
  );

  console.log('\n=== 6) 정리 ===');
  sql(`delete from public.patients where id='${patientId}'`);
  sql(`delete from auth.users where id='${userId}'`);

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
