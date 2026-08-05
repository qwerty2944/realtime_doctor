#!/usr/bin/env node
// E3(사실/해석 분리 + 출처 부착) + 결정 감사 추적(6장) 프로브.
//
// 검증 대상은 전부 **진짜로 도는 것들**이다:
//   - 실제 kiosk Next 서버 (dev) + 방문 코드 → 문진 완주까지의 실제 경로
//   - 가짜 Gemini 서버 (키오스크와 데스크톱 둘 다 여기로 보낸다)
//   - 로컬 스택의 실제 마이그레이션 0010 / 0011 / 0012
//   - src/main/analyzer.ts      실시간 분석 (진짜 analyzer 를 돌린다)
//   - src/main/patients.ts      loadPatientDetail
//   - src/main/decisionTrail.ts 감사 추적 기록기
//   - src/renderer/shared/patientMode.ts  구버전 행이 여전히 그려지는지
//
// 이 프로브가 답해야 하는 질문:
//   1. 키오스크가 만든 해석에 출처가 붙는가. 사실 지문은 DB 가 계산하는가.
//   2. 실시간(데스크톱) 해석에도 같은 출처가 붙는가.
//   3. 재해석이 **대체**인가 **덮어쓰기**인가. 사실이 보존되는가.
//   4. 출처 없는 구버전 행이 여전히 렌더되는가.
//   5. 감사 추적이 실제 문진 → 의사가 환자를 여는 흐름을 기록하는가.
//   6. 로그인한 클라이언트가 그 기록을 고치거나 지울 수 있는가. (불가여야 한다)
//   7. anon 이 새 RPC 들을 부를 수 있는가. (불가여야 한다)
//   8. RLS 가 임상의 A 와 B 를 갈라놓는가.
//   9. 0010 이후 public 스키마에 PUBLIC EXECUTE 가 남아 있는가. (0건이어야 한다)
//  10. 0013 의 권한 감사가 **실제로 울리는가**. 조용한 가드는 증거가 아니므로
//      진짜 구멍(anon EXECUTE / anon TRUNCATE / authenticated SELECT)을 뚫어
//      놓고 잡아내는지 확인하고, 같은 구멍을 0010 의 옛 가드가 못 본다는 것도
//      함께 보인다.
//
// 로컬 스택(포트 553xx)에만 붙는다. 실제 프로젝트는 건드리지 않는다.
//
// 실행:
//   supabase start
//   node --import ./scripts/probe-findings-register.mjs scripts/probe-provenance.mjs

import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';

const API = 'http://127.0.0.1:55321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const PASSWORD = 'probe-pass-123';

const LLM_PORT = 5611;
const KIOSK_PORT = 3131;
const KIOSK = `http://127.0.0.1:${KIOSK_PORT}`;

// 데스크톱 analyzer 도 같은 가짜 모델로 보낸다. import 전에 세워야 한다 —
// geminiClient 가 인스턴스를 캐시한다.
process.env.SUPABASE_URL = API;
process.env.SUPABASE_PUBLISHABLE_KEY = ANON;
process.env.GEMINI_API_KEY = 'probe-key';
process.env.GEMINI_API_BASE = `http://127.0.0.1:${LLM_PORT}`;
process.env.GEMINI_ANALYZER_MODEL = 'probe-analyzer-model';

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
const esc = (s) => String(s).replaceAll("'", "''");

// ---------------------------------------------------------------------------
// 0013 권한 감사 스크립트를 "있는 그대로" 돌린다
// ---------------------------------------------------------------------------
// 프로브가 감사 쿼리를 따로 베껴 들고 있으면, 베낀 쪽만 맞고 실제로 운영에
// 돌릴 파일은 틀린 상태가 될 수 있다. 그래서 검사 대상을 재구현하지 않고
// supabase/audit/named-role-privileges.sql 을 통째로 psql 에 먹인다 —
// 오케스트레이터가 운영 프로젝트에 돌릴 바로 그 파일이다.
const AUDIT_SQL = readFileSync(
  new URL('../supabase/audit/named-role-privileges.sql', import.meta.url),
  'utf8'
);

