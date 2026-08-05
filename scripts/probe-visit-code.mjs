#!/usr/bin/env node
// L1 방문 코드 접근 통제 · AI 고지 · 하위 경로 배포 프로브.
//
// 검증 대상은 전부 **진짜로 도는 것들**이다:
//   - 실제 kiosk Next 서버 (dev, 그리고 base path 를 준 build 한 번)
//   - 로컬 Supabase 스택의 실제 마이그레이션 0009 (RPC · RLS · GRANT)
//   - 가짜 Gemini 서버 — 모델이 **몇 번 불렸는지**를 센다
//
// 이 프로브가 답해야 하는 질문:
//   1. 코드 없이 / 모르는 코드로 / 만료된 코드로 / 이미 쓴 코드로 문진을
//      시작하려 하면 거절되는가. 그리고 그때 **patients 0행, encounters 0행,
//      모델 호출 0회** 인가. (이게 L1 의 [HARD] 요구사항 전부다.)
//   2. 유효한 코드는 문진을 끝까지 완주시키고 대기목록에 올리는가.
//   3. 끝난 코드는 다시 쓸 수 없는가 (replay).
//   4. 담당 의사 귀속이 그대로인가 (user_id NOT NULL, RLS user_id=auth.uid()).
//   5. anon 키로 코드를 만들거나 읽을 수 있는가.
//   6. 환자가 처음 보는 화면의 payload 에 AI 고지가 들어 있는가.
//   7. base path 를 준 빌드가 그 경로에서 서비스되는가.
//
// 로컬 스택(포트 553xx)에만 붙는다. 실제 프로젝트는 건드리지 않는다.
//
// 실행:
//   supabase start
//   node scripts/probe-visit-code.mjs

import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';

const API = 'http://127.0.0.1:55321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const PASSWORD = 'probe-pass-123';

const LLM_PORT = 5601;
const KIOSK_PORT = 3121;
const KIOSK_BASED_PORT = 3122;
const BASE_PATH = '/righthand/patient';
const KIOSK = `http://127.0.0.1:${KIOSK_PORT}`;

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 가짜 Gemini — 호출 횟수를 센다
// ---------------------------------------------------------------------------
// 이 프로브의 핵심 단언 중 하나가 "거절된 접근은 모델을 부르지 않는다" 이다.
// 그걸 확인하려면 호출을 셀 수 있어야 하고, 그래서 kiosk 의 GEMINI_API_BASE
// 를 여기로 돌린다. 진짜 Gemini 로는 셀 수 없고 돈도 든다.
let llmCalls = 0;
/** 문진을 몇 턴 만에 끝낼지. 프로브는 짧게 끝낸다. */
let closeAfterTurns = 1;

function interviewTurnArgs(contents) {
  // 대화가 충분히 쌓였으면 done. contents 길이로 대충 센다.
  const done = contents.length >= closeAfterTurns * 2;
  return {
    done,
    message: done
      ? '말씀해 주셔서 감사합니다. 곧 진료실에서 뵙겠습니다.'
      : '언제부터 그런 증상이 있으셨나요?',
    danger: false,
    danger_reason: ''
  };
}

const RESULT_ARGS = {
  soap: {
    s: {
      chief_complaint: '오른쪽 눈 시야 가림',
      hpi: '이틀 전부터 오른쪽 눈 바깥쪽이 커튼처럼 가려 보인다고 함.',
      pmh: '고혈압',
      medications: '없음',
      allergies: '없음'
    },
    a: '아래는 감별진단 후보이며 확정 진단이 아니다. 망막박리를 우선 고려한다.',
    p: '안저검사를 우선 시행한다.'
  },
  differentials: [
    {
      rank: 1,
      name_kr: '망막박리',
      name_en: 'Retinal detachment',
      rationale: '커튼처럼 가려지는 시야 결손',
      supporting_findings: []
    },
    {
      rank: 2,
      name_kr: '유리체출혈',
      name_en: 'Vitreous hemorrhage',
      rationale: '갑작스러운 시야 변화',
      supporting_findings: []
    },
    {
      rank: 3,
      name_kr: '후유리체박리',
      name_en: 'Posterior vitreous detachment',
      rationale: '연령과 증상 양상',
      supporting_findings: []
    }
  ],
  recommended_tests: [
    { name_kr: '안저검사', name_en: 'Fundoscopy', reason: '망막 열공 확인' }
  ],
  follow_up_questions: [
    { question: '시야 결손이 상측인지 하측인지 확인', rationale: '망막박리 위치 감별' },
    { question: '외상 병력 확인', rationale: '외상성 원인 배제' },
    { question: '번쩍임 여부 확인', rationale: '견인 여부 판단' }
  ],
  medical_terms: [
    { term: '비문증', term_en: 'Floaters', definition: '눈앞에 무언가 떠다녀 보이는 증상입니다.' },
    { term: '망막', term_en: 'Retina', definition: '눈 안쪽에서 빛을 받아들이는 얇은 막입니다.' },
    { term: '안저검사', term_en: 'Fundoscopy', definition: '눈 안쪽을 들여다보는 검사입니다.' }
  ]
};

const llmServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    llmCalls += 1;
    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      /* 아래에서 빈 객체로 처리 */
    }
    const tool = parsed?.tools?.[0]?.functionDeclarations?.[0]?.name ?? '';
    const args =
      tool === 'record_intake_result'
        ? RESULT_ARGS
        : interviewTurnArgs(parsed?.contents ?? []);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ functionCall: { name: tool, args } }] }, finishReason: 'STOP' }
        ]
      })
    );
  });
});

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------
async function createUser(email) {
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json.id;
}

/** 앱과 같은 경로로 발급한다: authenticated 세션 + issue_visit_access_code RPC. */
async function issueCode(accessToken, slug = 'main') {
  const res = await fetch(`${API}/rest/v1/rpc/issue_visit_access_code`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_kiosk_slug: slug, p_ttl_seconds: null })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

async function signIn(email) {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json.access_token;
}

const rowCounts = (userId) => ({
  patients: sqlValue(`select count(*) from public.patients where user_id='${userId}'`),
  encounters: sqlValue(`select count(*) from public.encounters where user_id='${userId}'`)
});

async function startIntake(body) {
  const res = await fetch(`${KIOSK}/api/intake/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function spawnKiosk(port, basePath, mode) {
  return spawn(
    'npx',
    mode === 'dev'
      ? ['next', 'dev', '-p', String(port), '-H', '127.0.0.1']
      : ['next', 'start', '-p', String(port), '-H', '127.0.0.1'],
    {
      cwd: new URL('../kiosk', import.meta.url).pathname,
      env: {
        ...process.env,
        NODE_ENV: mode === 'dev' ? 'development' : 'production',
        SUPABASE_URL: API,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE,
        KIOSK_TOKEN_SECRET: 'probe-visit-code-token-secret-0123456789',
        KIOSK_CLINICIANS: process.env.PROBE_KIOSK_CLINICIANS,
        GEMINI_API_KEY: 'probe-key',
        GEMINI_API_BASE: `http://127.0.0.1:${LLM_PORT}`,
        ...(basePath ? { NEXT_PUBLIC_BASE_PATH: basePath } : {})
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      // 자체 프로세스 그룹으로 띄운다. `npx next dev` 는 실제 서버를 자식으로
      // 다시 낳기 때문에, npx 만 죽이면 포트를 쥔 손자가 살아남아 다음 실행이
      // EADDRINUSE 로 죽는다(실제로 겪었다).
      detached: true
    }
  );
}

async function waitForHttp(url, tries = 120) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      /* 아직 안 떴다 */
    }
    await sleep(500);
  }
  return false;
}

// ---------------------------------------------------------------------------
const children = [];
function cleanupChildren() {
  for (const c of children) {
    try {
      // 음수 pid = 프로세스 그룹 전체. next 가 낳은 실제 서버까지 같이 죽인다.
      process.kill(-c.pid, 'SIGKILL');
    } catch {
      /* 이미 죽었다 */
    }
  }
}

