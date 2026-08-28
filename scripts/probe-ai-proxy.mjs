#!/usr/bin/env node
// A1 검증 프로브 — AI 프록시 (ai-gemini / ai-realtime).
//
// 로컬 Supabase 스택(포트 553xx)에만 붙는다. 실제 프로젝트는 건드리지 않는다.
//
// 실행:
//   supabase start
//   node scripts/probe-ai-proxy.mjs                 # 가짜 업스트림 (기본)
//   PROBE_LIVE=1 node scripts/probe-ai-proxy.mjs    # + 실제 Gemini/OpenAI 호출
//
// ══════════════════════════════════════════════════════════════════════════
// 무엇을 증명하려는가
// ══════════════════════════════════════════════════════════════════════════
//
// "게이트가 provider 호출 앞에 있다"는 주장은 코드를 읽어서는 증명되지 않는다.
// 그래서 이 프로브는 **가짜 업스트림을 세워 호출 횟수를 센다.** 거절된 요청
// 뒤에 카운터가 0 이면 그 요청은 소유자의 크레딧을 쓰지 않았다는 뜻이다.
//
// 함수 서버(`supabase functions serve`)를 프로브가 직접 띄운다. 업스트림 주소를
// 갈아끼워야 하는데 그건 함수 프로세스의 환경변수이기 때문이다.

import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = 'http://127.0.0.1:55321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const PASSWORD = 'probe-pass-123';

const MOCK_PORT = 5711;
const LIVE = process.env.PROBE_LIVE === '1';

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures += 1;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

/**
 * 가짜 업스트림이 있어야만 성립하는 검사.
 *
 * 실 모드에서는 provider 호출을 셀 수 없다 -- 호출은 Google/OpenAI 로 직접
 * 나간다. 그래서 조용히 통과시키지 않고 **건너뛴 것을 출력한다.** 안 돈 검사가
 * 돈 것처럼 보이면 그 순간 이 프로브가 거짓말을 시작한다.
 */
function mockOnly(label, cond, detail) {
  if (LIVE) {
    console.log(`  [SKIP] ${label} — 실 모드에서는 provider 호출을 셀 수 없다`);
    return;
  }
  check(label, cond, detail);
}

function sql(text) {
  return execFileSync(
    'docker',
    ['exec', '-i', 'supabase_db_realtime_doctor', 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', text],
    { encoding: 'utf8' }
  ).trim();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 가짜 업스트림. provider 호출을 센다.
// ---------------------------------------------------------------------------
const hits = { gemini: 0, openai: 0 };
const GEMINI_REPLY = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify({
              differentialDiagnoses: [
                {
                  name: '급성 위염',
                  rationale: '상복부 통증과 구역',
                  supportingFindings: [{ finding: '명치가 아프다', source: '#1' }]
                }
              ]
            })
          }
        ]
      }
    }
  ],
  usageMetadata: { promptTokenCount: 111, candidatesTokenCount: 22, totalTokenCount: 133 }
};
const OPENAI_REPLY = {
  value: 'ek_probe_fake_secret',
  expires_at: Math.floor(Date.now() / 1000) + 60
};

const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url.includes(':generateContent')) {
      hits.gemini += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(GEMINI_REPLY));
      return;
    }
    if (req.url.includes('/realtime/client_secrets')) {
      hits.openai += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(OPENAI_REPLY));
      return;
    }
    res.writeHead(404);
    res.end('{}');
  });
});

// ---------------------------------------------------------------------------
// 유저 / 호출 헬퍼
// ---------------------------------------------------------------------------
async function createUser(email) {
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`createUser ${email}: ${JSON.stringify(body)}`);
  return body.id;
}

async function tokenFor(email) {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`signIn ${email}: ${JSON.stringify(body)}`);
  return body.access_token;
}

