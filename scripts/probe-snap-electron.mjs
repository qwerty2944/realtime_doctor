// 실제 Electron 에서 스냅 한 케이스를 확인하는 프로브.
//
// scripts/probe-snap*.mjs 는 가짜 창으로 기하만 본다. 여기서는 빌드된 main 을
// 그대로 띄워 **진짜 BrowserWindow 의 이벤트 순서**('move' 연속 → 'moved')를
// 태운다 — 프로브와 현실이 갈라졌던 지점이 바로 거기다.
//
// 화면 캡처는 쓰지 않는다(이 머신에서 불가능). 보는 것은 전부 bounds 숫자다.
// 네이티브 드래그는 합성할 수 없으므로 setBounds 를 잘게 반복해 사용자 드래그와
// 같은 이벤트 열을 만든다. 커서는 조작할 수 없으므로, 실제 커서에서 멀리 떨어진
// 곳에 창을 배치해 "커서가 상대 창 밖" = 스냅 경로를 확정한다.
//
// [주의] top-level await 금지 (probe-dock-height.mjs 와 같은 제약).
//
// 실행:
//   npm run build
//   npx electron scripts/probe-snap-electron.mjs --user-data-dir=$(mktemp -d)

import { app, BrowserWindow, screen } from 'electron';
import '../out/main/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures += 1;
  console.log(`[probe]   [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}
const fmt = (r) => `${r.x},${r.y} ${r.width}x${r.height}`;

/** 사용자 드래그 흉내: 잘게 여러 번 옮겨 'move' 를 연속 발생시킨 뒤 놓는다. */
async function drag(w, dx, dy, steps = 10) {
  const s = w.getBounds();
  for (let i = 1; i <= steps; i += 1) {
    w.setBounds({
      ...s,
      x: s.x + Math.round((dx * i) / steps),
      y: s.y + Math.round((dy * i) / steps)
    });
    await sleep(16); // 60fps 근처 — 실제 드래그와 비슷한 간격
  }
  await sleep(600); // 'moved' 또는 드랍 디바운스(320ms) 이후까지 기다린다
}

async function run() {
  await sleep(4000); // 창 생성 + 렌더

  const byTitle = (t) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === t);
  const target = byTitle('Differential Diagnosis');
  const mover = byTitle('Waiting List');
  if (!target || !mover) {
    console.log(
      '[probe] 창을 찾지 못했다:',
      BrowserWindow.getAllWindows().map((w) => w.getTitle()).join(' | ')
    );
    app.exit(1);
    return;
  }
  for (const w of [target, mover]) if (!w.isVisible()) w.show();
  await sleep(300);

  // 실제 커서에서 먼 곳을 고른다 = 머지가 아니라 스냅 경로임을 확정.
  const cursor = screen.getCursorScreenPoint();
  const wa = screen.getPrimaryDisplay().workArea;
  const t = target.getBounds();
  const m = mover.getBounds();
  // 세로로 커서를 피한다. 가로는 target 왼쪽에 mover 가 통째로 들어갈 자리를
  // 반드시 남긴다 — 남기지 않으면 작업영역 클램프가 개입해서 흡착 결과가 가려진다.
  const baseY = cursor.y > wa.y + wa.height / 2 ? wa.y + 60 : wa.y + wa.height - t.height - 60;
  const baseX = wa.x + m.width + 80;

  target.setBounds({ x: baseX, y: baseY, width: t.width, height: t.height });
  await sleep(400);
  const tb = target.getBounds();
  console.log(`[probe] 커서=${cursor.x},${cursor.y} target=${fmt(tb)}`);
  check(
    '사전 조건: 커서가 target 밖 (스냅 경로)',
    !(
      cursor.x >= tb.x &&
      cursor.x <= tb.x + tb.width &&
      cursor.y >= tb.y &&
      cursor.y <= tb.y + tb.height
    ),
    `cursor=${cursor.x},${cursor.y}`
  );

  console.log('[probe] === 사용자 신고 케이스: 이웃 안으로 12px 밀어 넣고 놓는다 ===');
  // mover 의 오른쪽 변이 target 의 왼쪽 변을 12px 파고든 자리에서 끝나게 한다.
  const endX = tb.x - m.width + 12;
  mover.setBounds({ x: endX - 20, y: tb.y, width: m.width, height: m.height });
  await sleep(400);
  const before = mover.getBounds();
  await drag(mover, 20, 0);
  const after = mover.getBounds();
  const want = { x: tb.x - m.width, y: tb.y };
  check('사전 조건: 흡착 결과가 작업영역 안 (클램프 비개입)', want.x >= wa.x, `want.x=${want.x}`);
  console.log(`[probe] before=${fmt(before)} after=${fmt(after)} want=${want.x},${want.y}`);
  check(
    '겹치게 놓은 창이 상대 왼쪽 변에 딱 붙는다',
    after.x === want.x && after.y === want.y,
    `after=${fmt(after)}`
  );
  check('크기 불변', after.width === m.width && after.height === m.height);
  check('target 은 움직이지 않았다', fmt(target.getBounds()) === fmt(tb));

  console.log(`[probe] ${failures === 0 ? '=== ALL PASS ===' : `=== ${failures} FAILURE(S) ===`}`);
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run);
