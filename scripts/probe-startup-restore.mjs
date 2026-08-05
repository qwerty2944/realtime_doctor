#!/usr/bin/env node
// 시작 배치 검증 프로브: "저장된 위치 복원" vs "레이아웃 프리셋".
//
// 실행:
//   node --import ./scripts/probe-snap-register.mjs scripts/probe-startup-restore.mjs
//
// [중요] 검증 대상은 진짜 main 프로세스 모듈이다. windows.ts / layouts.ts /
// windowSnap.ts / store.ts 를 그대로 import 한다 (Electron 껍데기와
// electron-store 만 스텁). index.ts 는 앱 전체(네트워크·DB·인증)를 끌고 오므로
// 부팅 시퀀스 자체는 여기서 재현한다 — 아래 bootWindows() 가 index.ts 의
// app.whenReady() 블록과 같은 순서/같은 판정을 그대로 따른다.

import {
  BACKING,
  WORK_AREA,
  setDisplays,
  resetDisplays
} from './probe-snap-stubs.mjs';

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures += 1;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}
const fmt = (r) => `${r.x},${r.y} ${r.width}x${r.height}`;

const store = await import('../src/main/store.ts');
const windowsMod = await import('../src/main/windows.ts');
const layouts = await import('../src/main/layouts.ts');
const snap = await import('../src/main/windowSnap.ts');
const groups = await import('../src/main/windowGroups.ts');

/**
 * index.ts 의 app.whenReady() 창 배치 시퀀스 재현.
 * 판정 기준(hasSavedPlacement) 과 순서(창 생성 → 레이아웃? → 스냅 복원) 가
 * index.ts 와 1:1 로 대응한다.
 */
function bootWindows() {
  groups.dissolveAllGroups();
  const windows = new Map();
  snap.initWindowSnap({ windows });
  groups.initWindowGroups({
    windows,
    broadcast: () => undefined,
    onGroupChangedMembers: (ks) => snap.dropSnapsFor(ks)
  });
  for (const spec of windowsMod.OVERLAYS) {
    const win = windowsMod.createOverlayWindow(spec, { initiallyHidden: false });
    windows.set(spec.key, win);
    groups.attachGroupDragHandlers(win, spec.key);
    snap.attachSnapDragHandlers(win, spec.key);
  }

  const laidOut = !windowsMod.hasSavedPlacement();
  if (laidOut) {
    layouts.applyLayout(BACKING.defaultLayout ?? 'wide-grid', windows);
  }
  snap.restoreSnaps();
  return { windows, laidOut };
}

