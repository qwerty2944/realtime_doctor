#!/usr/bin/env node
// S4 검증 프로브 — 포트원 웹훅 수신 / 재예약 / 예약 누락 감시 크론.
//
// 로컬 Supabase 스택(포트 553xx)에만 붙는다. 실제 프로젝트는 건드리지 않는다.
// 포트원 HTTP 계층은 이 스크립트가 띄우는 목 서버로 대체된다 (PORTONE_API_BASE).
// 라우트 코드 자체는 진짜다 -- 실제 next 서버를 띄우고 HTTP 로 때린다.
// 웹훅 서명도 진짜다 -- @portone/server-sdk 가 검증하는 그 HMAC 을 그대로 만든다.
//
// 실행:
//   supabase start
//   supabase functions serve --env-file supabase/functions/.env   (자격 판정 확인용)
//   node scripts/probe-webhook.mjs

import { execFileSync, spawn } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';

const API = 'http://127.0.0.1:55321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const MOCK_PORT = 5601;
const WEB_PORT = 3112;
const WEB = `http://127.0.0.1:${WEB_PORT}`;

// 포트원 콘솔의 웹훅 시크릿과 같은 형식 (whsec_ + base64).
const WEBHOOK_SECRET = `whsec_${Buffer.from('probe-webhook-secret-0123456789ab').toString('base64')}`;
const CRON_SECRET = 'probe-cron-secret';

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures += 1;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}
function info(label, value) {
  console.log(`       ${label}: ${value}`);
}

