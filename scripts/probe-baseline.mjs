#!/usr/bin/env node
// 베이스라인 검증 프로브 — 0000_baseline.sql 로 새로 만든 스키마 위에서
// 앱의 "원래" 경로가 전부 도는지 확인한다.
//
// 로컬 Supabase 스택(포트 553xx)에만 붙는다. 실제 프로젝트는 건드리지 않는다.
//
// 실행:
//   supabase db reset
//   supabase functions serve --env-file supabase/functions/.env
//   node --import ./scripts/probe-baseline-register.mjs scripts/probe-baseline.mjs
//
// [중요] 검증 대상은 진짜 main 프로세스 모듈이다. src/main/sessions.ts /
// device.ts / auth.ts 를 그대로 import 해서 부른다 (Electron 껍데기만 스텁).
// 그 모듈들은 실패를 console.warn 으로 삼키므로, 이 프로브는 warn 을 가로채
// **경고가 하나라도 나오면 FAIL** 로 친다. "행이 없다"와 "권한이 없다"가 같은
// 모습이 되는 것이 정확히 이 마이그레이션이 막으려는 실패 모드다.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const API = 'http://127.0.0.1:55321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const PASSWORD = 'probe-pass-123';

process.env.SUPABASE_URL = API;
process.env.SUPABASE_PUBLISHABLE_KEY = ANON;
process.env.DEVICE_FUNCTION_URL = `${API}/functions/v1/device`;

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures += 1;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

// --- 앱 코드가 삼킨 경고를 잡아둔다 -------------------------------------------
const warnings = [];
const realWarn = console.warn;
console.warn = (...args) => {
  warnings.push(args.map(String).join(' '));
  realWarn('    (app warn)', ...args);
};
function takeWarnings() {
  const w = warnings.splice(0, warnings.length);
  return w;
}

