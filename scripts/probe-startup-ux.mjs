#!/usr/bin/env node
// 시작 시 사용자 경험 프로브 — 세 가지 결함의 회귀 방지.
//
//   1) Dock 이 내용에 맞춰 커진다 (구독 배너 유무에 따라 잘리지 않는다)
//   2) 로그인 전에도 모든 단축키가 등록된다
//   3) 로그인 전에도 저장된 표시 상태대로 창이 뜨고, 그래서 스냅이 걸린다
//
// 실행:
//   node --import ./scripts/probe-snap-register.mjs scripts/probe-startup-ux.mjs
//
// [중요] 검증 대상은 진짜 main 프로세스 모듈이다 (windowFit.ts / windows.ts /
// shortcuts.ts / store.ts / windowSnap.ts). Electron 껍데기와 electron-store 만
// 스텁이다. 화면 캡처와 합성 키 입력은 이 머신에서 불가능하므로 쓰지 않는다 —
// 여기서 확인하는 것은 전부 숫자와 상태다.

import {
  BACKING,
  REGISTERED_SHORTCUTS,
  WORK_AREA,
  resetDisplays
} from './probe-snap-stubs.mjs';

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures += 1;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}
const fmt = (r) => `${r.x},${r.y} ${r.width}x${r.height}`;

const types = await import('../src/shared/types.ts');
const store = await import('../src/main/store.ts');
const windowsMod = await import('../src/main/windows.ts');
const fit = await import('../src/main/windowFit.ts');
const shortcuts = await import('../src/main/shortcuts.ts');
const snap = await import('../src/main/windowSnap.ts');
const groups = await import('../src/main/windowGroups.ts');

/** 저장소를 공장 초기 상태로 (= 최초 실행, 세션 없음). */
function wipeStore() {
  for (const k of Object.keys(BACKING)) delete BACKING[k];
  BACKING.bounds = {};
  BACKING.opacity = {};
  resetDisplays();
}