function sql(text) {
  return execFileSync(
    'docker',
    ['exec', '-i', 'supabase_db_realtime_doctor', 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', text],
    { encoding: 'utf8' }
  ).trim();
}
function sqlTable(text) {
  return execFileSync(
    'docker',
    ['exec', '-i', 'supabase_db_realtime_doctor', 'psql', '-U', 'postgres', '-d', 'postgres', '-c', text],
    { encoding: 'utf8' }
  ).trim();
}

const customerIdOf = (userId) => `rd${createHash('sha256').update(userId).digest('hex').slice(0, 18)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 포트원 목 서버
// ---------------------------------------------------------------------------
const mock = {
  keys: new Map(),      // billingKey -> { customerId, status }
  paid: new Set(),      // 즉시결제된 paymentId
  payments: new Map(),  // paymentId -> GET /payments/{id} 응답
  schedules: new Map(), // paymentId -> { timeToPay, billingKey }
  calls: { get: 0, pay: 0, schedule: 0, payment: 0 }
};

function startMock() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (!(req.headers.authorization ?? '').startsWith('PortOne ')) return send(401, { type: 'UNAUTHORIZED' });

    const bk = url.pathname.match(/^\/billing-keys\/(.+)$/);
    if (req.method === 'GET' && bk) {
      mock.calls.get += 1;
      const rec = mock.keys.get(decodeURIComponent(bk[1]));
      if (!rec) return send(404, { type: 'BILLING_KEY_NOT_FOUND', message: '빌링키를 찾을 수 없습니다.' });
      return send(200, {
        status: rec.status ?? 'ISSUED',
        billingKey: decodeURIComponent(bk[1]),
        customer: { id: rec.customerId },
        methods: [{ card: { issuer: '신한카드', number: '433012******1234' } }],
        issuedAt: new Date().toISOString()
      });
    }

    // GET /payments/{id} — 웹훅이 사실 확인용으로 부르는 곳.
    const pget = url.pathname.match(/^\/payments\/([^/]+)$/);
    if (req.method === 'GET' && pget) {
      mock.calls.payment += 1;
      const id = decodeURIComponent(pget[1]);
      const rec = mock.payments.get(id);
      if (!rec) return send(404, { type: 'PAYMENT_NOT_FOUND', message: id });
      return send(200, rec);
    }

    let bodyText = '';
    req.on('data', (c) => (bodyText += c));
    req.on('end', () => {
      const body = bodyText ? JSON.parse(bodyText) : {};
      const pay = url.pathname.match(/^\/payments\/(.+)\/billing-key$/);
      if (req.method === 'POST' && pay) {
        mock.calls.pay += 1;
        const paymentId = decodeURIComponent(pay[1]);
        if (mock.paid.has(paymentId)) return send(409, { type: 'PAYMENT_ALREADY_PAID', message: '이미 결제된 건입니다.' });
        const rec = mock.keys.get(body.billingKey);
        if (rec?.decline) return send(402, { type: 'PG_PROVIDER_ERROR', message: '한도 초과입니다.' });
        mock.paid.add(paymentId);
        mock.payments.set(paymentId, {
          id: paymentId,
          status: 'PAID',
          paidAt: new Date().toISOString(),
          amount: { total: body.amount.total, paid: body.amount.total },
          customer: { id: body.customer.id },
          billingKey: body.billingKey
        });
        return send(200, { payment: { id: paymentId, status: 'PAID', paidAt: new Date().toISOString() } });
      }
      const sch = url.pathname.match(/^\/payments\/(.+)\/schedule$/);
      if (req.method === 'POST' && sch) {
        mock.calls.schedule += 1;
        const paymentId = decodeURIComponent(sch[1]);
        if (mock.schedules.has(paymentId)) {
          // 실제 포트원도 같은 paymentId 재예약을 거부한다. 중복 예약이 절대
          // 만들어지지 않는지 확인하기 위한 마지막 그물.
          return send(409, { type: 'PAYMENT_ALREADY_SCHEDULED', message: paymentId });
        }
        mock.schedules.set(paymentId, { timeToPay: body.timeToPay, billingKey: body.payment.billingKey, customerId: body.payment.customer.id });
        return send(200, { schedule: { id: `sch_${paymentId}`, timeToPay: body.timeToPay } });
      }
      send(404, { type: 'NOT_FOUND', message: url.pathname });
    });
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------------------
// 웹훅 서명 — @portone/server-sdk 가 검증하는 그 방식 (svix 호환)
// ---------------------------------------------------------------------------
function signWebhook(secret, id, timestamp, payload) {
  const raw = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const sig = createHmac('sha256', raw).update(`${id}.${timestamp}.${payload}`).digest('base64');
  return `v1,${sig}`;
}

/** 서명된(혹은 일부러 망가뜨린) 웹훅을 라우트로 보낸다. */
async function deliver(event, opts = {}) {
  const payload = JSON.stringify(event);
  const id = opts.eventId ?? `evt_${randomUUID()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  let signature = signWebhook(opts.secret ?? WEBHOOK_SECRET, id, ts, payload);
  if (opts.corrupt === 'signature') signature = 'v1,YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYQ==';
  const headers = { 'Content-Type': 'application/json' };
  if (!opts.omitHeaders) {
    headers['webhook-id'] = id;
    headers['webhook-timestamp'] = ts;
    headers['webhook-signature'] = signature;
  }
  // 본문을 서명 뒤에 한 글자 바꾼다 = 변조 시나리오.
  const sent = opts.corrupt === 'body' ? payload.replace('"data"', '"data "') : payload;
  const res = await fetch(`${WEB}/api/billing/webhook`, { method: 'POST', headers, body: sent });
  return { status: res.status, body: await res.json().catch(() => ({})), eventId: id };
}

/** 처리는 응답 뒤(after)에 돌기 때문에 처리 완료를 기다린다. */
async function waitProcessed(eventId, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const row = sql(
      `select coalesce(processed_at::text,'') || '|' || coalesce(processing_error,'') from public.webhook_events where portone_event_id='${eventId}'`
    );
    if (row && !row.startsWith('|')) return { ok: true };
    if (row && row.length > 1 && row.split('|')[1]) return { ok: false, error: row.split('|')[1] };
    await sleep(200);
  }
  return { ok: false, error: 'timeout' };
}

const paidEvent = (paymentId) => ({
  type: 'Transaction.Paid',
  timestamp: new Date().toISOString(),
  data: { paymentId, storeId: 'store-probe', transactionId: `tx_${paymentId}` }
});
const failedEvent = (paymentId) => ({
  type: 'Transaction.Failed',
  timestamp: new Date().toISOString(),
  data: { paymentId, storeId: 'store-probe', transactionId: `tx_${paymentId}` }
});

/** 예약된 결제가 실제로 승인된 것처럼 목을 세팅하고 웹훅을 보낸다. */
async function fireScheduledPayment(paymentId, customerId, { fail = false, amount = 77000 } = {}) {
  mock.payments.set(paymentId, fail
    ? {
        id: paymentId, status: 'FAILED', amount: { total: amount }, customer: { id: customerId },
        failure: { reason: 'CARD_EXPIRED', pgCode: 'PG_CARD_EXPIRED', pgMessage: '카드 유효기간이 만료되었습니다.' }
      }
    : {
        id: paymentId, status: 'PAID', paidAt: new Date().toISOString(),
        amount: { total: amount, paid: amount }, customer: { id: customerId }
      });
  const sent = await deliver(fail ? failedEvent(paymentId) : paidEvent(paymentId));
  const done = await waitProcessed(sent.eventId);
  return { ...sent, processed: done };
}