const main = async () => {
  const stamp = Date.now();
  const emailA = `visit-code-a-${stamp}@example.com`;
  const emailB = `visit-code-b-${stamp}@example.com`;

  console.log('\n=== 0) 준비: 임상의 2명 · 가짜 Gemini · 키오스크 서버 ===');
  const userA = await createUser(emailA);
  const userB = await createUser(emailB);
  process.env.PROBE_KIOSK_CLINICIANS = JSON.stringify({ main: userA, annex: userB });

  await new Promise((r) => llmServer.listen(LLM_PORT, '127.0.0.1', r));
  console.log(`  가짜 Gemini: http://127.0.0.1:${LLM_PORT}`);

  const kiosk = spawnKiosk(KIOSK_PORT, null, 'dev');
  children.push(kiosk);
  kiosk.stderr.on('data', (d) => {
    const line = String(d);
    if (/error|Error/.test(line)) process.stdout.write(`  [kiosk] ${line}`);
  });
  const up = await waitForHttp(`${KIOSK}/intake?k=main`);
  check('키오스크 서버가 떴다', up, KIOSK);
  if (!up) throw new Error('kiosk did not start');

  const tokenA = await signIn(emailA);
  const tokenB = await signIn(emailB);

  const baseline = rowCounts(userA);
  check(
    '시작 전 A 에게는 아무 행도 없다',
    baseline.patients === '0' && baseline.encounters === '0',
    `patients=${baseline.patients} encounters=${baseline.encounters}`
  );

  const infoOf = (suffix) => ({
    name: `프로브${suffix}`,
    birthDate: '1958-03-11',
    registrationNo: null,
    consents: { privacy: true, recording: true, ai: true }
  });

  // -------------------------------------------------------------------------
  console.log('\n=== 1) [HARD] 코드 없는 / 틀린 / 만료된 / 이미 쓴 코드 ===');
  console.log('     각 경우마다 patients 0행 · encounters 0행 · 모델 호출 0회 를 단언한다.');

  const cases = [];

  // (a) 코드 자체가 없다 — M6 시절의 요청 그대로다. 이게 통과하면 L1 은 없다.
  llmCalls = 0;
  const noCode = await startIntake({ kiosk: 'main', ...infoOf('무코드') });
  cases.push(['코드 없음', noCode, llmCalls]);

  // (b) 형식은 맞지만 존재하지 않는 코드.
  llmCalls = 0;
  const unknown = await startIntake({ kiosk: 'main', code: 'A2CD-4EF', ...infoOf('오타') });
  cases.push(['모르는 코드', unknown, llmCalls]);

  // (c) 만료된 코드. 발급 후 DB 에서 만료 시각만 과거로 민다.
  const expiredIssue = await issueCode(tokenA);
  sql(
    `update public.visit_access_codes set expires_at = now() - interval '1 minute', issued_at = now() - interval '2 hours' where id='${expiredIssue.id}'`
  );
  llmCalls = 0;
  const expired = await startIntake({
    kiosk: 'main',
    code: expiredIssue.code,
    ...infoOf('만료')
  });
  cases.push(['만료된 코드', expired, llmCalls]);

  // (d) 다른 의사에게 발급된 코드를 이 키오스크에서 쓴다. 귀속이 바뀌면
  //     안 되는 지점이라 별도로 본다.
  const foreignIssue = await issueCode(tokenB, 'annex');
  llmCalls = 0;
  const foreign = await startIntake({
    kiosk: 'main',
    code: foreignIssue.code,
    ...infoOf('타의사')
  });
  cases.push(['다른 의사의 코드', foreign, llmCalls]);

  for (const [label, result, calls] of cases) {
    const counts = rowCounts(userA);
    console.log(`  ── ${label}: HTTP ${result.status} "${result.body.error ?? ''}"`);
    check(`${label} — 거절된다`, result.status >= 400, `HTTP ${result.status}`);
    check(`${label} — patients 행이 만들어지지 않았다`, counts.patients === '0', `${counts.patients}행`);
    check(`${label} — encounters 행이 만들어지지 않았다`, counts.encounters === '0', `${counts.encounters}행`);
    check(`${label} — 모델을 부르지 않았다`, calls === 0, `${calls}회`);
    check(`${label} — 환자에게 한국어 안내가 간다`, typeof result.body.error === 'string' && result.body.error.length > 0);
  }

  const foreignCounts = rowCounts(userB);
  check(
    '다른 의사의 코드로도 그 의사 앞으로 행이 생기지 않았다',
    foreignCounts.patients === '0' && foreignCounts.encounters === '0',
    `patients=${foreignCounts.patients} encounters=${foreignCounts.encounters}`
  );

  // -------------------------------------------------------------------------
  console.log('\n=== 2) 유효한 코드 — 문진 완주 → 대기목록 ===');
  const good = await issueCode(tokenA);
  check('코드는 7자다', good.code.length === 7, good.code);
  check(
    '코드에 헷갈리는 글자가 없다 (0 O 1 I L B S U Z)',
    !/[0O1ILBSUZ]/.test(good.code),
    good.code
  );
  check('평문 코드는 DB 어디에도 없다', sqlValue(
    `select count(*) from public.visit_access_codes where encode(code_hash,'hex') like '%${good.code}%'`
  ) === '0');

  llmCalls = 0;
  closeAfterTurns = 1;
  const started = await startIntake({ kiosk: 'main', code: good.code, ...infoOf('정상') });
  check('유효한 코드로 문진이 시작된다', started.status === 200, `HTTP ${started.status}`);
  check('세션 토큰이 발급된다 (기존 HMAC 그대로)', typeof started.body.token === 'string');
  check('모델이 한 번 불렸다 (여는 질문)', llmCalls === 1, `${llmCalls}회`);

  const encounterId = started.body.encounterId;
  check(
    '코드가 그 진료에 묶였다',
    sqlValue(`select encounter_id from public.visit_access_codes where id='${good.id}'`) === encounterId
  );
  check(
    '코드가 소모 표시됐다',
    sqlValue(`select consumed_at is not null from public.visit_access_codes where id='${good.id}'`) === 't'
  );

  // 한 턴 답하고 종료까지.
  const turn = await fetch(`${KIOSK}/api/intake/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      encounterId,
      token: started.body.token,
      turns: [{ role: 'agent', text: started.body.question }],
      text: '이틀 전부터 오른쪽 눈이 커튼처럼 가려 보입니다.'
    })
  });
  const turnBody = await turn.json();
  check('문진이 끝까지 진행된다', turn.ok && turnBody.done === true, JSON.stringify(turnBody).slice(0, 120));

  check(
    '진료가 intake_done 이 됐다',
    sqlValue(`select status from public.encounters where id='${encounterId}'`) === 'intake_done'
  );
  check(
    '문진 결과가 저장됐다',
    sqlValue(`select count(*) from public.intake_results where encounter_id='${encounterId}'`) === '1'
  );

  // -------------------------------------------------------------------------
  console.log('\n=== 3) 담당 의사 귀속 ===');
  check(
    'encounters.user_id 가 그 의사다 (NOT NULL)',
    sqlValue(`select user_id from public.encounters where id='${encounterId}'`) === userA
  );
  const listA = await fetch(
    `${API}/rest/v1/encounters?id=eq.${encounterId}&select=id,user_id`,
    { headers: { apikey: ANON, Authorization: `Bearer ${tokenA}` } }
  );
  const listB = await fetch(
    `${API}/rest/v1/encounters?id=eq.${encounterId}&select=id,user_id`,
    { headers: { apikey: ANON, Authorization: `Bearer ${tokenB}` } }
  );
  check('A 는 자기 대기목록에서 이 진료를 본다 (RLS)', (await listA.json()).length === 1);
  check('B 에게는 보이지 않는다 (RLS user_id = auth.uid())', (await listB.json()).length === 0);

  // -------------------------------------------------------------------------
  console.log('\n=== 4) 재사용(replay) — 끝난 코드는 죽는다 ===');
  const before = rowCounts(userA);
  llmCalls = 0;
  const replay = await startIntake({ kiosk: 'main', code: good.code, ...infoOf('재사용') });
  const after = rowCounts(userA);
  console.log(`  재사용 시도: HTTP ${replay.status} "${replay.body.error ?? ''}"`);
  check('끝난 코드는 거절된다', replay.status >= 400, `HTTP ${replay.status}`);
  check('두 번째 진료가 만들어지지 않았다', after.encounters === before.encounters, `${before.encounters} → ${after.encounters}`);
  check('두 번째 환자가 만들어지지 않았다', after.patients === before.patients, `${before.patients} → ${after.patients}`);
  check('재사용 시도는 모델을 부르지 않았다', llmCalls === 0, `${llmCalls}회`);

  console.log('\n  ── 중단된 문진의 재개 (환자가 자리를 뜨거나 태블릿이 새로고침) ──');
  const resumable = await issueCode(tokenA);
  llmCalls = 0;
  const first = await startIntake({ kiosk: 'main', code: resumable.code, ...infoOf('중단') });
  check('첫 시작 성공', first.status === 200);
  const beforeResume = rowCounts(userA);
  const resumed = await startIntake({ kiosk: 'main', code: resumable.code, ...infoOf('중단') });
  const afterResume = rowCounts(userA);
  check('같은 코드로 다시 들어오면 이어진다', resumed.status === 200, `HTTP ${resumed.status}`);
  check(
    '이어질 때는 같은 진료다 — 새 행을 만들지 않는다',
    resumed.body.encounterId === first.body.encounterId &&
      afterResume.encounters === beforeResume.encounters,
    `${beforeResume.encounters} → ${afterResume.encounters}`
  );
  // 상한을 넘기면 멈춘다: 흘린 코드가 무한정 모델을 태우지 못하게.
  await startIntake({ kiosk: 'main', code: resumable.code, ...infoOf('중단') });
  const overLimit = await startIntake({ kiosk: 'main', code: resumable.code, ...infoOf('중단') });
  check('재개 횟수 상한을 넘으면 거절된다', overLimit.status >= 400, `HTTP ${overLimit.status}`);

  // -------------------------------------------------------------------------
  console.log('\n=== 5) 속도 제한 — 짧은 코드를 찍어 맞힐 수 있는가 ===');
  const limitBefore = sqlValue(
    `select coalesce(max(failures),0) from public.visit_access_code_attempts where user_id='${userA}'`
  );
  let rateLimited = 0;
  for (let i = 0; i < 30; i += 1) {
    const res = await fetch(`${KIOSK}/api/intake/code/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kiosk: 'main', code: 'A2CD4EF' })
    });
    if (res.status === 400) {
      const b = await res.json();
      if (String(b.error).includes('잠시 후')) rateLimited += 1;
    }
  }
  const limitAfter = sqlValue(
    `select coalesce(max(failures),0) from public.visit_access_code_attempts where user_id='${userA}'`
  );
  console.log(`  분당 실패 카운터: ${limitBefore} → ${limitAfter}`);
  check('실패가 DB 카운터에 쌓인다 (프로세스 밖에서 센다)', Number(limitAfter) > Number(limitBefore));
  check('한도를 넘으면 더 이상 시도를 받지 않는다', rateLimited > 0, `${rateLimited}회 차단`);
  check(
    '한도 이상으로는 세지 않는다 (분당 20)',
    Number(limitAfter) <= 21,
    `failures=${limitAfter}`
  );
  // [HARD] 속도 제한이 서비스 거부 지렛대가 되면 안 된다. 카운터가 꽉 찬
  // 상태에서도 **진짜 코드는 통과해야 한다** — 아니면 누구든 한 의원의
  // 문진 접수를 통째로 막을 수 있다.
  const duringAttack = await issueCode(tokenA);
  llmCalls = 0;
  const underAttack = await startIntake({
    kiosk: 'main',
    code: duringAttack.code,
    ...infoOf('공격중')
  });
  check(
    '카운터가 꽉 찬 동안에도 진짜 코드는 통과한다 (DoS 방지)',
    underAttack.status === 200,
    `HTTP ${underAttack.status} ${underAttack.body.error ?? ''}`
  );

  // -------------------------------------------------------------------------
  console.log('\n=== 6) 권한 — anon 키로 코드를 만들거나 읽을 수 있는가 ===');
  const anonIssue = await fetch(`${API}/rest/v1/rpc/issue_visit_access_code`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_kiosk_slug: 'main' })
  });
  check('anon 은 코드를 발급하지 못한다', anonIssue.status >= 400, `HTTP ${anonIssue.status}`);

  const anonRead = await fetch(`${API}/rest/v1/visit_access_codes?select=*`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }
  });
  const anonRows = await anonRead.json();
  check(
    'anon 은 코드를 읽지 못한다',
    anonRead.status >= 400 || (Array.isArray(anonRows) && anonRows.length === 0),
    `HTTP ${anonRead.status} ${JSON.stringify(anonRows).slice(0, 80)}`
  );

  const anonRedeem = await fetch(`${API}/rest/v1/rpc/redeem_visit_access_code`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_clinician_id: userA, p_code: 'A2CD4EF', p_kiosk_slug: 'main' })
  });
  check(
    'anon 은 소모 함수 자체를 부를 수 없다 (브라우저가 의사를 지목할 수 없다)',
    anonRedeem.status >= 400,
    `HTTP ${anonRedeem.status}`
  );

  const authRedeem = await fetch(`${API}/rest/v1/rpc/redeem_visit_access_code`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_clinician_id: userA, p_code: 'A2CD4EF', p_kiosk_slug: 'main' })
  });
  check(
    '로그인한 사용자도 소모 함수를 부를 수 없다 (service_role 전용)',
    authRedeem.status >= 400,
    `HTTP ${authRedeem.status}`
  );

  // B 도 자기 코드를 하나 갖고 있으므로(1장의 "다른 의사의 코드") 필터 없이
  // 세면 자기 행을 남의 행으로 착각한다. A 의 행만 물어본다.
  const bRead = await fetch(
    `${API}/rest/v1/visit_access_codes?user_id=eq.${userA}&select=id,user_id`,
    { headers: { apikey: ANON, Authorization: `Bearer ${tokenB}` } }
  );
  const bRows = await bRead.json();
  check('B 는 A 의 코드를 읽지 못한다 (RLS)', Array.isArray(bRows) && bRows.length === 0, JSON.stringify(bRows).slice(0, 80));
  const aRead = await fetch(
    `${API}/rest/v1/visit_access_codes?user_id=eq.${userA}&select=id`,
    { headers: { apikey: ANON, Authorization: `Bearer ${tokenA}` } }
  );
  check('A 는 자기 코드를 읽는다 (발급 화면이 쓴다)', (await aRead.json()).length > 0);

  const insertForge = await fetch(`${API}/rest/v1/visit_access_codes`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userA,
      code_salt: '\\x00000000000000000000000000000000',
      code_hash: '\\x' + '00'.repeat(32),
      issued_by: userB,
      expires_at: new Date(Date.now() + 3600_000).toISOString()
    })
  });
  check(
    '클라이언트의 직접 INSERT 가 막힌다 (남의 이름으로 코드 위조)',
    insertForge.status >= 400,
    `HTTP ${insertForge.status}`
  );

  const attemptsRead = await fetch(`${API}/rest/v1/visit_access_code_attempts?select=*`, {
    headers: { apikey: ANON, Authorization: `Bearer ${tokenA}` }
  });
  check(
    '속도 제한 카운터는 클라이언트에게 보이지 않는다',
    attemptsRead.status >= 400,
    `HTTP ${attemptsRead.status}`
  );

  // -------------------------------------------------------------------------
  console.log('\n=== 7) AI 고지 — 환자가 처음 보는 화면의 payload ===');
  const page = await (await fetch(`${KIOSK}/intake?k=main`)).text();
  const mustContain = [
    '사람이 아니라 AI',
    '진단이 아닙니다',
    '담당 의사가 직접 읽고 확인합니다',
    '문진을 멈추고 직원을 불러',
    '기다리지 마십시오'
  ];
  for (const phrase of mustContain) {
    check(`첫 화면 payload 에 "${phrase}" 가 있다`, page.includes(phrase));
  }
  check(
    '코드 입력 화면이 첫 화면이다 (QR 없이 들어온 환자)',
    page.includes('접수 코드를 입력해 주세요')
  );

  // QR 로 들어온 환자(유효한 코드가 URL 에)는 동의 화면부터 시작하고,
  // 거기에도 같은 고지가 있어야 한다.
  const qrCode = await issueCode(tokenA);
  const qrPage = await (
    await fetch(`${KIOSK}/intake?k=main&c=${qrCode.code}`)
  ).text();
  check('QR 로 들어오면 코드 입력을 건너뛴다', qrPage.includes('문진 시작 전 동의'));
  for (const phrase of mustContain) {
    check(`QR 첫 화면에도 "${phrase}" 가 있다`, qrPage.includes(phrase));
  }
  check(
    'URL 의 코드를 미리 확인만 하고 소모하지는 않는다',
    sqlValue(`select consumed_at is null from public.visit_access_codes where id='${qrCode.id}'`) === 't'
  );

  const badQrPage = await (await fetch(`${KIOSK}/intake?k=main&c=AAAAAAA`)).text();
  check('URL 의 코드가 틀리면 코드 입력 화면으로 떨어진다', badQrPage.includes('접수 코드를 입력해 주세요'));

  check(
    '담당 의사 uuid 는 화면 payload 에 내려가지 않는다',
    !page.includes(userA) && !qrPage.includes(userA)
  );

  // -------------------------------------------------------------------------
  console.log('\n=== 8) 하위 경로 배포 (basePath) ===');
  console.log('  build 중…');
  execFileSync('npx', ['next', 'build'], {
    cwd: new URL('../kiosk', import.meta.url).pathname,
    env: { ...process.env, NEXT_PUBLIC_BASE_PATH: BASE_PATH },
    stdio: 'ignore'
  });
  const based = spawnKiosk(KIOSK_BASED_PORT, BASE_PATH, 'start');
  children.push(based);
  const basedUrl = `http://127.0.0.1:${KIOSK_BASED_PORT}${BASE_PATH}`;
  const basedUp = await waitForHttp(`${basedUrl}/intake?k=main`);
  check('base path 를 준 빌드가 그 경로에서 뜬다', basedUp, basedUrl);

  if (basedUp) {
    const basedPage = await (await fetch(`${basedUrl}/intake?k=main`)).text();
    check('하위 경로에서도 코드 입력 화면이 나온다', basedPage.includes('접수 코드를 입력해 주세요'));
    check('하위 경로에서도 AI 고지가 나온다', basedPage.includes('사람이 아니라 AI'));
    // 클라이언트의 fetch 경로는 런타임에 문자열을 이어붙여 만들어지므로
    // HTML 에 완성된 문자열로 들어 있지 않다. 대신 (1) Next 가 정적 자원에
    // base path 를 붙였는지, (2) 그 값이 클라이언트 번들에 실제로 실렸는지,
    // (3) 그리고 무엇보다 **그 경로에서 문진이 실제로 시작되는지** 를 본다.
    check(
      '정적 자원에 base path 가 붙는다',
      basedPage.includes(`${BASE_PATH}/_next/`),
      `${BASE_PATH}/_next/`
    );
    // HTML 이 참조하는 청크를 전부 훑는다. 첫 청크만 보면 프레임워크 청크를
    // 집어서 "없다" 는 잘못된 결론을 낸다(실제로 그랬다).
    const chunks = [
      ...new Set(basedPage.match(new RegExp(`${BASE_PATH}/_next/static/[^"']+\\.js`, 'g')) ?? [])
    ];
    let carriesBasePath = false;
    for (const rel of chunks) {
      const js = await (await fetch(`http://127.0.0.1:${KIOSK_BASED_PORT}${rel}`)).text();
      if (js.includes(`"${BASE_PATH}"`) || js.includes(`'${BASE_PATH}'`)) {
        carriesBasePath = true;
        break;
      }
    }
    check(
      '클라이언트 번들이 base path 값을 들고 있다 (fetch 접두용)',
      carriesBasePath,
      `${chunks.length}개 청크 검사`
    );
    const basedCode = await issueCode(tokenA);
    const basedStart = await fetch(`${basedUrl}/api/intake/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kiosk: 'main', code: basedCode.code, ...infoOf('하위경로') })
    });
    check(
      '하위 경로에서 문진이 실제로 시작된다',
      basedStart.status === 200,
      `HTTP ${basedStart.status}`
    );
    const basedApi = await fetch(`${basedUrl}/api/intake/code/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kiosk: 'main', code: 'A2CD4EF' })
    });
    check('하위 경로의 API 라우트가 응답한다', basedApi.status === 400, `HTTP ${basedApi.status}`);
    const rootApi = await fetch(`http://127.0.0.1:${KIOSK_BASED_PORT}/api/intake/code/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kiosk: 'main', code: 'A2CD4EF' })
    });
    check('루트 경로로는 더 이상 열리지 않는다', rootApi.status === 404, `HTTP ${rootApi.status}`);
  }

  // -------------------------------------------------------------------------
  console.log('\n=== 9) 정리 ===');
  sql(`delete from public.visit_access_codes where user_id in ('${userA}','${userB}')`);
  sql(`delete from public.visit_access_code_attempts where user_id in ('${userA}','${userB}')`);
  sql(`delete from auth.users where id in ('${userA}','${userB}')`);

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}`);
};

main()
  .then(() => {
    cleanupChildren();
    llmServer.close();
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    cleanupChildren();
    llmServer.close();
    process.exit(1);
  });