/** 저장소를 공장 초기 상태로 (= 최초 실행). */
function wipeStore() {
  for (const k of Object.keys(BACKING)) delete BACKING[k];
  BACKING.bounds = {};
  BACKING.opacity = {};
  resetDisplays();
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 1) 최초 실행(저장된 위치 없음): 프리셋으로 배치한다 ===');
let presetBounds;
{
  wipeStore();
  check('사전 조건: 저장된 위치 없음', windowsMod.hasSavedPlacement() === false);
  const { windows, laidOut } = bootWindows();
  check('레이아웃 프리셋이 적용됨', laidOut === true);

  const preset = layouts.resolveLayout('wide-grid');
  presetBounds = {};
  let allMatch = true;
  for (const [k, want] of Object.entries(preset)) {
    const got = windows.get(k).getBounds();
    presetBounds[k] = got;
    if (got.x !== want.x || got.y !== want.y || got.width !== want.width || got.height !== want.height) {
      allMatch = false;
      console.log(`      ${k}: got ${fmt(got)} want ${fmt(want)}`);
    }
  }
  check('모든 창이 프리셋 좌표에 놓임', allMatch);
  check(
    '적용된 좌표가 저장소에 남는다 (다음 실행에서 복원 가능)',
    windowsMod.hasSavedPlacement() === true,
    JSON.stringify(BACKING.bounds.diagnosis)
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 2) 재시작: 저장된 위치를 복원하고 레이아웃을 덮어쓰지 않는다 ===');
{
  // 1) 의 결과 위에서 사용자가 창 두 개를 직접 옮긴 상태를 만든다.
  const moved = {
    diagnosis: { x: 140, y: 220, width: 380, height: 460 },
    patients: { x: 900, y: 640, width: 420, height: 300 }
  };
  BACKING.bounds = { ...BACKING.bounds, ...moved };

  const { windows, laidOut } = bootWindows();
  check('레이아웃 프리셋을 적용하지 않음', laidOut === false);
  for (const [k, want] of Object.entries(moved)) {
    const got = windows.get(k).getBounds();
    check(`${k}: 사용자가 둔 자리 그대로`, fmt(got) === fmt(want), `got ${fmt(got)} want ${fmt(want)}`);
  }
  // 옮기지 않은 창은 이전 실행에서 저장된 프리셋 좌표를 유지한다.
  const terms = windows.get('terms').getBounds();
  check(
    '옮기지 않은 창도 저장값 유지 (프리셋 재적용 아님)',
    fmt(terms) === fmt(presetBounds.terms),
    `got ${fmt(terms)} want ${fmt(presetBounds.terms)}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 3) 스냅 클러스터가 재시작을 살아서 넘어간다 ===');
{
  wipeStore();
  const first = bootWindows();
  const A = first.windows.get('diagnosis');
  const B = first.windows.get('patients');
  // 붙일 두 창만 남기고 나머지는 멀리 치워 의도치 않은 흡착 후보를 없앤다.
  //
  // 사용자가 마우스로 옮긴 것과 같은 효과를 내려면 좌표 저장까지 해야 한다
  // (windows.ts 는 'moved' 이벤트에서 저장하는데, 프로그램적 setBounds 는
  // 그 이벤트를 발생시키지 않는다 — 실제 Electron 과 동일한 성질).
  const placeAndSave = (w, k, bounds) => {
    w.setBounds(bounds);
    store.saveBounds(k, bounds);
  };
  let i = 0;
  for (const [k, w] of first.windows) {
    if (k === 'diagnosis' || k === 'patients') continue;
    placeAndSave(w, k, { x: -8000, y: -8000 + i * 1000, width: 380, height: 200 });
    i += 1;
  }
  placeAndSave(A, 'diagnosis', { x: 800, y: 300, width: 380, height: 460 });
  placeAndSave(B, 'patients', { x: 800 - 380 - 18, y: 300, width: 380, height: 420 });
  B.userDrag(2, 0);
  const relOf = () =>
    snap.getSnapRelations().some(
      (r) =>
        (r.a === 'patients' && r.b === 'diagnosis') ||
        (r.a === 'diagnosis' && r.b === 'patients')
    );
  check('사전 조건: 두 창이 붙음', relOf());
  const savedA = A.getBounds();
  const savedB = B.getBounds();
  check(
    '붙은 좌표가 저장소에 기록됨',
    fmt(BACKING.bounds.patients) === fmt(savedB),
    `${fmt(BACKING.bounds.patients)} vs ${fmt(savedB)}`
  );

  // ── 재시작 ──
  const second = bootWindows();
  check('재시작 시 레이아웃을 적용하지 않음', second.laidOut === false);
  check(
    '두 창 모두 저장된 좌표로 복원',
    fmt(second.windows.get('diagnosis').getBounds()) === fmt(savedA) &&
      fmt(second.windows.get('patients').getBounds()) === fmt(savedB)
  );
  check('스냅 관계 복원', relOf(), JSON.stringify(snap.getSnapRelations()));

  const beforeA = second.windows.get('diagnosis').getBounds();
  second.windows.get('patients').userDrag(220, 60);
  const afterA = second.windows.get('diagnosis').getBounds();
  check(
    '복원된 클러스터가 함께 움직임 (거리 제한 없음)',
    afterA.x - beforeA.x === 220 && afterA.y - beforeA.y === 60,
    `d=${afterA.x - beforeA.x},${afterA.y - beforeA.y}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 4) 명시적 레이아웃 적용은 예전 그대로 (재배치 + 스냅 해체) ===');
{
  // 3) 의 상태(붙어 있는 두 창)를 이어받는다.
  const { windows } = bootWindows();
  check('사전 조건: 스냅 관계 있음', snap.getSnapRelations().length > 0);

  // index.ts 의 'layout:apply' 핸들러가 하는 일 그대로.
  groups.dissolveAllGroups();
  snap.dissolveAllSnaps();
  const ok = layouts.applyLayout('wide-grid', windows);
  check('applyLayout 성공', ok === true);
  check('스냅 관계 전부 해체', snap.getSnapRelations().length === 0);

  const preset = layouts.resolveLayout('wide-grid');
  let allMatch = true;
  for (const [k, want] of Object.entries(preset)) {
    if (fmt(windows.get(k).getBounds()) !== fmt(want)) allMatch = false;
  }
  check('모든 창이 프리셋 좌표로 재배치', allMatch);

  // 적용한 레이아웃이 다음 실행에도 남는지 — applyLayout 이 직접 저장한다.
  const restarted = bootWindows();
  check('재시작 후에도 방금 적용한 레이아웃 유지', (() => {
    for (const [k, want] of Object.entries(preset)) {
      if (fmt(restarted.windows.get(k).getBounds()) !== fmt(want)) return false;
    }
    return true;
  })());
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 5) 사라진 모니터의 좌표는 손이 닿는 곳으로 되돌린다 ===');
{
  wipeStore();
  // 오른쪽에 두 번째 모니터가 붙어 있는 상태에서 창을 거기에 두고 저장.
  const SECOND = { x: 1920, y: 0, width: 1920, height: 1080 };
  setDisplays([WORK_AREA, SECOND]);
  const onSecond = { x: 2400, y: 500, width: 380, height: 460 };
  check(
    '두 번째 모니터 위 좌표는 보정하지 않는다',
    fmt(windowsMod.clampBoundsToDisplays(onSecond)) === fmt(onSecond)
  );

  BACKING.bounds = { diagnosis: onSecond };
  // 모니터를 뽑는다.
  setDisplays([WORK_AREA]);
  const fixed = windowsMod.clampBoundsToDisplays(onSecond);
  check(
    '모니터 제거 후 주 작업영역 안으로 이동',
    fixed.x >= WORK_AREA.x &&
      fixed.x + fixed.width <= WORK_AREA.x + WORK_AREA.width &&
      fixed.y >= WORK_AREA.y &&
      fixed.y + fixed.height <= WORK_AREA.y + WORK_AREA.height,
    fmt(fixed)
  );

  const { windows } = bootWindows();
  const got = windows.get('diagnosis').getBounds();
  check('창이 실제로 닿는 위치에 열림', fmt(got) === fmt(fixed), fmt(got));
  check(
    '보정된 좌표가 저장값도 고친다 (매번 반복하지 않음)',
    fmt(BACKING.bounds.diagnosis) === fmt(fixed),
    fmt(BACKING.bounds.diagnosis)
  );

  // 경계: 작업영역에 80px 이상 걸쳐 있으면 "닿는다" 로 보고 건드리지 않는다.
  const barelyIn = { x: -300, y: 100, width: 380, height: 460 }; // 80px 노출
  check(
    '80px 걸친 창은 그대로 둔다',
    fmt(windowsMod.clampBoundsToDisplays(barelyIn)) === fmt(barelyIn)
  );
  const barelyOut = { x: -301, y: 100, width: 380, height: 460 }; // 79px 노출
  check(
    '79px 만 걸친 창은 되돌린다',
    windowsMod.clampBoundsToDisplays(barelyOut).x === WORK_AREA.x,
    fmt(windowsMod.clampBoundsToDisplays(barelyOut))
  );
  // 세로 방향(작업영역 위쪽 메뉴바 밖) 도 같은 규칙.
  const aboveScreen = { x: 200, y: -900, width: 380, height: 460 };
  check(
    '화면 위로 밀려난 창도 되돌린다',
    windowsMod.clampBoundsToDisplays(aboveScreen).y === WORK_AREA.y,
    fmt(windowsMod.clampBoundsToDisplays(aboveScreen))
  );
  resetDisplays();
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 6) 세로 스택 프리셋이 화면 아래로 넘친 창도 다음 실행에 되돌아온다 ===');
{
  // right-stack 은 창 7개의 높이 합이 작업영역을 넘으면 최소 높이(180)에서
  // 축소를 멈춘다 — layouts.ts 주석이 인정하는 트레이드오프다. 그 결과 아래쪽
  // 창은 화면 밖에 놓일 수 있는데, 이제는 다음 실행에서 손이 닿는 곳으로
  // 돌아온다. (예전에는 매 실행 프리셋이 다시 밖으로 밀어냈다.)
  wipeStore();
  const { windows } = bootWindows();
  layouts.applyLayout('right-stack', windows);
  const bottom = WORK_AREA.y + WORK_AREA.height;
  const outOfReach = [...windows.entries()].filter(
    ([, w]) => w.getBounds().y >= bottom
  );
  check('프리셋이 실제로 화면 밖에 놓는 창이 있다', outOfReach.length > 0, `${outOfReach.length}개`);

  const restarted = bootWindows();
  const stillOut = [...restarted.windows.entries()].filter(
    ([, w]) => w.getBounds().y >= bottom
  );
  check('재시작 후 화면 밖에 남은 창 없음', stillOut.length === 0, stillOut.map(([k]) => k).join(','));
}

console.log(`\n${failures === 0 ? '=== ALL PASS ===' : `=== ${failures} FAILURE(S) ===`}`);
process.exit(failures === 0 ? 0 : 1);