function runPrivilegeAudit() {
  // psql 의 NOTICE(통과 메시지)는 stderr 로 나간다. 컨테이너 안에서 2>&1 로
  // 합쳐야 성공 경로의 출력까지 볼 수 있다 — 성공을 눈으로 확인할 수 없는
  // 검사는 이 파일이 고치려는 문제와 같은 문제다.
  try {
    const out = execFileSync(
      'docker',
      [
        'exec', '-i', 'supabase_db_realtime_doctor',
        'sh', '-c',
        'psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - 2>&1'
      ],
      { encoding: 'utf8', input: AUDIT_SQL, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return { ok: true, output: out };
  } catch (err) {
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

// ---------------------------------------------------------------------------
// 가짜 Gemini — 키오스크 문진과 데스크톱 실시간 분석을 모두 받는다
// ---------------------------------------------------------------------------
let llmCalls = 0;

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
      supporting_findings: [{ finding: '커튼처럼 가려 보인다', source: '#1' }]
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

/** 데스크톱 analyzer 가 기대하는 JSON 응답 (도구 호출이 아니라 responseSchema). */
const LIVE_ANALYSIS = {
  differentialDiagnoses: [
    {
      name: '결막염',
      nameEn: 'Conjunctivitis',
      icd10: 'H10',
      reasoning: '충혈과 분비물',
      supportingFindings: [{ finding: '오른쪽 눈이 빨갛다', source: '#1' }]
    }
  ],
  medicalTerms: [],
  suggestedQuestions: [],
  redFlags: []
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
      /* 빈 객체로 처리 */
    }
    // 데스크톱 analyzer 는 도구를 쓰지 않고 responseSchema + JSON 텍스트다.
    if (parsed?.generationConfig?.responseSchema) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(LIVE_ANALYSIS) }] }, finishReason: 'STOP' }
          ]
        })
      );
      return;
    }
    const tool = parsed?.tools?.[0]?.functionDeclarations?.[0]?.name ?? '';
    const contents = parsed?.contents ?? [];
    const args =
      tool === 'record_intake_result'
        ? RESULT_ARGS
        : {
            done: contents.length >= 2,
            message:
              contents.length >= 2
                ? '말씀해 주셔서 감사합니다. 곧 진료실에서 뵙겠습니다.'
                : '언제부터 그런 증상이 있으셨나요?',
            danger: false,
            danger_reason: ''
          };
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

async function issueCode(accessToken, slug = 'main') {
  const res = await fetch(`${API}/rest/v1/rpc/issue_visit_access_code`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_kiosk_slug: slug, p_ttl_seconds: null })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

/** REST 한 방. 상태코드와 본문을 함께 돌려준다 (권한 단언용). */
async function rest(path, { token, method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

function spawnKiosk(port) {
  return spawn('npx', ['next', 'dev', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: new URL('../kiosk', import.meta.url).pathname,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      SUPABASE_URL: API,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE,
      KIOSK_TOKEN_SECRET: 'probe-provenance-token-secret-0123456789',
      KIOSK_CLINICIANS: process.env.PROBE_KIOSK_CLINICIANS,
      GEMINI_API_KEY: 'probe-key',
      GEMINI_API_BASE: `http://127.0.0.1:${LLM_PORT}`,
      GEMINI_MODEL: 'probe-intake-model'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });
}

async function waitForHttp(url, tries = 120) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      /* 아직 */
    }
    await sleep(500);
  }
  return false;
}

const children = [];
function cleanupChildren() {
  for (const c of children) {
    try {
      process.kill(-c.pid, 'SIGKILL');
    } catch {
      /* 이미 죽었다 */
    }
  }
}

