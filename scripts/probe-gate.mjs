// S2 검증 프로브 #2 (Electron) — 오프라인 유예와 IPC 게이트 (시나리오 5c/6/7).
//
// 빌드된 main 번들(out/main/index.js)을 그대로 import 해서 실제 IPC 핸들러를
// 등록시킨 뒤, 별도의 숨김 창에서 채널을 직접 invoke 한다. 화면 캡처나 합성 키
// 입력은 쓰지 않는다 (이 머신에서 불가능하고, 필요하지도 않다).
//
// [주의] 이 파일에 top-level await 을 쓰면 안 된다. Electron 의 ESM 엔트리는
// 엔트리 모듈 평가가 끝나야 'ready' 를 발행하므로, top-level 에서
// app.whenReady() 를 await 하면 그대로 데드락이다.
//
// userData 는 --user-data-dir 스위치로 넘긴다. import 시점에 electron-store 가
// 이미 만들어지므로 코드에서 app.setPath 를 부르는 건 늦다.
//
// 단독 실행하지 말 것 — scripts/probe-gate-driver.mjs 가 띄운다.

import { app, BrowserWindow } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 실제 앱 main 번들. 정적 import 여야 한다 (동적 import 는 TLA 를 부른다).
import '../out/main/index.js';

const here = dirname(fileURLToPath(import.meta.url));

const PHASE = process.env.PROBE_PHASE ?? '';
const EMAIL = process.env.PROBE_EMAIL;
const PASSWORD = process.env.PROBE_PASSWORD;

const out = [];
function log(...parts) {
  const line = parts.join(' ');
  out.push(line);
  console.log('[probe]', line);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function finish(code) {
  console.log('[probe:done]', PHASE);
  app.exit(code);
}

async function run() {
  // index.js 의 whenReady 핸들러(창 생성, auth 콜백 등록)가 먼저 돌게 한 턴 양보.
  await sleep(2000);

  const probeWin = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(here, 'probe-gate-preload.cjs'),
      contextIsolation: true,
      sandbox: false
    }
  });
  await probeWin.loadURL('about:blank');

  /** 채널 직접 호출. 거부(reject)도 값으로 환원해서 비교 가능하게 만든다. */
  async function invoke(channel, ...args) {
    const script = `
      (async () => {
        try {
          const value = await window.probe.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)});
          return { ok: true, value };
        } catch (err) {
          return { ok: false, error: String(err && err.message ? err.message : err) };
        }
      })()
    `;
    return probeWin.webContents.executeJavaScript(script);
  }

  if (EMAIL) {
    const signIn = await invoke('auth:signIn', { email: EMAIL, password: PASSWORD });
    log('signIn:', JSON.stringify(signIn.value ?? signIn));
    // onAuthStateChange -> setSubscriptionUser -> refreshEntitlement 가 끝날 시간.
    // ENTITLEMENT_URL 이 죽은 주소면 여기서 실패하고 캐시 유예로 떨어진다.
    await sleep(3000);
  }

  const state = await invoke('subscription:get');
  log('subscription:get =', JSON.stringify(state.value));

  // ── 게이트 대상 채널 (새 진료 시작) ──────────────────────────────────────
  const gated = {
    'stream:mint': await invoke('stream:mint'),
    'clova-stream:open': await invoke('clova-stream:open'),
    'analysis:request': await invoke('analysis:request'),
    'summary:request': await invoke('summary:request'),
    'dictation:request': await invoke('dictation:request', 'soap'),
    'patients:select': await invoke('patients:select', '00000000-0000-0000-0000-000000000123')
  };
  for (const [k, v] of Object.entries(gated)) log(`GATED ${k} ->`, JSON.stringify(v));

  // ── 게이트 하지 않은 채널 (저장된 기록 열람) ─────────────────────────────
  const open = {
    'sessions:list-mine': await invoke('sessions:list-mine'),
    'sessions:load': await invoke('sessions:load', '00000000-0000-0000-0000-000000000456'),
    'patients:list-waiting': await invoke('patients:list-waiting'),
    'patients:load-detail': await invoke(
      'patients:load-detail',
      '00000000-0000-0000-0000-000000000789'
    ),
    'localSave:get': await invoke('localSave:get'),
    'subscription:get': await invoke('subscription:get')
  };
  for (const [k, v] of Object.entries(open)) log(`OPEN ${k} ->`, JSON.stringify(v));

  log('phase', PHASE, 'complete');
  finish(0);
}

app.whenReady().then(() =>
  run().catch((err) => {
    log('probe error:', String(err));
    finish(1);
  })
);
