#!/usr/bin/env node
// S3 검증 프로브 — admin-web 결제 라우트 (핸드오프 / 빌링키 검증 / 첫 결제 / 예약).
//
// 로컬 Supabase 스택(포트 553xx)에만 붙는다. 실제 프로젝트는 건드리지 않는다.
// 포트원 HTTP 계층은 이 스크립트가 띄우는 목 서버로 대체된다 (PORTONE_API_BASE).
// 라우트 코드 자체는 진짜다 -- 실제 next 서버를 띄우고 HTTP 로 때린다.
//
// 실행:
//   supabase start
//   supabase functions serve --env-file supabase/functions/.env   (시나리오 2에 필요)
//   node scripts/probe-billing.mjs

import { execFileSync, spawn } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import http from 'node:http';

const API = 'http://127.0.0.1:55321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const MOCK_PORT = 5599;
const WEB_PORT = 3111;
const WEB = `http://127.0.0.1:${WEB_PORT}`;

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

// admin-web/lib/billing/ids.ts 와 같은 규칙. 서버가 계산한 값과 일치해야 한다.
const customerIdOf = (userId) => `rd${createHash('sha256').update(userId).digest('hex').slice(0, 18)}`;

// ---------------------------------------------------------------------------
// 포트원 목 서버
// ---------------------------------------------------------------------------
const mock = {
  keys: new Map(), // billingKey -> { customerId, status, decline }
  paid: new Set(),
  calls: { get: 0, pay: 0, schedule: 0 }
};

function startMock() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('PortOne ')) return send(401, { type: 'UNAUTHORIZED' });

    const m = url.pathname.match(/^\/billing-keys\/(.+)$/);
    if (req.method === 'GET' && m) {
      mock.calls.get += 1;
      const key = decodeURIComponent(m[1]);
      const rec = mock.keys.get(key);
      if (!rec) return send(404, { type: 'BILLING_KEY_NOT_FOUND', message: '빌링키를 찾을 수 없습니다.' });
      return send(200, {
        status: rec.status ?? 'ISSUED',
        billingKey: key,
        customer: { id: rec.customerId },
        methods: [{ card: { issuer: '신한카드', number: '433012******1234' } }],
        issuedAt: new Date().toISOString()
      });
    }

    let bodyText = '';
    req.on('data', (c) => (bodyText += c));
    req.on('end', () => {
      const body = bodyText ? JSON.parse(bodyText) : {};
      const pay = url.pathname.match(/^\/payments\/(.+)\/billing-key$/);
      if (req.method === 'POST' && pay) {
        mock.calls.pay += 1;
        const paymentId = decodeURIComponent(pay[1]);
        if (mock.paid.has(paymentId)) {
          return send(409, { type: 'PAYMENT_ALREADY_PAID', message: '이미 결제된 건입니다.' });
        }
        const rec = mock.keys.get(body.billingKey);
        if (rec?.decline) {
          return send(402, { type: 'PG_PROVIDER_ERROR', message: '한도 초과입니다.' });
        }
        mock.paid.add(paymentId);
        return send(200, {
          payment: { id: paymentId, status: 'PAID', paidAt: new Date().toISOString() }
        });
      }
      const sch = url.pathname.match(/^\/payments\/(.+)\/schedule$/);
      if (req.method === 'POST' && sch) {
        mock.calls.schedule += 1;
        return send(200, {
          schedule: { id: `sch_${decodeURIComponent(sch[1])}`, timeToPay: body.timeToPay }
        });
      }
      send(404, { type: 'NOT_FOUND', message: url.pathname });
    });
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------------------
// 쿠키 자
// ---------------------------------------------------------------------------
function newJar() {
  return new Map();
}
function applySetCookie(jar, res) {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1);
    if (value === '' ) jar.delete(name);
    else jar.set(name, value);
  }
}
function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
async function jarFetch(jar, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    redirect: 'manual',
    headers: { ...(init.headers ?? {}), ...(jar.size ? { cookie: cookieHeader(jar) } : {}) }
  });
  applySetCookie(jar, res);
  return res;
}