// ---------------------------------------------------------------------------
const main = async () => {
  const stamp = Date.now();
  const emailA = `prov-a-${stamp}@example.com`;
  const emailB = `prov-b-${stamp}@example.com`;

  console.log('\n=== 0) 준비: 임상의 2명 · 가짜 Gemini · 키오스크 서버 ===');
  const userA = await createUser(emailA);
  const userB = await createUser(emailB);
  process.env.PROBE_KIOSK_CLINICIANS = JSON.stringify({ main: userA, annex: userB });

  await new Promise((r) => llmServer.listen(LLM_PORT, '127.0.0.1', r));
  console.log(`  가짜 Gemini: http://127.0.0.1:${LLM_PORT} (키오스크 + 데스크톱 공용)`);

  const kiosk = spawnKiosk(KIOSK_PORT);
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

  // -------------------------------------------------------------------------
  console.log('\n=== 1) 키오스크가 만든 해석에 출처가 붙는가 (E3) ===');
  const code = await issueCode(tokenA);
  llmCalls = 0;
  const startRes = await fetch(`${KIOSK}/api/intake/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kiosk: 'main',
      code: code.code,
      name: '프로브출처',
      birthDate: '1958-03-11',
      registrationNo: null,
      consents: { privacy: true, recording: true, ai: true }
    })
  });
  const started = await startRes.json();
  check('유효한 코드로 문진이 시작된다', startRes.ok, `HTTP ${startRes.status}`);
  const encounterId = started.encounterId;

  const turnRes = await fetch(`${KIOSK}/api/intake/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      encounterId,
      token: started.token,
      turns: [{ role: 'agent', text: started.question }],
      text: '이틀 전부터 오른쪽 눈이 커튼처럼 가려 보입니다.'
    })
  });
  const turnBody = await turnRes.json();
  check('문진이 끝까지 진행된다', turnRes.ok && turnBody.done === true, JSON.stringify(turnBody).slice(0, 120));

  const prov = JSON.parse(
    sqlValue(
      `select interpretation_provenance::text from public.intake_results where encounter_id='${encounterId}'`
    )
  );
  console.log(`  저장된 출처: ${JSON.stringify(prov)}`);
  check('engine 이 kiosk-intake 다', prov.engine === 'kiosk-intake', prov.engine);
  check('실제로 부른 모델 id 가 들어간다', prov.model === 'probe-intake-model', prov.model);
  check('프로바이더가 들어간다', prov.provider === 'gemini', prov.provider);
  check('프롬프트 버전이 들어간다', Number.isInteger(prov.promptVersion), String(prov.promptVersion));
  check('스키마 버전이 들어간다', Number.isInteger(prov.schemaVersion), String(prov.schemaVersion));
  check('생성 시각이 파싱 가능한 ISO 8601 이다', !Number.isNaN(Date.parse(prov.generatedAt)), prov.generatedAt);

  const fp1 = sqlValue(
    `select facts_fingerprint from public.intake_results where encounter_id='${encounterId}'`
  );
  check('사실 지문이 채워졌다', /^[0-9a-f]{64}$/.test(fp1), fp1);
  check(
    '지문이 DB 함수의 계산과 일치한다',
    sqlValue(
      `select public.intake_facts_fingerprint(soap_json) from public.intake_results where encounter_id='${encounterId}'`
    ) === fp1
  );

  console.log('\n  ── 지문은 클라이언트가 주장할 수 없다 ──');
  // service_role 로 거짓 지문을 실어 직접 INSERT 해도 트리거가 덮어쓴다.
  const forgedRowId = sqlValue(
    `insert into public.intake_results (encounter_id, soap_json, version, facts_fingerprint)
     values ('${encounterId}', '{"transcript":[],"s":{}}'::jsonb, 99, 'deadbeef')
     returning id`
  );
  check(
    '거짓 지문을 실어 INSERT 해도 DB 가 다시 계산한다',
    sqlValue(`select facts_fingerprint from public.intake_results where id='${forgedRowId}'`) !== 'deadbeef',
    sqlValue(`select facts_fingerprint from public.intake_results where id='${forgedRowId}'`)
  );
  sql(`delete from public.intake_results where id='${forgedRowId}'`);

  // -------------------------------------------------------------------------
  console.log('\n=== 2) 실시간(데스크톱) 해석에도 같은 출처가 붙는가 ===');
  const { analyzer } = await import('../src/main/analyzer.ts');
  const liveResult = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('analyzer timeout')), 20_000);
    const off = analyzer.on((r) => {
      clearTimeout(timer);
      off();
      resolve(r);
    });
    analyzer.push({ id: 'u0', text: '어디가 불편하세요?', timestamp: 0, speaker: 'doctor' });
    analyzer.push({ id: 'u1', text: '오른쪽 눈이 빨갛습니다.', timestamp: 1000, speaker: 'patient' });
    analyzer.runNow();
  });
  console.log(`  실시간 출처: ${JSON.stringify(liveResult.provenance)}`);
  check('engine 이 desktop-live-analysis 다', liveResult.provenance?.engine === 'desktop-live-analysis');
  check(
    '실제로 부른 모델 id 가 들어간다',
    liveResult.provenance?.model === 'probe-analyzer-model',
    liveResult.provenance?.model
  );
  const { parseProvenance, isRecordedProvenance, describeProvenance } = await import(
    '../src/shared/provenance.ts'
  );
  check(
    '키오스크와 실시간의 출처 키 집합이 같다',
    JSON.stringify(Object.keys(prov).sort()) ===
      JSON.stringify(Object.keys(liveResult.provenance).sort()),
    `${Object.keys(prov).sort().join(',')} / ${Object.keys(liveResult.provenance).sort().join(',')}`
  );
  check(
    '공용 파서가 두 출처를 모두 "기록됨" 으로 받는다',
    isRecordedProvenance(parseProvenance(prov)) &&
      isRecordedProvenance(parseProvenance(liveResult.provenance))
  );

  // -------------------------------------------------------------------------
  console.log('\n=== 3) 재해석은 대체인가 덮어쓰기인가 ===');
  const originalId = sqlValue(
    `select id from public.intake_results where encounter_id='${encounterId}' order by version desc limit 1`
  );
  const originalSoap = sqlValue(
    `select soap_json::text from public.intake_results where id='${originalId}'`
  );
  const originalDiff = sqlValue(
    `select differentials_json::text from public.intake_results where id='${originalId}'`
  );

  const newInterpretation = {
    a: '재해석: 유리체출혈을 우선 고려한다. 확정 진단이 아니다.',
    differentials: [
      {
        rank: 1,
        name_kr: '유리체출혈',
        name_en: 'Vitreous hemorrhage',
        rationale: '재해석 모델의 판단',
        supporting_findings: []
      }
    ]
  };
  const newProv = {
    engine: 'kiosk-intake',
    provider: 'gemini',
    model: 'probe-intake-model-v2',
    promptVersion: 2,
    schemaVersion: 1,
    generatedAt: new Date().toISOString()
  };
  const rederived = await rest('rpc/rederive_intake_interpretation', {
    token: SERVICE,
    method: 'POST',
    body: {
      p_source_id: originalId,
      p_interpretation: newInterpretation,
      p_provenance: newProv
    }
  });
  check('service_role 은 재해석할 수 있다', rederived.status === 200, JSON.stringify(rederived.body).slice(0, 160));
  const newId = rederived.body?.id;
  check('DB 가 사실 보존을 스스로 확인해 돌려준다', rederived.body?.factsPreserved === true);

  check(
    '원본의 soap_json 이 바이트 그대로다',
    sqlValue(`select soap_json::text from public.intake_results where id='${originalId}'`) === originalSoap
  );
  check(
    '원본의 differentials_json 이 바이트 그대로다',
    sqlValue(`select differentials_json::text from public.intake_results where id='${originalId}'`) === originalDiff
  );
  check(
    '원본이 대체 표시됐고 대체한 행을 가리킨다',
    sqlValue(
      `select superseded_at is not null and superseded_by='${newId}' from public.intake_results where id='${originalId}'`
    ) === 't'
  );
  check(
    '새 행은 version 이 하나 올라갔다',
    Number(sqlValue(`select version from public.intake_results where id='${newId}'`)) >
      Number(sqlValue(`select version from public.intake_results where id='${originalId}'`))
  );
  check(
    '새 행이 사실을 어디서 가져왔는지 가리킨다',
    sqlValue(`select derived_from_id from public.intake_results where id='${newId}'`) === originalId
  );
  check(
    '사실 지문이 원본과 같다 (기록이 고쳐지지 않았다)',
    sqlValue(`select facts_fingerprint from public.intake_results where id='${newId}'`) === fp1
  );
  check(
    '대화 전문이 원본과 동일하다',
    sqlValue(`select soap_json->'transcript' from public.intake_results where id='${newId}'`) ===
      sqlValue(`select soap_json->'transcript' from public.intake_results where id='${originalId}'`)
  );
  check(
    '해석은 실제로 바뀌었다',
    sqlValue(`select differentials_json->0->>'name_kr' from public.intake_results where id='${newId}'`) ===
      '유리체출혈'
  );
  check(
    '새 행의 출처가 새 모델을 말한다',
    JSON.parse(
      sqlValue(`select interpretation_provenance::text from public.intake_results where id='${newId}'`)
    ).model === 'probe-intake-model-v2'
  );

  const twice = await rest('rpc/rederive_intake_interpretation', {
    token: SERVICE,
    method: 'POST',
    body: { p_source_id: originalId, p_interpretation: newInterpretation, p_provenance: newProv }
  });
  check('이미 대체된 행은 다시 대체할 수 없다', twice.status >= 400, `HTTP ${twice.status}`);

  const noProv = await rest('rpc/rederive_intake_interpretation', {
    token: SERVICE,
    method: 'POST',
    body: { p_source_id: newId, p_interpretation: newInterpretation, p_provenance: {} }
  });
  check('출처 없는 재해석은 거절된다', noProv.status >= 400, `HTTP ${noProv.status}`);

  // -------------------------------------------------------------------------
  console.log('\n=== 4) 출처 없는 구버전 행도 여전히 렌더되는가 ===');
  const legacyPatient = sqlValue(
    `insert into public.patients (user_id, name, birth_date) values ('${userA}','구버전환자','1950-01-01') returning id`
  );
  const legacyEncounter = sqlValue(
    `insert into public.encounters (user_id, patient_id, status, red_flag) values ('${userA}','${legacyPatient}','intake_done', false) returning id`
  );
  // 0011 이전 모습 그대로: 출처 컬럼을 아예 건드리지 않는다.
  const legacySoap = JSON.stringify({
    s: { chief_complaint: '눈 충혈', hpi: '사흘 전부터 충혈' },
    o: '진찰 소견 대기',
    a: '결막염 의심',
    p: '세극등검사',
    transcript: [
      { role: 'agent', text: '어떤 불편함으로 오셨나요?' },
      { role: 'patient', text: '사흘 전부터 오른쪽 눈이 빨갛습니다.' }
    ]
  });
  const legacyDiff = JSON.stringify([
    {
      rank: 1,
      name_kr: '세균성 결막염',
      name_en: 'Bacterial conjunctivitis',
      rationale: '충혈과 분비물',
      supporting_findings: [{ finding: '오른쪽 눈이 빨갛다', source: '#1' }]
    }
  ]);
  sql(
    `insert into public.intake_results (encounter_id, soap_json, differentials_json, version)
     values ('${legacyEncounter}','${esc(legacySoap)}'::jsonb,'${esc(legacyDiff)}'::jsonb, 1)`
  );

  const auth = await import('../src/main/auth.ts');
  const patients = await import('../src/main/patients.ts');
  const { getSupabase } = await import('../src/main/supabaseClient.ts');
  auth.setAuthCallbacks({
    broadcast: () => undefined,
    onSignedIn: () => undefined,
    onSignedOut: () => undefined
  });
  const supabase = getSupabase();
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: emailA,
    password: PASSWORD
  });
  if (signInErr) throw new Error(signInErr.message);
  for (let i = 0; i < 50 && !auth.getCurrentUser(); i += 1) await sleep(100);
  check('데스크톱이 A 로 로그인했다', auth.getCurrentUser()?.id === userA);

  const legacyDetail = await patients.loadPatientDetail(legacyEncounter);
  check('구버전 행도 그대로 읽힌다', !!legacyDetail?.intakeResult, legacyDetail?.patient.name);
  check(
    '출처는 "미기록" 이라는 값으로 온다 (undefined 가 아니다)',
    legacyDetail.intakeResult.provenance?.engine === 'unrecorded',
    JSON.stringify(legacyDetail.intakeResult.provenance)
  );
  check(
    '화면 문구가 침묵하지 않는다',
    describeProvenance(legacyDetail.intakeResult.provenance) === '출처 미기록',
    describeProvenance(legacyDetail.intakeResult.provenance)
  );
  const patientMode = await import('../src/renderer/shared/patientMode.ts');
  const legacyPart = patientMode.patientDifferentialsPartitioned(legacyDetail);
  check(
    'M3 리더가 여전히 감별진단을 그린다 (E1 경로 무손상)',
    legacyPart.supported.length === 1 && legacyPart.supported[0].name === '세균성 결막염',
    `supported=${legacyPart.supported.length} unverified=${legacyPart.unverified.length}`
  );
  check(
    '근거 인용도 그대로 해석된다',
    legacyPart.supported[0].supportingFindings[0]?.quote === '사흘 전부터 오른쪽 눈이 빨갛습니다.'
  );
  const legacySummary = patientMode.patientSummary(legacyDetail);
  check('요약 매퍼도 살아 있다', legacySummary?.chiefComplaint === '눈 충혈', legacySummary?.chiefComplaint);

  // 반쯤 채워진 출처는 출처가 아니다.
  sql(
    `update public.intake_results set interpretation_provenance='{"engine":"kiosk-intake","model":"x"}'::jsonb where encounter_id='${legacyEncounter}'`
  );
  const halfDetail = await patients.loadPatientDetail(legacyEncounter);
  check(
    '반쯤 채워진 출처는 "미기록" 으로 떨어진다',
    halfDetail.intakeResult.provenance?.engine === 'unrecorded',
    JSON.stringify(halfDetail.intakeResult.provenance)
  );

  // -------------------------------------------------------------------------
  console.log('\n=== 5) 감사 추적: 실제 인계 흐름 (6장) ===');
  const detail = await patients.loadPatientDetail(encounterId);
  check('의사가 문진 환자의 상세를 연다', !!detail?.intakeResult, detail?.patient.name);
  check(
    '읽어온 해석은 재해석된 최신본이다',
    detail.intakeResult.id === newId && detail.intakeResult.derivedFromId === originalId
  );

  const trail = await import('../src/main/decisionTrail.ts');
  trail.recordPatientDetailOpened(detail);
  trail.recordInterpretationPresented(detail);
  trail.recordDifferentialExpanded({
    encounterId,
    intakeResultId: detail.intakeResult.id,
    diagnosis: '유리체출혈'
  });
  trail.recordEvidenceRequested({
    encounterId,
    intakeResultId: detail.intakeResult.id,
    diagnosis: '유리체출혈'
  });
  trail.recordFindingSourceOpened({
    encounterId,
    intakeResultId: detail.intakeResult.id,
    utteranceId: 'intake-1'
  });
  trail.recordSummaryGenerated({
    encounterId,
    intakeResultId: detail.intakeResult.id,
    sessionId: null
  });
  // fire-and-forget 이라 기록이 도착할 시간을 준다.
  await sleep(1500);

  const types = sql(
    `select event_type from public.clinical_decision_events where encounter_id='${encounterId}' order by event_type`
  )
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  console.log(`  기록된 이벤트: ${types.join(', ')}`);
  for (const expected of [
    'interpretation_presented',
    'patient_detail_opened',
    'differential_expanded',
    'evidence_requested',
    'finding_source_opened',
    'summary_generated'
  ]) {
    check(`${expected} 가 기록됐다`, types.includes(expected));
  }

  const shown = JSON.parse(
    sqlValue(
      `select payload::text from public.clinical_decision_events where encounter_id='${encounterId}' and event_type='interpretation_presented'`
    )
  );
  console.log(`  무엇을 보여줬는가: ${JSON.stringify(shown).slice(0, 220)}`);
  check('보여준 감별진단 목록이 남는다', Array.isArray(shown.differentials) && shown.differentials.length > 0);
  check('추천검사가 남는다', Array.isArray(shown.recommendedTests));
  check('red flag 가 남는다', typeof shown.redFlag === 'boolean');
  check('그 순간의 출처가 함께 얼어붙는다', shown.provenance?.model === 'probe-intake-model-v2', shown.provenance?.model);
  check('사람이 읽는 출처 문구도 함께 남는다', typeof shown.provenanceLabel === 'string' && shown.provenanceLabel.length > 0, shown.provenanceLabel);
  check('사실 지문이 함께 남는다', shown.factsFingerprint === fp1);

  const firstOpened = sqlValue(
    `select min(occurred_at) from public.clinical_decision_events where encounter_id='${encounterId}' and event_type='patient_detail_opened'`
  );
  check('환자 상세를 처음 연 시각을 답할 수 있다', firstOpened.length > 0, firstOpened);

  console.log('\n  ── 횟수를 세지 않는다 (dedupe) ──');
  for (let i = 0; i < 3; i += 1) {
    trail.recordDifferentialExpanded({
      encounterId,
      intakeResultId: detail.intakeResult.id,
      diagnosis: '유리체출혈'
    });
  }
  await sleep(1200);
  check(
    '같은 진단을 몇 번 펼쳐도 한 줄이다',
    sqlValue(
      `select count(*) from public.clinical_decision_events where encounter_id='${encounterId}' and event_type='differential_expanded'`
    ) === '1'
  );

  console.log('\n  ── 다시 열면 그것은 별개의 사건이다 ──');
  const beforeReopen = Number(
    sqlValue(
      `select count(*) from public.clinical_decision_events where encounter_id='${encounterId}' and event_type='patient_detail_opened'`
    )
  );
  trail.recordPatientDetailOpened(detail);
  await sleep(1200);
  check(
    '환자를 다시 여는 것은 새 줄로 남는다',
    Number(
      sqlValue(
        `select count(*) from public.clinical_decision_events where encounter_id='${encounterId}' and event_type='patient_detail_opened'`
      )
    ) ===
      beforeReopen + 1
  );

  console.log('\n  ── 추론하지 않기로 한 것이 실제로 없는가 ──');
  const columns = sql(
    `select column_name from information_schema.columns where table_name='clinical_decision_events'`
  )
    .split('\n')
    .map((s) => s.trim());
  const forbidden = ['adopted', 'overridden', 'ignored', 'dwell_ms', 'focus_ms', 'view_count', 'scroll_depth'];
  check(
    '채택/무시/체류시간/횟수 컬럼이 존재하지 않는다',
    forbidden.every((c) => !columns.includes(c)),
    columns.join(',')
  );
  const allPayloads = sql(
    `select coalesce(string_agg(payload::text, ' '), '') from public.clinical_decision_events where encounter_id='${encounterId}'`
  );
  check(
    'payload 어디에도 체류시간·횟수 키가 없다',
    !/dwellMs|focusMs|viewCount|scrollDepth|adopted|overridden|ignored/.test(allPayloads)
  );

  // -------------------------------------------------------------------------
  console.log('\n=== 6) 추적은 고칠 수도 지울 수도 없다 (append-only) ===');
  const eventId = sqlValue(
    `select id from public.clinical_decision_events where encounter_id='${encounterId}' and event_type='interpretation_presented'`
  );

  const clientUpdate = await rest(`clinical_decision_events?id=eq.${eventId}`, {
    token: tokenA,
    method: 'PATCH',
    body: { payload: { differentials: [] } }
  });
  check('로그인 클라이언트의 UPDATE 가 거부된다', clientUpdate.status >= 400, `HTTP ${clientUpdate.status}`);
  const clientDelete = await rest(`clinical_decision_events?id=eq.${eventId}`, {
    token: tokenA,
    method: 'DELETE'
  });
  check('로그인 클라이언트의 DELETE 가 거부된다', clientDelete.status >= 400, `HTTP ${clientDelete.status}`);
  const clientInsert = await rest('clinical_decision_events', {
    token: tokenA,
    method: 'POST',
    body: {
      user_id: userA,
      encounter_id: encounterId,
      event_type: 'patient_detail_opened'
    }
  });
  check('로그인 클라이언트의 직접 INSERT 가 거부된다', clientInsert.status >= 400, `HTTP ${clientInsert.status}`);

  // service_role 도 예외가 아니다 — 이 표의 요점이다.
  const svcUpdate = await rest(`clinical_decision_events?id=eq.${eventId}`, {
    token: SERVICE,
    method: 'PATCH',
    body: { payload: {} }
  });
  check('service_role 의 UPDATE 도 트리거가 막는다', svcUpdate.status >= 400, `HTTP ${svcUpdate.status}`);
  const svcDelete = await rest(`clinical_decision_events?id=eq.${eventId}`, {
    token: SERVICE,
    method: 'DELETE'
  });
  check('service_role 의 DELETE 도 트리거가 막는다', svcDelete.status >= 400, `HTTP ${svcDelete.status}`);

  let directUpdateBlocked = false;
  try {
    sql(`update public.clinical_decision_events set payload='{}'::jsonb where id='${eventId}'`);
  } catch {
    directUpdateBlocked = true;
  }
  check('DB 직결(postgres 슈퍼유저)로도 UPDATE 가 막힌다', directUpdateBlocked);

  check(
    '기록은 그대로 남아 있다',
    sqlValue(`select count(*) from public.clinical_decision_events where id='${eventId}'`) === '1'
  );

  // 법적 삭제 요구를 위한 문서화된 탈출구가 실제로 동작하는지도 확인한다.
  const erasureProbe = sqlValue(
    `insert into public.clinical_decision_events (user_id, encounter_id, event_type)
     values ('${userA}','${encounterId}','patient_detail_opened') returning id`
  );
  sql(
    `set rd.audit_erasure = 'on'; delete from public.clinical_decision_events where id='${erasureProbe}'`
  );
  check(
    '문서화된 삭제 경로(rd.audit_erasure)는 동작한다',
    sqlValue(`select count(*) from public.clinical_decision_events where id='${erasureProbe}'`) === '0'
  );

  // -------------------------------------------------------------------------
  console.log('\n=== 7) 권한: anon 은 새 RPC 를 부를 수 없다 (0010/0011/0012) ===');
  const anonCalls = [
    ['record_clinical_decision_event', { p_encounter_id: encounterId, p_event_type: 'patient_detail_opened' }],
    ['rederive_intake_interpretation', { p_source_id: newId, p_interpretation: {}, p_provenance: newProv }],
    ['record_care_activity_candidates', { p_session_id: encounterId, p_candidates: [] }],
    ['set_care_activity_adoption', { p_activity_code: 'x', p_rule_version: 1, p_reviewed: true, p_note: null }],
    ['intake_facts_fingerprint', { p_soap: {} }],
    ['visit_code_max_failures_per_minute', {}]
  ];
  for (const [fn, body] of anonCalls) {
    const res = await rest(`rpc/${fn}`, { method: 'POST', body });
    check(`anon 이 ${fn} 을 부를 수 없다`, res.status >= 400, `HTTP ${res.status}`);
  }

  console.log('\n  ── 로그인 사용자에게도 열려 있으면 안 되는 것 ──');
  const authRederive = await rest('rpc/rederive_intake_interpretation', {
    token: tokenA,
    method: 'POST',
    body: { p_source_id: newId, p_interpretation: {}, p_provenance: newProv }
  });
  check('로그인 사용자도 재해석 RPC 를 부를 수 없다 (서버 전용)', authRederive.status >= 400, `HTTP ${authRederive.status}`);

  console.log('\n  ── 0010: public 스키마에 PUBLIC EXECUTE 가 남아 있는가 ──');
  const leaked = sql(
    `select coalesce(string_agg(t.sig, ', '), '') from (
       select p.oid::regprocedure::text as sig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public'
         and (p.proacl is null or exists (select 1 from unnest(p.proacl::text[]) a where a like '=%'))
     ) t`
  );
  check('PUBLIC EXECUTE 를 가진 함수가 0건이다', leaked === '', leaked);

  // -------------------------------------------------------------------------
  // 0013: 이름 붙은 권한 부여자(anon/authenticated)까지 보는 가드
  // -------------------------------------------------------------------------
  // [HARD] 가드가 "조용하다"는 것은 가드가 동작한다는 증거가 아니다. 0010 의
  // 가드는 운영 DB 에서 조용했고, 그 순간 그 DB 의 모든 함수는 anon 이 부를 수
  // 있었다. 그래서 여기서는 **진짜 구멍을 뚫어놓고** 가드가 그것을 잡아내는지
  // 확인한다. 잡지 못하면 가드가 아니다.
  console.log('\n  ── 0013: 권한 감사가 실제로 "울리는가" (구멍을 뚫어서 확인) ──');

  const baseline = runPrivilegeAudit();
  check('구멍이 없을 때 감사는 통과한다', baseline.ok, baseline.ok ? '' : baseline.output.slice(-400));
  check(
    '통과 시 PASS 를 명시적으로 말한다 (조용한 통과가 아니다)',
    /PASS -- anon and authenticated hold nothing/.test(baseline.output)
  );

  // (1) 함수 구멍: 0009 가 지키려고 만든 바로 그 함수를 anon 에게 연다.
  //     운영 DB 가 실제로 어떤 상태였는지를 그대로 재현한 것이다.
  sql(
    `grant execute on function public.redeem_visit_access_code(uuid,text,text,boolean) to anon`
  );

  //     같은 상태를 0010 의 가드에 물어본다. 0010 은 빈 권한부여자('=%')만
  //     찾으므로 'anon=X/postgres' 를 원리상 볼 수 없다 — 이 프로브가 증명해야
  //     하는 것은 새 가드가 잡는다는 사실뿐 아니라, 옛 가드가 못 잡는다는
  //     사실이다. 그것이 0010 을 교체해야 하는 이유 전체다.
  const oldGuardOnHole = sql(
    `select coalesce(string_agg(t.sig, ', '), '') from (
       select p.oid::regprocedure::text as sig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public'
         and (p.proacl is null or exists (select 1 from unnest(p.proacl::text[]) a where a like '=%'))
     ) t`
  );
  check(
    '0010 의 옛 가드는 이 구멍을 보지 못한다 (원리상 볼 수 없다)',
    oldGuardOnHole === '',
    `옛 가드 결과: "${oldGuardOnHole}"`
  );

  const fnHole = runPrivilegeAudit();
  check('0013 감사는 anon 함수 구멍에서 실패한다', !fnHole.ok);
  check(
    '실패 메시지가 어떤 함수인지 지목한다',
    /redeem_visit_access_code/.test(fnHole.output),
    fnHole.output.slice(-300)
  );
  check(
    '실패 메시지가 SECURITY DEFINER 임을 알린다',
    /SECURITY DEFINER/.test(fnHole.output)
  );

  sql(`revoke execute on function public.redeem_visit_access_code(uuid,text,text,boolean) from anon`);
  check('구멍을 막으면 감사는 다시 통과한다', runPrivilegeAudit().ok);

  // (2) 테이블 구멍: TRUNCATE 는 RLS 가 걸러주지 않는다. 로컬 스택의
  //     pg_default_acl 이 0013 이전까지 anon 에게 실제로 주고 있던 권한이다.
  sql(`grant truncate on public.clinical_decision_events to anon`);
  const tableHole = runPrivilegeAudit();
  check('0013 감사는 anon 테이블 구멍에서 실패한다', !tableHole.ok);
  check(
    '실패 메시지가 RLS 가 TRUNCATE 를 거르지 못한다고 말한다',
    /clinical_decision_events/.test(tableHole.output) &&
      /RLS does not filter TRUNCATE/.test(tableHole.output),
    tableHole.output.slice(-300)
  );
  sql(`revoke truncate on public.clinical_decision_events from anon`);

  // (3) authenticated 도 예외가 아니다. 허용목록에 없는 SELECT 하나면 울린다.
  sql(`grant select on public.visit_access_code_attempts to authenticated`);
  const authHole = runPrivilegeAudit();
  check('0013 감사는 authenticated 의 미허용 SELECT 에서도 실패한다', !authHole.ok);
  check(
    '실패 메시지가 어떤 테이블/역할인지 지목한다',
    /visit_access_code_attempts/.test(authHole.output) && /authenticated/.test(authHole.output),
    authHole.output.slice(-300)
  );
  sql(`revoke select on public.visit_access_code_attempts from authenticated`);

  // (4) 허용목록이 없으면 "깨끗하다"가 아니라 "판정 거부"여야 한다.
  //     기준을 못 찾아서 통과하는 감사가 이 작업 전체의 실패 모드다.
  sql(`alter table public.role_privilege_allowlist rename to role_privilege_allowlist_probe_tmp`);
  const noAllowlist = runPrivilegeAudit();
  sql(`alter table public.role_privilege_allowlist_probe_tmp rename to role_privilege_allowlist`);
  check('허용목록이 없으면 감사는 통과가 아니라 실패한다', !noAllowlist.ok);
  check(
    '그 실패는 "0013 이 적용되지 않았다"고 말한다',
    /migration 0013 has not been applied/.test(noAllowlist.output),
    noAllowlist.output.slice(-300)
  );

  const restored = runPrivilegeAudit();
  check('모든 구멍을 되돌린 뒤 감사는 통과 상태로 복귀한다', restored.ok);

  // 허용목록의 모든 항목에 근거가 달려 있어야 한다. 근거 없는 항목은 추측이고,
  // 0007/0008 의 구멍이 정확히 추측에서 나왔다.
  check(
    '허용목록의 모든 항목에 근거(rationale)가 있다',
    sqlValue(
      `select count(*) from public.role_privilege_allowlist where coalesce(trim(rationale),'') = ''`
    ) === '0'
  );

  // -------------------------------------------------------------------------
  console.log('\n=== 8) RLS: 임상의 A 와 B 는 서로의 기록을 보지 못한다 ===');
  const readA = await rest(
    `clinical_decision_events?encounter_id=eq.${encounterId}&select=id,event_type`,
    { token: tokenA }
  );
  const readB = await rest(
    `clinical_decision_events?encounter_id=eq.${encounterId}&select=id,event_type`,
    { token: tokenB }
  );
  check('A 는 자기 진료의 추적을 읽는다', Array.isArray(readA.body) && readA.body.length > 0, `${readA.body?.length}건`);
  check('B 에게는 한 건도 보이지 않는다', Array.isArray(readB.body) && readB.body.length === 0, `${readB.body?.length}건`);
  const readAnon = await rest(`clinical_decision_events?select=id`, {});
  check(
    'anon 에게는 읽히지 않는다',
    readAnon.status >= 400 || (Array.isArray(readAnon.body) && readAnon.body.length === 0),
    `HTTP ${readAnon.status}`
  );

  const forgedForB = await rest('rpc/record_clinical_decision_event', {
    token: tokenB,
    method: 'POST',
    body: { p_encounter_id: encounterId, p_event_type: 'patient_detail_opened' }
  });
  check(
    'B 는 A 의 진료에 이벤트를 기록할 수 없다',
    forgedForB.status >= 400,
    `HTTP ${forgedForB.status}`
  );

  const wrongResult = await rest('rpc/record_clinical_decision_event', {
    token: tokenA,
    method: 'POST',
    body: {
      p_encounter_id: encounterId,
      p_event_type: 'interpretation_presented',
      p_dedupe_key: 'cross',
      p_intake_result_id: sqlValue(
        `select id from public.intake_results where encounter_id='${legacyEncounter}' limit 1`
      )
    }
  });
  check(
    '다른 진료의 해석을 보여줬다고 기록할 수 없다',
    wrongResult.status >= 400,
    `HTTP ${wrongResult.status}`
  );

  // -------------------------------------------------------------------------
  console.log('\n=== 9) 정리 ===');
  sql(`set rd.audit_erasure = 'on'; delete from public.clinical_decision_events where user_id in ('${userA}','${userB}')`);
  sql(`delete from public.patients where user_id in ('${userA}','${userB}')`);
  sql(`delete from auth.users where id in ('${userA}','${userB}')`);

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}`);
};

main()
  .then(() => {
    cleanupChildren();
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    cleanupChildren();
    process.exit(1);
  });
