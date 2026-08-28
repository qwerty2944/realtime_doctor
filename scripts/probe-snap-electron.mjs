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
// 탭 그룹은 커서를 합성해야 만들 수 있어서 여기서 드래그로 만들 수 없다. 대신
// **저장소를 미리 심어 두고** main 의 restoreGroups 가 진짜 탭 그룹을 복원하게
// 한다 — 실제 BrowserWindow 로 된 진짜 그룹이 생긴다. 그래서 index.js 는
// 정적 import 가 아니라 저장소를 심은 뒤 동적으로 불러온다.
//
// [주의] top-level await 금지 (probe-dock-height.mjs 와 같은 제약).
//
// 실행:
//   npm run build
//   npx electron scripts/probe-snap-electron.mjs --user-data-dir=$(mktemp -d)

import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 재시작 복원 경로로 진짜 탭 그룹(diagnosis+terms)을 심는다. */
function seedStore() {
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'realtime-doctor.json'),
    JSON.stringify({
      bounds: {
        diagnosis: { x: 900, y: 120, width: 380, height: 460 },
        terms: { x: 900, y: 120, width: 380, height: 460 },
        patients: { x: 200, y: 120, width: 380, height: 420 }
      },
      windowGroups: [{ id: 'probe-group', tabs: ['diagnosis', 'terms'], active: 'diagnosis' }]
    })
  );
}

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

  const byTitle = (t) =>
    BrowserWindow.getAllWindows().find((w) => w.getTitle().startsWith(t));
  // 심어 둔 그룹(diagnosis+terms)의 활성 탭이 target 이다 = 탭 그룹이 스냅에
  // 참여하는지를 이 시나리오 전체가 검증한다.
  const target = byTitle('Differential');
  const hiddenTab = byTitle('Medical Terms');
  const mover = byTitle('Waiting List');
  if (!target || !mover) {
    console.log(
      '[probe] 창을 찾지 못했다:',
      BrowserWindow.getAllWindows().map((w) => w.getTitle()).join(' | ')
    );
    app.exit(1);
    return;
  }
  // 시나리오에 안 쓰는 창은 숨긴다. 커서를 합성할 수 없어 실제 커서가 어느 창
  // 위에 있을지 모르는데, 커서 아래에 창이 있으면 그 드랍은 스냅이 아니라 탭
  // 머지가 가져간다(설계상 옳은 동작) — 시나리오가 오염된다.
  // 앱이 부팅 뒤 뒤늦게 창을 띄우기도 하므로 시나리오마다 다시 부른다.
  const keep = new Set([target.id, mover.id, hiddenTab?.id]);
  const hideOthers = () => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!keep.has(w.id) && w.isVisible()) w.hide();
    }
  };
  hideOthers();
  for (const w of [target, mover]) if (!w.isVisible()) w.show();
  await sleep(300);
  check(
    '사전 조건: 진짜 탭 그룹이 복원됐다 (Medical Terms 는 숨은 멤버)',
    !!hiddenTab && !hiddenTab.isVisible(),
    hiddenTab ? `visible=${hiddenTab.isVisible()}` : '창 없음'
  );

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
  // 커서를 합성할 수 없으므로 **실제 마우스가 시나리오 띠 안에 있으면** 그 드랍은
  // 설계상 탭 머지가 가져간다. 그러면 스냅을 검증할 수 없으니 조용히 실패하지 말고
  // 명확히 알린다. (띠 = 창들이 오르내리는 y 범위 전체 + 여유)
  const bandTop = baseY - 60;
  const bandBottom = baseY + t.height + 60;
  check(
    '사전 조건: 실제 마우스가 시나리오 띠 밖에 있다 (아니면 마우스를 옮기고 재실행)',
    cursor.y < bandTop || cursor.y > bandBottom,
    `cursor.y=${cursor.y} 띠=${bandTop}..${bandBottom}`
  );
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

  hideOthers();
  console.log(
    '[probe] === 사용자 신고 케이스: 탭 그룹 안으로 12px 밀어 넣고 놓는다 ==='
  );
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

  // ═════════════════════════════════════════════════════════════════════════
  // 사용자 신고: 붙긴 붙는데 줄이 안 맞는다. 좌우로 붙이면 **위쪽 변**이
  // 무조건 맞아야 한다 — 드랍 오프셋이 얼마든 결과가 같아야 한다.
  // 가짜 창 프로브가 이 기능에서 이미 실제 버그를 여러 번 놓쳤으므로 정렬은
  // 진짜 BrowserWindow 위에서도 확인한다.
  hideOthers();
  console.log('[probe] === 흡착하면 위쪽 변이 무조건 맞는다 (드랍 오프셋 무관) ===');
  {
    // 케이스 사이의 초기화는 **명시적 분리**(타이틀바 분리 버튼이 쓰는 바로 그
    // IPC)로 한다. 드래그로는 절대 떨어지지 않는 것이 설계이므로(클러스터 통째
    // 이동), 드래그로 초기화하려 하면 시나리오가 제 발등을 찍는다.
    // 덤으로 분리 IPC 자체가 실제 main 위에서 동작하는지도 여기서 확인된다.
    const detachMover = () => ipcMain.emit('window-snaps:detach', {}, 'patients');
    const landed = [];
    const g = target.getBounds();
    for (const off of [0, 70, 160]) {
      detachMover();
      await sleep(150);
      const m = mover.getBounds();
      // 왼쪽에서 접근. 세로로 off 만큼 어긋난 채 18px 을 드래그로 메운다.
      mover.setBounds({ x: g.x - m.width - 18, y: g.y + off, width: m.width, height: m.height });
      await sleep(400);
      await drag(mover, 18, 0);
      const after = mover.getBounds();
      landed.push(`${after.x},${after.y}`);
      check(
        `오프셋 ${off}px 로 놓아도 위쪽 변이 상대와 같다`,
        after.y === g.y && after.x === g.x - m.width,
        `after=${fmt(after)} target=${fmt(g)}`
      );
      check(
        `오프셋 ${off}px — 크기 불변 (강제 리사이즈 없음)`,
        after.width === m.width &&
          after.height === m.height &&
          fmt(target.getBounds()) === fmt(g),
        `mover=${after.width}x${after.height} target=${fmt(target.getBounds())}`
      );
    }
    check('모든 드랍 오프셋이 같은 최종 위치로 수렴', new Set(landed).size === 1, landed.join(' | '));
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 결함 1 회귀: 탭 그룹이 스냅 클러스터의 일원으로 함께 움직이는가.
  hideOthers();
  console.log('[probe] === 탭 그룹이 클러스터로 함께 움직인다 ===');
  {
    const g0 = target.getBounds();
    const m0 = mover.getBounds();
    await drag(mover, -60, 30);
    const g1 = target.getBounds();
    const m1 = mover.getBounds();
    check(
      '바깥 창을 끌면 그룹이 같은 delta 로 따라온다',
      g1.x - g0.x === m1.x - m0.x && g1.y - g0.y === m1.y - m0.y && m1.x - m0.x === -60,
      `group d=${g1.x - g0.x},${g1.y - g0.y} mover d=${m1.x - m0.x},${m1.y - m0.y}`
    );
    check(
      '숨은 탭도 활성 탭과 같은 자리 (그룹 bounds 동기 유지)',
      !!hiddenTab && fmt(hiddenTab.getBounds()) === fmt(g1),
      hiddenTab ? `hidden=${fmt(hiddenTab.getBounds())} active=${fmt(g1)}` : '창 없음'
    );
    check(
      '숨은 탭은 여전히 숨어 있다 (클러스터 이동이 그룹을 깨지 않음)',
      !!hiddenTab && !hiddenTab.isVisible()
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 결함 3 회귀: 드래그 **도중에** 클러스터가 따라오는가 (라이브 추종).
  //
  // 가짜 창 프로브가 이 기능에서 이미 두 번 실제 버그를 놓쳤으므로, 최소한
  // 기본 케이스는 진짜 BrowserWindow 의 이벤트 열 위에서 확인한다. 릴리즈
  // ('moved')도 디바운스 대기도 없이 이동만 연속으로 주고, 그 도중에 그룹이
  // 따라왔는지 본다 — 수정 전에는 여기서 그룹이 완전히 정지해 있다.
  hideOthers();
  console.log('[probe] === 드래그 도중 클러스터가 따라온다 (라이브 추종) ===');
  {
    const g0 = target.getBounds();
    const m0 = mover.getBounds();
    const gap0 = g0.x - (m0.x + m0.width);
    let lagged = 0;
    let drifted = 0;
    let hiddenLagged = 0;
    const STEPS = 12;
    for (let i = 1; i <= STEPS; i += 1) {
      mover.setBounds({ ...m0, x: m0.x + i * 4, y: m0.y - i * 2 });
      await sleep(16);
      const m = mover.getBounds();
      const g = target.getBounds();
      if (g.x - g0.x !== m.x - m0.x || g.y - g0.y !== m.y - m0.y) lagged += 1;
      if (g.x - (m.x + m.width) !== gap0) drifted += 1;
      if (hiddenTab && fmt(hiddenTab.getBounds()) !== fmt(g)) hiddenLagged += 1;
    }
    const during = { g: target.getBounds(), m: mover.getBounds() };
    check(`드래그 도중 그룹이 매 스텝 따라온다 (릴리즈 전)`, lagged === 0, `뒤처진 스텝=${lagged}/${STEPS}`);
    check('드래그 도중 간격이 유지된다 (표류 0)', drifted === 0, `어긋난 스텝=${drifted}/${STEPS}`);
    check('숨은 탭도 드래그 도중 따라온다', hiddenLagged === 0, `어긋난 스텝=${hiddenLagged}/${STEPS}`);

    await sleep(600); // 드랍 판정까지 기다린다
    check(
      '릴리즈 후 위치 == 마지막 이동 이벤트 시점 위치 (이중 적용 없음)',
      fmt(target.getBounds()) === fmt(during.g) && fmt(mover.getBounds()) === fmt(during.m),
      `group ${fmt(during.g)} → ${fmt(target.getBounds())} / mover ${fmt(during.m)} → ${fmt(mover.getBounds())}`
    );
    check('숨은 탭은 여전히 숨어 있다', !!hiddenTab && !hiddenTab.isVisible());
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 결함 2 회귀: 정지 구간으로 잘린 드래그가 하나의 드래그로 이어지는가.
  console.log('[probe] === 조각난 드래그(정지 구간 포함)도 하나의 드래그다 ===');
  const third = byTitle('Suggested Questions');
  if (!third) {
    console.log('[probe] 세 번째 창을 찾지 못했다 — 이 절은 건너뛴다');
  } else {
    hideOthers();
    if (!third.isVisible()) third.show();
    keep.add(third.id);
    await sleep(300);
    const t3 = third.getBounds();
    const gb = target.getBounds();
    // 그룹 오른쪽에 30px 간격을 두고 배치한 뒤, -8px 씩 세 조각으로 접근한다.
    // 세 조각을 다 해도 6px 이 남는다 — 마지막 6px 은 반드시 **흡착**이 메워야
    // 하므로, 드래그가 조각으로 잘려 버려지면 이 검사는 통과할 수 없다.
    // 각 조각은 move 이벤트 2개뿐이고, 조각 사이에 드랍 디바운스보다 긴 정지가
    // 있다 — 예전 코드가 드래그를 잘라서 통째로 버리던 바로 그 모양이다.
    // (왼쪽이 아니라 오른쪽인 이유: 왼쪽은 작업영역 끝이라 클램프가 개입한다.)
    third.setBounds({ x: gb.x + gb.width + 30, y: gb.y, width: t3.width, height: t3.height });
    await sleep(400);
    // 조각당 setBounds 1회 = 'will-move' + 'move' 2개. 예전 기준(move 4개)에
    // 정확히 못 미치는, 실제로 조준할 때 나오는 이벤트 수다.
    for (let i = 0; i < 3; i += 1) {
      await drag(third, -8, 0, 1);
      await sleep(500); // DROP_SETTLE_MS(320) 보다 긴 정지
    }
    const t3after = third.getBounds();
    const gnow = target.getBounds();
    check(
      '조각난 드래그가 이어져 탭 그룹에 흡착 (간격 0)',
      t3after.x === gnow.x + gnow.width,
      `third=${fmt(t3after)} group=${fmt(gnow)}`
    );

    // 클러스터 통째 이동: 그룹 + 창 2개가 같은 delta 로 움직인다.
    const b0 = [target.getBounds(), mover.getBounds(), third.getBounds()];
    await drag(third, 0, -40);
    const b1 = [target.getBounds(), mover.getBounds(), third.getBounds()];
    const deltas = b1.map((r, i) => `${r.x - b0[i].x},${r.y - b0[i].y}`);
    check(
      '그룹 포함 세 unit 이 같은 delta 로 이동',
      new Set(deltas).size === 1 && deltas[0] === '0,-40',
      deltas.join(' | ')
    );
  }

  console.log(`[probe] ${failures === 0 ? '=== ALL PASS ===' : `=== ${failures} FAILURE(S) ===`}`);
  app.exit(failures === 0 ? 0 : 1);
}

// 저장소를 먼저 심고 나서 main 을 불러온다 — restoreGroups 가 진짜 탭 그룹을
// 복원하게 하기 위해서다 (store 는 import 시점에 파일을 읽는다).
seedStore();
import('../out/main/index.js').then(() => app.whenReady().then(run));