/**
 * index.ts 의 app.whenReady() 창 배치 시퀀스 재현.
 * 표시 여부 판정은 index.ts 와 **같은 함수**(initiallyHiddenFor)를 부른다.
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
  const keyOf = new Map();
  for (const spec of windowsMod.OVERLAYS) {
    const win = windowsMod.createOverlayWindow(spec, {
      initiallyHidden: windowsMod.initiallyHiddenFor(spec.key)
    });
    windows.set(spec.key, win);
    keyOf.set(win.id, spec.key);
    groups.attachGroupDragHandlers(win, spec.key);
    snap.attachSnapDragHandlers(win, spec.key);
  }

  // index.ts 의 initWindowFit 배선과 동일 (팝오버 확장 상태는 시나리오가 주입).
  const tempExpanded = new Map();
  fit.initWindowFit({
    isTempExpanded: (w) => tempExpanded.has(w.id),
    noteNaturalHeightWhileExpanded: (w, h) => {
      const st = tempExpanded.get(w.id);
      if (!st || st.userResized) return;
      st.prev = { ...st.prev, height: h };
    },
    windowKeyOf: (w) => keyOf.get(w.id) ?? null
  });

  // index.ts 는 로그인 여부와 무관하게 시작 시점에 전부 등록한다.
  shortcuts.setShortcutDispatch(() => undefined);
  shortcuts.registerAllShortcuts();

  return { windows, tempExpanded };
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 1) Dock 이 렌더러가 잰 내용 높이에 맞춰 커진다 (저장된 크기 없음) ===');
{
  wipeStore();
  const { windows } = bootWindows();
  const dock = windows.get('dock');
  const spec = windowsMod.OVERLAYS.find((s) => s.key === 'dock');

  check(
    `사전 조건: dock 이 상수 defaultHeight(${spec.defaultHeight})로 열린다`,
    dock.getBounds().height === spec.defaultHeight,
    fmt(dock.getBounds())
  );

  // 렌더러 측정값 (배너 없음). 실제 dock 은 타이틀바 + 버튼 2줄 구조라
  // 130 보다 크다 — 그래서 상수로는 잘렸다.
  const NO_BANNER = 168;
  fit.fitWindowToContent(dock, NO_BANNER);
  check(
    'main 이 적용한 높이 >= 렌더러가 잰 내용 높이',
    dock.getBounds().height >= NO_BANNER,
    `applied=${dock.getBounds().height} measured=${NO_BANNER}`
  );
  check('정확히 내용 높이에 맞춘다 (남는 칸 없음)', dock.getBounds().height === NO_BANNER);
  check(
    '적용한 크기가 저장소에 남는다 (다음 실행에서 복원)',
    BACKING.bounds.dock?.height === NO_BANNER,
    JSON.stringify(BACKING.bounds.dock)
  );
  check('폭은 건드리지 않는다', dock.getBounds().width === spec.defaultWidth);

  // 배너 등장 (로그인이 필요합니다 / 체험 만료 / 결제 실패)
  const WITH_BANNER = 204;
  fit.fitWindowToContent(dock, WITH_BANNER);
  check(
    '배너가 나타나면 그만큼 커진다',
    dock.getBounds().height === WITH_BANNER,
    `${NO_BANNER} -> ${dock.getBounds().height}`
  );

  // 배너 소멸 (로그인 성공 / 결제 완료)
  fit.fitWindowToContent(dock, NO_BANNER);
  check(
    '배너가 사라지면 다시 줄어든다',
    dock.getBounds().height === NO_BANNER,
    `${WITH_BANNER} -> ${dock.getBounds().height}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 2) 사용자가 손으로 정한 크기를 즉시 덮어쓰지 않는다 ===');
{
  wipeStore();
  const { windows } = bootWindows();
  const dock = windows.get('dock');
  fit.fitWindowToContent(dock, 168);

  // 사용자가 마우스로 창을 크게 늘린다 ('resized' 발생).
  dock.userResize(380, 260);
  check('사전 조건: 사용자가 260 으로 늘림', dock.getBounds().height === 260);

  // 이후 배너가 사라져 내용은 168 이면 충분해도 줄이지 않는다.
  fit.fitWindowToContent(dock, 168);
  check(
    '내용이 작아져도 사용자 높이를 유지한다',
    dock.getBounds().height === 260,
    `height=${dock.getBounds().height}`
  );

  // 그러나 내용이 사용자 높이보다 커지면(잘림) 키운다 — 이 결함의 본체.
  fit.fitWindowToContent(dock, 300);
  check(
    '내용이 사용자 높이를 넘으면 잘리지 않게 키운다',
    dock.getBounds().height === 300,
    `height=${dock.getBounds().height}`
  );

  // 사용자가 줄인 경우도 같은 규칙: 잘리는 만큼만 되돌린다.
  dock.userResize(380, 120);
  fit.fitWindowToContent(dock, 168);
  check(
    '사용자가 내용보다 작게 줄이면 잘리지 않는 최소치까지만 키운다',
    dock.getBounds().height === 168,
    `height=${dock.getBounds().height}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 3) 작업 영역과 팝오버 임시 확장을 존중한다 ===');
{
  wipeStore();
  const { windows, tempExpanded } = bootWindows();
  const dock = windows.get('dock');

  fit.fitWindowToContent(dock, 99999);
  const b = dock.getBounds();
  check(
    '작업 영역보다 커지지 않는다',
    b.height <= WORK_AREA.height && b.y >= WORK_AREA.y,
    fmt(b)
  );
  check(
    '화면 아래로 삐져나가지 않는다',
    b.y + b.height <= WORK_AREA.y + WORK_AREA.height,
    `bottom=${b.y + b.height} limit=${WORK_AREA.y + WORK_AREA.height}`
  );

  // 팝오버가 열려 창이 일시 확장된 상태.
  dock.setBounds({ x: 16, y: 41, width: 380, height: 168 });
  const expandedTo = { x: 16, y: 41, width: 520, height: 560 };
  tempExpanded.set(dock.id, {
    prev: { x: 16, y: 41, width: 380, height: 168 },
    userResized: false
  });
  dock.setBounds(expandedTo);

  fit.fitWindowToContent(dock, 204);
  check(
    '확장 중에는 창 크기를 건드리지 않는다',
    fmt(dock.getBounds()) === fmt(expandedTo),
    fmt(dock.getBounds())
  );
  check(
    '대신 "확장이 끝나면 돌아갈 높이" 를 새 자연 높이로 갱신한다',
    tempExpanded.get(dock.id).prev.height === 204,
    `prev.height=${tempExpanded.get(dock.id).prev.height}`
  );

  // 확장 중 사용자가 직접 크기를 정했으면 그 선택이 이긴다.
  tempExpanded.set(dock.id, {
    prev: { x: 16, y: 41, width: 380, height: 400 },
    userResized: true
  });
  fit.fitWindowToContent(dock, 204);
  check(
    '확장 중 사용자가 정한 복귀 크기는 덮어쓰지 않는다',
    tempExpanded.get(dock.id).prev.height === 400
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 4) 세션이 없어도 모든 단축키가 등록된다 ===');
{
  wipeStore();
  check(
    '사전 조건: 저장된 세션 없음',
    !BACKING.session && !BACKING.authSession,
    JSON.stringify(Object.keys(BACKING))
  );
  bootWindows(); // index.ts 와 같이 registerAllShortcuts() 를 로그인 없이 호출

  check('registerAllShortcuts 가 완료 상태를 보고한다', shortcuts.isRegistered() === true);

  const ids = Object.keys(types.SHORTCUT_DEFAULTS);
  const map = store.getShortcuts();
  const missing = ids.filter((id) => !REGISTERED_SHORTCUTS.has(map[id]));
  check(
    `SHORTCUT_DEFAULTS 의 ${ids.length}개 id 가 전부 등록됨`,
    missing.length === 0,
    missing.length ? `누락: ${missing.join(', ')}` : `${REGISTERED_SHORTCUTS.size}개 accelerator`
  );

  // 사용자가 눌렀다고 보고한 키들을 이름으로 확인한다.
  const cmdNumbers = [
    'toggleAll',
    'toggleTranscript',
    'toggleDiagnosis',
    'toggleTerms',
    'toggleQuestions',
    'toggleSummary',
    'toggleDictation',
    'togglePatients'
  ];
  for (const id of cmdNumbers) {
    check(`${id} (${map[id]}) 등록됨`, REGISTERED_SHORTCUTS.has(map[id]));
  }
  check(
    '창 크기/스냅 분리 단축키도 등록됨',
    ['windowWiden', 'windowNarrow', 'windowTaller', 'windowShorter', 'windowSnapDetach'].every(
      (id) => REGISTERED_SHORTCUTS.has(map[id])
    )
  );
  check(
    '유료 기능 단축키도 등록된다 (막는 것은 main 의 ensureEntitled 게이트)',
    ['recordStartStop', 'runAnalyze', 'runSummary', 'runDictation'].every((id) =>
      REGISTERED_SHORTCUTS.has(map[id])
    )
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 5) 세션이 없어도 저장된 표시 상태대로 창이 뜬다 ===');
{
  wipeStore();
  const { windows } = bootWindows();
  const hidden = windowsMod.MAIN_WINDOW_KEYS.filter((k) => !windows.get(k).isVisible());
  check(
    '최초 실행(저장값 없음): dock 을 포함해 전부 표시',
    hidden.length === 0,
    hidden.length ? `숨김: ${hidden.join(', ')}` : '숨긴 창 없음'
  );
  check('dock 은 항상 표시', windows.get('dock').isVisible() === true);

  // 사용자가 일부 창을 닫아 둔 상태를 저장한다.
  wipeStore();
  store.saveWindowVisibility('transcript', true);
  store.saveWindowVisibility('diagnosis', true);
  store.saveWindowVisibility('terms', false);
  store.saveWindowVisibility('questions', false);
  store.saveWindowVisibility('summary', false);
  store.saveWindowVisibility('dictation', false);
  store.saveWindowVisibility('patients', true);

  const restarted = bootWindows();
  const wantShown = ['transcript', 'diagnosis', 'patients'];
  const wantHidden = ['terms', 'questions', 'summary', 'dictation'];
  check(
    `세션 없이 시작해도 표시로 저장된 ${wantShown.length}개가 보인다`,
    wantShown.every((k) => restarted.windows.get(k).isVisible()),
    wantShown.map((k) => `${k}=${restarted.windows.get(k).isVisible()}`).join(' ')
  );
  check(
    '숨김으로 저장된 창은 숨은 채로 뜬다',
    wantHidden.every((k) => !restarted.windows.get(k).isVisible()),
    wantHidden.map((k) => `${k}=${restarted.windows.get(k).isVisible()}`).join(' ')
  );

  // ── 로그아웃: 화면에서 걷어내되 저장된 취향은 건드리지 않는다 ──
  const before = JSON.stringify(BACKING.windowsVisibility);
  // index.ts 의 hideOverlaysAndClearPHI 중 창 처리 부분.
  for (const key of windowsMod.MAIN_WINDOW_KEYS) {
    const w = restarted.windows.get(key);
    if (w.isVisible()) w.hide();
  }
  check(
    '로그아웃: 모든 주 창이 화면에서 사라진다 (PHI 보호)',
    windowsMod.MAIN_WINDOW_KEYS.every((k) => !restarted.windows.get(k).isVisible())
  );
  check(
    '로그아웃은 저장된 표시 취향을 덮어쓰지 않는다',
    JSON.stringify(BACKING.windowsVisibility) === before,
    `${before} -> ${JSON.stringify(BACKING.windowsVisibility)}`
  );

  const afterSignOut = bootWindows();
  check(
    '로그아웃 후 재시작해도 사용자가 보던 창이 돌아온다',
    wantShown.every((k) => afterSignOut.windows.get(k).isVisible()) &&
      wantHidden.every((k) => !afterSignOut.windows.get(k).isVisible())
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 6) 로그인 전에도 스냅이 걸린다 (사용자가 보고한 시나리오) ===');
{
  wipeStore();
  const { windows } = bootWindows();
  const A = windows.get('diagnosis');
  const B = windows.get('patients');
  check(
    '사전 조건: 세션 없이도 두 창이 화면에 있다',
    A.isVisible() && B.isVisible(),
    `diagnosis=${A.isVisible()} patients=${B.isVisible()}`
  );

  const placeAndSave = (w, k, bounds) => {
    w.setBounds(bounds);
    store.saveBounds(k, bounds);
  };
  let i = 0;
  for (const [k, w] of windows) {
    if (k === 'diagnosis' || k === 'patients') continue;
    placeAndSave(w, k, { x: -8000, y: -8000 + i * 1000, width: 380, height: 200 });
    i += 1;
  }
  placeAndSave(A, 'diagnosis', { x: 800, y: 300, width: 380, height: 460 });
  // 흡착 거리 안쪽(왼쪽 18px 틈)에 두고 2px 만 밀어 붙인다.
  placeAndSave(B, 'patients', { x: 800 - 380 - 18, y: 300, width: 380, height: 420 });
  B.userDrag(2, 0);

  const rels = snap.getSnapRelations();
  check(
    '드래그 한 번으로 스냅이 걸린다',
    rels.some(
      (r) =>
        (r.a === 'patients' && r.b === 'diagnosis') ||
        (r.a === 'diagnosis' && r.b === 'patients')
    ),
    JSON.stringify(rels)
  );
  check(
    '맞닿은 좌표로 흡착됨',
    B.getBounds().x + B.getBounds().width === A.getBounds().x,
    `${fmt(B.getBounds())} | ${fmt(A.getBounds())}`
  );

  const beforeA = A.getBounds();
  B.userDrag(120, 40);
  const afterA = A.getBounds();
  check(
    '클러스터가 함께 움직인다',
    afterA.x - beforeA.x === 120 && afterA.y - beforeA.y === 40,
    `d=${afterA.x - beforeA.x},${afterA.y - beforeA.y}`
  );
}

console.log(`\n${failures === 0 ? '=== ALL PASS ===' : `=== ${failures} FAILURE(S) ===`}`);
process.exit(failures === 0 ? 0 : 1);