function sql(text) {
  return execFileSync(
    'docker',
    ['exec', '-i', 'supabase_db_realtime_doctor', 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', text],
    { encoding: 'utf8' }
  ).trim();
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

// ---------------------------------------------------------------------------
const main = async () => {
  const stamp = Date.now();
  const emailA = `baseline-a-${stamp}@example.com`;
  const emailB = `baseline-b-${stamp}@example.com`;

  console.log('\n=== 0) 가입 트리거: profiles / subscriptions ===');
  const userA = await createUser(emailA);
  const userB = await createUser(emailB);
  check(
    'profiles 행이 가입 시 자동 생성됨',
    sql(`select email from public.profiles where user_id='${userA}'`) === emailA,
    emailA
  );
  check(
    'is_admin 기본값 false',
    sql(`select is_admin from public.profiles where user_id='${userA}'`) === 'f'
  );

  // 앱 모듈은 env 를 읽은 뒤에 로드해야 한다.
  const auth = await import('../src/main/auth.ts');
  const sessions = await import('../src/main/sessions.ts');
  const device = await import('../src/main/device.ts');
  const store = await import('../src/main/store.ts');
  const { getSupabase } = await import('../src/main/supabaseClient.ts');

  store.setCloudSync({ enabled: true, saveTranscripts: true, saveAudio: true });
  store.setLocalSave({ enabled: false, saveAudio: false });

  device.initDeviceAuth({ broadcast: () => undefined, forceSignOut: async () => undefined });
  auth.setAuthCallbacks({
    broadcast: () => undefined,
    onSignedIn: () => undefined,
    onSignedOut: () => undefined
  });

  console.log('\n=== 1) 로그인 (실제 auth.ts 경로) ===');
  const supabase = getSupabase();
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: emailA,
    password: PASSWORD
  });
  if (signInErr) throw new Error(signInErr.message);
  for (let i = 0; i < 50 && !auth.getCurrentUser(); i += 1) await sleep(100);
  check('auth.getCurrentUser() 가 로그인 사용자를 반환', auth.getCurrentUser()?.id === userA);
  takeWarnings();

  console.log('\n=== 2) 세션 + 전사 청크 (sessions.ts) ===');
  const chunkId = `c-${randomUUID()}`;
  await sessions.saveTranscriptChunk({
    id: chunkId,
    text: '가슴이 답답하고 숨이 찹니다',
    timestamp: 1234,
    speaker: 'patient'
  });
  const sessionId = sessions.getCurrentSessionId();
  check('세션 id 가 생성됨', !!sessionId, sessionId ?? '');
  check(
    'sessions 행이 내 user_id 로 저장됨',
    sql(`select user_id from public.sessions where id='${sessionId}'`) === userA
  );
  check(
    'transcript_chunks 행 저장됨 (speaker/text/timestamp_ms)',
    sql(
      `select speaker||'|'||text||'|'||timestamp_ms from public.transcript_chunks where session_id='${sessionId}'`
    ) === '가슴이 답답하고 숨이 찹니다'.replace(/^/, 'patient|') + '|1234'
  );

  console.log('\n=== 3) 화자 재지정 / 청크 삭제 ===');
  await sessions.relabelChunk(chunkId, 'doctor');
  check(
    'relabelChunk 가 실제로 반영됨',
    sql(`select speaker from public.transcript_chunks where chunk_id='${chunkId}'`) === 'doctor'
  );
  const doomed = `c-${randomUUID()}`;
  await sessions.saveTranscriptChunk({ id: doomed, text: '삭제될 청크', timestamp: 2000, speaker: 'unknown' });
  await sessions.deleteChunkRow(doomed);
  check(
    'deleteChunkRow 가 실제로 지움',
    sql(`select count(*) from public.transcript_chunks where chunk_id='${doomed}'`) === '0'
  );

  console.log('\n=== 4) 분석 / 요약 / 받아쓰기 ===');
  await sessions.upsertAnalysis({
    differentialDiagnoses: [{ name: '협심증', probability: 0.4 }],
    medicalTerms: [{ term: 'dyspnea', description: '호흡곤란' }],
    suggestedQuestions: ['언제부터 그러셨나요?'],
    redFlags: ['흉통'],
    updatedAt: Date.now()
  });
  check(
    'analyses 행 1개 (session_id PK upsert)',
    sql(`select count(*) from public.analyses where session_id='${sessionId}'`) === '1'
  );
  // 두 번째 upsert 가 중복 행을 만들지 않아야 한다 (onConflict: session_id).
  await sessions.upsertAnalysis({
    differentialDiagnoses: [],
    medicalTerms: [],
    suggestedQuestions: [],
    redFlags: ['재분석'],
    updatedAt: Date.now()
  });
  check(
    '재분석해도 여전히 1개 (onConflict 동작)',
    sql(`select count(*) from public.analyses where session_id='${sessionId}'`) === '1'
  );
  check(
    '재분석 내용이 갱신됨',
    sql(`select red_flags::text from public.analyses where session_id='${sessionId}'`) === '["재분석"]'
  );

  await sessions.appendSummary({
    chiefComplaint: '흉통',
    historyOfPresentIllness: '3일 전부터',
    pertinentFindings: '특이소견 없음',
    investigationsMentioned: 'ECG',
    clinicalImpression: 'r/o angina',
    plan: '심전도 시행',
    generatedAt: Date.now()
  });
  check(
    'summaries 행 저장됨',
    sql(`select chief_complaint from public.summaries where session_id='${sessionId}'`) === '흉통'
  );

  await sessions.appendDictation({
    template: 'soap',
    sections: [{ heading: 'S', body: '흉통 3일' }],
    generatedAt: Date.now()
  });
  check(
    'dictations 행 저장됨 (template soap)',
    sql(`select template from public.dictations where session_id='${sessionId}'`) === 'soap'
  );

  console.log('\n=== 5) 사용량 이벤트 ===');
  await sessions.logUsage({
    provider: 'gemini',
    task: 'analyze',
    model: 'gemini-2.0-flash',
    prompt_tokens: 100,
    output_tokens: 20,
    total_tokens: 120,
    duration_ms: 900
  });
  check(
    'usage_events 행 저장 (session_id 연결 + ts 컬럼)',
    sql(
      `select provider||'|'||task||'|'||coalesce(session_id::text,'-') from public.usage_events where user_id='${userA}'`
    ) === `gemini|analyze|${sessionId}`
  );
  check(
    'usage_events.ts 가 채워짐',
    sql(`select count(*) from public.usage_events where user_id='${userA}' and ts is not null`) === '1'
  );

  console.log('\n=== 6) 오디오 업로드 (recordings 버킷 + storage RLS) ===');
  const wav = Buffer.alloc(64);
  wav.write('RIFF', 0);
  const chunkPath = await sessions.uploadChunkAudio(chunkId, wav.toString('base64'));
  check('청크 WAV 업로드 경로', chunkPath === `${userA}/${sessionId}/${chunkId}.wav`, chunkPath ?? 'null');
  const sessPath = await sessions.uploadSessionAudio(sessionId, wav);
  check('세션 WAV 업로드 경로', sessPath === `${userA}/${sessionId}/session.wav`, sessPath ?? 'null');
  check(
    'sessions.audio_path 갱신됨',
    sql(`select audio_path from public.sessions where id='${sessionId}'`) === sessPath
  );
  check(
    'storage.objects 에 2개 저장됨',
    sql(`select count(*) from storage.objects where bucket_id='recordings' and name like '${userA}/%'`) === '2'
  );

  console.log('\n=== 7) 세션 종료 / 목록 / 로드 ===');
  await sessions.endCurrentSession();
  check(
    'ended_at 이 채워짐',
    sql(`select ended_at is not null from public.sessions where id='${sessionId}'`) === 't'
  );
  const list = await sessions.listMySessions();
  check('listMySessions 가 세션을 돌려줌', list.some((s) => s.id === sessionId), `${list.length}건`);
  const loaded = await sessions.loadSession(sessionId);
  check('loadSession: 세션 메타', loaded?.session.id === sessionId);
  check('loadSession: 청크', loaded?.chunks.length === 1 && loaded.chunks[0].speaker === 'doctor');
  check('loadSession: 분석', !!loaded?.analysis);
  check('loadSession: 요약', loaded?.latestSummary?.chiefComplaint === '흉통');
  check('loadSession: 받아쓰기', loaded?.latestDictation?.template === 'soap');

  console.log('\n=== 8) 기기 등록 / 하트비트 / 해지 (device Edge Function) ===');
  const registered = await device.registerCurrentDevice(userA);
  check('registerCurrentDevice 성공', registered === true);
  const myDeviceId = store.getDeviceId();
  check(
    'devices 행이 active 로 등록됨',
    sql(`select status from public.devices where user_id='${userA}' and device_id='${myDeviceId}'`) === 'active'
  );
  const devices = await device.listDevices(userA);
  check('listDevices 가 이 기기를 돌려줌', devices.some((d) => d.device_id === myDeviceId));

  // 하트비트: device.ts 는 5분 타이머 안에서 같은 호출을 한다. 타이머를 기다리지
  // 않고 동일한 요청을 그대로 보낸다.
  const beforeSeen = sql(
    `select last_seen_at from public.devices where user_id='${userA}' and device_id='${myDeviceId}'`
  );
  await sleep(1100);
  const { data: sess } = await supabase.auth.getSession();
  const hb = await fetch(process.env.DEVICE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sess.session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'heartbeat', deviceId: myDeviceId })
  }).then((r) => r.json());
  check('heartbeat 가 active 를 돌려줌', hb.ok === true && hb.status === 'active', JSON.stringify(hb));
  check(
    'heartbeat 가 last_seen_at 을 갱신함',
    sql(`select last_seen_at from public.devices where user_id='${userA}' and device_id='${myDeviceId}'`) !==
      beforeSeen
  );

  const rowId = devices.find((d) => d.device_id === myDeviceId).id;
  const revoked = await device.revokeDevice(userA, rowId);
  check('revokeDevice 성공', revoked.ok === true, JSON.stringify(revoked));
  check(
    'devices.status = revoked + revoked_at (0005 가 추가한 컬럼)',
    sql(
      `select status||'|'||(revoked_at is not null)::text from public.devices where id='${rowId}'`
    ) === 'revoked|true'
  );
  device.stopHeartbeat();

  console.log('\n=== 9) RLS 격리: 남의 데이터가 보이지 않는가 ===');
  const other = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailB, password: PASSWORD })
  }).then((r) => r.json());
  const asB = async (path) =>
    fetch(`${API}/rest/v1/${path}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${other.access_token}` }
    }).then(async (r) => ({ status: r.status, body: await r.json() }));

  for (const t of ['sessions', 'transcript_chunks', 'analyses', 'summaries', 'dictations', 'usage_events']) {
    const res = await asB(`${t}?select=*`);
    check(`다른 사용자는 ${t} 를 못 본다`, res.status === 200 && res.body.length === 0, `${res.status} ${JSON.stringify(res.body).slice(0, 60)}`);
  }
  const devRes = await asB('devices?select=*');
  check('다른 사용자는 devices 를 못 본다', devRes.status === 200 && devRes.body.length === 0);
  const profRes = await asB('profiles?select=user_id');
  check(
    'profiles 는 자기 행만 보인다',
    profRes.status === 200 && profRes.body.length === 1 && profRes.body[0].user_id === userB
  );
  const escalate = await fetch(`${API}/rest/v1/profiles?user_id=eq.${userB}`, {
    method: 'PATCH',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${other.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({ is_admin: true })
  });
  check('스스로 관리자로 승격 불가', escalate.status === 403 || escalate.status === 401, `HTTP ${escalate.status}`);
  const devWrite = await fetch(`${API}/rest/v1/devices`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${other.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userB, device_id: 'forged' })
  });
  check('클라이언트가 devices 에 직접 쓰기 불가', devWrite.status === 403, `HTTP ${devWrite.status}`);
  const stealAudio = await fetch(
    `${API}/storage/v1/object/recordings/${userA}/${sessionId}/session.wav`,
    { headers: { apikey: ANON, Authorization: `Bearer ${other.access_token}` } }
  );
  check('다른 사용자는 녹음 파일을 못 받는다', stealAudio.status === 400 || stealAudio.status === 403 || stealAudio.status === 404, `HTTP ${stealAudio.status}`);

  console.log('\n=== 10) 관리자 경로: admin-web 이 남의 행을 읽을 수 있는가 ===');
  sql(`update public.profiles set is_admin = true where user_id='${userB}'`);
  const adminSessions = await asB('sessions?select=id,user_id');
  check(
    'is_admin 이면 다른 의사의 sessions 가 보인다',
    adminSessions.status === 200 && adminSessions.body.some((s) => s.id === sessionId),
    `${adminSessions.status} ${adminSessions.body.length}건`
  );
  const adminUsage = await asB('usage_events?select=user_id');
  check('is_admin 이면 usage_events 가 보인다', adminUsage.status === 200 && adminUsage.body.length > 0);
  const adminProfiles = await asB('profiles?select=user_id,email');
  check('is_admin 이면 모든 profiles 가 보인다', adminProfiles.status === 200 && adminProfiles.body.length >= 2);
  sql(`update public.profiles set is_admin = false where user_id='${userB}'`);

  console.log('\n=== 11) 앱이 삼킨 경고 ===');
  const leftover = takeWarnings();
  check('앱 코드가 남긴 경고 0건', leftover.length === 0, leftover.join(' / ').slice(0, 300));

  console.log(failures === 0 ? '\n전부 PASS' : `\n${failures}건 FAIL`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => {
  realWarn(err);
  process.exit(1);
});