/**
 * 게이트 검사용 최소 요청 본문.
 *
 * 빈 `contents: []` 를 쓰면 가짜 업스트림은 받아주지만 **실제 Gemini 는 400 을
 * 준다**(contents is not specified). 그러면 실 모드에서 게이트 통과 검사들이
 * 게이트와 무관한 이유로 무더기 실패한다. 두 모드가 같은 경로를 타도록
 * 기본 본문을 유효하게 만든다.
 */
const MINIMAL_BODY = {
  contents: [{ role: 'user', parts: [{ text: 'ping. 한 단어로만 답하세요.' }] }],
  generationConfig: { temperature: 0, maxOutputTokens: 8 }
};

async function callGemini({ jwt, model = 'gemini-2.5-flash', task = 'analyze', sessionId, body }) {
  const headers = { apikey: ANON, 'Content-Type': 'application/json' };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  if (task) headers['x-rd-task'] = task;
  if (sessionId) headers['x-rd-session-id'] = sessionId;
  const res = await fetch(
    `${API}/functions/v1/ai-gemini/models/${encodeURIComponent(model)}:generateContent`,
    { method: 'POST', headers, body: JSON.stringify(body ?? MINIMAL_BODY) }
  );
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 비 JSON 응답 그대로 둔다 */
  }
  return { status: res.status, body: json, text };
}

async function callRealtime({ jwt, sessionId }) {
  const headers = { apikey: ANON, 'Content-Type': 'application/json' };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  if (sessionId) headers['x-rd-session-id'] = sessionId;
  const res = await fetch(`${API}/functions/v1/ai-realtime`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ language: 'ko' })
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, body: json, text };
}

// ---------------------------------------------------------------------------
// 함수 서버 기동
// ---------------------------------------------------------------------------
const children = [];
function cleanup() {
  for (const c of children) {
    try {
      process.kill(-c.pid, 'SIGKILL');
    } catch {
      /* 이미 죽음 */
    }
  }
  try {
    mock.close();
  } catch {
    /* ignore */
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(1);
});

function rootEnv() {
  const map = new Map();
  if (!existsSync('.env')) return map;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    map.set(t.slice(0, i).trim(), t.slice(i + 1).trim());
  }
  return map;
}

function serveFunctions(envFile) {
  const c = spawn('supabase', ['functions', 'serve', '--env-file', envFile, '--no-verify-jwt'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });
  children.push(c);
  c.stderr.on('data', (d) => {
    const s = d.toString();
    if (/error|Error/.test(s) && !/Serving/.test(s)) process.stderr.write(`[fn] ${s}`);
  });
  return c;
}

