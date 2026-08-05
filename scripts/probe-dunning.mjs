#!/usr/bin/env node
// S5 검증 프로브 — dunning 사다리 / 유예 만료 / 웹훅 재처리 / 해지 / 기기 수 제한.
//
// probe-webhook.mjs(S4) 와 같은 방식이다. 로컬 Supabase 스택(포트 553xx)에만 붙고,
// 포트원 HTTP 계층만 목 서버로 대체한다. 라우트·Edge Function 코드는 전부 진짜이고
// 실제 next 서버를 띄워 HTTP 로 때린다. 웹훅 서명도 진짜 HMAC 이다.
//
// 실행:
//   supabase start
//   supabase functions serve --env-file supabase/functions/.env
//   node scripts/probe-dunning.mjs

import { execFileSync, spawn } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';

const API = 'http://127.0.0.1:55321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const MOCK_PORT = 5611;
const WEB_PORT = 3113;
const WEB = `http://127.0.0.1:${WEB_PORT}`;

const WEBHOOK_SECRET = `whsec_${Buffer.from('probe-dunning-secret-0123456789ab').toString('base64')}`;
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
// 포트원 목 서버 — S4 목 + 예약 취소(DELETE /payment-schedules)
// ---------------------------------------------------------------------------
const mock = {
  keys: new Map(),
  paid: new Set(),
  payments: new Map(),
  /** paymentId -> { scheduleId, timeToPay, billingKey } */
  schedules: new Map(),
  /** scheduleId -> paymentId (취소 조회용) */
  byScheduleId: new Map(),
  /** 취소된 scheduleId 기록 — "해지가 실제로 예약을 걷어냈는가"의 증거. */
  revoked: [],
  calls: { get: 0, pay: 0, schedule: 0, payment: 0, revoke: 0 }
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

    const pget = url.pathname.match(/^\/payments\/([^/]+)$/);
    if (req.method === 'GET' && pget) {
      mock.calls.payment += 1;
      const id = decodeURIComponent(pget[1]);
      const rec = mock.payments.get(id);
      if (!rec) return send(404, { type: 'PAYMENT_NOT_FOUND', message: id });
      return send(200, rec);
    }

    // DELETE /payment-schedules?requestBody={"billingKey":..,"scheduleIds":[..]}
    if (req.method === 'DELETE' && url.pathname === '/payment-schedules') {
      mock.calls.revoke += 1;
      let body = {};
      try {
        body = JSON.parse(url.searchParams.get('requestBody') ?? '{}');
      } catch { /* 무시 */ }
      const ids = body.scheduleIds ?? [];
      const revoked = [];
      for (const id of ids) {
        const paymentId = mock.byScheduleId.get(id);
        if (!paymentId) continue;
        // 실제 포트원처럼 예약을 없앤다. 없어져야 같은 paymentId 로 재예약이 된다.
        mock.schedules.delete(paymentId);
        mock.byScheduleId.delete(id);
        mock.paid.delete(paymentId);
        revoked.push(id);
        mock.revoked.push({ scheduleId: id, paymentId, at: new Date().toISOString() });
      }
      return send(200, { revokedScheduleIds: revoked, revokedAt: new Date().toISOString() });
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
          id: paymentId, status: 'PAID', paidAt: new Date().toISOString(),
          amount: { total: body.amount.total, paid: body.amount.total },
          customer: { id: body.customer.id }, billingKey: body.billingKey
        });
        return send(200, { payment: { id: paymentId, status: 'PAID', paidAt: new Date().toISOString() } });
      }
      const sch = url.pathname.match(/^\/payments\/(.+)\/schedule$/);
      if (req.method === 'POST' && sch) {
        mock.calls.schedule += 1;
        const paymentId = decodeURIComponent(sch[1]);
        if (mock.schedules.has(paymentId)) {
          return send(409, { type: 'PAYMENT_ALREADY_SCHEDULED', message: paymentId });
        }
        const scheduleId = `sch_${paymentId}`;
        mock.schedules.set(paymentId, {
          scheduleId, timeToPay: body.timeToPay, billingKey: body.payment.billingKey
        });
        mock.byScheduleId.set(scheduleId, paymentId);
        return send(200, { schedule: { id: scheduleId, timeToPay: body.timeToPay } });
      }
      send(404, { type: 'NOT_FOUND', message: url.pathname });
    });
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------------------
// 웹훅 서명 / 전달
// ---------------------------------------------------------------------------
function signWebhook(secret, id, timestamp, payload) {
  const raw = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const sig = createHmac('sha256', raw).update(`${id}.${timestamp}.${payload}`).digest('base64');
  return `v1,${sig}`;
}

