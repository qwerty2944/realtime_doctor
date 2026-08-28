#!/usr/bin/env node
// 배포된 키오스크 프로브 — 실제 Vercel 배포와 실제 Supabase 프로젝트를 상대로 돈다.
//
// `scripts/probe-visit-code.mjs`(저장소 루트)는 로컬 스택과 가짜 Gemini 로 L1 의
// 전 구간을 센다. 그건 여기서 못 한다: 배포 환경에서는 모델 호출 횟수를 셀 수
// 없고, DB 에 psql 로 붙지도 않는다. 그래서 이 프로브가 답하는 질문은 좁다.
//
//   1. 배포된 서버가 떴는가 (환경변수 누락으로 죽지 않았는가).
//   2. 하위 경로(`NEXT_PUBLIC_BASE_PATH`)에서 화면과 API 가 모두 서비스되는가.
//      루트 경로로는 더 이상 열리지 않는가.
//   3. 코드 없이 / 모르는 코드로 시작하려 하면 거절되고, 그때 실제 DB 에
//      patients·encounters 행이 **한 줄도** 늘지 않는가. (L1 [HARD])
//   4. 진짜로 발급한 코드로 문진을 끝까지 완주하면, 실제 DB 에 데스크톱 앱이
//      읽는 모양 그대로 남는가 (intake_done · 귀속 · 동의 · 산출 JSON).
//   5. 첫 화면 payload 에 AI 고지가 있는가.
//
// 모델 호출 횟수는 여기서 세지 않는다 — 셀 수 있는 이음매가 배포에는 없다.
// 그 단언은 로컬 프로브가 갖고 있고, 여기서는 거절이 코드 게이트에서 끝났다는
// 것을 "행이 늘지 않았다" 로만 확인한다.
//
// 필요한 환경변수 (전부 셸에서 주입한다. 이 파일에 값은 없다):
//   KIOSK_URL                    예: https://righthand-patient.vercel.app
//   KIOSK_BASE_PATH              예: /righthand/patient
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY    행 확인 · 임상의 세션 발급용
//   SUPABASE_ANON_KEY            authenticated 세션으로 RPC 를 부를 때 apikey
//   KIOSK_CLINICIAN_ID           문진이 귀속될 의사 auth user id
//   PROBE_KEEP=1                 정리 단계를 건너뛴다 (남은 행을 눈으로 볼 때)
//
// 실행:
//   node kiosk/scripts/probe-production.mjs

const KIOSK_URL = requireEnv('KIOSK_URL').replace(/\/+$/, '');
const BASE_PATH = (process.env.KIOSK_BASE_PATH ?? '').replace(/\/+$/, '');
const SUPABASE_URL = requireEnv('SUPABASE_URL').replace(/\/+$/, '');
const SERVICE = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const ANON = requireEnv('SUPABASE_ANON_KEY');
const CLINICIAN = requireEnv('KIOSK_CLINICIAN_ID');

const APP = `${KIOSK_URL}${BASE_PATH}`;
/** 남는 행을 사람이 한눈에 알아보라고 붙이는 표식. */
const PROBE_TAG = 'ZZ배포검증';

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    console.error(`[probe] 환경변수 ${name} 이 필요합니다.`);
    process.exit(2);
  }
  return value.trim();
}

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures += 1;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

const admin = (path, init = {}) =>
  fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  });

/** service_role 로 읽는다 (RLS 우회). 확인용이지 앱의 경로가 아니다. */
async function rows(table, query) {
  const res = await admin(`/rest/v1/${table}?${query}`);
  const body = await res.json();
  if (!res.ok) throw new Error(`${table}: ${JSON.stringify(body)}`);
  return body;
}

async function countFor(table) {
  const res = await admin(`/rest/v1/${table}?user_id=eq.${CLINICIAN}&select=id`, {
    headers: { Prefer: 'count=exact', Range: '0-0' }
  });
  const range = res.headers.get('content-range') ?? '';
  return Number(range.split('/')[1] ?? 'NaN');
}

/**
 * 임상의 세션을 만든다.
 *
 * 발급 RPC(`issue_visit_access_code`)는 `auth.uid()` 를 쓰므로 service_role 로는
 * 부를 수 없다(그게 설계다 — 브라우저가 의사를 지목할 수 없다). 데스크톱 앱은
 * 로그인한 의사의 세션으로 부른다. 프로브는 그 세션을 admin API 의 매직링크로
 * 만든다: 비밀번호를 알 필요도, 바꿀 필요도 없다.
 */
