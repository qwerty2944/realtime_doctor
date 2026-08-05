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

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 1) 네 방향 흡착: 딱 맞닿고 관계가 기록되는가 ===');
{
  // 각 방향마다: 목표 지점에서 GAP 만큼 떨어진 곳에 두고, 드래그로 접근시킨다.
  // targetY 는 방향마다 다르다 — 흡착 결과가 작업 영역(y 25..1080) 안에
  // 들어가야 클램프가 개입하지 않는다.
  const cases = [
    { name: '오른쪽 변 → 상대 왼쪽 변', edge: 'right', gap: 18, targetY: 300 },
    { name: '왼쪽 변 → 상대 오른쪽 변', edge: 'left', gap: 18, targetY: 300 },
    { name: '아래 변 → 상대 위 변', edge: 'bottom', gap: 18, targetY: 520 },
    { name: '위 변 → 상대 아래 변', edge: 'top', gap: 18, targetY: 150 }
  ];
  for (const c of cases) {
    const W = freshWorld();
    const target = W.get('diagnosis'); // 380x460
    const mover = W.get('patients'); // 380x420
    target.place({ x: 800, y: c.targetY });
    const t = b(target);
    const m = SPECS.patients;

    // 흡착 후 기대 위치 (수직축은 ALIGN_PX=24 안이면 상대에 맞춰진다).
    const want = {
      right: { x: t.x - m.width, y: t.y },
      left: { x: t.x + t.width, y: t.y },
      bottom: { x: t.x, y: t.y - m.height },
      top: { x: t.x, y: t.y + t.height }
    }[c.edge];

    // 시작 위치 = 기대 위치에서 간격만큼 뒤로 + 수직축을 10px 어긋나게.
    const off = {
      right: { x: -c.gap, y: 10 },
      left: { x: c.gap, y: 10 },
      bottom: { x: 10, y: -c.gap },
      top: { x: 10, y: c.gap }
    }[c.edge];
    // 드래그 자체는 짧게(32px) — DETACH_PX 와 무관한 순수 흡착 검증.
    mover.place({ x: want.x + off.x - 16, y: want.y + off.y - 16, ...m });
    await mover.userDrag(16, 16);

    const got = b(mover);
    check(
      `${c.name}: 간격 0 으로 흡착`,
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
// ENGAGE_PX = 48 (windowSnap.ts). 손으로 끌어 붙이는 정확도를 고려한 값이라
// 예전 24 보다 넓다. 경계 자체는 여전히 딱 떨어져야 한다.
console.log('\n=== 2) 임계값 경계: 48px 이내는 붙고, 그 밖은 안 붙는다 ===');
for (const gap of [48, 49]) {
  const W = freshWorld();
  const target = W.get('diagnosis');
  const mover = W.get('patients');
  target.place({ x: 900, y: 300 });
  const t = b(target);
  // 드래그 8스텝으로 정확히 gap 만큼 떨어진 곳에 도착시킨다.
  mover.place({ x: t.x - SPECS.patients.width - gap - 16, y: t.y, ...SPECS.patients });
  await mover.userDrag(16, 0);
  check(
    `간격 ${gap}px → ${gap <= 48 ? '흡착' : '무시'}`,
    rel('patients', 'diagnosis') === (gap <= 48),
    `x=${b(mover).x}`
  );
}

console.log('\n--- 모서리만 스친 경우(공유 변 40px 미만)는 붙지 않아야 한다 ---');
{
  const W = freshWorld();
  const target = W.get('diagnosis');
  const mover = W.get('patients');
  target.place({ x: 900, y: 300 });
  const t = b(target);
  // 세로로 10px 만 겹치도록 아래로 밀어둔다 (MIN_SHARE_PX = 40 미만).
  mover.place({
    x: t.x - SPECS.patients.width - 18,
    y: t.y + t.height - 10,
    ...SPECS.patients
  });
  await mover.userDrag(2, 0);
  check('세로 공유 10px → 흡착 안 함', !rel('patients', 'diagnosis'));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 3) 클러스터 이동: 어느 멤버를 끌어도 전원이 같은 delta 로 ===');
{
  const W = freshWorld();
  const A = W.get('diagnosis');
  const B = W.get('patients');
  A.place({ x: 800, y: 300 });
  B.place({ x: 800 - 380 - 18, y: 310, ...SPECS.patients });
  await B.userDrag(2, 0);
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
  // A 를 B 왼쪽에 붙인다.
  A.place({ x: 700 - 380 - 18, y: 300, ...SPECS.terms });
  await A.userDrag(2, 0);
  // C 를 B 오른쪽에 붙인다.
  C.place({ x: 700 + 380 + 18, y: 300, ...SPECS.patients });
  await C.userDrag(-2, 0);
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
  B.place({ x: 600 - 380 - 18, y: 100, ...SPECS.patients });
  await B.userDrag(2, 0);
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
  A.place({ x: 700 - 380 - 18, y: 300, ...SPECS.terms });
  await A.userDrag(2, 0);
  C.place({ x: 700 + 380 + 18, y: 300, ...SPECS.patients });
  await C.userDrag(-2, 0);
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
  A2.place({ x: 700 - 380 - 18, y: 300, ...SPECS.terms });
  await A2.userDrag(2, 0);
  C2.place({ x: 700 + 380 + 18, y: 300, ...SPECS.patients });
  await C2.userDrag(-2, 0);
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
  let x = 300;
  W.get('terms').place({ x, y: 300, ...SPECS.terms });
  for (const k of keys.slice(1)) {
    x += 380;
    W.get(k).place({ x: x + 18, y: 300, ...SPECS[k] });
    await W.get(k).userDrag(-2, 0);
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
  B.place({ x: rightEdge - 380 - 10 - 380 - 18, y: 300, ...SPECS.patients });
  await B.userDrag(2, 0);
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
  D.place({ x: 600 - 380 - 18, y: WORK_AREA.y + 8, ...SPECS.patients });
  await D.userDrag(2, 0);
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
  B.place({ x: 800 - 380 - 18, y: 300, ...SPECS.patients });
  await B.userDrag(2, 0);
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
  B.place({ x: 800 - 380 - 18, y: 300, ...SPECS.patients });
  await B.userDrag(2, 0);
  check('사전 조건: 붙어 있음', rel('patients', 'diagnosis'));
  snap.dissolveAllSnaps(); // index.ts 의 'layout:apply' 핸들러가 하는 일
  check('해체 후 관계 없음', snap.getSnapRelations().length === 0);
  check('저장소도 비워짐', (BACKING.windowSnaps ?? []).length === 0);
  const aBefore = b(A);
  await B.userDrag(40, 0);
  check('해체 후 한 창 이동이 다른 창을 끌지 않음', b(A).x === aBefore.x);
}

// ═══════════════════════════════════════════════════════════════════════════
// 우선순위 규칙: 커서가 상대 rect 안이면 머지가 이긴다 (겹침 여부가 아니라
// 커서 위치가 기준이다 — windowSnap.ts 상단 주석 참고).
console.log('\n=== 10) 커서가 상대 창 안이면 스냅이 아니라 탭 머지 (우선순위 규칙) ===');
{
  const W = freshWorld();
  const target = W.get('diagnosis');
  const mover = W.get('patients');
  target.place({ x: 800, y: 300 });
  // 타깃 위로 확실히 겹치게 놓고, 커서도 타깃 안에 둔다 (머지 조건).
  mover.place({ x: 820, y: 320, ...SPECS.patients });
  setCursor(900, 400);
  await mover.userDrag(8, 8);

  const gs = groups.getGroupsState();
  check('탭 그룹이 생성됨', gs.length === 1 && gs[0].tabs.length === 2, JSON.stringify(gs));
  check('스냅 관계는 생기지 않음', snap.getSnapRelations().length === 0, JSON.stringify(snap.getSnapRelations()));

  // 이미 붙어 있던 창이 머지되면 스냅에서 빠진다.
  const W2 = freshWorld();
  const T = W2.get('diagnosis');
  const M = W2.get('patients');
  const X = W2.get('terms');
  T.place({ x: 800, y: 300 });
  M.place({ x: 800 - 380 - 18, y: 300, ...SPECS.patients });
  await M.userDrag(2, 0);
  check('사전 조건: patients-diagnosis 스냅', rel('patients', 'diagnosis'));
  X.place({ x: 200, y: 700, ...SPECS.terms });
  // patients 를 terms 위로 끌어 머지.
  M.place({ x: 210, y: 710, ...SPECS.patients });
  setCursor(300, 760);
  await M.userDrag(8, 8);
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
  mover.place({ x: 800 - 380 - 18 - 16, y: 300, ...SPECS.patients });
  await mover.userDrag(16, 0, { emitMoved: false, settle: false });
  check('드랍 직후에는 아직 흡착 전 (판정을 미룬다)', !rel('patients', 'diagnosis'));
  await sleep(420); // DROP_SETTLE_MS = 320
  check("'moved' 없이도 정착 후 흡착", rel('patients', 'diagnosis'), `x=${b(mover).x}`);
  check('흡착 위치가 정확히 맞닿음', b(mover).x + b(mover).width === b(target).x);

  // (b) macOS 실측 동작: 이동마다 'moved' 가 온다.
  //     예전 코드는 이 신호로 매번 finishDrag 를 해서 move 카운트가 임계값에
  //     닿지 못했다 = macOS 에서 스냅이 아예 발동하지 않았던 진짜 원인.
  const W2 = freshWorld();
  const t2 = W2.get('diagnosis');
  const m2 = W2.get('patients');
  t2.place({ x: 800, y: 300 });
  m2.place({ x: 800 - 380 - 18 - 16, y: 300, ...SPECS.patients });
  await m2.userDrag(16, 0, { movedPerStep: true });
  check(
    "이동마다 'moved' 가 와도 흡착 (macOS 실제 이벤트 열)",
    rel('patients', 'diagnosis'),
    `x=${b(m2).x}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 12) 멤버 리사이즈는 상대 오프셋을 유지한다 (리플로우 없음) ===');
{
  const W = freshWorld();
  const A = W.get('diagnosis');
  const B = W.get('patients');
  A.place({ x: 800, y: 300 });
  B.place({ x: 800 - 380 - 18, y: 300, ...SPECS.patients });
  await B.userDrag(2, 0);
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

console.log(`\n${failures === 0 ? '=== ALL PASS ===' : `=== ${failures} FAILURE(S) ===`}`);
process.exit(failures === 0 ? 0 : 1);
