#!/usr/bin/env node
// 창 가장자리 스냅 검증 프로브.
//
// 실행:
//   node --import ./scripts/probe-snap-register.mjs scripts/probe-snap.mjs
//
// [중요] 검증 대상은 진짜 main 프로세스 모듈이다. src/main/windowSnap.ts 와
// windowGroups.ts 를 그대로 import 해서 실제 이벤트 핸들러를 구동한다
// (Electron 껍데기와 electron-store 만 스텁). 화면 캡처와 합성 입력이 막힌
// 환경이므로 관측은 전부 bounds 숫자로 한다.

import {
  FakeWindow,
  WORK_AREA,
  BACKING,
  setCursor
} from './probe-snap-stubs.mjs';

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures += 1;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}
const b = (w) => w.getBounds();
const fmt = (r) => `${r.x},${r.y} ${r.width}x${r.height}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const snap = await import('../src/main/windowSnap.ts');
const groups = await import('../src/main/windowGroups.ts');

const SPECS = {
  transcript: { width: 380, height: 320 },
  diagnosis: { width: 380, height: 460 },
  terms: { width: 380, height: 240 },
  questions: { width: 380, height: 260 },
  summary: { width: 380, height: 320 },
  dictation: { width: 420, height: 380 },
  patients: { width: 380, height: 420 },
  dock: { width: 380, height: 130 }
};

/**
 * 시나리오에 안 쓰는 창을 멀리 떨어뜨려 둔다.
 * 한 곳에 겹쳐 두면 그 창들이 의도치 않은 흡착 후보가 되어 시나리오를 오염시킨다.
 */
function park(w, i) {
  w.place({ x: -8000, y: -8000 + i * 1000 });
}

/** 매 시나리오마다 창 8개를 새로 만들고 모듈 상태를 초기화한다. */
function freshWorld(keys = Object.keys(SPECS)) {
  // 모듈 전역 상태를 시나리오 사이에 완전히 끊는다.
  // (initWindowGroups 는 참조만 갈아끼우므로 그룹 배열은 직접 해체해야 한다.)
  groups.dissolveAllGroups();
  delete BACKING.windowGroups;
  delete BACKING.windowSnaps;
  BACKING.bounds = {};
  const windows = new Map();
  keys.forEach((k, i) => {
    const w = new FakeWindow({ x: 0, y: 0, ...SPECS[k] });
    park(w, i);
    windows.set(k, w);
  });
  groups.initWindowGroups({
    windows,
    broadcast: () => undefined,
    // index.ts 와 같은 배선: 그룹 구성이 바뀌면 스냅 관계를 unit 기준으로
    // 정규화하고, 그룹 대표가 바뀌면 관계를 넘겨받는다.
    onGroupChangedMembers: (ks) => snap.normalizeSnapUnits(ks),
    onSnapUnitReassign: (from, to) => snap.reassignSnapUnit(from, to)
  });
  snap.initWindowSnap({ windows });
  for (const [k, w] of windows) {
    groups.attachGroupDragHandlers(w, k);
    snap.attachSnapDragHandlers(w, k);
  }
  setCursor(-10000, -10000); // 머지 후보 밖
  return windows;
}

const rel = (x, y) =>
  snap
    .getSnapRelations()
    .some((r) => (r.a === x && r.b === y) || (r.a === y && r.b === x));

/**
 * 붙이기는 **선택지를 거쳐서만** 일어난다: 대상 창 위에 겹쳐 놓고(선택지 표시),
 * 방향을 골라 실행한다. 자동 흡착이 사라졌으므로 "가까이 끌어다 놓기" 로는
 * 어떤 관계도 만들 수 없다 — 모든 시나리오의 사전 조건은 이 헬퍼를 통과한다.
 *
 * @param side 드래그한 창이 놓일 자리 ('left' = 대상의 왼쪽).
 */
async function attach(W, dragged, target, side) {
  const t = b(W.get(target));
  // 대상 위에 **정확히 포개지도록** 놓는다. 옆으로 삐져나가면 이웃 창까지
  // 겹침 후보가 되어(겹침 대상 2개) 선택지가 아예 안 뜬다.
  W.get(dragged).place({ x: t.x - 8, y: t.y - 8, ...SPECS[dragged] });
  await W.get(dragged).userDrag(8, 8);
  snap.applySnapChoice(dragged, target, side);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 1) 선택지의 네 방향: 딱 맞닿고 관계가 기록되는가 ===');
{
  // targetY 는 방향마다 다르다 — 결과가 작업 영역(y 25..1080) 안에 들어가야
  // 클램프가 개입하지 않는다.
  const cases = [
    { name: '왼쪽 붙이기', side: 'left', targetY: 300 },
    { name: '오른쪽 붙이기', side: 'right', targetY: 300 },
    { name: '위로 붙이기', side: 'top', targetY: 520 },
    { name: '아래로 붙이기', side: 'bottom', targetY: 150 }
  ];
  for (const c of cases) {
    const W = freshWorld();
    const target = W.get('diagnosis'); // 380x460
    const mover = W.get('patients'); // 380x420
    target.place({ x: 800, y: c.targetY });
    const t = b(target);
    const m = SPECS.patients;
    const want = {
      left: { x: t.x - m.width, y: t.y },
      right: { x: t.x + t.width, y: t.y },
      top: { x: t.x, y: t.y - m.height },
      bottom: { x: t.x, y: t.y + t.height }
    }[c.side];

    await attach(W, 'patients', 'diagnosis', c.side);

    const got = b(mover);
    check(
      `${c.name}: 간격 0 으로 붙는다`,
      got.x === want.x && got.y === want.y,
      `got ${fmt(got)} / want ${want.x},${want.y}`
    );
    check(`${c.name}: 관계 기록`, rel('patients', 'diagnosis'), JSON.stringify(snap.getSnapRelations()));
    check(
      `${c.name}: 크기는 그대로 (강제 리사이즈 없음)`,
      got.width === m.width && got.height === m.height
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 자동 흡착(자석)은 전부 제거됐다. 변끼리 아무리 가까워도 저절로 붙지 않는다 —
// 붙는 유일한 길은 겹쳐 놓고 선택지에서 고르는 것이다.
console.log('\n=== 2) 근접 드랍은 아무것도 하지 않는다 (자석 없음) ===');
for (const gap of [4, 18, 48]) {
  const W = freshWorld();
  const target = W.get('diagnosis');
  const mover = W.get('patients');
  target.place({ x: 900, y: 300 });
  const t = b(target);
  const endX = t.x - SPECS.patients.width - gap;
  mover.place({ x: endX - 16, y: t.y, ...SPECS.patients });
  await mover.userDrag(16, 0);
  check(
    `간격 ${gap}px → 붙지 않는다`,
    !rel('patients', 'diagnosis'),
    JSON.stringify(snap.getSnapRelations())
  );
  check(
    `간격 ${gap}px → 창이 움직여지지 않는다 (놓은 자리 그대로)`,
    b(mover).x === endX && b(mover).y === t.y,
    fmt(b(mover))
  );
  check(`간격 ${gap}px → 선택지도 뜨지 않는다`, snap.getPendingSnapChoice() === null);
}

console.log('\n--- 얕게 파고든 드랍도 마찬가지로 아무 일 없음 ---');
{
  const W = freshWorld();
  const target = W.get('diagnosis');
  const mover = W.get('patients');
  target.place({ x: 900, y: 300 });
  const t = b(target);
  // 오른쪽 변이 12px 파고든 상태 — 예전에는 여기서 자석이 붙였다.
  const endX = t.x - SPECS.patients.width + 12;
  mover.place({ x: endX - 16, y: t.y, ...SPECS.patients });
  await mover.userDrag(16, 0);
  check('12px 겹침 → 붙지 않는다', !rel('patients', 'diagnosis'));
  check('12px 겹침 → 창은 놓은 자리 그대로', b(mover).x === endX, fmt(b(mover)));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 3) 클러스터 이동: 어느 멤버를 끌어도 전원이 같은 delta 로 ===');
{
  const W = freshWorld();
  const A = W.get('diagnosis');
  const B = W.get('patients');
  A.place({ x: 800, y: 300 });
  await attach(W, 'patients', 'diagnosis', 'left');
  check('사전 조건: 붙어 있음', rel('patients', 'diagnosis'));

  for (const [label, leader] of [
    ['끌린 창 = patients', B],
    ['끌린 창 = diagnosis', A]
  ]) {
    const before = { a: b(A), b: b(B) };
    const before2 = snap.getSnapDiagnostics().appliedBoundsCount;
    await leader.userDrag(40, 24);
    const after = { a: b(A), b: b(B) };
    const da = { x: after.a.x - before.a.x, y: after.a.y - before.a.y };
    const db = { x: after.b.x - before.b.x, y: after.b.y - before.b.y };
    check(
      `${label}: 두 창의 delta 가 동일`,
      da.x === db.x && da.y === db.y && da.x === 40 && da.y === 24,
      `A=${JSON.stringify(da)} B=${JSON.stringify(db)}`
    );
    check(
      `${label}: 여전히 맞닿음 (간격 0)`,
      after.b.x + after.b.width === after.a.x
    );
    const applied = snap.getSnapDiagnostics().appliedBoundsCount - before2;
    // [기준이 바뀐 이유] 예전에는 클러스터가 드랍 때 한 번만 움직였으므로
    // "드래그 1회당 setBounds ≤ 멤버수" 였다. 이제는 드래그 **도중에도** 팔로워가
    // 따라오므로(라이브 추종) 상한은 "이동 이벤트 수 × 팔로워 수" 다. 되먹임이
    // 없다는 성질은 그대로 — 이벤트당 상수이고 이벤트에 선형이다.
    const STEPS = 8; // FakeWindow.userDrag 기본값
    const FOLLOWERS = 1;
    check(
      `${label}: setBounds 가 이동 이벤트에 선형 (${applied}회 ≤ ${STEPS}×${FOLLOWERS})`,
      applied >= 1 && applied <= STEPS * FOLLOWERS,
      `${applied}`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 4) 3창 사슬 A-B-C 가 한 덩어리로 움직인다 ===');
{
  const W = freshWorld();
  const A = W.get('terms'); // 380x240
  const B = W.get('diagnosis'); // 380x460
  const C = W.get('patients'); // 380x420
  B.place({ x: 700, y: 300 });
  await attach(W, 'terms', 'diagnosis', 'left');
  await attach(W, 'patients', 'diagnosis', 'right');
  check('사슬 구성 A-B, B-C', rel('terms', 'diagnosis') && rel('patients', 'diagnosis'));
  check(
    'clusterOf 가 3개 전부 반환',
    snap.clusterOf('terms').sort().join(',') === 'diagnosis,patients,terms',
    snap.clusterOf('terms').join(',')
  );

  const before = [b(A), b(B), b(C)];
  await B.userDrag(-50, 30); // 가운데 창을 끈다
  const after = [b(A), b(B), b(C)];
  const deltas = after.map((r, i) => `${r.x - before[i].x},${r.y - before[i].y}`);
  check(
    '세 창 모두 동일 delta',
    new Set(deltas).size === 1 && deltas[0] === '-50,30',
    deltas.join(' | ')
  );
  check(
    '사슬 인접성 유지',
    after[0].x + after[0].width === after[1].x &&
      after[1].x + after[1].width === after[2].x
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 5) 분리는 명시적 동작으로만 — 드래그 거리에는 천장이 없다 ===');
{
  const W = freshWorld();
  const A = W.get('diagnosis');
  const B = W.get('patients');
  // 작업영역(0..1920 × 25..1080) 안에서 600px 오른쪽 + 400px 아래로 움직여도
  // 클램프가 개입하지 않도록 왼쪽 위에 여유를 두고 배치한다.
  A.place({ x: 600, y: 100 });
  await attach(W, 'patients', 'diagnosis', 'left');
  check('사전 조건: 붙어 있음', rel('patients', 'diagnosis'));

  // 한 번의 드래그로 600px — 예전 DETACH_PX(96) 라면 여기서 떨어졌다.
  const before = { a: b(A), b: b(B) };
  await B.userDrag(600, 0);
  const after = { a: b(A), b: b(B) };
  check(
    '600px 한 번에 이동해도 관계 유지',
    rel('patients', 'diagnosis'),
    JSON.stringify(snap.getSnapRelations())
  );
  check(
    '두 창 모두 정확히 600px 이동',
    after.a.x - before.a.x === 600 && after.b.x - before.b.x === 600,
    `dA=${after.a.x - before.a.x} dB=${after.b.x - before.b.x}`
  );
  check('이동 후에도 맞닿음(간격 0)', after.b.x + after.b.width === after.a.x);

  // 아래로도 큰 거리 — 방향 무관하게 천장이 없다는 확인.
  const beforeY = { a: b(A).y, b: b(B).y };
  await B.userDrag(0, 400);
  check(
    '세로 400px 이동해도 관계 유지 + 동일 delta',
    rel('patients', 'diagnosis') &&
      b(A).y - beforeY.a === 400 &&
      b(B).y - beforeY.b === 400,
    `dA=${b(A).y - beforeY.a} dB=${b(B).y - beforeY.b}`
  );

  // ── 명시적 분리 ──
  const aBefore = b(A);
  const bBefore = b(B);
  check('detachFromCluster 가 true 반환', snap.detachFromCluster('patients') === true);
  check('관계 해제됨', !rel('patients', 'diagnosis'), JSON.stringify(snap.getSnapRelations()));
  check(
    '분리는 어느 창도 움직이지 않는다 (순간이동 없음)',
    b(A).x === aBefore.x && b(A).y === aBefore.y &&
      b(B).x === bBefore.x && b(B).y === bBefore.y
  );
  check('붙어 있지 않은 창의 분리는 no-op', snap.detachFromCluster('patients') === false);

  // 분리 후: 맞닿은 변에서 멀어지면 더 이상 따라오지 않는다.
  const aBefore2 = b(A);
  await B.userDrag(-300, 0);
  check(
    '분리 후: 이 창의 이동이 상대를 끌지 않음',
    b(A).x === aBefore2.x && b(A).y === aBefore2.y
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 5b) 사슬 A-B-C 에서 가운데 B 를 분리하면 사슬이 끊긴다 ===');
{
  const W = freshWorld();
  const A = W.get('terms'); // 380x240
  const B = W.get('diagnosis'); // 380x460
  const C = W.get('patients'); // 380x420
  B.place({ x: 700, y: 300 });
  await attach(W, 'terms', 'diagnosis', 'left');
  await attach(W, 'patients', 'diagnosis', 'right');
  check('사전 조건: A-B-C 클러스터', snap.clusterOf('terms').length === 3);

  check('가운데 B 분리', snap.detachFromCluster('diagnosis') === true);
  // A 와 C 사이에는 B 의 폭(380px)만큼 빈 공간이 있다 — 맞닿지 않은 둘을
  // 이어두면 보이지 않는 기하가 된다. 그래서 사슬은 끊는다.
  check('A 는 홀로 남음', snap.clusterOf('terms').join(',') === 'terms');
  check('C 도 홀로 남음', snap.clusterOf('patients').join(',') === 'patients');
  check('B 도 홀로 남음', snap.clusterOf('diagnosis').join(',') === 'diagnosis');
  check('관계 0건', snap.getSnapRelations().length === 0, JSON.stringify(snap.getSnapRelations()));

  const aBefore = b(A);
  const bBefore = b(B);
  await C.userDrag(0, 300);
  check(
    '분리된 B 는 더 이상 따라오지 않음',
    b(B).x === bBefore.x && b(B).y === bBefore.y
  );
  check('A 도 따라오지 않음', b(A).x === aBefore.x && b(A).y === aBefore.y);

  // ── 끝 창(C) 분리는 A-B 를 그대로 남긴다 ──
  const W2 = freshWorld();
  const A2 = W2.get('terms');
  const B2 = W2.get('diagnosis');
  const C2 = W2.get('patients');
  B2.place({ x: 700, y: 300 });
  await attach(W2, 'terms', 'diagnosis', 'left');
  await attach(W2, 'patients', 'diagnosis', 'right');
  check('사전 조건: A-B-C', snap.clusterOf('terms').length === 3);
  snap.detachFromCluster('patients');
  check(
    '끝 창 분리 후 A-B 는 유지',
    snap.clusterOf('terms').sort().join(',') === 'diagnosis,terms',
    snap.clusterOf('terms').join(',')
  );
  const cBefore = b(C2);
  const bBefore2 = b(B2);
  await A2.userDrag(-120, 0);
  check(
    '남은 A-B 는 함께 이동',
    b(B2).x - bBefore2.x === -120,
    `${b(B2).x - bBefore2.x}`
  );
  check('분리된 C 는 제자리', b(C2).x === cBefore.x && b(C2).y === cBefore.y);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 6) 되먹임 루프 없음: 사용자 이동 1회당 프로그램 적용이 유한 ===');
{
  const W = freshWorld();
  const keys = ['terms', 'diagnosis', 'patients', 'summary'];
  // 4창 사슬을 가로로 구성.
  W.get('terms').place({ x: 300, y: 300, ...SPECS.terms });
  let prev = 'terms';
  for (const k of keys.slice(1)) {
    await attach(W, k, prev, 'right');
    prev = k;
  }
  check('4창 클러스터 구성', snap.clusterOf('terms').length === 4, snap.clusterOf('terms').join(','));

  const before = snap.getSnapDiagnostics().appliedBoundsCount;
  await W.get('summary').userDrag(20, 20);
  const applied = snap.getSnapDiagnostics().appliedBoundsCount - before;
  // 상한 = 이동 이벤트 수(8) × 팔로워 unit 수(3). 라이브 추종이 이벤트마다
  // 팔로워를 맞추므로 선형이고, 그 이상은 되먹임이라는 뜻이 된다.
  const BOUND = 8 * 3;
  check(
    `드래그 1회(이동 이벤트 8) → 프로그램 setBounds ${applied}회 (≤ ${BOUND}, 폭주 아님)`,
    applied >= 1 && applied <= BOUND,
    `${applied}`
  );
  // 스텁의 setBounds 는 실제 Electron 처럼 'move' 를 다시 쏜다. 위 숫자가
  // 유한하다는 것 자체가 가드(applyingBounds)가 재진입을 막았다는 증거다.
  const before2 = snap.getSnapDiagnostics().appliedBoundsCount;
  await W.get('terms').userDrag(-10, 0);
  const applied2 = snap.getSnapDiagnostics().appliedBoundsCount - before2;
  check(`반대쪽 끝을 끌어도 ${applied2}회로 유한 (≤ ${BOUND})`, applied2 >= 1 && applied2 <= BOUND, `${applied2}`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 7) 클러스터는 작업 영역 밖으로 밀려나지 않는다 ===');
{
  const W = freshWorld();
  const A = W.get('diagnosis');
  const B = W.get('patients');
  const rightEdge = WORK_AREA.x + WORK_AREA.width;
  A.place({ x: rightEdge - 380 - 10, y: 300 });
  await attach(W, 'patients', 'diagnosis', 'left');
  check('사전 조건: 우측 끝에 붙어 있음', rel('patients', 'diagnosis'));

  await B.userDrag(80, 0); // 오른쪽으로 밀기 — 10px 만 남았다
  const ra = b(A);
  const rb = b(B);
  check(
    '오른쪽 클램프: 어느 창도 작업영역을 넘지 않음',
    ra.x + ra.width <= rightEdge && rb.x + rb.width <= rightEdge,
    `A right=${ra.x + ra.width} B right=${rb.x + rb.width} limit=${rightEdge}`
  );
  check('클램프 후에도 강체 유지 (간격 0)', rb.x + rb.width === ra.x);

  // 위쪽(작업영역 y=25) 으로도 확인
  const W2 = freshWorld();
  const C = W2.get('diagnosis');
  const D = W2.get('patients');
  C.place({ x: 600, y: WORK_AREA.y + 8 });
  await attach(W2, 'patients', 'diagnosis', 'left');
  await D.userDrag(0, -60);
  check(
    '위쪽 클램프',
    b(C).y >= WORK_AREA.y && b(D).y >= WORK_AREA.y,
    `C.y=${b(C).y} D.y=${b(D).y} min=${WORK_AREA.y}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 8) 재시작 후 관계 유지 / 없는 창을 가리키는 관계는 조용히 폐기 ===');
{
  const W = freshWorld();
  const A = W.get('diagnosis');
  const B = W.get('patients');
  A.place({ x: 800, y: 300 });
  await attach(W, 'patients', 'diagnosis', 'left');
  const savedBounds = { a: b(A), b: b(B) };
  check('저장소에 관계가 기록됨', (BACKING.windowSnaps ?? []).length === 1, JSON.stringify(BACKING.windowSnaps));

  // ── 재시작 시뮬레이션: 창 객체를 새로 만들고 저장된 bounds 로 복원 ──
  const windows2 = new Map();
  Object.keys(SPECS).forEach((k, i) => {
    const w = new FakeWindow({ x: 0, y: 0, ...SPECS[k] });
    park(w, i);
    windows2.set(k, w);
  });
  windows2.get('diagnosis').place(savedBounds.a);
  windows2.get('patients').place(savedBounds.b);
  groups.initWindowGroups({ windows: windows2, broadcast: () => undefined });
  snap.initWindowSnap({ windows: windows2 });
  for (const [k, w] of windows2) snap.attachSnapDragHandlers(w, k);
  snap.restoreSnaps();
  check('재시작 후 관계 복원', rel('patients', 'diagnosis'), JSON.stringify(snap.getSnapRelations()));

  // 복원된 관계가 실제로 살아 있는지 — 이동으로 확인
  const beforeA = windows2.get('diagnosis').getBounds();
  await windows2.get('patients').userDrag(24, 0);
  check(
    '복원된 클러스터가 함께 움직임',
    windows2.get('diagnosis').getBounds().x - beforeA.x === 24,
    `${windows2.get('diagnosis').getBounds().x - beforeA.x}`
  );

  // ── 없는 창 / 깨진 항목이 섞인 저장값 ──
  BACKING.windowSnaps = [
    { a: 'patients', b: 'diagnosis', edge: 'right' },
    { a: 'dictation', b: 'ghost-window', edge: 'left' },
    { a: 'nope', b: 'terms', edge: 'top' },
    { a: 'terms', b: 'terms', edge: 'top' },
    { a: 'summary', b: 'questions', edge: 'sideways' },
    null,
    'garbage'
  ];
  const windows3 = new Map();
  // dictation 을 아예 만들지 않는다 = "더 이상 존재하지 않는 창".
  Object.keys(SPECS).forEach((k, i) => {
    if (k === 'dictation') return;
    const w = new FakeWindow({ x: 0, y: 0, ...SPECS[k] });
    park(w, i);
    windows3.set(k, w);
  });
  windows3.get('diagnosis').place(savedBounds.a);
  windows3.get('patients').place(savedBounds.b);
  groups.initWindowGroups({ windows: windows3, broadcast: () => undefined });
  snap.initWindowSnap({ windows: windows3 });
  let threw = null;
  try {
    snap.restoreSnaps();
  } catch (e) {
    threw = e;
  }
  check('깨진 저장값에도 예외 없음', threw === null, threw ? String(threw) : '');
  check(
    '유효한 관계 1건만 남음',
    snap.getSnapRelations().length === 1 && rel('patients', 'diagnosis'),
    JSON.stringify(snap.getSnapRelations())
  );

  // ── 레이아웃이 흩어 놓은 뒤 재시작하면 관계는 스스로 소멸 ──
  BACKING.windowSnaps = [{ a: 'patients', b: 'diagnosis', edge: 'right' }];
  const windows4 = new Map();
  Object.keys(SPECS).forEach((k, i) => {
    const w = new FakeWindow({ x: 0, y: 0, ...SPECS[k] });
    park(w, i);
    windows4.set(k, w);
  });
  windows4.get('diagnosis').place({ x: 40, y: 40, ...SPECS.diagnosis });
  windows4.get('patients').place({ x: 1200, y: 600, ...SPECS.patients });
  groups.initWindowGroups({ windows: windows4, broadcast: () => undefined });
  snap.initWindowSnap({ windows: windows4 });
  snap.restoreSnaps();
  check('멀리 떨어진 채 복원 → 관계 폐기', snap.getSnapRelations().length === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 9) applyLayout 은 스냅을 해체한다 ===');
{
  const W = freshWorld();
  const A = W.get('diagnosis');
  const B = W.get('patients');
  A.place({ x: 800, y: 300 });
  await attach(W, 'patients', 'diagnosis', 'left');
  check('사전 조건: 붙어 있음', rel('patients', 'diagnosis'));
  snap.dissolveAllSnaps(); // index.ts 의 'layout:apply' 핸들러가 하는 일
  check('해체 후 관계 없음', snap.getSnapRelations().length === 0);
  check('저장소도 비워짐', (BACKING.windowSnaps ?? []).length === 0);
  const aBefore = b(A);
  await B.userDrag(40, 0);
  check('해체 후 한 창 이동이 다른 창을 끌지 않음', b(A).x === aBefore.x);
}

// ═══════════════════════════════════════════════════════════════════════════
// 겹쳐 놓으면 **아무것도 자동으로 하지 않고 묻는다**. 실행은 사용자가 고른
// 것 하나뿐이다 (windowSnap.ts 상단 주석 참고).
console.log('\n=== 10) 겹쳐 놓으면 선택지 — 고른 것만 실행된다 ===');
{
  const W = freshWorld();
  const target = W.get('diagnosis');
  const mover = W.get('patients');
  target.place({ x: 800, y: 300 });
  // 타깃 위로 확실히 겹치게 놓고, 커서도 타깃 안에 둔다 (예전 머지 조건).
  mover.place({ x: 820, y: 320, ...SPECS.patients });
  setCursor(900, 400);
  const droppedAt = b(mover);
  await mover.userDrag(8, 8);

  const prompt = snap.getPendingSnapChoice();
  check(
    '선택지가 뜬다 (dragged=patients, target=diagnosis)',
    prompt?.dragged === 'patients' && prompt?.target === 'diagnosis',
    JSON.stringify(prompt)
  );
  check('선택 전에는 탭 그룹이 생기지 않는다', groups.getGroupsState().length === 0);
  // 선택지는 대상 창의 렌더러가 그린다 — 대상이 끌던 창 아래에 깔려 있으면
  // 물어보는 UI 자체가 안 보인다. 그래서 표시 시점에 대상을 맨 위로 올린다.
  check(
    '대상 창을 z-order 맨 위로 올린다 (가려짐 방지)',
    target.moveTopCount === 1,
    `moveTop=${target.moveTopCount ?? 0}회`
  );
  check('끌던 창은 올리지 않는다 (포커스/순서를 함부로 건드리지 않는다)', !mover.moveTopCount);
  check('선택 전에는 스냅 관계도 생기지 않는다', snap.getSnapRelations().length === 0);
  check(
    '창은 놓인 자리 그대로 (자동 순간이동 없음)',
    b(mover).x === droppedAt.x + 8 && b(mover).y === droppedAt.y + 8,
    fmt(b(mover))
  );

  // '합치기' 를 골라야 비로소 머지된다.
  snap.applySnapChoice('patients', 'diagnosis', 'merge');
  const gs = groups.getGroupsState();
  check('합치기 선택 → 탭 그룹 생성', gs.length === 1 && gs[0].tabs.length === 2, JSON.stringify(gs));
  check('선택지는 닫힌다', snap.getPendingSnapChoice() === null);
}

console.log('\n--- 취소하면 아무 일도 일어나지 않는다 ---');
{
  const W = freshWorld();
  const target = W.get('diagnosis');
  const mover = W.get('patients');
  target.place({ x: 800, y: 300 });
  mover.place({ x: 820, y: 320, ...SPECS.patients });
  setCursor(900, 400);
  await mover.userDrag(8, 8);
  const at = b(mover);
  snap.cancelSnapChoice();
  check('취소 후 탭 그룹 없음', groups.getGroupsState().length === 0);
  check('취소 후 스냅 관계 없음', snap.getSnapRelations().length === 0);
  check('취소 후 창은 그 자리', b(mover).x === at.x && b(mover).y === at.y);
  // 닫힌 뒤에 도착한 클릭은 버려진다 (창이 뒤늦게 튀지 않는다).
  snap.applySnapChoice('patients', 'diagnosis', 'left');
  check('닫힌 선택지에 대한 뒤늦은 클릭은 무시', snap.getSnapRelations().length === 0);
}

console.log('\n--- 방향을 고르면 그 방향으로만 붙는다 ---');
{
  const W = freshWorld();
  const target = W.get('diagnosis');
  const mover = W.get('patients');
  target.place({ x: 800, y: 300 });
  const t = b(target);
  mover.place({ x: 820, y: 320, ...SPECS.patients });
  setCursor(900, 400);
  await mover.userDrag(8, 8);
  snap.applySnapChoice('patients', 'diagnosis', 'left');
  const got = b(mover);
  check(
    '왼쪽 붙이기 → 타깃 왼쪽 변에 붙고 위쪽 변이 맞는다',
    got.x === t.x - SPECS.patients.width && got.y === t.y,
    `got ${fmt(got)} / want ${t.x - SPECS.patients.width},${t.y}`
  );
  check('관계 기록', rel('patients', 'diagnosis'));
  check('탭 그룹은 생기지 않음', groups.getGroupsState().length === 0);
  check(
    '크기는 그대로',
    got.width === SPECS.patients.width && got.height === SPECS.patients.height
  );
}

console.log('\n--- 이미 붙어 있는 창도 합칠 수 있다 (선택지를 거쳐서) ---');
{
  const W2 = freshWorld();
  const T = W2.get('diagnosis');
  const M = W2.get('patients');
  const X = W2.get('terms');
  T.place({ x: 800, y: 300 });
  await attach(W2, 'patients', 'diagnosis', 'left');
  check('사전 조건: patients-diagnosis 스냅', rel('patients', 'diagnosis'));
  X.place({ x: 200, y: 700, ...SPECS.terms });
  // patients 를 terms 위로 끌어 놓는다 — 클러스터 이동 후 선택지가 떠야 한다.
  M.place({ x: 210, y: 710, ...SPECS.patients });
  setCursor(300, 760);
  await M.userDrag(8, 8);
  check(
    '클러스터 이동 뒤에도 선택지가 뜬다',
    snap.getPendingSnapChoice()?.target === 'terms',
    JSON.stringify(snap.getPendingSnapChoice())
  );
  snap.applySnapChoice('patients', 'terms', 'merge');
  check('머지된 창은 스냅 클러스터에서 빠짐', !rel('patients', 'diagnosis'), JSON.stringify(snap.getSnapRelations()));
  check('탭 그룹은 정상 생성', groups.getGroupsState().length === 1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log("\n=== 11) 드랍 판정은 '조용해지면' — 'moved' 유무와 무관하게 같은 결과 ===");
{
  // (a) 'moved' 가 아예 없는 플랫폼(win32/linux)
  const W = freshWorld();
  const target = W.get('diagnosis');
  const mover = W.get('patients');
  target.place({ x: 800, y: 300 });
  mover.place({ x: 820 - 16, y: 320, ...SPECS.patients });
  await mover.userDrag(16, 0, { emitMoved: false, settle: false });
  check('드랍 직후에는 아직 판정 전 (선택지 없음)', snap.getPendingSnapChoice() === null);
  await sleep(420); // DROP_SETTLE_MS = 320
  check(
    "'moved' 없이도 정착 후 선택지",
    snap.getPendingSnapChoice()?.target === 'diagnosis',
    JSON.stringify(snap.getPendingSnapChoice())
  );
  check('선택 전에는 창이 움직이지 않는다', b(mover).x === 820 && b(mover).y === 320, fmt(b(mover)));

  // (b) macOS 실측 동작: 이동마다 'moved' 가 온다.
  //     예전 코드는 이 신호로 매번 finishDrag 를 해서 move 카운트가 임계값에
  //     닿지 못했다 = macOS 에서 스냅이 아예 발동하지 않았던 진짜 원인.
  const W2 = freshWorld();
  const t2 = W2.get('diagnosis');
  const m2 = W2.get('patients');
  t2.place({ x: 800, y: 300 });
  m2.place({ x: 820 - 16, y: 320, ...SPECS.patients });
  await m2.userDrag(16, 0, { movedPerStep: true });
  check(
    "이동마다 'moved' 가 와도 선택지가 뜬다 (macOS 실제 이벤트 열)",
    snap.getPendingSnapChoice()?.target === 'diagnosis',
    JSON.stringify(snap.getPendingSnapChoice())
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 12) 멤버 리사이즈는 상대 오프셋을 유지한다 (리플로우 없음) ===');
{
  const W = freshWorld();
  const A = W.get('diagnosis');
  const B = W.get('patients');
  A.place({ x: 800, y: 300 });
  await attach(W, 'patients', 'diagnosis', 'left');
  const aBefore = b(A);
  // 마우스 리사이즈 ('resized' 발생) 와 단축키 리사이즈 (이벤트 없음) 둘 다.
  B.userResize(340, 420);
  check("마우스 리사이즈: 이웃이 안 움직임", b(A).x === aBefore.x && b(A).y === aBefore.y);
  A.setBounds({ ...aBefore, width: 420 }); // 단축키 경로 (프로그램적)
  check('단축키 리사이즈: 관계 유지', rel('patients', 'diagnosis'));
  const aNow = b(A);
  const bNow = b(B);
  await B.userDrag(30, 0);
  check(
    '리사이즈 후에도 클러스터는 함께 이동',
    b(A).x - aNow.x === 30 && b(B).x - bNow.x === 30,
    `dA=${b(A).x - aNow.x} dB=${b(B).x - bNow.x}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 사용자 신고: "스냅이 됐을 때 두 창을 상단 기준으로 정렬시키기".
// 예전에는 허용 오차(ALIGN_PX=48) 안에 이미 들어와 있을 때만 맞췄기 때문에,
// 크게 어긋난 채 놓으면 붙기만 하고 줄은 어긋난 배치가 남았다. 이제는 무조건
// 맞춘다 — 드랍 오프셋과 무관하게 결과가 같아야 한다.
console.log('\n=== 13) 흡착하면 앞쪽 변이 무조건 맞는다 (드랍 오프셋 무관) ===');
{
  // 좌우 흡착 → 위쪽 변(y) 정렬. 오프셋은 옛 허용 오차(48)를 훨씬 넘는 값 포함.
  for (const edge of ['right', 'left']) {
    const results = [];
    for (const off of [0, 12, 60, 140, 240]) {
      const W = freshWorld();
      const target = W.get('diagnosis'); // 380x460
      const mover = W.get('patients'); // 380x420
      target.place({ x: 800, y: 300 });
      const t = b(target);
      const m = SPECS.patients;
      const wantX = edge === 'right' ? t.x - m.width : t.x + t.width;
      // 세로로 off 만큼 어긋난 채 겹쳐 놓고, 방향을 고른다.
      mover.place({ x: t.x + 40, y: t.y + off, ...m });
      await mover.userDrag(8, 0);
      snap.applySnapChoice('patients', 'diagnosis', edge === 'right' ? 'left' : 'right');
      const got = b(mover);
      results.push({ off, got });
      check(
        `${edge}: 오프셋 ${off}px 로 놓아도 위쪽 변이 상대와 같다`,
        got.y === t.y,
        `got.y=${got.y} target.y=${t.y}`
      );
      check(
        `${edge}: 오프셋 ${off}px — 맞닿음 유지 + 크기 불변`,
        got.x === wantX && got.width === m.width && got.height === m.height,
        `got ${fmt(got)} wantX=${wantX}`
      );
    }
    check(
      `${edge}: 모든 드랍 오프셋이 같은 최종 위치로 수렴`,
      new Set(results.map((r) => `${r.got.x},${r.got.y}`)).size === 1,
      results.map((r) => `off${r.off}→${r.got.x},${r.got.y}`).join(' | ')
    );
  }

  // 상하 흡착 → 왼쪽 변(x) 정렬 (좌우의 거울).
  for (const edge of ['bottom', 'top']) {
    const results = [];
    for (const off of [0, 12, 60, 140, 240]) {
      const W = freshWorld();
      const target = W.get('diagnosis'); // 380x460
      const mover = W.get('patients'); // 380x420
      target.place({ x: 600, y: edge === 'bottom' ? 520 : 120 });
      const t = b(target);
      const m = SPECS.patients;
      const wantY = edge === 'bottom' ? t.y - m.height : t.y + t.height;
      mover.place({ x: t.x + off, y: t.y + 40, ...m });
      await mover.userDrag(0, 8);
      snap.applySnapChoice('patients', 'diagnosis', edge === 'bottom' ? 'top' : 'bottom');
      const got = b(mover);
      results.push({ off, got });
      check(
        `${edge}: 오프셋 ${off}px 로 놓아도 왼쪽 변이 상대와 같다`,
        got.x === t.x,
        `got.x=${got.x} target.x=${t.x}`
      );
      check(
        `${edge}: 오프셋 ${off}px — 맞닿음 유지 + 크기 불변`,
        got.y === wantY && got.width === m.width && got.height === m.height,
        `got ${fmt(got)} wantY=${wantY}`
      );
    }
    check(
      `${edge}: 모든 드랍 오프셋이 같은 최종 위치로 수렴`,
      new Set(results.map((r) => `${r.got.x},${r.got.y}`)).size === 1,
      results.map((r) => `off${r.off}→${r.got.x},${r.got.y}`).join(' | ')
    );
  }

  // 크기가 다른 두 창(dock 130 vs diagnosis 460)도 정렬만 하고 리사이즈는 안 한다.
  {
    const W = freshWorld();
    const target = W.get('diagnosis'); // 380x460
    const mover = W.get('dock'); // 380x130
    target.place({ x: 800, y: 300 });
    const t = b(target);
    mover.place({ x: t.x + 40, y: t.y + 200, ...SPECS.dock });
    await mover.userDrag(8, 0);
    snap.applySnapChoice('dock', 'diagnosis', 'left');
    const got = b(mover);
    check(
      '크기가 크게 다른 창도 위쪽 변만 맞춘다',
      got.y === t.y && got.x === t.x - SPECS.dock.width,
      `got ${fmt(got)} target ${fmt(t)}`
    );
    check(
      '높이는 그대로 (130 → 460 강제 리사이즈 없음)',
      got.height === SPECS.dock.height && b(target).height === SPECS.diagnosis.height,
      `dock.h=${got.height} diagnosis.h=${b(target).height}`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 사용자 신고: "이 상태로 서로 같이 움직이게 하기".
// 실사용 로그(/tmp/dev.log 2026-08-05T21:52)에서 라이브 추종 자체는 돌고 있었다
// (setBounds > 0). 진짜 원인은 클램프였다: 클러스터가 작업영역 아래로 조금 걸쳐
// 있으면 이동량이 0 이어도 강제로 안쪽으로 당겨져, 리더는 커서를 따라가고
// 팔로워는 반대로 끌려가 "같이 안 움직인다" 로 보였다.
console.log('\n=== 14) 이미 작업영역 밖으로 걸친 클러스터도 함께 움직인다 ===');
{
  const OVER = 40; // 아래로 40px 삐져나온 상태
  const W = freshWorld();
  const A = W.get('diagnosis'); // 380x460
  const B = W.get('patients'); // 380x420
  const waBottom = WORK_AREA.y + WORK_AREA.height;
  // B 를 A 왼쪽에 붙인다. A 의 아래쪽이 작업영역을 OVER 만큼 넘도록 배치.
  A.place({ x: 700, y: waBottom + OVER - SPECS.diagnosis.height });
  await attach(W, 'patients', 'diagnosis', 'left');
  check(
    '사전 조건: 붙었고, 클러스터가 작업영역 아래로 걸쳐 있다',
    rel('patients', 'diagnosis') && b(A).y + b(A).height > waBottom,
    `A=${fmt(b(A))} 작업영역 하단=${waBottom}`
  );

  // (a) 가로로만 끈다 → 세로는 한 픽셀도 움직이면 안 된다 (강제 교정 금지).
  const a1 = b(A);
  const b1 = b(B);
  await B.userDrag(-120, 0);
  const dA = { x: b(A).x - a1.x, y: b(A).y - a1.y };
  const dB = { x: b(B).x - b1.x, y: b(B).y - b1.y };
  check(
    '가로 드래그에 세로가 딸려 오지 않는다 (걸친 만큼을 강제 교정하지 않음)',
    dA.y === 0 && dB.y === 0,
    `dA=${dA.x},${dA.y} dB=${dB.x},${dB.y}`
  );
  check(
    '두 창이 정확히 같은 delta 로 움직인다',
    dA.x === dB.x && dA.y === dB.y && dA.x === -120,
    `dA=${dA.x},${dA.y} dB=${dB.x},${dB.y}`
  );

  // (b) 안쪽(위)으로는 제한 없이 움직인다.
  const a2 = b(A);
  const b2 = b(B);
  await B.userDrag(0, -60);
  check(
    '안쪽으로 들어오는 방향은 그대로 허용',
    b(A).y - a2.y === -60 && b(B).y - b2.y === -60,
    `dA.y=${b(A).y - a2.y} dB.y=${b(B).y - b2.y}`
  );

  // (c) 바깥(아래)으로 더 나가는 방향은 여전히 막힌다 = 창을 잃지 않는다.
  const a3 = b(A);
  const b3 = b(B);
  const slack = waBottom - Math.max(a3.y + a3.height, b3.y + b3.height);
  await B.userDrag(0, 200);
  const moved = b(A).y - a3.y;
  check(
    '바깥으로 더 나가는 방향은 여전히 막힌다',
    moved === Math.max(0, slack) && b(B).y - b3.y === moved,
    `요청 200 → ${moved} (여유=${slack})`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 사용자 신고: "분리 버튼 만들기" — 버튼은 이미 있었다. 검증할 것은 배선이다:
// 렌더러가 분리 버튼을 띄우는 근거(IPC.WindowSnapsState 페이로드)가 실제로
// 도착하는가. 도착하지 않으면 타입은 통과하면서 아이콘만 영영 안 보인다.
console.log('\n=== 15) 분리 버튼을 띄우는 클러스터 상태가 렌더러에 도착한다 ===');
{
  groups.dissolveAllGroups();
  delete BACKING.windowGroups;
  delete BACKING.windowSnaps;
  BACKING.bounds = {};
  const windows = new Map();
  Object.keys(SPECS).forEach((k, i) => {
    const w = new FakeWindow({ x: 0, y: 0, ...SPECS[k] });
    w.place({ x: -8000, y: -8000 + i * 1000 });
    windows.set(k, w);
  });
  groups.initWindowGroups({
    windows,
    broadcast: () => undefined,
    onGroupChangedMembers: (ks) => snap.normalizeSnapUnits(ks),
    onSnapUnitReassign: (from, to) => snap.reassignSnapUnit(from, to)
  });
  // index.ts 와 같은 배선: onSnapsChanged → broadcast(WindowSnapsState, getSnappedKeys())
  const broadcasts = [];
  snap.initWindowSnap({
    windows,
    onSnapsChanged: () => broadcasts.push(snap.getSnappedKeys())
  });
  for (const [k, w] of windows) {
    groups.attachGroupDragHandlers(w, k);
    snap.attachSnapDragHandlers(w, k);
  }
  setCursor(-10000, -10000);

  const A = windows.get('diagnosis');
  const B = windows.get('patients');
  A.place({ x: 800, y: 300 });
  B.place({ x: 840, y: 340, ...SPECS.patients });
  const before = broadcasts.length;
  await B.userDrag(8, 8);
  snap.applySnapChoice('patients', 'diagnosis', 'left');

  const payload = broadcasts[broadcasts.length - 1];
  check('흡착이 브로드캐스트를 발생시킨다', broadcasts.length > before, `${broadcasts.length}회`);
  check(
    '페이로드 모양이 렌더러 기대(OverlayKey[])와 같다',
    Array.isArray(payload) && payload.every((k) => typeof k === 'string'),
    JSON.stringify(payload)
  );
  // useSnapped(myKey) 의 실제 조건을 그대로 재현한다.
  const visible = (myKey) => Array.isArray(payload) && payload.includes(myKey);
  check(
    '붙은 두 창 모두에서 분리 버튼이 보인다',
    visible('patients') && visible('diagnosis'),
    JSON.stringify(payload)
  );
  check('안 붙은 창에서는 안 보인다', !visible('summary') && !visible('dock'));
  check(
    'invoke(WindowSnapsGet) 도 같은 값을 준다 (마운트 직후 경로)',
    JSON.stringify([...snap.getSnappedKeys()].sort()) === JSON.stringify([...payload].sort()),
    JSON.stringify(snap.getSnappedKeys())
  );

  // 분리하면 상태가 즉시 비워져 버튼이 사라진다.
  const n = broadcasts.length;
  snap.detachFromCluster('patients');
  const after = broadcasts[broadcasts.length - 1];
  check('분리도 브로드캐스트를 발생시킨다', broadcasts.length > n);
  check(
    '분리 후에는 아무 창에도 안 보인다',
    Array.isArray(after) && after.length === 0,
    JSON.stringify(after)
  );
}

console.log(`\n${failures === 0 ? '=== ALL PASS ===' : `=== ${failures} FAILURE(S) ===`}`);
process.exit(failures === 0 ? 0 : 1);