async function clinicianAccessToken(email) {
  const link = await admin('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email })
  });
  const linkBody = await link.json();
  if (!link.ok) throw new Error(`generate_link: ${JSON.stringify(linkBody)}`);

  // generate_link 는 같은 링크를 세 가지 모양으로 준다: action_link(브라우저용),
  // hashed_token(token_hash 검증용), email_otp(코드 입력용). 여기서는 OTP 를
  // 그대로 쓴다 — 브라우저 리다이렉트를 흉내 낼 필요가 없다.
  const verify = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token: linkBody.email_otp, email })
  });
  const session = await verify.json();
  if (!verify.ok) throw new Error(`verify: ${JSON.stringify(session)}`);
  return session.access_token;
}

/** 앱과 같은 경로로 코드를 발급한다: authenticated 세션 + RPC. */
async function issueCode(accessToken, slug = 'main') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/issue_visit_access_code`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_kiosk_slug: slug, p_ttl_seconds: null })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`issue: ${JSON.stringify(json)}`);
  return json;
}

const postJson = async (path, body) => {
  const res = await fetch(`${APP}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const patientInfo = (suffix) => ({
  name: `${PROBE_TAG}${suffix}`,
  birthDate: '1958-03-11',
  registrationNo: null,
  consents: { privacy: true, recording: true, ai: true }
});