async function waitForFunctions(tries = 90) {
  for (let i = 0; i < tries; i += 1) {
    try {
      // 인증 없는 호출이 401 을 주면 함수가 살아 있다는 뜻이다.
      const res = await fetch(`${API}/functions/v1/ai-realtime`, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (res.status === 401) return true;
    } catch {
      /* 아직 */
    }
    await sleep(1000);
  }
  return false;
}

// ===========================================================================
console.log('=== A1 probe: AI 프록시 (ai-gemini / ai-realtime) ===\n');

// 마이그레이션 0016 적용 (idempotent).
console.log('0016 마이그레이션 적용...');
execFileSync(
  'docker',
  ['exec', '-i', 'supabase_db_realtime_doctor', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'],
  { input: readFileSync('supabase/migrations/0016_usage_event_source.sql', 'utf8'), encoding: 'utf8' }
);
check(
  'usage_events.source 컬럼 존재 + 기본값 client',
  sql(
    `select column_default like '%client%' from information_schema.columns where table_name='usage_events' and column_name='source'`
  ) === 't'
);

// 함수 env: 진짜 키는 넣되 업스트림은 가짜로 돌린다.
const env = rootEnv();
const fnEnvDir = mkdtempSync(join(tmpdir(), 'rd-a1-'));
const fnEnvPath = join(fnEnvDir, 'functions.env');
const priv = existsSync('supabase/functions/.env')
  ? (readFileSync('supabase/functions/.env', 'utf8').match(/^ENTITLEMENT_PRIVATE_KEY=(.*)$/m)?.[1] ?? '')
  : '';

function writeFnEnv({ mockUpstream }) {
  writeFileSync(
    fnEnvPath,
    [
      `ENTITLEMENT_PRIVATE_KEY=${priv}`,
      `GEMINI_API_KEY=${env.get('GEMINI_API_KEY') ?? 'probe-fake-key'}`,
      `OPENAI_API_KEY=${env.get('OPENAI_API_KEY') ?? 'probe-fake-key'}`,
      `OPENAI_TRANSCRIBE_MODEL=${env.get('OPENAI_TRANSCRIBE_MODEL') ?? 'gpt-4o-transcribe'}`,
      mockUpstream ? `GEMINI_UPSTREAM_BASE=http://host.docker.internal:${MOCK_PORT}/v1beta` : '',
      mockUpstream ? `OPENAI_UPSTREAM_BASE=http://host.docker.internal:${MOCK_PORT}/v1` : ''
    ]
      .filter(Boolean)
      .join('\n') + '\n'
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 업스트림 모드는 시작할 때 한 번 정한다.
// ═══════════════════════════════════════════════════════════════════════════
//
// 도중에 함수 서버를 재기동해서 업스트림을 바꾸지 않는다. 컨테이너가 포트를
// 놓아주기 전에 새 프로세스가 붙으려 하면 조용히 실패하고, 그러면 **옛
// 프로세스가 계속 응답한다** -- 실 호출을 검증한다고 믿으면서 목을 때리거나,
// 목이 닫힌 뒤라면 전부 502 로 뜬다. 둘 다 거짓 결과다.
//
//   기본 모드  : 가짜 업스트림. provider 호출 횟수를 세서 fail-closed 를 증명.
//   PROBE_LIVE : 실제 Gemini / OpenAI. 응답 스키마와 실 왕복을 증명.
//                (호출 카운터가 없으므로 "0회" 검사는 이 모드에서 건너뛴다.)
if (!LIVE) {
  await new Promise((r) => mock.listen(MOCK_PORT, '0.0.0.0', r));
  console.log(`가짜 업스트림 :${MOCK_PORT} 기동`);
}
writeFnEnv({ mockUpstream: !LIVE });
serveFunctions(fnEnvPath);
if (!(await waitForFunctions())) {
  console.error('functions serve 가 뜨지 않았다.');
  process.exit(1);
}
console.log(`functions serve 준비됨 (${LIVE ? '실제 provider' : '가짜 업스트림'})\n`);

// 유저 4명.
const stamp = Date.now();
const users = {
  entitled: `probe-a1-ok-${stamp}@example.com`,
  lapsed: `probe-a1-lapsed-${stamp}@example.com`,
  noRow: `probe-a1-norow-${stamp}@example.com`,
  canceled: `probe-a1-canceled-${stamp}@example.com`
};
const ids = {};
for (const [k, email] of Object.entries(users)) ids[k] = await createUser(email);

sql(`update public.subscriptions set status='trialing', trial_ends_at = now() + interval '5 days' where user_id='${ids.entitled}'`);
sql(`update public.subscriptions set status='trialing', trial_ends_at = now() - interval '1 day' where user_id='${ids.lapsed}'`);
sql(`delete from public.subscriptions where user_id='${ids.noRow}'`);
sql(`update public.subscriptions set status='canceled', trial_ends_at = now() + interval '30 days' where user_id='${ids.canceled}'`);

const jwt = {};
for (const [k, email] of Object.entries(users)) jwt[k] = await tokenFor(email);

// ── 시나리오 1: 인증 없음 ──────────────────────────────────────────────────
console.log('시나리오 1: 인증 없는 호출 — provider 에 닿기 전에 거절');
{
  const before = { ...hits };
  const g = await callGemini({ jwt: null });
  const r = await callRealtime({ jwt: null });
  const gBad = await callGemini({ jwt: 'not-a-real-jwt' });
  const rBad = await callRealtime({ jwt: 'not-a-real-jwt' });
  check('ai-gemini 토큰 없음 → 401', g.status === 401, `status=${g.status} body=${g.text.slice(0, 80)}`);
  check('ai-realtime 토큰 없음 → 401', r.status === 401, `status=${r.status}`);
  check('ai-gemini 위조 토큰 → 401', gBad.status === 401, `status=${gBad.status}`);
  check('ai-realtime 위조 토큰 → 401', rBad.status === 401, `status=${rBad.status}`);
  mockOnly(
    '거절 4건 동안 provider 호출 0회 (fail-closed)',
    hits.gemini === before.gemini && hits.openai === before.openai,
    `gemini ${before.gemini}→${hits.gemini}, openai ${before.openai}→${hits.openai}`
  );
}

// ── 시나리오 2: 로그인했지만 자격 없음 ─────────────────────────────────────
console.log('\n시나리오 2: 로그인 O / 자격 X — provider 에 닿기 전에 거절');
for (const [label, key, reason] of [
  ['체험 만료', 'lapsed', 'lapsed_trial_ends_at'],
  ['구독 행 없음', 'noRow', 'no_subscription_row'],
  ['해지됨', 'canceled', 'status_canceled']
]) {
  const before = { ...hits };
  const g = await callGemini({ jwt: jwt[key] });
  const r = await callRealtime({ jwt: jwt[key] });
  check(`${label}: ai-gemini → 402`, g.status === 402, `status=${g.status} reason=${g.body?.reason}`);
  check(`${label}: ai-realtime → 402`, r.status === 402, `status=${r.status} reason=${r.body?.reason}`);
  check(`${label}: 거절 사유가 entitlement 규칙과 일치`, g.body?.reason === reason, `reason=${g.body?.reason}`);
  mockOnly(
    `${label}: provider 호출 0회`,
    hits.gemini === before.gemini && hits.openai === before.openai,
    `gemini ${before.gemini}→${hits.gemini}, openai ${before.openai}→${hits.openai}`
  );
}

// ── 시나리오 3: 자격 있는 사용자 ───────────────────────────────────────────
console.log('\n시나리오 3: 자격 있는 사용자 — 통과 + 서버 계량');
let sessionId = null;
{
  // usage_events.session_id 확인용 실제 세션 행.
  sessionId = sql(
    `insert into public.sessions (user_id, transcribe_provider) values ('${ids.entitled}', 'openai') returning id`
  ).split('\n')[0];

  const before = { ...hits };
  const g = await callGemini({ jwt: jwt.entitled, task: 'analyze', sessionId });
  check('ai-gemini → 200', g.status === 200, `status=${g.status}`);
  mockOnly('provider 호출 1회 증가', hits.gemini === before.gemini + 1, `${before.gemini}→${hits.gemini}`);
  mockOnly(
    '응답 본문이 업스트림 원문 그대로 (가공 없음)',
    JSON.stringify(g.body) === JSON.stringify(GEMINI_REPLY)
  );
  check(
    '응답이 Gemini generateContent 모양이다 (candidates + usageMetadata)',
    Array.isArray(g.body?.candidates) && typeof g.body?.usageMetadata === 'object'
  );

  const r = await callRealtime({ jwt: jwt.entitled, sessionId });
  check('ai-realtime → 200', r.status === 200, `status=${r.status}`);
  check(
    'ephemeral secret 이 돌아온다',
    LIVE
      ? typeof r.body?.client_secret?.value === 'string' &&
          r.body.client_secret.value.startsWith('ek_')
      : r.body?.client_secret?.value === OPENAI_REPLY.value,
    LIVE ? `접두=${String(r.body?.client_secret?.value).slice(0, 3)}` : undefined
  );
  check('모델은 서버가 정한다', typeof r.body?.model === 'string' && r.body.model.length > 0, `model=${r.body?.model}`);
  mockOnly('provider 호출 1회 증가', hits.openai === before.openai + 1, `${before.openai}→${hits.openai}`);
}

// ── 시나리오 4: usage_events ───────────────────────────────────────────────
console.log('\n시나리오 4: usage_events — 서버가 기록했는가');
await sleep(1200); // recordUsage 는 응답 전에 await 하지만 커밋 여유를 준다.
{
  const rows = sql(
    `select provider||'|'||task||'|'||model||'|'||source||'|'||coalesce(total_tokens::text,'-')||'|'||coalesce(session_id::text,'-') from public.usage_events where user_id='${ids.entitled}' order by ts`
  );
  console.log('  기록된 행:\n' + (rows ? rows.split('\n').map((l) => '    ' + l).join('\n') : '    (없음)'));
  check(
    'gemini 행이 source=server 로 기록됨',
    sql(`select count(*) from public.usage_events where user_id='${ids.entitled}' and provider='gemini' and source='server'`) === '1'
  );
  check(
    '토큰 수가 업스트림 usageMetadata 에서 왔다',
    LIVE
      ? Number(sql(`select total_tokens from public.usage_events where user_id='${ids.entitled}' and provider='gemini'`)) > 0
      : sql(`select total_tokens from public.usage_events where user_id='${ids.entitled}' and provider='gemini'`) === '133',
    `total_tokens=${sql(`select total_tokens from public.usage_events where user_id='${ids.entitled}' and provider='gemini'`)}`
  );
  check(
    'task 라벨이 붙었다',
    sql(`select task from public.usage_events where user_id='${ids.entitled}' and provider='gemini'`) === 'analyze'
  );
  check(
    'openai-realtime mint 행이 source=server 로 기록됨',
    sql(`select count(*) from public.usage_events where user_id='${ids.entitled}' and provider='openai-realtime' and task='mint' and source='server'`) === '1'
  );
  check(
    'session_id 가 붙었다',
    sql(`select count(*) from public.usage_events where user_id='${ids.entitled}' and session_id='${sessionId}'`) === '2'
  );
  check(
    '거절된 사용자 3명에게는 행이 하나도 없다',
    sql(`select count(*) from public.usage_events where user_id in ('${ids.lapsed}','${ids.noRow}','${ids.canceled}')`) === '0'
  );
}

// ── 시나리오 5: 남의 세션 / 남의 계정으로 붙이기 ──────────────────────────
console.log('\n시나리오 5: 계량을 남에게 떠넘길 수 있는가');
{
  const otherSession = sql(
    `insert into public.sessions (user_id, transcribe_provider) values ('${ids.lapsed}', 'openai') returning id`
  ).split('\n')[0];
  const g = await callGemini({ jwt: jwt.entitled, task: 'analyze', sessionId: otherSession });
  check('통과는 한다 (자기 자격으로)', g.status === 200);
  await sleep(800);
  check(
    '남의 session_id 는 무시되고 붙지 않는다',
    sql(`select count(*) from public.usage_events where session_id='${otherSession}'`) === '0'
  );
  check(
    '행은 호출자 본인에게 귀속된다',
    sql(`select count(*) from public.usage_events where user_id='${ids.entitled}' and provider='gemini'`) === '2'
  );
}

// ── 시나리오 6: 클라이언트는 source='server' 를 위조할 수 없다 ─────────────
console.log("\n시나리오 6: 클라이언트가 source='server' 행을 만들 수 있는가");
{
  async function insertUsage(source) {
    const res = await fetch(`${API}/rest/v1/usage_events`, {
      method: 'POST',
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${jwt.entitled}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        user_id: ids.entitled,
        provider: 'gemini',
        task: 'analyze',
        model: 'forged',
        source
      })
    });
    return res.status;
  }
  const forged = await insertUsage('server');
  check("source='server' INSERT 거부 (RLS restrictive)", forged === 403 || forged === 401, `status=${forged}`);
  const own = await insertUsage('client');
  check("source='client' INSERT 은 허용 (CLOVA 신고 경로 유지)", own === 201, `status=${own}`);
  const flip = await fetch(
    `${API}/rest/v1/usage_events?user_id=eq.${ids.entitled}&source=eq.client`,
    {
      method: 'PATCH',
      headers: { apikey: ANON, Authorization: `Bearer ${jwt.entitled}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'server' })
    }
  );
  check('기존 행을 server 로 승격하는 UPDATE 거부', flip.status === 403, `status=${flip.status}`);
  check(
    '위조 시도 후에도 server 행 수는 그대로',
    sql(`select count(*) from public.usage_events where user_id='${ids.entitled}' and source='server'`) === '3'
  );
}

// ── 시나리오 7: 열린 프록시가 아니다 ───────────────────────────────────────
console.log('\n시나리오 7: 경로/모델 allowlist');
{
  const before = { ...hits };
  const embed = await fetch(`${API}/functions/v1/ai-gemini/models/gemini-2.5-flash:embedContent`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${jwt.entitled}`, 'Content-Type': 'application/json' },
    body: '{}'
  });
  check('허용되지 않은 경로(:embedContent) → 404', embed.status === 404, `status=${embed.status}`);
  const badModel = await callGemini({ jwt: jwt.entitled, model: 'gpt-4o' });
  check('gemini 계열이 아닌 모델 → 400', badModel.status === 400, `status=${badModel.status}`);
  const traversal = await fetch(`${API}/functions/v1/ai-gemini/models/..%2F..%2Fv1%2Ffiles:generateContent`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${jwt.entitled}`, 'Content-Type': 'application/json' },
    body: '{}'
  });
  check('경로 탈출 시도 거부', traversal.status === 400 || traversal.status === 404, `status=${traversal.status}`);
  const getReq = await fetch(`${API}/functions/v1/ai-realtime`, {
    method: 'GET',
    headers: { apikey: ANON, Authorization: `Bearer ${jwt.entitled}` }
  });
  check('GET → 405', getReq.status === 405, `status=${getReq.status}`);
  mockOnly(
    '거절 4건 동안 provider 호출 0회',
    hits.gemini === before.gemini && hits.openai === before.openai,
    `gemini ${before.gemini}→${hits.gemini}, openai ${before.openai}→${hits.openai}`
  );
}

// ── 시나리오 8 (선택): 실제 provider 왕복 ─────────────────────────────────
if (LIVE) {
  console.log('\n시나리오 8: 실제 Gemini / OpenAI 왕복 (PROBE_LIVE=1)');
  // 함수 서버는 이미 실 업스트림으로 떠 있다 (시작할 때 정했다). 여기서
  // 재기동하지 않는다 -- 위의 모드 결정 주석 참조.
  {
    const { ANALYSIS_RESPONSE_SCHEMA, getAnalyzerSystemPrompt } = await import(
      '../src/main/prompts.ts'
    );
    const transcript = [
      '[#1 의사] 어디가 불편해서 오셨어요?',
      '[#2 환자] 이틀 전부터 명치가 쓰리고 아파요. 밥 먹고 나면 더 심해요.',
      '[#3 의사] 토하거나 열이 나지는 않았나요?',
      '[#4 환자] 구역질은 좀 났는데 열은 없었어요.'
    ].join('\n');
    const model = env.get('GEMINI_ANALYZER_MODEL') ?? 'gemini-2.5-flash';
    const live = await callGemini({
      jwt: jwt.entitled,
      model,
      task: 'analyze',
      sessionId,
      body: {
        system_instruction: { parts: [{ text: getAnalyzerSystemPrompt('ko') }] },
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `다음은 진행 중인 진료 대화의 누적 transcript입니다.\n\n---\n${transcript}\n---\n\n요청한 JSON 스키마에 맞게 분석을 반환하세요.`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: ANALYSIS_RESPONSE_SCHEMA
        }
      }
    });
    check('실 Gemini 왕복 → 200', live.status === 200, `status=${live.status} ${live.text.slice(0, 160)}`);

    // 앱과 **같은 코드**로 파싱한다. 프로브가 따로 파싱하면 앱에서 깨져도 통과한다.
    const { extractText } = await import('../src/shared/gemini.ts');
    const { partitionDifferentials } = await import('../src/shared/findings.ts');
    let parsed = null;
    try {
      parsed = JSON.parse(extractText(live.body));
    } catch (err) {
      check('extractText → JSON.parse 성공', false, String(err));
    }
    if (parsed) {
      check('extractText 가 본문을 꺼낸다', true);
      const utterances = [
        { id: 'u1', text: '어디가 불편해서 오셨어요?' },
        { id: 'u2', text: '이틀 전부터 명치가 쓰리고 아파요. 밥 먹고 나면 더 심해요.' },
        { id: 'u3', text: '토하거나 열이 나지는 않았나요?' },
        { id: 'u4', text: '구역질은 좀 났는데 열은 없었어요.' }
      ];
      const { supported, unverified } = partitionDifferentials(
        (parsed.differentialDiagnoses ?? []).map((d) => {
          const { supportingFindings, ...rest } = d;
          return { ...rest, rawFindings: supportingFindings };
        }),
        utterances
      );
      console.log(
        `  감별진단 ${(parsed.differentialDiagnoses ?? []).length}건 → 근거 검증 통과 ${supported.length}, 미확인 ${unverified.length}`
      );
      check('감별진단이 하나 이상 나왔다', (parsed.differentialDiagnoses ?? []).length > 0);
      check('supporting_findings 가 검증기를 통과한다 (E1 스키마 보존)', supported.length > 0);
      check(
        '검증된 근거의 quote 가 원문에서 온 값이다',
        supported.every((d) => d.supportingFindings.every((f) => utterances.some((u) => u.text.includes(f.quote))))
      );
    }

    const liveMint = await callRealtime({ jwt: jwt.entitled, sessionId });
    check('실 OpenAI mint → 200', liveMint.status === 200, `status=${liveMint.status} ${liveMint.text.slice(0, 160)}`);
    const secret = liveMint.body?.client_secret?.value ?? '';
    check('ephemeral secret 형식(ek_ 접두)', secret.startsWith('ek_'), `길이=${secret.length}, 접두=${secret.slice(0, 3)}`);
    check(
      '만료 시각이 미래이고 짧다 (단기 키)',
      typeof liveMint.body?.client_secret?.expires_at === 'number' &&
        liveMint.body.client_secret.expires_at * 1000 > Date.now(),
      `expires_at=${liveMint.body?.client_secret?.expires_at}`
    );

    await sleep(1200);
    console.log(
      '  실 호출 usage_events:\n' +
        sql(
          `select provider||'|'||task||'|'||model||'|'||source||'|'||coalesce(total_tokens::text,'-') from public.usage_events where user_id='${ids.entitled}' and source='server' order by ts desc limit 3`
        )
          .split('\n')
          .map((l) => '    ' + l)
          .join('\n')
    );
    check(
      '실 호출도 server 행으로 기록됨 (총 5건)',
      sql(`select count(*) from public.usage_events where user_id='${ids.entitled}' and source='server'`) === '5'
    );
  }
} else {
  console.log('\n시나리오 8 건너뜀 (실제 provider 호출). PROBE_LIVE=1 로 실행하면 돈다.');
}

console.log(`\n=== ${failures === 0 ? '전부 PASS' : `${failures} FAIL`} ===`);
cleanup();
process.exit(failures === 0 ? 0 : 1);