// ---------------------------------------------------------------------------
// Supabase 도우미 (probe-billing.mjs 와 동일)
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
function newJar() { return new Map(); }
function applySetCookie(jar, res) {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1);
    if (value === '') jar.delete(name); else jar.set(name, value);
  }
}
async function jarFetch(jar, url, init = {}) {
  const res = await fetch(url, {
    ...init, redirect: 'manual',
    headers: { ...(init.headers ?? {}), ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}) }
  });
  applySetCookie(jar, res);
  return res;
}
async function signInViaHandoff(email) {
  const jwt = await accessToken(email);
  const res = await fetch(`${WEB}/api/billing/handoff`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(`handoff: ${JSON.stringify(body)}`);
  const jar = newJar();
  await jarFetch(jar, body.url);
  return jar;
}

/** S3 경로 그대로 카드 등록 + 첫 결제. S4 시나리오의 출발점. */
async function subscribe(email, userId, billingKey) {
  const jar = await signInViaHandoff(email);
  const issue = await (await jarFetch(jar, `${WEB}/api/billing/issue-id`, { method: 'POST' })).json();
  mock.keys.set(billingKey, { customerId: customerIdOf(userId) });
  const res = await jarFetch(jar, `${WEB}/api/billing/complete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ issueId: issue.issueId, billingKey })
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`subscribe ${email}: ${JSON.stringify(body)}`);
  return body;
}

function subRow(userId) {
  const raw = sql(
    `select status, coalesce(current_period_start::text,''), coalesce(current_period_end::text,''), coalesce(billing_anchor_day::text,''), coalesce(billing_key,''), coalesce(grace_until::text,''), coalesce(card_last4,'') from public.subscriptions where user_id='${userId}'`
  ).split('|');
  return { status: raw[0], periodStart: raw[1], periodEnd: raw[2], anchorDay: raw[3], billingKey: raw[4], graceUntil: raw[5], last4: raw[6] };
}
function nextScheduled(userId) {
  const raw = sql(
    `select payment_id || '|' || scheduled_for::text from public.payment_attempts where user_id='${userId}' and status='scheduled' order by scheduled_for desc limit 1`
  );
  if (!raw) return null;
  const [paymentId, scheduledFor] = raw.split('|');
  return { paymentId, scheduledFor };
}
const countAttempts = (userId, status) =>
  Number(sql(`select count(*) from public.payment_attempts where user_id='${userId}'${status ? ` and status='${status}'` : ''}`));

async function entitlement(email) {
  const jwt = await accessToken(email);
  const res = await fetch(`${API}/functions/v1/entitlement`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, apikey: ANON, 'Content-Type': 'application/json' }, body: '{}'
  });
  return { status: res.status, body: await res.json() };
}

async function runWatchdog(token = CRON_SECRET) {
  const res = await fetch(`${WEB}/api/billing/watchdog`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------
console.log('=== S4 probe: 포트원 웹훅 / 재예약 / 예약 누락 감시 ===\n');

const mockServer = await startMock();
console.log(`포트원 목 서버: http://127.0.0.1:${MOCK_PORT}`);

const web = spawn('npx', ['next', 'dev', '-p', String(WEB_PORT), '-H', '127.0.0.1'], {
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
    PORTONE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    BILLING_CRON_SECRET: CRON_SECRET,
    BILLING_HANDOFF_SECRET: 'probe-handoff-secret',
    NEXT_PUBLIC_APP_ORIGIN: WEB
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
const webLog = [];
web.stdout.on('data', (d) => webLog.push(String(d)));
web.stderr.on('data', (d) => webLog.push(String(d)));

async function waitForWeb() {
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(`${WEB}/login`)).status < 500) return true; } catch { /* 아직 */ }
    await sleep(1000);
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
    cycle: `probe-wh-cycle-${stamp}@example.com`,
    dup: `probe-wh-dup-${stamp}@example.com`,
    fail: `probe-wh-fail-${stamp}@example.com`,
    del: `probe-wh-del-${stamp}@example.com`,
    dog: `probe-wh-dog-${stamp}@example.com`,
    eom: `probe-wh-eom-${stamp}@example.com`
  };
  const ids = {};
  for (const [k, e] of Object.entries(emails)) ids[k] = await createUser(e);

  // === 시나리오 1: 정상 성공 웹훅 → 기간 전진 + 다음 달 재예약 ==============
  console.log('--- 시나리오 1: 서명된 결제 성공 웹훅 → 기간 1개월 전진 + 새 예약 ---');
  await subscribe(emails.cycle, ids.cycle, 'bk_cycle');
  const before1 = subRow(ids.cycle);
  const sched1 = nextScheduled(ids.cycle);
  info('첫 결제 후 주기', `${before1.periodStart} → ${before1.periodEnd} (앵커일 ${before1.anchorDay})`);
  info('첫 결제 후 예약', `${sched1.paymentId} @ ${sched1.scheduledFor}`);

  const fire1 = await fireScheduledPayment(sched1.paymentId, customerIdOf(ids.cycle));
  check('웹훅이 200 을 받는다', fire1.status === 200, JSON.stringify(fire1.body));
  check('처리 완료(processed_at 기록)', fire1.processed.ok, fire1.processed.error ?? '');

  const after1 = subRow(ids.cycle);
  const sched2 = nextScheduled(ids.cycle);
  info('웹훅 후 주기', `${after1.periodStart} → ${after1.periodEnd}`);
  info('웹훅 후 예약', `${sched2?.paymentId} @ ${sched2?.scheduledFor}`);
  check('status=active', after1.status === 'active', after1.status);
  check('새 주기의 시작 = 직전 주기의 끝 (now() 가 아니다)',
    Date.parse(after1.periodStart) === Date.parse(before1.periodEnd),
    `${after1.periodStart} vs ${before1.periodEnd}`);
  const advDays = Math.round((Date.parse(after1.periodEnd) - Date.parse(before1.periodEnd)) / 86400000);
  check('기간이 한 달(28~31일) 전진', advDays >= 28 && advDays <= 31, `${advDays}일`);
  check('새 예약이 생겼다', !!sched2 && sched2.paymentId !== sched1.paymentId,
    `${sched1.paymentId} → ${sched2?.paymentId}`);
  check('새 예약 시각 = 새 주기의 끝',
    !!sched2 && Date.parse(sched2.scheduledFor) === Date.parse(after1.periodEnd),
    `${sched2?.scheduledFor} vs ${after1.periodEnd}`);
  check('포트원 예약 API 가 실제로 호출됐다', mock.schedules.has(sched2.paymentId), sched2.paymentId);
  check('결제 성공이 payment_attempts 에 기록', countAttempts(ids.cycle, 'paid') === 2,
    `paid ${countAttempts(ids.cycle, 'paid')}건 (첫 결제 + 이번 주기)`);
  console.log('\n예약된 행:');
  console.log(sqlTable(
    `select payment_id, status, amount_krw, scheduled_for from public.payment_attempts where user_id='${ids.cycle}' order by created_at`
  ));

  // === 시나리오 2: 같은 이벤트 두 번 전달 (멱등성) ==========================
  console.log('\n--- 시나리오 2: 같은 이벤트 재전달 → 기간 1회만 전진, 예약 1개 ---');
  await subscribe(emails.dup, ids.dup, 'bk_dup');
  const dupSched = nextScheduled(ids.dup);
  const dupCust = customerIdOf(ids.dup);
  mock.payments.set(dupSched.paymentId, {
    id: dupSched.paymentId, status: 'PAID', paidAt: new Date().toISOString(),
    amount: { total: 77000, paid: 77000 }, customer: { id: dupCust }
  });
  const evt = paidEvent(dupSched.paymentId);
  const fixedId = `evt_dup_${stamp}`;
  const d1 = await deliver(evt, { eventId: fixedId });
  await waitProcessed(fixedId);
  const midEnd = subRow(ids.dup).periodEnd;
  const scheduleCallsBefore = mock.calls.schedule;
  const d2 = await deliver(evt, { eventId: fixedId });
  await sleep(1500);
  const dupAfter = subRow(ids.dup);

  check('1회차 200', d1.status === 200 && !d1.body.duplicate, JSON.stringify(d1.body));
  check('2회차도 200 (재전송 폭풍 방지)', d2.status === 200, JSON.stringify(d2.body));
  check('2회차는 duplicate 로 식별', d2.body.duplicate === true, JSON.stringify(d2.body));
  check('기간이 두 번 늘지 않았다', Date.parse(dupAfter.periodEnd) === Date.parse(midEnd),
    `${midEnd} → ${dupAfter.periodEnd}`);
  check('예약 API 추가 호출 없음', mock.calls.schedule === scheduleCallsBefore,
    `${mock.calls.schedule - scheduleCallsBefore}회 추가`);
  check('webhook_events 행 1개, attempt_count=2',
    sql(`select count(*)||'/'||max(attempt_count) from public.webhook_events where portone_event_id='${fixedId}'`) === '1/2',
    sql(`select count(*)||'/'||max(attempt_count) from public.webhook_events where portone_event_id='${fixedId}'`));
  check('해당 결제의 payment_attempts 행 1개',
    Number(sql(`select count(*) from public.payment_attempts where payment_id='${dupSched.paymentId}'`)) === 1);
  check('미래 예약 정확히 1건',
    Number(sql(`select count(*) from public.payment_attempts where user_id='${ids.dup}' and status='scheduled' and scheduled_for > now()`)) === 1);

  // --- 이벤트 id 가 달라도 같은 결제는 두 번 반영되지 않는다 (멱등성 2겹) ---
  const d3 = await deliver(evt);
  await waitProcessed(d3.eventId);
  const dupAfter2 = subRow(ids.dup);
  check('이벤트 id 가 달라도 기간은 그대로 (멱등성 2겹)',
    Date.parse(dupAfter2.periodEnd) === Date.parse(midEnd), `${dupAfter2.periodEnd}`);

  // === 시나리오 3: 서명 없는 / 잘못된 웹훅 ==================================
  console.log('\n--- 시나리오 3: 미서명·위조 웹훅 → 거부, DB 무변화 ---');
  const evBefore = Number(sql('select count(*) from public.webhook_events'));
  const paBefore = Number(sql('select count(*) from public.payment_attempts'));
  const cycleBefore = subRow(ids.cycle);

  const unsigned = await deliver(paidEvent(sched2.paymentId), { omitHeaders: true });
  check('헤더 없는 요청 거부', unsigned.status === 400 && unsigned.body.error === 'invalid_signature',
    `${unsigned.status} ${JSON.stringify(unsigned.body)}`);
  info('거부 사유', unsigned.body.reason);

  const badSig = await deliver(paidEvent(sched2.paymentId), { corrupt: 'signature' });
  check('잘못된 서명 거부', badSig.status === 400 && badSig.body.reason === 'NO_MATCHING_SIGNATURE',
    `${badSig.status} ${JSON.stringify(badSig.body)}`);

  const wrongSecret = await deliver(paidEvent(sched2.paymentId), {
    secret: `whsec_${Buffer.from('attacker-secret-0123456789abcdef').toString('base64')}`
  });
  check('공격자 시크릿으로 서명한 요청 거부', wrongSecret.status === 400,
    `${wrongSecret.status} ${JSON.stringify(wrongSecret.body)}`);

  const tampered = await deliver(paidEvent(sched2.paymentId), { corrupt: 'body' });
  check('서명 후 본문 변조 거부 (원문 바이트로 검증한다)', tampered.status === 400,
    `${tampered.status} ${JSON.stringify(tampered.body)}`);

  await sleep(800);
  check('webhook_events 에 아무것도 쓰이지 않았다',
    Number(sql('select count(*) from public.webhook_events')) === evBefore,
    `${evBefore} → ${sql('select count(*) from public.webhook_events')}`);
  check('payment_attempts 에도 쓰이지 않았다',
    Number(sql('select count(*) from public.payment_attempts')) === paBefore);
  check('구독 상태도 그대로', JSON.stringify(subRow(ids.cycle)) === JSON.stringify(cycleBefore));

  // === 시나리오 4: 결제 실패 → past_due + 유예, 유예 중 자격 유지 ===========
  console.log('\n--- 시나리오 4: 결제 실패 → past_due + grace_until, 유예 중에는 잠기지 않는다 ---');
  await subscribe(emails.fail, ids.fail, 'bk_fail');
  const failSched = nextScheduled(ids.fail);
  const fireFail = await fireScheduledPayment(failSched.paymentId, customerIdOf(ids.fail), { fail: true });
  check('실패 웹훅 200', fireFail.status === 200);
  check('처리 완료', fireFail.processed.ok, fireFail.processed.error ?? '');
  const failRow = subRow(ids.fail);
  info('실패 후 구독', `status=${failRow.status} period_end=${failRow.periodEnd} grace_until=${failRow.graceUntil}`);
  check('status=past_due', failRow.status === 'past_due', failRow.status);
  const graceDays = Math.round((Date.parse(failRow.graceUntil) - Date.now()) / 86400000);
  check('grace_until 이 7일 뒤로 설정', graceDays === 7, `${graceDays}일 (${failRow.graceUntil})`);
  const failAttempt = sql(
    `select status||'|'||coalesce(failure_code,'')||'|'||coalesce(failure_message,'') from public.payment_attempts where payment_id='${failSched.paymentId}'`
  );
  check('실패가 payment_attempts 에 기록', failAttempt.startsWith('failed|PG_CARD_EXPIRED|'), failAttempt);

  const entGrace = await entitlement(emails.fail);
  if (entGrace.status === 0 || !entGrace.body?.token) {
    check('entitlement Edge Function 응답', false, `HTTP ${entGrace.status} — supabase functions serve 가 떠 있는지 확인`);
  } else {
    check('[HARD] 유예 중 entitlement 는 여전히 ENTITLED', entGrace.body.token.entitled === true,
      `entitled=${entGrace.body.token.entitled} status=${entGrace.body.token.status} reason=${entGrace.body.token.reason}`);
    info('유예 중 판정', `status=${entGrace.body.token.status} reason=${entGrace.body.token.reason} coverageEnd=${entGrace.body.token.coverageEnd}`);
  }

  // 유예가 끝난 뒤. (주기 끝도 함께 과거로 보낸다 -- 판정은 둘 중 늦은 쪽이다.)
  sql(`update public.subscriptions set grace_until = now() - interval '1 hour', current_period_end = now() - interval '2 hour' where user_id='${ids.fail}'`);
  const entExpired = await entitlement(emails.fail);
  if (entExpired.body?.token) {
    check('[HARD] 유예 만료 후 entitlement 는 NOT ENTITLED', entExpired.body.token.entitled === false,
      `entitled=${entExpired.body.token.entitled} reason=${entExpired.body.token.reason}`);
    info('유예 만료 후 판정', `status=${entExpired.body.token.status} reason=${entExpired.body.token.reason}`);
  } else {
    check('유예 만료 후 entitlement 응답', false, `HTTP ${entExpired.status}`);
  }

  // === 시나리오 5: BillingKey.Deleted =======================================
  console.log('\n--- 시나리오 5: BillingKey.Deleted → 빌링키 제거 ---');
  await subscribe(emails.del, ids.del, 'bk_del');
  const delBefore = subRow(ids.del);
  check('삭제 전 빌링키 보유', delBefore.billingKey === 'bk_del' && delBefore.last4 === '1234',
    `${delBefore.billingKey} / ****${delBefore.last4}`);
  const delEvt = await deliver({
    type: 'BillingKey.Deleted', timestamp: new Date().toISOString(),
    data: { billingKey: 'bk_del', storeId: 'store-probe' }
  });
  const delDone = await waitProcessed(delEvt.eventId);
  check('삭제 웹훅 처리 완료', delEvt.status === 200 && delDone.ok, delDone.error ?? '');
  const delAfter = subRow(ids.del);
  check('billing_key 가 비워졌다', delAfter.billingKey === '', `"${delAfter.billingKey}"`);
  check('마스킹 카드 정보도 제거', delAfter.last4 === '', `"${delAfter.last4}"`);
  check('has_billing_key 뷰도 false',
    sql(`select (billing_key is not null)::text from public.subscriptions where user_id='${ids.del}'`) === 'false');
  check('이미 낸 기간은 유지 (상태는 그대로)', delAfter.status === 'active', delAfter.status);

  // === 시나리오 6: 미지원 이벤트 ============================================
  console.log('\n--- 시나리오 6: 관심 없는 이벤트 → 저장하고 200 (영구 재전송 방지) ---');
  const unknown = await deliver({
    type: 'Transaction.DisputeCreated', timestamp: new Date().toISOString(),
    data: { paymentId: 'whatever', storeId: 'store-probe', transactionId: 'tx_x' }
  });
  const unknownDone = await waitProcessed(unknown.eventId);
  check('200 을 돌려준다', unknown.status === 200, String(unknown.status));
  check('webhook_events 에 남는다',
    sql(`select type from public.webhook_events where portone_event_id='${unknown.eventId}'`) === 'Transaction.DisputeCreated');
  check('processing_error 없이 처리 완료', unknownDone.ok, unknownDone.error ?? '');

  // === 시나리오 7: 예약 누락 감시 크론 ======================================
  console.log('\n--- 시나리오 7: 감시 크론 — 예약이 사라진 구독을 탐지·복구 ---');
  await subscribe(emails.dog, ids.dog, 'bk_dog');
  const dogSched = nextScheduled(ids.dog);
  // "재예약이 조용히 실패한" 상태를 만든다: 예약 흔적을 지운다.
  sql(`delete from public.payment_attempts where payment_id='${dogSched.paymentId}'`);
  mock.schedules.delete(dogSched.paymentId);
  check('예약이 사라진 상태를 만들었다', nextScheduled(ids.dog) === null);

  const runsBefore = Number(sql('select count(*) from public.subscription_watchdog_runs'));
  const noAuth = await fetch(`${WEB}/api/billing/watchdog`, { method: 'POST' });
  check('시크릿 없이는 크론을 부를 수 없다', noAuth.status === 401, `HTTP ${noAuth.status}`);
  const wrongAuth = await runWatchdog('not-the-secret');
  check('틀린 시크릿 거부', wrongAuth.status === 401, `HTTP ${wrongAuth.status}`);

  const dog1 = await runWatchdog();
  const dogFinding = (dog1.body.findings ?? []).find((f) => f.userId === ids.dog);
  check('크론 실행 성공', dog1.status === 200 && dog1.body.ok === true, JSON.stringify(dog1.body).slice(0, 160));
  check('누락을 탐지했다', !!dogFinding, JSON.stringify(dogFinding ?? null));
  check('복구했다(예약 생성)', dogFinding?.action === 'scheduled', dogFinding?.action);
  info('탐지 내용', JSON.stringify(dogFinding));
  const dogRepaired = nextScheduled(ids.dog);
  check('예약이 되살아났다', !!dogRepaired, JSON.stringify(dogRepaired));
  check('예약 시각 = 현재 주기의 끝',
    !!dogRepaired && Date.parse(dogRepaired.scheduledFor) === Date.parse(subRow(ids.dog).periodEnd),
    `${dogRepaired?.scheduledFor} vs ${subRow(ids.dog).periodEnd}`);
  check('포트원에 실제로 예약됐다', mock.schedules.has(dogRepaired.paymentId));

  const schedCallsBeforeSecondRun = mock.calls.schedule;
  const dog2 = await runWatchdog();
  const dogFinding2 = (dog2.body.findings ?? []).find((f) => f.userId === ids.dog);
  check('두 번째 실행은 이 구독에 아무 조치도 하지 않는다', !dogFinding2, JSON.stringify(dogFinding2 ?? null));
  check('예약 API 를 다시 부르지 않는다 (멱등)', mock.calls.schedule === schedCallsBeforeSecondRun,
    `${mock.calls.schedule - schedCallsBeforeSecondRun}회 추가`);
  check('예약이 중복되지 않았다',
    Number(sql(`select count(*) from public.payment_attempts where user_id='${ids.dog}' and status='scheduled' and scheduled_for > now()`)) === 1);
  info('2차 실행 결과', `checked=${dog2.body.checked} missing=${dog2.body.missing} repaired=${dog2.body.repaired}`);
  // 인증 실패 2회는 기록되지 않아야 하고(잡이 돈 게 아니다), 정상 실행 2회는
  // 문제를 찾았든 못 찾았든 둘 다 기록돼야 한다.
  const runsAfter = Number(sql('select count(*) from public.subscription_watchdog_runs'));
  check('문제가 없어도 실행 기록이 남는다 (조용한 0 ≠ 안 돈 잡)', runsAfter - runsBefore === 2,
    `실행 2회 → 기록 ${runsAfter - runsBefore}건`);
  check('아무것도 못 찾은 실행도 finished_at 과 함께 남는다',
    sql('select (finished_at is not null)::text || \'|\' || missing_count from public.subscription_watchdog_runs order by started_at desc limit 1') === 'true|0');
  console.log('\n감시 크론 실행 기록:');
  console.log(sqlTable(
    "select to_char(started_at,'HH24:MI:SS') as started, finished_at is not null as finished, checked_count, missing_count, repaired_count, failed_count from public.subscription_watchdog_runs order by started_at desc limit 5"
  ));
  check('빌링키가 없는 구독은 예약 대상에서 제외된다 (BillingKey.Deleted 사용자)',
    !(dog1.body.findings ?? []).some((f) => f.userId === ids.del) && !(dog2.body.findings ?? []).some((f) => f.userId === ids.del));

  // === 시나리오 8: 말일 주기 산술 ===========================================
  console.log('--- 시나리오 8: 31일 가입자 — 2월에 28일로 잘려도 3월엔 31일로 돌아온다 ---');
  await subscribe(emails.eom, ids.eom, 'bk_eom');
  // 앵커 31, 주기 끝 = 1/31 인 상태로 세팅한다 (미래 연도라 stale 판정에 안 걸린다).
  const y = new Date().getUTCFullYear() + 1;
  sql(`update public.subscriptions set billing_anchor_day=31, current_period_start='${y}-01-01T00:00:00Z', current_period_end='${y}-01-31T00:00:00Z' where user_id='${ids.eom}'`);
  sql(`delete from public.payment_attempts where user_id='${ids.eom}' and status='scheduled'`);

  const eomCust = customerIdOf(ids.eom);
  const eomPay1 = `probe_eom_1_${stamp}`;
  await db_insertAttempt(ids.eom, eomPay1);
  const eomFire1 = await fireScheduledPayment(eomPay1, eomCust);
  check('1월 결제 웹훅 처리', eomFire1.processed.ok, eomFire1.processed.error ?? '');
  const eom1 = subRow(ids.eom);
  info('1/31 결제 후', `${eom1.periodStart} → ${eom1.periodEnd}`);
  check(`${y}-01-31 → ${y}-02-28 로 클램프`, eom1.periodEnd.startsWith(`${y}-02-28`), eom1.periodEnd);
  check('앵커일은 31 로 유지된다 (28로 침식되지 않는다)', eom1.anchorDay === '31', eom1.anchorDay);

  const eomPay2 = `probe_eom_2_${stamp}`;
  await db_insertAttempt(ids.eom, eomPay2);
  const eomFire2 = await fireScheduledPayment(eomPay2, eomCust);
  check('2월 결제 웹훅 처리', eomFire2.processed.ok, eomFire2.processed.error ?? '');
  const eom2 = subRow(ids.eom);
  info('2/28 결제 후', `${eom2.periodStart} → ${eom2.periodEnd}`);
  check(`${y}-02-28 → ${y}-03-31 로 앵커 복귀`, eom2.periodEnd.startsWith(`${y}-03-31`), eom2.periodEnd);

  // === 시나리오 9: 3개월 연속 — 두 번째 달에 멈추지 않는다 ==================
  console.log('\n--- 시나리오 9: 3주기 연속 청구 (S4 가 없으면 2주기에서 멈추는 자리) ---');
  const cycles = [];
  let cur = subRow(ids.cycle);
  let sched = nextScheduled(ids.cycle);
  for (let i = 1; i <= 3; i += 1) {
    const fired = await fireScheduledPayment(sched.paymentId, customerIdOf(ids.cycle));
    if (!fired.processed.ok) { check(`${i}주기 처리`, false, fired.processed.error); break; }
    const now = subRow(ids.cycle);
    const nxt = nextScheduled(ids.cycle);
    cycles.push({
      주기: i,
      청구된_paymentId: sched.paymentId,
      새_주기: `${now.periodStart.slice(0, 10)} → ${now.periodEnd.slice(0, 10)}`,
      다음_예약: nxt ? `${nxt.paymentId} @ ${nxt.scheduledFor.slice(0, 10)}` : '(없음!)',
      상태: now.status
    });
    check(`${i}주기: 기간이 전진했다`, Date.parse(now.periodEnd) > Date.parse(cur.periodEnd),
      `${cur.periodEnd.slice(0, 10)} → ${now.periodEnd.slice(0, 10)}`);
    check(`${i}주기: 다음 예약이 존재한다 (여기가 끊기면 과금이 멈춘다)`,
      !!nxt && nxt.paymentId !== sched.paymentId, nxt?.paymentId ?? '(없음)');
    cur = now; sched = nxt;
    if (!sched) break;
  }
  console.table(cycles);
  check('3주기 전부 완주', cycles.length === 3, `${cycles.length}주기`);
  check('총 결제 성공 건수 = 첫 결제 + 1(시나리오1) + 3', countAttempts(ids.cycle, 'paid') === 5,
    `${countAttempts(ids.cycle, 'paid')}건`);
  check('미래 예약은 항상 정확히 1건',
    Number(sql(`select count(*) from public.payment_attempts where user_id='${ids.cycle}' and status='scheduled' and scheduled_for > now()`)) === 1);
  console.log('\ncycle 사용자 결제 이력:');
  console.log(sqlTable(
    `select payment_id, status, amount_krw, to_char(scheduled_for,'YYYY-MM-DD') as scheduled from public.payment_attempts where user_id='${ids.cycle}' order by created_at`
  ));

  console.log(`\n포트원 목 호출: ${JSON.stringify(mock.calls)}`);
  console.log(`\n${failures === 0 ? '전부 PASS' : `${failures}건 FAIL`}`);
  shutdown(failures === 0 ? 0 : 1);
} catch (err) {
  console.error('\n프로브 실패:', err);
  console.error(webLog.slice(-60).join(''));
  shutdown(1);
}

/** 예약된 결제 행을 직접 만든다 (말일 시나리오에서 날짜를 강제로 정하기 위해). */
async function db_insertAttempt(userId, paymentId) {
  sql(
    `insert into public.payment_attempts (user_id, payment_id, amount_krw, status, scheduled_for, raw_json) values ('${userId}','${paymentId}',77000,'scheduled', now() + interval '1 day', '{"kind":"probe"}'::jsonb)`
  );
}