const main = async () => {
  console.log(`\n키오스크: ${APP}`);
  console.log(`의사    : ${CLINICIAN}`);

  // -------------------------------------------------------------------------
  console.log('\n=== 1) 배포된 서버가 떴는가 · 하위 경로 ===');
  const intakePage = await fetch(`${APP}/intake?k=main`);
  const html = await intakePage.text();
  check('하위 경로에서 문진 화면이 200 이다', intakePage.status === 200, `HTTP ${intakePage.status}`);
  check('코드 입력 화면이 첫 화면이다', html.includes('접수 코드를 입력해 주세요'));
  check(
    '정적 자원에 base path 가 붙는다',
    BASE_PATH === '' || html.includes(`${BASE_PATH}/_next/`),
    `${BASE_PATH}/_next/`
  );
  check(
    '담당 의사 uuid 는 화면 payload 에 내려가지 않는다',
    !html.includes(CLINICIAN)
  );

  if (BASE_PATH) {
    const rootPage = await fetch(`${KIOSK_URL}/intake?k=main`);
    check('루트 경로로는 화면이 열리지 않는다', rootPage.status === 404, `HTTP ${rootPage.status}`);
    const rootApi = await fetch(`${KIOSK_URL}/api/intake/code/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kiosk: 'main', code: 'A2CD4EF' })
    });
    check('루트 경로로는 API 도 열리지 않는다', rootApi.status === 404, `HTTP ${rootApi.status}`);

    // 클라이언트 fetch 는 런타임에 이어붙이므로 HTML 에 완성된 문자열이 없다.
    // 번들이 그 값을 들고 있는지를 본다 (apiPath()).
    const chunks = [
      ...new Set(html.match(new RegExp(`${BASE_PATH}/_next/static/[^"']+\\.js`, 'g')) ?? [])
    ];
    let carries = false;
    for (const rel of chunks) {
      const js = await (await fetch(`${KIOSK_URL}${rel}`)).text();
      if (js.includes(`"${BASE_PATH}"`) || js.includes(`'${BASE_PATH}'`)) {
        carries = true;
        break;
      }
    }
    check('클라이언트 번들이 base path 를 들고 있다 (fetch 접두용)', carries, `${chunks.length}개 청크`);
  }

  console.log('\n=== 2) AI 고지 — 환자가 처음 보는 화면의 payload ===');
  for (const phrase of [
    '사람이 아니라 AI',
    '진단이 아닙니다',
    '담당 의사가 직접 읽고 확인합니다',
    '문진을 멈추고 직원을 불러',
    '기다리지 마십시오'
  ]) {
    check(`"${phrase}" 가 있다`, html.includes(phrase));
  }

  // -------------------------------------------------------------------------
  console.log('\n=== 3) [HARD] 발급되지 않은 접근은 행을 만들지 않는다 ===');
  const before = { patients: await countFor('patients'), encounters: await countFor('encounters') };
  console.log(`  시작 전: patients=${before.patients} encounters=${before.encounters}`);

  const refusals = [
    ['코드 없음', await postJson('/api/intake/start', { kiosk: 'main', ...patientInfo('무코드') })],
    [
      '모르는 코드',
      await postJson('/api/intake/start', { kiosk: 'main', code: 'A2CD-4EF', ...patientInfo('오타') })
    ]
  ];
  const afterRefusals = {
    patients: await countFor('patients'),
    encounters: await countFor('encounters')
  };
  for (const [label, result] of refusals) {
    console.log(`  ── ${label}: HTTP ${result.status} "${result.body.error ?? ''}"`);
    check(`${label} — 거절된다`, result.status >= 400, `HTTP ${result.status}`);
    check(
      `${label} — 환자에게 한국어 안내가 간다`,
      typeof result.body.error === 'string' &&
        /[가-힣]/.test(result.body.error) &&
        !/[A-Za-z]{4,}/.test(result.body.error),
      result.body.error
    );
  }
  check(
    '거절 뒤 patients 행이 늘지 않았다',
    afterRefusals.patients === before.patients,
    `${before.patients} → ${afterRefusals.patients}`
  );
  check(
    '거절 뒤 encounters 행이 늘지 않았다',
    afterRefusals.encounters === before.encounters,
    `${before.encounters} → ${afterRefusals.encounters}`
  );

  // -------------------------------------------------------------------------
  console.log('\n=== 4) 진짜 코드로 문진 완주 ===');
  const userRes = await admin(`/auth/v1/admin/users/${CLINICIAN}`);
  const user = await userRes.json();
  if (!userRes.ok) throw new Error(`admin user: ${JSON.stringify(user)}`);
  const accessToken = await clinicianAccessToken(user.email);
  const code = await issueCode(accessToken, 'main');
  check('코드는 7자다', code.code.length === 7);
  check('헷갈리는 글자가 없다 (0 O 1 I L B S U Z)', !/[0O1ILBSUZ]/.test(code.code));

  const started = await postJson('/api/intake/start', {
    kiosk: 'main',
    code: code.code,
    ...patientInfo('')
  });
  check('유효한 코드로 문진이 시작된다', started.status === 200, JSON.stringify(started.body).slice(0, 160));
  if (started.status !== 200) throw new Error('start failed');
  const encounterId = started.body.encounterId;
  check('세션 토큰이 발급된다', typeof started.body.token === 'string');
  console.log(`  encounter: ${encounterId}`);
  console.log(`  여는 질문: ${started.body.question}`);

  // 실제 Gemini 가 상대다. 몇 턴에 끝날지는 모델이 정하므로 상한만 둔다.
  const answers = [
    '이틀 전부터 오른쪽 눈 바깥쪽이 커튼처럼 가려 보입니다.',
    '통증은 없고, 눈앞에 까만 점들이 갑자기 늘었습니다.',
    '고혈압으로 약을 먹고 있고 다른 병은 없습니다.',
    '눈을 다친 적은 없습니다. 번쩍이는 빛이 가끔 보입니다.',
    '알레르기는 없습니다. 더 드릴 말씀은 없습니다.',
    '없습니다.',
    '없습니다.',
    '없습니다.'
  ];
  const dialogue = [{ role: 'agent', text: started.body.question }];
  let done = false;
  for (const answer of answers) {
    const turn = await postJson('/api/intake/turn', {
      encounterId,
      token: started.body.token,
      turns: dialogue,
      text: answer
    });
    if (turn.status !== 200) {
      check('문진 턴이 처리된다', false, `HTTP ${turn.status} ${JSON.stringify(turn.body).slice(0, 160)}`);
      break;
    }
    dialogue.push({ role: 'patient', text: answer });
    if (turn.body.done) {
      console.log(`  마무리: ${turn.body.message}`);
      done = true;
      break;
    }
    dialogue.push({ role: 'agent', text: turn.body.question });
    console.log(`  질문: ${turn.body.question}`);
  }
  check('문진이 끝까지 진행된다 (done)', done);

  // -------------------------------------------------------------------------
  console.log('\n=== 5) 실제 DB 에 남은 것 ===');
  const [encounter] = await rows(
    'encounters',
    `id=eq.${encounterId}&select=id,patient_id,user_id,status,chief_complaint,consent_privacy,consent_recording,consent_ai,consented_at,created_at`
  );
  console.log('  encounters:', JSON.stringify(encounter, null, 2));
  check('status = intake_done', encounter?.status === 'intake_done', encounter?.status);
  check('user_id = 담당 의사', encounter?.user_id === CLINICIAN, encounter?.user_id);
  check(
    '동의 3종이 저장됐다',
    encounter?.consent_privacy === true &&
      encounter?.consent_recording === true &&
      encounter?.consent_ai === true &&
      Boolean(encounter?.consented_at)
  );
  check('chief_complaint 이 채워졌다', Boolean(encounter?.chief_complaint), encounter?.chief_complaint);

  const [patient] = await rows(
    'patients',
    `id=eq.${encounter.patient_id}&select=id,user_id,name,birth_date,registration_no,created_at`
  );
  console.log('  patients:', JSON.stringify(patient, null, 2));
  check('patients.user_id = 담당 의사', patient?.user_id === CLINICIAN);

  const [result] = await rows(
    'intake_results',
    `encounter_id=eq.${encounterId}&select=id,encounter_id,soap_json,differentials_json,recommended_tests_json,created_at`
  );
  check('intake_results 행이 있다', Boolean(result));
  const soap = result?.soap_json ?? {};
  const differentials = result?.differentials_json ?? [];
  console.log('  intake_results.soap_json.s:', JSON.stringify(soap.s));
  console.log(`  transcript: ${Array.isArray(soap.transcript) ? soap.transcript.length : 0}턴`);
  console.log('  follow_up_questions:', JSON.stringify(soap.follow_up_questions, null, 2));
  console.log('  medical_terms:', JSON.stringify(soap.medical_terms, null, 2));
  console.log('  differentials_json:', JSON.stringify(differentials, null, 2));
  console.log('  recommended_tests_json:', JSON.stringify(result?.recommended_tests_json, null, 2));

  check('soap_json.transcript 가 대화 전문을 담는다', Array.isArray(soap.transcript) && soap.transcript.length >= 2);
  check(
    'transcript 에 환자 발화가 들어 있다',
    Array.isArray(soap.transcript) && soap.transcript.some((t) => t.role === 'patient')
  );
  check('follow_up_questions 가 있다', Array.isArray(soap.follow_up_questions) && soap.follow_up_questions.length > 0);
  check('medical_terms 가 있다', Array.isArray(soap.medical_terms) && soap.medical_terms.length > 0);
  check('differentials 가 있다', Array.isArray(differentials) && differentials.length > 0);
  check(
    '감별진단마다 name_en 이 있다 (M4 PubMed 검색어)',
    differentials.every((d) => typeof d.name_en === 'string' && d.name_en.trim() !== '')
  );
  check(
    '감별진단마다 supporting_findings 가 있다',
    differentials.every((d) => Array.isArray(d.supporting_findings))
  );

  console.log('\n=== 6) 코드는 죽었는가 (replay) ===');
  const beforeReplay = await countFor('encounters');
  const replay = await postJson('/api/intake/start', {
    kiosk: 'main',
    code: code.code,
    ...patientInfo('재사용')
  });
  const afterReplay = await countFor('encounters');
  check('끝난 코드는 거절된다', replay.status >= 400, `HTTP ${replay.status} "${replay.body.error ?? ''}"`);
  check('두 번째 진료가 만들어지지 않았다', afterReplay === beforeReplay, `${beforeReplay} → ${afterReplay}`);

  // -------------------------------------------------------------------------
  if (process.env.PROBE_KEEP === '1') {
    console.log('\n=== 7) 정리 생략 (PROBE_KEEP=1) ===');
    console.log(`  남은 행: encounter=${encounterId} patient=${patient.id} (이름 ${patient.name})`);
  } else {
    console.log('\n=== 7) 정리 — 프로브가 만든 행을 지운다 ===');
    await admin(`/rest/v1/intake_results?encounter_id=eq.${encounterId}`, { method: 'DELETE' });
    await admin(`/rest/v1/visit_access_codes?encounter_id=eq.${encounterId}`, { method: 'DELETE' });
    await admin(`/rest/v1/encounters?id=eq.${encounterId}`, { method: 'DELETE' });
    await admin(`/rest/v1/patients?user_id=eq.${CLINICIAN}&name=like.${PROBE_TAG}*`, { method: 'DELETE' });
    const left = await rows('patients', `user_id=eq.${CLINICIAN}&name=like.${PROBE_TAG}*&select=id`);
    const leftEnc = await rows('encounters', `id=eq.${encounterId}&select=id`);
    check('프로브가 만든 환자 행이 남지 않았다', left.length === 0, `${left.length}행`);
    check('프로브가 만든 진료 행이 남지 않았다', leftEnc.length === 0, `${leftEnc.length}행`);
    const end = { patients: await countFor('patients'), encounters: await countFor('encounters') };
    console.log(`  정리 후: patients=${end.patients} encounters=${end.encounters}`);
    check(
      '시작 전 개수로 돌아왔다',
      end.patients === before.patients && end.encounters === before.encounters,
      `patients ${before.patients}→${end.patients}, encounters ${before.encounters}→${end.encounters}`
    );
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}`);
};

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
