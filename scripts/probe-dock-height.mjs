// Dock 높이 프로브 (실제 Electron + 실제 렌더러).
//
// 빌드된 main 번들을 그대로 띄우고, 진짜로 렌더된 dock 창에서 내용 높이를 재서
// main 이 창에 적용한 높이와 맞춰 본다. **화면 캡처는 쓰지 않는다** (이 머신에서
// 불가능하다). 여기서 보는 것은 전부 숫자다: 렌더러의 scrollHeight 와 창 bounds.
//
// [주의] top-level await 금지 — Electron ESM 엔트리는 엔트리 평가가 끝나야
// 'ready' 를 발행한다 (probe-gate.mjs 와 같은 제약).
//
// 실행:
//   npm run build
//   npx electron scripts/probe-dock-height.mjs --user-data-dir=$(mktemp -d)

import { app, BrowserWindow } from 'electron';
import '../out/main/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures += 1;
  console.log(`[probe]   [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

/** 렌더러 안에서 "잘리지 않으려면 필요한 창 높이" 를 앱과 같은 식으로 잰다. */
const MEASURE = `
  (() => {
    const shell = document.querySelector('.overlay-shell');
    if (!shell) return null;
    const titlebar = shell.querySelector('.overlay-titlebar');
    // 측정 래퍼 = 타이틀바 다음 컨테이너 안의 첫 div (dock 의 contentRef).
    const body = shell.children[1];
    const content = body ? body.firstElementChild : null;
    if (!content) return null;
    const borders = Math.max(0, shell.offsetHeight - shell.clientHeight);
    const chrome = Math.max(0, window.outerHeight - window.innerHeight);
    return {
      needed: Math.ceil(borders + titlebar.offsetHeight + content.scrollHeight + chrome),
      innerHeight: window.innerHeight,
      contentScrollHeight: content.scrollHeight,
      titlebar: titlebar.offsetHeight,
      bannerText: (shell.querySelector('.overlay-titlebar ~ * *') && content.firstElementChild
        ? content.firstElementChild.textContent.slice(0, 40)
        : '')
    };
  })()
`;

async function run() {
  await sleep(4000); // 창 생성 + 렌더 + fonts.ready + fit IPC 왕복

  const dock = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Dock');
  if (!dock) {
    console.log('[probe] dock 창을 찾지 못했다');
    app.exit(1);
    return;
  }

  console.log('[probe] === 1) 첫 실행: 창 높이가 렌더러가 잰 내용 높이 이상인가 ===');
  const m1 = await dock.webContents.executeJavaScript(MEASURE);
  const b1 = dock.getBounds();
  console.log('[probe] 측정:', JSON.stringify(m1));
  console.log('[probe] 창 bounds:', JSON.stringify(b1));
  check(
    '창 높이 >= 렌더러가 잰 내용 높이',
    b1.height >= m1.needed,
    `applied=${b1.height} measured=${m1.needed}`
  );
  check(
    '내용이 창 안에 다 들어간다 (잘림 없음)',
    m1.contentScrollHeight + m1.titlebar <= m1.innerHeight,
    `content+titlebar=${m1.contentScrollHeight + m1.titlebar} innerHeight=${m1.innerHeight}`
  );
  check(
    '고정 상수 130 으로는 담기지 않았다 (이 결함의 실체)',
    m1.needed > 130,
    `needed=${m1.needed} > 130`
  );

  console.log('[probe] === 2) 배너가 사라지면 창이 따라 줄어든다 ===');
  // 로그인 전이라 지금은 "로그인이 필요합니다" 배너가 떠 있다. DOM 에서 떼어내
  // ResizeObserver 가 도는지 = 상태 변화에 창이 반응하는지 확인한다.
  const removed = await dock.webContents.executeJavaScript(`
    (() => {
      const shell = document.querySelector('.overlay-shell');
      const content = shell.children[1].firstElementChild;
      if (content.children.length < 2) return { removed: false, why: '배너가 없다' };
      const banner = content.firstElementChild;
      const h = banner.offsetHeight;
      banner.remove();
      return { removed: true, bannerHeight: h };
    })()
  `);
  console.log('[probe] 배너 제거:', JSON.stringify(removed));
  await sleep(1200);
  const b2 = dock.getBounds();
  const m2 = await dock.webContents.executeJavaScript(MEASURE);
  console.log('[probe] 이후 bounds:', JSON.stringify(b2), '측정:', JSON.stringify(m2));
  if (removed.removed) {
    check(
      '배너가 빠진 만큼 창이 줄었다',
      b2.height === b1.height - removed.bannerHeight,
      `${b1.height} -> ${b2.height} (배너 ${removed.bannerHeight}px)`
    );
    check('줄어든 뒤에도 내용은 여전히 다 보인다', b2.height >= m2.needed,
      `applied=${b2.height} measured=${m2.needed}`);
  } else {
    check('배너 제거 시나리오 실행됨', false, removed.why);
  }

  console.log('[probe] === 3) 사용자가 직접 키운 크기는 되돌리지 않는다 ===');
  // 사용자의 마우스 리사이즈와 동일한 경로: setBounds 는 'resized' 를 쏘지
  // 않으므로 실제 사용자 조작을 흉내내려면 이벤트를 함께 발생시켜야 한다.
  dock.setBounds({ ...b2, height: b2.height + 90 });
  dock.emit('resized');
  const b3 = dock.getBounds();
  await dock.webContents.executeJavaScript(
    `window.dispatchEvent(new Event('resize'))`
  );
  await sleep(1200);
  const b4 = dock.getBounds();
  check(
    '사용자가 키운 높이를 다시 줄이지 않는다',
    b4.height === b3.height,
    `user=${b3.height} after-refit=${b4.height}`
  );

  console.log(
    `[probe] ${failures === 0 ? '=== ALL PASS ===' : `=== ${failures} FAILURE(S) ===`}`
  );
  console.log('[probe:done]');
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(() =>
  run().catch((err) => {
    console.log('[probe] error:', String(err && err.stack ? err.stack : err));
    app.exit(1);
  })
);