async function deliver(event, opts = {}) {
  const payload = JSON.stringify(event);
  const id = opts.eventId ?? `evt_${randomUUID()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const headers = {
    'Content-Type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': ts,
    'webhook-signature': signWebhook(WEBHOOK_SECRET, id, ts, payload)
  };
  const res = await fetch(`${WEB}/api/billing/webhook`, { method: 'POST', headers, body: payload });
  return { status: res.status, body: await res.json().catch(() => ({})), eventId: id };
}

async function waitSettled(eventId, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const row = sql(
      `select coalesce(processed_at::text,'') || '|' || coalesce(processing_error,'') from public.webhook_events where portone_event_id='${eventId}'`
    );
    if (row && !row.startsWith('|')) return { ok: true };
    if (row && row.split('|')[1]) return { ok: false, error: row.split('|')[1] };
    await sleep(200);
  }
  return { ok: false, error: 'timeout' };
}

const paidEvent = (paymentId) => ({
  type: 'Transaction.Paid', timestamp: new Date().toISOString(),
  data: { paymentId, storeId: 'store-probe', transactionId: `tx_${paymentId}` }
});
const failedEvent = (paymentId) => ({
  type: 'Transaction.Failed', timestamp: new Date().toISOString(),
  data: { paymentId, storeId: 'store-probe', transactionId: `tx_${paymentId}` }
});

/** 예약된 결제가 실제로 승인/거절된 것처럼 목을 세팅하고 웹훅을 보낸다. */
async function fireScheduled(paymentId, customerId, { fail = false } = {}) {
  mock.payments.set(paymentId, fail
    ? {
        id: paymentId, status: 'FAILED', amount: { total: 77000 }, customer: { id: customerId },
        failure: { reason: 'CARD_EXPIRED', pgCode: 'PG_CARD_EXPIRED', pgMessage: '카드 유효기간이 만료되었습니다.' }
      }
    : {
        id: paymentId, status: 'PAID', paidAt: new Date().toISOString(),
        amount: { total: 77000, paid: 77000 }, customer: { id: customerId }
      });
  const sent = await deliver(fail ? failedEvent(paymentId) : paidEvent(paymentId));
  return { ...sent, settled: await waitSettled(sent.eventId) };
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
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
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
  return { jar, body };
}

function subRow(userId) {
  const raw = sql(
    `select status, coalesce(current_period_end::text,''), coalesce(grace_until::text,''), dunning_rung::text, coalesce(dunning_started_at::text,''), cancel_at_period_end::text, coalesce(canceled_at::text,'') from public.subscriptions where user_id='${userId}'`
  ).split('|');
  return {
    status: raw[0], periodEnd: raw[1], graceUntil: raw[2], rung: raw[3],
    dunningStarted: raw[4], cancelAtPeriodEnd: raw[5] === 'true', canceledAt: raw[6]
  };
}
function nextScheduled(userId) {
  const raw = sql(
    `select payment_id || '|' || scheduled_for::text || '|' || attempt_kind || '|' || coalesce(portone_schedule_id,'') from public.payment_attempts where user_id='${userId}' and status='scheduled' and scheduled_for > now() order by scheduled_for limit 1`
  );
  if (!raw) return null;
  const [paymentId, scheduledFor, kind, scheduleId] = raw.split('|');
  return { paymentId, scheduledFor, kind, scheduleId };
}
const countFutureScheduled = (userId) =>
  Number(sql(`select count(*) from public.payment_attempts where user_id='${userId}' and status='scheduled' and scheduled_for > now()`));
const countAttempts = (userId, status) =>
  Number(sql(`select count(*) from public.payment_attempts where user_id='${userId}'${status ? ` and status='${status}'` : ''}`));

async function entitlement(email) {
  const jwt = await accessToken(email);
  const res = await fetch(`${API}/functions/v1/entitlement`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, apikey: ANON, 'Content-Type': 'application/json' }, body: '{}'
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function deviceCall(email, payload) {
  const jwt = await accessToken(email);
  const res = await fetch(`${API}/functions/v1/device`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function runWatchdog(token = CRON_SECRET) {
  const res = await fetch(`${WEB}/api/billing/watchdog`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// D+N 을 실제로 기다릴 수는 없으므로, 각 시나리오에서 dunning_started_at 을
// 과거로 밀어 "그 날이 됐다"를 만든다. 사다리의 due 판정이 오직
// dunning_started_at + 오프셋만 보기 때문에 이것으로 충분하다.

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------
console.log('=== S5 probe: dunning / 만료 / 웹훅 재처리 / 해지 / 기기 수 제한 ===\n');

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
    dun: `probe-s5-dun-${stamp}@example.com`,
    rec: `probe-s5-rec-${stamp}@example.com`,
    col: `probe-s5-col-${stamp}@example.com`,
    rep: `probe-s5-rep-${stamp}@example.com`,
    can: `probe-s5-can-${stamp}@example.com`,
    unc: `probe-s5-unc-${stamp}@example.com`,
    dev: `probe-s5-dev-${stamp}@example.com`
  };
  const ids = {};
  for (const [k, e] of Object.entries(emails)) ids[k] = await createUser(e);

  // =========================================================================
  // 시나리오 1: 전체 dunning 경로
  // =========================================================================
  console.log('--- 시나리오 1: 실패 → past_due → D+1/D+3/D+5 재시도 → 유예 만료 → expired ---');
  await subscribe(emails.dun, ids.dun, 'bk_dun');
  const dunSched = nextScheduled(ids.dun);
  const dunCust = customerIdOf(ids.dun);
  info('첫 결제 후 예약', `${dunSched.paymentId} (${dunSched.kind}) @ ${dunSched.scheduledFor}`);

  // --- D+0: 결제 실패 ---
  const f0 = await fireScheduled(dunSched.paymentId, dunCust, { fail: true });
  check('실패 웹훅 처리 완료', f0.status === 200 && f0.settled.ok, f0.settled.error ?? '');
  let r = subRow(ids.dun);
  info('D+0 이후', `status=${r.status} rung=${r.rung} grace_until=${r.graceUntil}`);
  check('status = past_due', r.status === 'past_due', r.status);
  check('유예가 7일로 열렸다',
    Math.round((Date.parse(r.graceUntil) - Date.now()) / 86400000) === 7, r.graceUntil);
  check('사다리는 아직 0단', r.rung === '0', r.rung);

  // --- [HARD] 유예 중에는 잠기지 않는다 ---
  const entD0 = await entitlement(emails.dun);
  check('[HARD] D+0 유예 중 앱은 UNLOCKED', entD0.body?.token?.entitled === true,
    `entitled=${entD0.body?.token?.entitled} reason=${entD0.body?.token?.reason}`);

  // --- 아직 D+1 이 안 됐으면 재시도는 안 잡힌다 ---
  const wdEarly = await runWatchdog();
  const fEarly = (wdEarly.body.findings ?? []).find((x) => x.userId === ids.dun);
  check('D+1 전에는 재시도를 잡지 않는다', !fEarly, JSON.stringify(fEarly ?? null));
  check('미래 예약 0건 (실패한 예약은 소진됐다)', countFutureScheduled(ids.dun) === 0,
    String(countFutureScheduled(ids.dun)));

  // --- D+1 ---
  const rungs = [];
  for (const [i, day] of [1, 3, 5].entries()) {
    const rung = i + 1;
    // dunning_started_at 을 뒤로 밀어 "D+day 가 됐다"를 만든다.
    sql(`update public.subscriptions set dunning_started_at = now() - interval '${day} days' where user_id='${ids.dun}'`);
    const schedBefore = mock.calls.schedule;
    const wd = await runWatchdog();
    const f = (wd.body.findings ?? []).find((x) => x.userId === ids.dun);
    check(`D+${day}: ${rung}단 재시도가 예약된다`, f?.action === 'scheduled' && f?.rung === rung,
      JSON.stringify(f ?? null));
    check(`D+${day}: 포트원 예약 API 1회만 호출`, mock.calls.schedule - schedBefore === 1,
      `${mock.calls.schedule - schedBefore}회`);
    const s = nextScheduled(ids.dun);
    check(`D+${day}: 예약 종류가 dunning_retry`, s?.kind === 'dunning_retry', s?.kind);
    check(`D+${day}: 미래 예약은 정확히 1건`, countFutureScheduled(ids.dun) === 1,
      String(countFutureScheduled(ids.dun)));
    r = subRow(ids.dun);
    check(`D+${day}: dunning_rung = ${rung}`, r.rung === String(rung), r.rung);

    // 같은 날 크론을 두 번 더 돌려도 아무 일도 없어야 한다 (재시도 폭풍 방지).
    const schedBefore2 = mock.calls.schedule;
    await runWatchdog();
    await runWatchdog();
    check(`D+${day}: 크론을 두 번 더 돌려도 추가 예약 없음`,
      mock.calls.schedule === schedBefore2 && countFutureScheduled(ids.dun) === 1,
      `예약API +${mock.calls.schedule - schedBefore2}, 미래예약 ${countFutureScheduled(ids.dun)}`);

    rungs.push({ 단: rung, paymentId: s.paymentId, 예약시각: s.scheduledFor });

    // 이 재시도도 실패한다.
    const fired = await fireScheduled(s.paymentId, dunCust, { fail: true });
    check(`D+${day}: 재시도 실패 웹훅 처리`, fired.settled.ok, fired.settled.error ?? '');
    r = subRow(ids.dun);
    check(`D+${day}: 유예가 연장되지 않는다 (유예가 영원해지면 안 된다)`,
      Math.round((Date.parse(r.graceUntil) - Date.now()) / 86400000) === 7, r.graceUntil);

    // 유예 중이므로 여전히 열려 있어야 한다.
    const ent = await entitlement(emails.dun);
    check(`[HARD] D+${day}: 재시도 실패 후에도 앱은 UNLOCKED`, ent.body?.token?.entitled === true,
      `entitled=${ent.body?.token?.entitled} reason=${ent.body?.token?.reason}`);
  }
  console.table(rungs);

  // --- 사다리 소진 후에는 더 이상 잡지 않는다 ---
  sql(`update public.subscriptions set dunning_started_at = now() - interval '6 days' where user_id='${ids.dun}'`);
  const schedBeforeExhaust = mock.calls.schedule;
  const wdExhaust = await runWatchdog();
  check('사다리 소진(3단) 뒤에는 재시도를 더 만들지 않는다',
    mock.calls.schedule === schedBeforeExhaust &&
      !(wdExhaust.body.findings ?? []).some((x) => x.userId === ids.dun && x.action === 'scheduled'),
    `예약API +${mock.calls.schedule - schedBeforeExhaust}`);

  // --- 유예 만료 ---
  sql(`update public.subscriptions set grace_until = now() - interval '1 hour', current_period_end = now() - interval '2 hour' where user_id='${ids.dun}'`);
  const wdExpire = await runWatchdog();
  const fExpire = (wdExpire.body.findings ?? []).find((x) => x.userId === ids.dun);
  r = subRow(ids.dun);
  info('유예 만료 후', `status=${r.status} rung=${r.rung}`);
  check('크론이 유예 만료를 탐지', fExpire?.issue === 'grace_expired', JSON.stringify(fExpire ?? null));
  check('[HARD] DB status 가 실제로 expired 로 바뀐다 (S4 가 남긴 구멍)',
    r.status === 'expired', r.status);
  check('만료 시 사다리 상태가 초기화된다', r.rung === '0', r.rung);
  const entExpired = await entitlement(emails.dun);
  check('[HARD] 만료 후 앱은 LOCKED', entExpired.body?.token?.entitled === false,
    `entitled=${entExpired.body?.token?.entitled} reason=${entExpired.body?.token?.reason}`);
  check('entitlement 의 실효 상태도 expired (DB 와 일치)',
    entExpired.body?.token?.status === 'expired', entExpired.body?.token?.status);
  check('만료된 구독에는 미래 예약이 남지 않는다', countFutureScheduled(ids.dun) === 0,
    String(countFutureScheduled(ids.dun)));
  console.log('\ndunning 사용자 결제 이력:');
  console.log(sqlTable(
    `select payment_id, attempt_kind, dunning_rung, status from public.payment_attempts where user_id='${ids.dun}' order by created_at`
  ));

  // =========================================================================
  // 시나리오 2: 재시도 중 회복
  // =========================================================================
  console.log('\n--- 시나리오 2: 2단 재시도가 성공 → 남은 단 취소, active, 월 예약 복구 ---');
  await subscribe(emails.rec, ids.rec, 'bk_rec');
  const recCust = customerIdOf(ids.rec);
  const recSched0 = nextScheduled(ids.rec);
  const recPeriodEndBefore = subRow(ids.rec).periodEnd;
  await fireScheduled(recSched0.paymentId, recCust, { fail: true });
  check('실패 → past_due', subRow(ids.rec).status === 'past_due', subRow(ids.rec).status);

  // D+1 재시도도 실패, D+3 재시도는 성공시킨다.
  sql(`update public.subscriptions set dunning_started_at = now() - interval '1 days' where user_id='${ids.rec}'`);
  await runWatchdog();
  const rec1 = nextScheduled(ids.rec);
  await fireScheduled(rec1.paymentId, recCust, { fail: true });
  sql(`update public.subscriptions set dunning_started_at = now() - interval '3 days' where user_id='${ids.rec}'`);
  await runWatchdog();
  const rec2 = nextScheduled(ids.rec);
  check('2단 재시도가 잡혔다', rec2?.kind === 'dunning_retry' && subRow(ids.rec).rung === '2',
    `${rec2?.paymentId} rung=${subRow(ids.rec).rung}`);
  info('2단 예약', `${rec2.paymentId} scheduleId=${rec2.scheduleId}`);

  const revokedBefore = mock.revoked.length;
  const recFire = await fireScheduled(rec2.paymentId, recCust);
  check('2단 결제 성공 웹훅 처리', recFire.settled.ok, recFire.settled.error ?? '');
  const recAfter = subRow(ids.rec);
  info('회복 후', `status=${recAfter.status} rung=${recAfter.rung} grace=${recAfter.graceUntil || '(없음)'} period_end=${recAfter.periodEnd}`);
  check('status = active', recAfter.status === 'active', recAfter.status);
  check('유예가 해제됐다', recAfter.graceUntil === '', `"${recAfter.graceUntil}"`);
  check('사다리가 접혔다 (rung=0)', recAfter.rung === '0', recAfter.rung);
  check('dunning_started_at 이 비워졌다', recAfter.dunningStarted === '', recAfter.dunningStarted);
  check('기간이 한 달 전진했다',
    Date.parse(recAfter.periodEnd) > Date.parse(recPeriodEndBefore),
    `${recPeriodEndBefore} → ${recAfter.periodEnd}`);
  const recNext = nextScheduled(ids.rec);
  check('정상 월 예약이 복구됐다', recNext?.kind === 'cycle', `${recNext?.paymentId} (${recNext?.kind})`);
  check('새 예약 시각 = 새 주기의 끝',
    Date.parse(recNext.scheduledFor) === Date.parse(recAfter.periodEnd),
    `${recNext.scheduledFor} vs ${recAfter.periodEnd}`);
  check('[HARD] 미래 예약은 정확히 1건 (재시도가 남아 있으면 이중청구)',
    countFutureScheduled(ids.rec) === 1, String(countFutureScheduled(ids.rec)));

  // 남은 3단은 애초에 만들어지지 않으므로 취소할 것도 없다. 크론을 다시 돌려도
  // 재시도가 되살아나면 안 된다.
  const schedBeforeRec = mock.calls.schedule;
  await runWatchdog();
  check('회복 뒤 크론이 재시도를 되살리지 않는다',
    mock.calls.schedule === schedBeforeRec && countFutureScheduled(ids.rec) === 1,
    `예약API +${mock.calls.schedule - schedBeforeRec}, 미래예약 ${countFutureScheduled(ids.rec)}`);
  info('회복 시 철회된 예약 수', String(mock.revoked.length - revokedBefore));

  // =========================================================================
  // 시나리오 3: 감시 크론 vs dunning — 같은 주기에 두 번 청구되지 않는다
  // =========================================================================
  console.log('\n--- 시나리오 3: [HARD] dunning 중인 사용자는 같은 주기에 두 번 청구되지 않는다 ---');
  await subscribe(emails.col, ids.col, 'bk_col');
  const colCust = customerIdOf(ids.col);
  const colSched = nextScheduled(ids.col);
  const colPeriodEnd = subRow(ids.col).periodEnd;
  await fireScheduled(colSched.paymentId, colCust, { fail: true });

  // S4 의 연체 복구 경로가 걸리는 조건을 정확히 만든다:
  // 주기 끝이 과거 + 미래 예약 없음. 상태만 past_due 다.
  sql(`update public.subscriptions set current_period_end = now() - interval '1 hour', grace_until = now() + interval '5 days', dunning_started_at = now() - interval '1 days' where user_id='${ids.col}'`);
  check('연체 복구가 걸리는 조건을 만들었다 (주기끝 과거 + 미래예약 0)',
    countFutureScheduled(ids.col) === 0 &&
      Date.parse(subRow(ids.col).periodEnd) < Date.now(),
    `미래예약 ${countFutureScheduled(ids.col)}, period_end ${subRow(ids.col).periodEnd}`);

  const colSchedBefore = mock.calls.schedule;
  const wdCol = await runWatchdog();
  const colFindings = (wdCol.body.findings ?? []).filter((x) => x.userId === ids.col);
  info('크론이 이 사용자에 대해 한 일', JSON.stringify(colFindings));
  check('[HARD] 연체 복구(period_end_passed)로 잡지 않는다 — dunning 이 독점',
    !colFindings.some((x) => x.issue === 'period_end_passed'), JSON.stringify(colFindings));
  check('dunning 재시도 경로로만 처리됐다',
    colFindings.length === 1 && colFindings[0].issue === 'dunning_retry',
    JSON.stringify(colFindings));
  check('[HARD] 예약은 정확히 1건만 생겼다 (두 경로가 각각 잡았다면 2건)',
    mock.calls.schedule - colSchedBefore === 1 && countFutureScheduled(ids.col) === 1,
    `예약API +${mock.calls.schedule - colSchedBefore}, 미래예약 ${countFutureScheduled(ids.col)}`);
  const colOnly = nextScheduled(ids.col);
  check('그 1건은 재시도 예약이다 (정기 rdc_ 가 아니다)',
    colOnly.kind === 'dunning_retry' && colOnly.paymentId.startsWith('rdr_'), colOnly.paymentId);

  // 크론을 5번 더 돌려도 예약은 여전히 1건.
  for (let i = 0; i < 5; i += 1) await runWatchdog();
  check('[HARD] 크론 5회 추가 실행 후에도 미래 예약 1건',
    countFutureScheduled(ids.col) === 1, String(countFutureScheduled(ids.col)));
  // 아직 실행되지 않은 = 앞으로 카드를 긁게 될 청구 시도. 이게 2건이면 이 주기에
  // 두 번 청구된다. (이미 마감된 첫 결제 paid 와 실패한 정기 결제는 제외.)
  const colCharges = Number(sql(
    `select count(*) from public.payment_attempts where user_id='${ids.col}' and status in ('scheduled','scheduling')`
  ));
  check('[HARD] 앞으로 실행될 청구 시도는 1건뿐 (2건이면 이중청구)',
    colCharges === 1, `${colCharges}건`);
  const colDunningIds = sql(
    `select string_agg(payment_id, ',') from public.payment_attempts where user_id='${ids.col}' and payment_id like 'rdr_%'`
  );
  check('이 주기(20260903)에 대한 재시도 단은 1단 하나뿐',
    colDunningIds.split(',').filter(Boolean).length === 1, colDunningIds);
  console.log('\n충돌 시나리오 사용자의 결제 시도:');
  console.log(sqlTable(
    `select payment_id, attempt_kind, dunning_rung, status from public.payment_attempts where user_id='${ids.col}' order by created_at`
  ));
  void colPeriodEnd;

  // =========================================================================
  // 시나리오 4: 웹훅 처리 실패 → 재처리
  // =========================================================================
  console.log('\n--- 시나리오 4: processing_error 가 남은 웹훅을 크론이 재처리 ---');
  await subscribe(emails.rep, ids.rep, 'bk_rep');
  const repCust = customerIdOf(ids.rep);
  const repSched = nextScheduled(ids.rep);
  const repEndBefore = subRow(ids.rep).periodEnd;

  // 포트원 조회가 실패하도록 결제 상세를 넣지 않는다 → onPaid 가 던진다.
  mock.payments.delete(repSched.paymentId);
  const repEvt = await deliver(paidEvent(repSched.paymentId));
  const repSettled = await waitSettled(repEvt.eventId);
  check('처리가 실패하고 processing_error 가 남는다', !repSettled.ok && !!repSettled.error,
    repSettled.error ?? '');
  info('남은 오류', repSettled.error?.slice(0, 80));
  check('기간은 전진하지 않았다', subRow(ids.rep).periodEnd === repEndBefore, subRow(ids.rep).periodEnd);
  check('포트원은 이미 200 을 받았다 (재전송 없음)', repEvt.status === 200, String(repEvt.status));

  // 원인을 고치고(결제 상세 등장) 크론을 돌린다.
  mock.payments.set(repSched.paymentId, {
    id: repSched.paymentId, status: 'PAID', paidAt: new Date().toISOString(),
    amount: { total: 77000, paid: 77000 }, customer: { id: repCust }
  });
  const wdRep = await runWatchdog();
  const repFinding = (wdRep.body.findings ?? []).find((x) => x.eventId === repEvt.eventId);
  check('크론이 미처리 웹훅을 집어 재처리했다', repFinding?.action === 'reprocessed',
    JSON.stringify(repFinding ?? null));
  const repAfter = subRow(ids.rep);
  check('재처리로 기간이 전진했다', Date.parse(repAfter.periodEnd) > Date.parse(repEndBefore),
    `${repEndBefore} → ${repAfter.periodEnd}`);
  check('processing_error 가 지워지고 processed_at 이 찍혔다',
    sql(`select (processed_at is not null)::text || '|' || coalesce(processing_error,'(null)') from public.webhook_events where portone_event_id='${repEvt.eventId}'`) === 'true|(null)',
    sql(`select (processed_at is not null)::text || '|' || coalesce(processing_error,'(null)') from public.webhook_events where portone_event_id='${repEvt.eventId}'`));
  check('reprocess_count 가 1', sql(`select reprocess_count from public.webhook_events where portone_event_id='${repEvt.eventId}'`) === '1');

  // --- 두 번 재처리해도 두 번 전진하지 않는다 ---
  const repEndAfterFirst = repAfter.periodEnd;
  sql(`update public.webhook_events set processed_at = null, processing_error = 'forced re-run' where portone_event_id='${repEvt.eventId}'`);
  await runWatchdog();
  check('[HARD] 같은 이벤트를 다시 재처리해도 기간이 또 늘지 않는다 (멱등)',
    subRow(ids.rep).periodEnd === repEndAfterFirst,
    `${repEndAfterFirst} → ${subRow(ids.rep).periodEnd}`);
  check('미래 예약도 여전히 1건', countFutureScheduled(ids.rep) === 1,
    String(countFutureScheduled(ids.rep)));

  // --- 복구 불가능한 건은 상한에서 멈추고 보고된다 ---
  const deadId = `evt_dead_${stamp}`;
  sql(`insert into public.webhook_events (portone_event_id, type, payload_json, processing_error, reprocess_count) values ('${deadId}','Transaction.Paid','{"type":"Transaction.Paid","data":{"paymentId":"does_not_exist"}}'::jsonb,'boom',5)`);
  const wdDead = await runWatchdog();
  const deadFinding = (wdDead.body.findings ?? []).find((x) => x.eventId === deadId);
  check('상한을 넘은 미처리 건은 재시도하지 않고 미복구로 보고된다',
    deadFinding?.issue === 'webhook_unrecovered' && wdDead.body.webhooksUnrecovered >= 1,
    JSON.stringify(deadFinding ?? null));
  check('미복구 건은 조용히 사라지지 않는다 (크론 응답에 노출)',
    wdDead.body.webhooksUnrecovered >= 1, `webhooksUnrecovered=${wdDead.body.webhooksUnrecovered}`);
  sql(`delete from public.webhook_events where portone_event_id='${deadId}'`);

  // =========================================================================
  // 시나리오 5: 해지
  // =========================================================================
  console.log('\n--- 시나리오 5: 해지 → 포트원 예약 실제 철회, 기간 종료까지 이용, 이후 canceled ---');
  const { jar: canJar } = await subscribe(emails.can, ids.can, 'bk_can');
  const canSched = nextScheduled(ids.can);
  const canPeriodEnd = subRow(ids.can).periodEnd;
  info('해지 전 예약', `${canSched.paymentId} scheduleId=${canSched.scheduleId}`);
  check('해지 전 포트원에 예약이 실재한다', mock.schedules.has(canSched.paymentId));
  check('예약 id 가 DB 에 저장돼 있다 (없으면 취소 자체가 불가능)',
    canSched.scheduleId === `sch_${canSched.paymentId}`, canSched.scheduleId);

  const revokeCallsBefore = mock.calls.revoke;
  const cancelRes = await jarFetch(canJar, `${WEB}/api/billing/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cancel: true })
  });
  const cancelBody = await cancelRes.json();
  check('해지 요청 성공', cancelRes.status === 200 && cancelBody.ok === true, JSON.stringify(cancelBody));
  check('cancel_at_period_end 가 켜졌다', subRow(ids.can).cancelAtPeriodEnd === true);
  check('[HARD] 포트원 예약 취소 API 가 실제로 호출됐다',
    mock.calls.revoke - revokeCallsBefore === 1, `${mock.calls.revoke - revokeCallsBefore}회`);
  check('[HARD] 목이 이 예약의 취소를 기록했다',
    mock.revoked.some((x) => x.paymentId === canSched.paymentId),
    JSON.stringify(mock.revoked.slice(-2)));
  check('[HARD] 포트원 쪽 예약이 사라졌다 (남아 있으면 해지 후에도 청구된다)',
    !mock.schedules.has(canSched.paymentId));
  check('미래 예약이 없다', countFutureScheduled(ids.can) === 0, String(countFutureScheduled(ids.can)));

  const entCan = await entitlement(emails.can);
  check('[HARD] 해지해도 기간 종료까지는 이용 가능', entCan.body?.token?.entitled === true,
    `entitled=${entCan.body?.token?.entitled} reason=${entCan.body?.token?.reason}`);
  info('해지 후 잔여 이용 기간', `~ ${canPeriodEnd}`);

  // 기간 종료 전에는 크론이 아무것도 하지 않는다.
  const canSchedBefore = mock.calls.schedule;
  await runWatchdog();
  check('기간 종료 전에는 크론이 재예약도 해지도 하지 않는다',
    subRow(ids.can).status === 'active' && mock.calls.schedule === canSchedBefore,
    `status=${subRow(ids.can).status}, 예약API +${mock.calls.schedule - canSchedBefore}`);

  // 기간 종료.
  sql(`update public.subscriptions set current_period_end = now() - interval '1 minute' where user_id='${ids.can}'`);
  const wdCan = await runWatchdog();
  const canFinding = (wdCan.body.findings ?? []).find((x) => x.userId === ids.can);
  check('크론이 기간 종료를 탐지해 canceled 로 내린다', canFinding?.action === 'canceled',
    JSON.stringify(canFinding ?? null));
  const canFinal = subRow(ids.can);
  check('status = canceled', canFinal.status === 'canceled', canFinal.status);
  check('canceled_at 이 기록된다', canFinal.canceledAt !== '', canFinal.canceledAt);
  const entCanEnd = await entitlement(emails.can);
  check('[HARD] 기간 종료 후 NOT ENTITLED', entCanEnd.body?.token?.entitled === false,
    `entitled=${entCanEnd.body?.token?.entitled} reason=${entCanEnd.body?.token?.reason}`);
  check('해지된 구독에 새 예약이 생기지 않는다', countFutureScheduled(ids.can) === 0,
    String(countFutureScheduled(ids.can)));

  // =========================================================================
  // 시나리오 6: 해지 취소
  // =========================================================================
  console.log('\n--- 시나리오 6: 기간 종료 전 해지 취소 → 예약 복구 ---');
  const { jar: uncJar } = await subscribe(emails.unc, ids.unc, 'bk_unc');
  const uncSched0 = nextScheduled(ids.unc);
  await jarFetch(uncJar, `${WEB}/api/billing/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cancel: true })
  });
  check('해지 후 미래 예약 0건', countFutureScheduled(ids.unc) === 0,
    String(countFutureScheduled(ids.unc)));
  check('포트원 쪽 예약도 사라졌다', !mock.schedules.has(uncSched0.paymentId));

  const uncRes = await jarFetch(uncJar, `${WEB}/api/billing/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cancel: false })
  });
  const uncBody = await uncRes.json();
  check('해지 취소 성공', uncRes.status === 200 && uncBody.ok === true, JSON.stringify(uncBody));
  check('cancel_at_period_end 가 꺼졌다', subRow(ids.unc).cancelAtPeriodEnd === false);
  check('[HARD] 예약이 복구됐다', uncBody.rescheduled === true && countFutureScheduled(ids.unc) === 1,
    `rescheduled=${uncBody.rescheduled}, 미래예약 ${countFutureScheduled(ids.unc)}`);
  const uncNow = nextScheduled(ids.unc);
  check('포트원에 다시 예약됐다', mock.schedules.has(uncNow.paymentId), uncNow.paymentId);
  check('복구된 예약 시각 = 현재 주기의 끝',
    Date.parse(uncNow.scheduledFor) === Date.parse(subRow(ids.unc).periodEnd),
    `${uncNow.scheduledFor} vs ${subRow(ids.unc).periodEnd}`);

  // =========================================================================
  // 시나리오 7: 기기 수 제한
  // =========================================================================
  console.log('\n--- 시나리오 7: 기기 2대 제한 — 서버가 3번째를 거부, 해제하면 등록 ---');
  await subscribe(emails.dev, ids.dev, 'bk_dev');
  const limit = Number(sql(`select device_limit from public.plans where code='standard'`));
  check('플랜 기기 수 = 2', limit === 2, String(limit));

  const reg = (deviceId, name) =>
    deviceCall(emails.dev, { action: 'register', deviceId, name, platform: 'darwin', appVersion: '0.5.6' });

  const d1 = await reg('dev-aaa', '진료실 데스크톱');
  const d2 = await reg('dev-bbb', '노트북');
  check('1번째 기기 등록', d1.body.ok === true, JSON.stringify(d1.body).slice(0, 120));
  check('2번째 기기 등록', d2.body.ok === true, JSON.stringify(d2.body).slice(0, 120));
  check('DB 에 active 기기 2대', Number(sql(`select count(*) from public.devices where user_id='${ids.dev}' and status='active'`)) === 2);

  const d3 = await reg('dev-ccc', '집 컴퓨터');
  check('[HARD] 3번째 기기는 서버가 거부한다',
    d3.body.ok === false && d3.body.error === 'device_limit_exceeded',
    JSON.stringify(d3.body).slice(0, 160));
  check('거부하면서 선택할 기기 목록을 함께 준다 (자동 해제하지 않는다)',
    Array.isArray(d3.body.devices) && d3.body.devices.length === 2,
    `${d3.body.devices?.length}대`);
  check('[HARD] 거부된 기기는 DB 에 만들어지지 않았다',
    Number(sql(`select count(*) from public.devices where user_id='${ids.dev}' and device_id='dev-ccc'`)) === 0);
  check('[HARD] 기존 기기가 조용히 밀려나지 않았다',
    Number(sql(`select count(*) from public.devices where user_id='${ids.dev}' and status='active'`)) === 2);

  // --- 클라이언트가 직접 우회할 수 있는가 (anon 키로) ---
  const devJwt = await accessToken(emails.dev);
  const bypassInsert = await fetch(`${API}/rest/v1/devices`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${devJwt}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: ids.dev, device_id: 'dev-bypass', name: '우회', status: 'active' })
  });
  check('[HARD] 클라이언트가 devices 에 직접 INSERT 할 수 없다',
    bypassInsert.status >= 400,
    `HTTP ${bypassInsert.status} ${(await bypassInsert.text()).slice(0, 90)}`);
  const bypassUpdate = await fetch(`${API}/rest/v1/devices?device_id=eq.dev-aaa`, {
    method: 'PATCH',
    headers: { apikey: ANON, Authorization: `Bearer ${devJwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'active' })
  });
  check('[HARD] 클라이언트가 devices 를 UPDATE 할 수 없다 (해지 무효화 방지)',
    bypassUpdate.status >= 400, `HTTP ${bypassUpdate.status}`);
  const ownRead = await fetch(`${API}/rest/v1/devices?select=device_id,status`, {
    headers: { apikey: ANON, Authorization: `Bearer ${devJwt}` }
  });
  const ownRows = await ownRead.json();
  check('자기 기기 목록 읽기는 여전히 가능', ownRead.status === 200 && ownRows.length === 2,
    `HTTP ${ownRead.status}, ${ownRows.length}행`);

  // --- 하나 내리고 다시 등록 ---
  const rowB = sql(`select id from public.devices where user_id='${ids.dev}' and device_id='dev-bbb'`);
  const rel = await deviceCall(emails.dev, { action: 'revoke', rowId: rowB });
  check('기기 하나를 내렸다', rel.body.ok === true, JSON.stringify(rel.body).slice(0, 100));
  const d3b = await reg('dev-ccc', '집 컴퓨터');
  check('[HARD] 해제 후 3번째 기기가 등록된다', d3b.body.ok === true, JSON.stringify(d3b.body).slice(0, 120));
  check('active 기기는 여전히 2대', Number(sql(`select count(*) from public.devices where user_id='${ids.dev}' and status='active'`)) === 2);

  // --- 해지된 기기는 다음 하트비트에 접근을 잃는다 ---
  const hbActive = await deviceCall(emails.dev, { action: 'heartbeat', deviceId: 'dev-aaa' });
  check('살아 있는 기기의 하트비트는 active', hbActive.body.status === 'active', hbActive.body.status);
  const hbRevoked = await deviceCall(emails.dev, { action: 'heartbeat', deviceId: 'dev-bbb' });
  check('[HARD] 해지된 기기의 하트비트는 revoked 를 돌려준다 (앱은 이 신호로 강제 로그아웃)',
    hbRevoked.body.status === 'revoked', hbRevoked.body.status);
  const lastSeenB = sql(`select last_seen_at::text from public.devices where user_id='${ids.dev}' and device_id='dev-bbb'`);
  await sleep(50);
  await deviceCall(emails.dev, { action: 'heartbeat', deviceId: 'dev-bbb' });
  check('해지된 기기의 last_seen 은 갱신되지 않는다 (목록이 거짓말하지 않게)',
    sql(`select last_seen_at::text from public.devices where user_id='${ids.dev}' and device_id='dev-bbb'`) === lastSeenB);
  const reRegister = await reg('dev-bbb', '노트북');
  check('[HARD] 해지된 기기는 재등록으로 되살아나지 않는다',
    reRegister.body.ok === false && reRegister.body.error === 'device_revoked',
    JSON.stringify(reRegister.body).slice(0, 120));

  // --- 기기 게이트와 구독 게이트는 독립이다 ---
  const entDev = await entitlement(emails.dev);
  check('기기가 해지돼도 구독 자격 자체는 유효하다 (두 게이트는 독립)',
    entDev.body?.token?.entitled === true, `entitled=${entDev.body?.token?.entitled}`);
  check('entitlement 토큰의 deviceLimit 은 여전히 2',
    entDev.body?.token?.deviceLimit === 2, String(entDev.body?.token?.deviceLimit));
  const hbUnknown = await deviceCall(emails.dev, { action: 'heartbeat', deviceId: 'never-registered' });
  check('등록 자체가 없는 기기도 접근을 잃는다', hbUnknown.body.status === 'unregistered',
    hbUnknown.body.status);
  console.log('\n기기 목록:');
  console.log(sqlTable(
    `select device_id, name, status, revoked_at is not null as revoked from public.devices where user_id='${ids.dev}' order by created_at`
  ));

  // --- 남의 기기는 건드릴 수 없다 ---
  const otherRow = sql(`select id from public.devices where user_id='${ids.dev}' and device_id='dev-aaa'`);
  const foreign = await deviceCall(emails.can, { action: 'revoke', rowId: otherRow });
  check('[HARD] 남의 기기는 해지할 수 없다', foreign.body.ok === false && foreign.body.error === 'not_found',
    JSON.stringify(foreign.body));
  check('대상 기기는 그대로 active',
    sql(`select status from public.devices where id='${otherRow}'`) === 'active');

  console.log(`\n포트원 목 호출: ${JSON.stringify(mock.calls)}`);
  console.log(`철회된 예약: ${mock.revoked.length}건`);
  console.log('\n감시 크론 최근 실행:');
  console.log(sqlTable(
    "select to_char(started_at,'HH24:MI:SS') as started, checked_count, missing_count, repaired_count, failed_count from public.subscription_watchdog_runs order by started_at desc limit 5"
  ));
  console.log(`\n${failures === 0 ? '전부 PASS' : `${failures}건 FAIL`}`);
  shutdown(failures === 0 ? 0 : 1);
} catch (err) {
  console.error('\n프로브 실패:', err);
  console.error(webLog.slice(-60).join(''));
  shutdown(1);
}
