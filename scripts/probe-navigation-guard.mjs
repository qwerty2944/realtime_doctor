#!/usr/bin/env node
// S5-1 검증 프로브 — BrowserWindow 네비게이션/윈도우오픈 잠금.
//
// 두 층으로 검증한다:
//   (A) 순수 판정 로직: isLocalNavigation 을 electron 런타임 없이 직접 호출해
//       file:// / dev origin 은 허용, 원격 origin·파싱불가는 차단하는지 본다.
//   (B) 구조 검증(probe-snap-stubs 스타일): 전역 가드가 실제로 등록되고
//       핸들러(setWindowOpenHandler / will-navigate / will-redirect / deny)가
//       배선돼 있는지 소스에서 확인한다. 완전한 Electron 런타임은 불필요하다.
//
// 실행: node scripts/probe-navigation-guard.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isLocalNavigation } from '../src/main/navigationGuard.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let failures = 0;
function check(label, cond, detail) {
  const mark = cond ? 'PASS' : 'FAIL';
  if (!cond) failures += 1;
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('=== S5-1 probe: navigation guard ===\n');

// ── (A) 순수 판정 로직 ──────────────────────────────────────────────────────
console.log('(A) isLocalNavigation 판정');
{
  const DEV = 'http://localhost:5173';

  // 로컬(허용)
  check('file:// 허용', isLocalNavigation('file:///Applications/RightHand.app/renderer/transcript/index.html', null) === true);
  check('dev origin 허용', isLocalNavigation('http://localhost:5173/diagnosis/index.html', DEV) === true);
  check('dev origin + 다른 경로 허용', isLocalNavigation('http://localhost:5173/anything', DEV) === true);

  // 원격(차단)
  check('원격 https 차단', isLocalNavigation('https://evil.example.com/steal', DEV) === false);
  check('원격 http 차단', isLocalNavigation('http://evil.example.com', DEV) === false);
  check('dev 포트 다르면 차단', isLocalNavigation('http://localhost:9999/x', DEV) === false);
  check('패키지 빌드(devOrigin=null)에서 http 전부 차단', isLocalNavigation('http://localhost:5173/x', null) === false);

  // fail-closed
  check('파싱 불가 URL 차단', isLocalNavigation('not a url', DEV) === false);
  check('빈 문자열 차단', isLocalNavigation('', DEV) === false);
  check('javascript: 스킴 차단', isLocalNavigation('javascript:alert(1)', DEV) === false);
}

// ── (B) 구조 검증 ───────────────────────────────────────────────────────────
console.log('\n(B) 가드 등록/배선 구조');
{
  const guard = readFileSync(join(root, 'src/main/navigationGuard.ts'), 'utf8');
  const index = readFileSync(join(root, 'src/main/index.ts'), 'utf8');
  const windows = readFileSync(join(root, 'src/main/windows.ts'), 'utf8');

  check("web-contents-created 전역 리스너", guard.includes("app.on('web-contents-created'"));
  check('setWindowOpenHandler 로 새 창 거부', guard.includes('setWindowOpenHandler') && guard.includes("action: 'deny'"));
  check('will-navigate 차단', guard.includes("contents.on('will-navigate'"));
  check('will-redirect 차단', guard.includes("contents.on('will-redirect'"));
  check('허용 목록(PubMed)만 openExternal 경유', guard.includes('isAllowedExternal') && guard.includes('openExternal'));

  check('index.ts 가 가드를 설치한다', index.includes('installNavigationGuard('));
  // 가드 설치가 창 생성보다 먼저인가 (loadEnvFiles 직후, createOverlayWindow 앞).
  const installAt = index.indexOf('installNavigationGuard(');
  const firstCreateAt = index.indexOf('createOverlayWindow(spec');
  check('가드가 창 생성보다 먼저 설치된다', installAt > 0 && firstCreateAt > 0 && installAt < firstCreateAt,
    `install@${installAt} < create@${firstCreateAt}`);

  check('오버레이 webPreferences sandbox:true', windows.includes('sandbox: true'));
}

console.log(`\n=== navigation-guard 결과: ${failures === 0 ? '전부 PASS' : `${failures}건 FAIL`} ===`);
process.exit(failures === 0 ? 0 : 1);