// ---------------------------------------------------------------------------
// Supabase 도우미
// ---------------------------------------------------------------------------
async function createUser(email) {
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'probe-pass-123', email_confirm: true })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`createUser ${email}: ${JSON.stringify(body)}`);
  return body.id;
}
async function accessToken(email) {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'probe-pass-123' })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`signIn ${email}: ${JSON.stringify(body)}`);
  return body.access_token;
}

/** Electron 이 하는 일을 그대로: 핸드오프 링크를 받아 브라우저처럼 따라간다. */
async function signInViaHandoff(email) {
  const jwt = await accessToken(email);
  const res = await fetch(`${WEB}/api/billing/handoff`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` }
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`handoff: ${JSON.stringify(body)}`);
  const jar = newJar();
  const follow = await jarFetch(jar, body.url);
  return { jar, jwt, handoffUrl: body.url, redirect: follow.headers.get('location'), status: follow.status };
}

async function startCardRegistration(jar) {
  const res = await jarFetch(jar, `${WEB}/api/billing/issue-id`, { method: 'POST' });
  return { status: res.status, body: await res.json() };
}
async function complete(jar, issueId, billingKey) {
  const res = await jarFetch(jar, `${WEB}/api/billing/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ issueId, billingKey })
  });
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------
console.log('=== S3 probe: admin-web 결제 흐름 ===\n');

const mockServer = await startMock();
console.log(`포트원 목 서버: http://127.0.0.1:${MOCK_PORT}`);

const web = spawn(
  'npx',
  ['next', 'dev', '-p', String(WEB_PORT), '-H', '127.0.0.1'],
  {
    cwd: new URL('../admin-web', import.meta.url).pathname,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      NEXT_PUBLIC_SUPABASE_URL: API,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE,
      NEXT_PUBLIC_PORTONE_STORE_ID: 'store-probe',
      NEXT_PUBLIC_PORTONE_CHANNEL_KEY: 'channel-key-probe',
      PORTONE_API_SECRET: 'probe-secret',
      PORTONE_API_BASE: `http://127.0.0.1:${MOCK_PORT}`,
      BILLING_HANDOFF_SECRET: 'probe-handoff-secret',
      // S4 가 필수 env 로 추가한 둘. 이 프로브는 웹훅도 크론도 쓰지 않지만,
      // instrumentation.ts 의 assertBillingEnv 가 부팅 시 전부 검사하므로
      // 없으면 서버가 아예 뜨지 않는다.
      PORTONE_WEBHOOK_SECRET: `whsec_${Buffer.from('probe-billing-secret-0123456789ab').toString('base64')}`,
      BILLING_CRON_SECRET: 'probe-cron-secret',
      NEXT_PUBLIC_APP_ORIGIN: WEB
    },
    stdio: ['ignore', 'pipe', 'pipe']
  }
);
const webLog = [];
web.stdout.on('data', (d) => webLog.push(String(d)));
web.stderr.on('data', (d) => webLog.push(String(d)));

async function waitForWeb() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${WEB}/login`);
      if (res.status < 500) return true;
    } catch {
      /* 아직 안 떴다 */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function shutdown(code) {
  web.kill('SIGTERM');
  mockServer.close();
  setTimeout(() => process.exit(code), 300);
}

try {
  if (!(await waitForWeb())) {
    console.error('next dev 가 뜨지 않았습니다.\n' + webLog.join(''));
    shutdown(1);
  }
  console.log(`admin-web: ${WEB}\n`);

  const stamp = Date.now();
  const emails = {
    happy: `probe-bill-happy-${stamp}@example.com`,
    forged: `probe-bill-forged-${stamp}@example.com`,
    dbl: `probe-bill-double-${stamp}@example.com`,
    decline: `probe-bill-decline-${stamp}@example.com`
  };
  const ids = {};
  for (const [k, e] of Object.entries(emails)) ids[k] = await createUser(e);

  // 전원 trialing 상태에서 시작한다 (가입 트리거 기본값).
  console.log('초기 구독 상태:');
  console.log(
    sql(
      `select left(user_id::text,8) as uid, status, billing_key is not null as has_key from public.subscriptions where user_id in ('${ids.happy}','${ids.forged}','${ids.dbl}','${ids.decline}')`
    )
  );

  // === 시나리오 1: 정상 카드 등록 =========================================
  console.log('\n--- 시나리오 1: trialing 유저가 카드 등록 → active ---');
  const happy = await signInViaHandoff(emails.happy);
  check('핸드오프 링크가 URL 에 refresh token 을 싣지 않는다',
    !/refresh_token|access_token/i.test(happy.handoffUrl), happy.handoffUrl.replace(/t=[^&]+/, 't=<otp-hash>'));
  check('핸드오프가 /billing 으로 리다이렉트', happy.redirect === '/billing' || happy.redirect?.endsWith('/billing'),
    `${happy.status} -> ${happy.redirect}`);
  check('핸드오프로 세션 쿠키가 설정됨', [...happy.jar.keys()].some((k) => k.includes('auth-token')),
    [...happy.jar.keys()].join(','));

  const issue1 = await startCardRegistration(happy.jar);
  check('issue-id 발급', issue1.status === 200 && !!issue1.body.issueId, JSON.stringify(issue1.body));
  const cust1 = customerIdOf(ids.happy);
  check('customerId 가 서버·클라이언트 동일 규칙', issue1.body.customerId === cust1, issue1.body.customerId);
  check('customerId 20자 이하', cust1.length <= 20, `${cust1} (${cust1.length}자)`);

  // 브라우저 SDK 가 발급했다고 가정하고 목에 등록.
  mock.keys.set('bk_happy', { customerId: cust1 });
  const done1 = await complete(happy.jar, issue1.body.issueId, 'bk_happy');
  check('첫 결제 성공', done1.status === 200 && done1.body.ok === true, JSON.stringify(done1.body));

  const row = sql(
    `select status, to_char(current_period_end - current_period_start, 'DD') as span_days, billing_key, card_brand, card_last4, portone_customer_id from public.subscriptions where user_id='${ids.happy}'`
  ).split('|');
  check('status=active', row[0] === 'active', row[0]);
  const spanDays = Number(sql(
    `select round(extract(epoch from (current_period_end - current_period_start))/86400) from public.subscriptions where user_id='${ids.happy}'`
  ));
  check('current_period_end 가 약 한 달 뒤', spanDays >= 28 && spanDays <= 31, `${spanDays}일`);
  check('billing_key 저장됨', row[2] === 'bk_happy', row[2]);
  check('마스킹 카드 정보 저장됨', row[3] === '신한카드' && row[4] === '1234', `${row[3]} ****${row[4]}`);
  check('portone_customer_id 저장됨', row[5] === cust1, row[5]);

  const paidRow = sql(
    `select amount_krw, status from public.payment_attempts where user_id='${ids.happy}' and status='paid'`
  );
  check('payment_attempts 에 77000원 결제 성공 행', paidRow === '77000|paid', paidRow || '(없음)');
  const schedRow = sql(
    `select payment_id, amount_krw, status from public.payment_attempts where user_id='${ids.happy}' and status='scheduled'`
  );
  check('다음 주기 예약이 잡히고 기록됨', schedRow.endsWith('|77000|scheduled'), schedRow || '(없음)');
  check('포트원 예약 API 가 실제로 호출됨', mock.calls.schedule === 1, `schedule 호출 ${mock.calls.schedule}회`);

  // --- S2 와의 연결: entitlement 가 이제 자격을 인정하는가 ---
  const jwt1 = await accessToken(emails.happy);
  const entRes = await fetch(`${API}/functions/v1/entitlement`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt1}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: '{}'
  });
  const ent = await entRes.json();
  check('entitlement(S2) 가 entitled=true 를 서명', entRes.status === 200 && ent.token?.entitled === true,
    `status=${ent.token?.status} reason=${ent.token?.reason}`);
  check('entitlement status=active', ent.token?.status === 'active', ent.token?.status);
  check('entitlement 가 결제로 갱신된 기간을 본다', ent.token?.reason === 'covered_by_current_period_end', ent.token?.reason);
  check('deviceLimit=2', ent.token?.deviceLimit === 2, String(ent.token?.deviceLimit));

  // === 시나리오 2: 위조 콜백 ===============================================
  console.log('\n--- 시나리오 2: 위조 콜백 (포트원이 모르는 빌링키 / 남의 빌링키) ---');
  const forged = await signInViaHandoff(emails.forged);
  const issue2 = await startCardRegistration(forged.jar);
  const before2 = sql(`select status from public.subscriptions where user_id='${ids.forged}'`);
  const fake = await complete(forged.jar, issue2.body.issueId, 'bk_does_not_exist');
  check('존재하지 않는 빌링키 거부', fake.status === 400 && fake.body.error === 'billing_key_unverified',
    `${fake.status} ${JSON.stringify(fake.body)}`);
  const after2 = sql(`select status from public.subscriptions where user_id='${ids.forged}'`);
  check('구독 상태 변화 없음', before2 === after2 && after2 === 'trialing', `${before2} -> ${after2}`);
  check('결제 시도 행도 생기지 않음',
    sql(`select count(*) from public.payment_attempts where user_id='${ids.forged}'`) === '0');

  // 남의(유효한) 빌링키를 자기 것이라고 주장.
  const issue2b = await startCardRegistration(forged.jar);
  const stolen = await complete(forged.jar, issue2b.body.issueId, 'bk_happy');
  check('남의 빌링키 도용 거부(customer 불일치)',
    stolen.status === 400 && stolen.body.error === 'billing_key_rejected' && stolen.body.detail === 'owner',
    `${stolen.status} ${JSON.stringify(stolen.body)}`);
  check('도용 시도 후에도 여전히 trialing',
    sql(`select status from public.subscriptions where user_id='${ids.forged}'`) === 'trialing');
  // 남의 issueId 를 훔쳐 쓰는 경우.
  const cross = await complete(forged.jar, issue1.body.issueId, 'bk_happy');
  check('남의 issueId 사용 거부', cross.status === 400 && cross.body.error === 'unknown_issue_id',
    `${cross.status} ${JSON.stringify(cross.body)}`);

  // === 시나리오 3: 이중 제출 ===============================================
  console.log('\n--- 시나리오 3: 같은 요청 두 번 제출 → 청구 1회 ---');
  const dbl = await signInViaHandoff(emails.dbl);
  const issue3 = await startCardRegistration(dbl.jar);
  const cust3 = customerIdOf(ids.dbl);
  mock.keys.set('bk_double', { customerId: cust3 });
  const payBefore = mock.calls.pay;
  const [r1, r2] = await Promise.all([
    complete(dbl.jar, issue3.body.issueId, 'bk_double'),
    complete(dbl.jar, issue3.body.issueId, 'bk_double')
  ]);
  check('두 응답 모두 오류가 아님(사용자에겐 성공으로 보임)',
    r1.status === 200 && r2.status === 200, `${r1.status}/${r2.status}`);
  check('둘 중 정확히 하나만 duplicate',
    [r1.body.duplicate, r2.body.duplicate].filter(Boolean).length === 1,
    JSON.stringify([r1.body, r2.body]));
  check('포트원 결제 API 는 1회만 호출', mock.calls.pay - payBefore === 1,
    `${mock.calls.pay - payBefore}회`);
  check('payment_attempts 첫 결제 행 1개',
    sql(`select count(*) from public.payment_attempts where user_id='${ids.dbl}' and status='paid'`) === '1');
  check('총 청구 금액 77000원 1회',
    sql(`select coalesce(sum(amount_krw),0) from public.payment_attempts where user_id='${ids.dbl}' and status='paid'`) === '77000');

  // === 시나리오 4: 첫 결제 거절 ============================================
  console.log('\n--- 시나리오 4: 첫 결제 거절 → 활성화되지 않음 ---');
  const dec = await signInViaHandoff(emails.decline);
  const issue4 = await startCardRegistration(dec.jar);
  mock.keys.set('bk_decline', { customerId: customerIdOf(ids.decline), decline: true });
  const declined = await complete(dec.jar, issue4.body.issueId, 'bk_decline');
  check('402 로 거절 전달', declined.status === 402 && declined.body.error === 'payment_failed',
    `${declined.status} ${JSON.stringify(declined.body)}`);
  const decRow = sql(
    `select status, billing_key is not null from public.subscriptions where user_id='${ids.decline}'`
  );
  check('구독 활성화되지 않음 (trialing 유지, 빌링키 미저장)', decRow === 'trialing|f', decRow);
  const decAttempt = sql(
    `select status, failure_code, failure_message, amount_krw from public.payment_attempts where user_id='${ids.decline}'`
  );
  check('실패가 payment_attempts 에 기록됨',
    decAttempt.startsWith('failed|PG_PROVIDER_ERROR|한도 초과입니다.|77000'), decAttempt || '(없음)');

  // === 시나리오 5: 권한 (S1 이 살아 있는가) ================================
  console.log('\n--- 시나리오 5: billing_key 는 여전히 클라이언트에서 읽히지 않는다 ---');
  const selfRes = await fetch(
    `${API}/rest/v1/subscriptions_self?select=*`,
    { headers: { apikey: ANON, Authorization: `Bearer ${jwt1}` } }
  );
  const selfBody = await selfRes.json();
  check('subscriptions_self 는 읽힌다', selfRes.ok && Array.isArray(selfBody) && selfBody.length === 1,
    JSON.stringify(selfBody).slice(0, 120));
  check('뷰에 billing_key 컬럼이 없다', selfBody[0] && !('billing_key' in selfBody[0]),
    Object.keys(selfBody[0] ?? {}).join(','));
  check('has_billing_key=true 로만 노출', selfBody[0]?.has_billing_key === true);

  const keyTry = await fetch(`${API}/rest/v1/subscriptions?select=billing_key`, {
    headers: { apikey: ANON, Authorization: `Bearer ${jwt1}` }
  });
  check('본 테이블 billing_key 조회 차단', !keyTry.ok, `HTTP ${keyTry.status} ${(await keyTry.text()).slice(0, 90)}`);

  const viewKeyTry = await fetch(`${API}/rest/v1/subscriptions_self?select=billing_key`, {
    headers: { apikey: ANON, Authorization: `Bearer ${jwt1}` }
  });
  check('뷰에서 billing_key 지정 조회도 차단', !viewKeyTry.ok,
    `HTTP ${viewKeyTry.status} ${(await viewKeyTry.text()).slice(0, 90)}`);

  const issueTry = await fetch(`${API}/rest/v1/billing_issue_requests?select=*`, {
    headers: { apikey: ANON, Authorization: `Bearer ${jwt1}` }
  });
  check('billing_issue_requests 접근 차단', !issueTry.ok, `HTTP ${issueTry.status}`);

  const writeTry = await fetch(`${API}/rest/v1/subscriptions?user_id=eq.${ids.forged}`, {
    method: 'PATCH',
    headers: { apikey: ANON, Authorization: `Bearer ${jwt1}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'active' })
  });
  check('클라이언트가 구독을 직접 수정 불가', !writeTry.ok, `HTTP ${writeTry.status}`);

  console.log(`\n포트원 목 호출 횟수: ${JSON.stringify(mock.calls)}`);
  console.log(`\n${failures === 0 ? '전부 PASS' : `${failures}건 FAIL`}`);
  shutdown(failures === 0 ? 0 : 1);
} catch (err) {
  console.error('\n프로브 실패:', err);
  console.error(webLog.slice(-40).join(''));
  shutdown(1);
}
