#!/usr/bin/env node
// 회귀 프로브: 탭 그룹이 스냅에 참여한다 + 끊어진 드래그도 하나의 드래그다.
//
// 실행:
//   node --import ./scripts/probe-snap-register.mjs scripts/probe-snap-groups.mjs
//
// 왜 필요한가 (사용자 실사용 로그 /tmp/dev.log 기반):
//
//   결함 1) 머지가 잘 되니 창들이 대부분 탭 그룹에 들어가는데, 그 순간부터
//     스냅이 영영 죽는다. 로그에 "스냅 안 함 — 끌린 창이 탭 그룹 멤버" 와
//     "후보 X: 탈락 — 탭 그룹 멤버" 가 반복해서 찍혔다.
//
//   결함 2) 천천히 겨누는 드래그(붙이려 할 때 사람이 실제로 하는 동작)는
//     중간에 손이 멈춘다. 그러면 디바운스가 드래그를 끊고, 조각마다 move
//     이벤트가 1~3개뿐이라 "드래그로 보기엔 move 가 적다" 며 통째로 버려졌다.
//
// 화면 캡처와 합성 입력이 불가능한 환경이므로 관측은 전부 bounds 숫자다.

import { FakeWindow, BACKING, setCursor, SETTLE_MS, WORK_AREA } from './probe-snap-stubs.mjs';

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

function freshWorld() {
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
    // 수정 전에는 normalizeSnapUnits 가 없다 — 그때의 올바른 배선은 dropSnapsFor.
    onGroupChangedMembers: (ks) => (snap.normalizeSnapUnits ?? snap.dropSnapsFor)(ks),
    onSnapUnitReassign: snap.reassignSnapUnit ?? (() => undefined)
  });
  snap.initWindowSnap({ windows });
  for (const [k, w] of windows) {
    groups.attachGroupDragHandlers(w, k);
    snap.attachSnapDragHandlers(w, k);
  }
  setCursor(-10000, -10000);
  return windows;
}

const rel = (x, y) =>
  snap
    .getSnapRelations()
    .some((r) => (r.a === x && r.b === y) || (r.a === y && r.b === x));

/** 커서를 상대 창 안에 두고 드래그해서 탭 그룹을 만든다. */
async function makeGroup(W, dragged, target) {
  const t = b(W.get(target));
  W.get(dragged).place({ x: t.x + 10, y: t.y + 10, ...SPECS[dragged] });
  setCursor(t.x + 40, t.y + 40);
  await W.get(dragged).userDrag(8, 8);
  setCursor(-10000, -10000);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== D1-a) 탭 그룹이 바깥 창에 흡착한다 ===');
{
  const W = freshWorld();
  const outside = W.get('patients'); // 380x420
  const host = W.get('diagnosis'); // 380x460 — 그룹의 첫 탭
  host.place({ x: 900, y: 300 });
  await makeGroup(W, 'terms', 'diagnosis');
  check(
    '사전 조건: diagnosis+terms 탭 그룹',
    groups.getGroupsState().length === 1 && groups.getGroupsState()[0].tabs.length === 2,
    JSON.stringify(groups.getGroupsState())
  );

  // 그룹의 활성 탭(=지금 보이는 창)을 바깥 창 쪽으로 끌어 붙인다.
  const active = groups.getGroupsState()[0].active;
  const g = b(W.get(active));
  outside.place({ x: g.x - SPECS.patients.width - 200, y: g.y, ...SPECS.patients });
  // 그룹을 바깥 창 오른쪽 변에서 18px 떨어진 자리로 옮긴 뒤 놓는다.
  const wantX = b(outside).x + SPECS.patients.width;
  W.get(active).place({ x: wantX + 18 - 16, y: g.y, width: g.width, height: g.height });
  await W.get(active).userDrag(16, 0);

  check(
    '그룹이 바깥 창에 흡착 (간격 0)',
    b(W.get(active)).x === wantX,
    `got=${fmt(b(W.get(active)))} wantX=${wantX}`
  );
  check(
    '스냅 관계가 기록됨',
    snap.getSnapRelations().length === 1,
    JSON.stringify(snap.getSnapRelations())
  );

  // ── 클러스터가 함께 움직인다 (숨은 멤버 포함) ──
  const before = {
    active: b(W.get(active)),
    hidden: b(W.get(active === 'terms' ? 'diagnosis' : 'terms')),
    outside: b(outside)
  };
  await W.get(active).userDrag(-60, 40);
  const after = {
    active: b(W.get(active)),
    hidden: b(W.get(active === 'terms' ? 'diagnosis' : 'terms')),
    outside: b(outside)
  };
  check(
    '그룹을 끌면 바깥 창도 같은 delta 로 따라온다',
    after.outside.x - before.outside.x === -60 && after.outside.y - before.outside.y === 40,
    `outside d=${after.outside.x - before.outside.x},${after.outside.y - before.outside.y}`
  );
  check(
    '숨은 탭도 활성 탭과 같은 자리 (그룹 bounds 동기 유지)',
    after.hidden.x === after.active.x && after.hidden.y === after.active.y,
    `hidden=${fmt(after.hidden)} active=${fmt(after.active)}`
  );

  // 반대 방향: 바깥 창을 끌면 그룹 전체가 따라온다.
  const b2 = { active: b(W.get(active)), outside: b(outside) };
  await outside.userDrag(50, -30);
  check(
    '바깥 창을 끌면 그룹이 따라온다',
    b(W.get(active)).x - b2.active.x === 50 && b(W.get(active)).y - b2.active.y === -30,
    `group d=${b(W.get(active)).x - b2.active.x},${b(W.get(active)).y - b2.active.y}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== D1-b) 그룹이 다른 그룹에 흡착한다 ===');
{
  const W = freshWorld();
  W.get('diagnosis').place({ x: 1100, y: 300 });
  await makeGroup(W, 'terms', 'diagnosis');
  W.get('patients').place({ x: 300, y: 300 });
  await makeGroup(W, 'summary', 'patients');
  check('사전 조건: 그룹 2개', groups.getGroupsState().length === 2, JSON.stringify(groups.getGroupsState()));

  const [g1, g2] = groups.getGroupsState();
  const rightActive = b(W.get(g1.active)).x > b(W.get(g2.active)).x ? g1.active : g2.active;
  const leftActive = rightActive === g1.active ? g2.active : g1.active;
  const lb = b(W.get(leftActive));
  const wantX = lb.x + lb.width;
  const rb = b(W.get(rightActive));
  W.get(rightActive).place({ x: wantX + 20 - 16, y: lb.y, width: rb.width, height: rb.height });
  await W.get(rightActive).userDrag(16, 0);

  check(
    '그룹 ↔ 그룹 흡착 (간격 0)',
    b(W.get(rightActive)).x === wantX,
    `got=${fmt(b(W.get(rightActive)))} wantX=${wantX}`
  );
  check('관계 1건', snap.getSnapRelations().length === 1, JSON.stringify(snap.getSnapRelations()));

  // 클러스터 이동: 네 창 전부 같은 delta.
  const keys = [...g1.tabs, ...g2.tabs];
  const before = Object.fromEntries(keys.map((k) => [k, b(W.get(k))]));
  await W.get(leftActive).userDrag(0, 60);
  const deltas = keys.map((k) => `${b(W.get(k)).x - before[k].x},${b(W.get(k)).y - before[k].y}`);
  check(
    '두 그룹 네 창이 모두 같은 delta 로 이동',
    new Set(deltas).size === 1 && deltas[0] === '0,60',
    deltas.join(' | ')
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== D1-c) 스냅된 그룹에서도 syncGroupBounds 가 동작한다 ===');
{
  const W = freshWorld();
  W.get('diagnosis').place({ x: 900, y: 300 });
  await makeGroup(W, 'terms', 'diagnosis');
  const active = groups.getGroupsState()[0].active;
  const hidden = groups.getGroupsState()[0].tabs.find((t) => t !== active);
  const g = b(W.get(active));
  const outside = W.get('patients');
  outside.place({ x: g.x - SPECS.patients.width - 18, y: g.y, ...SPECS.patients });
  await outside.userDrag(2, 0);
  check('사전 조건: 그룹에 흡착', snap.getSnapRelations().length === 1, JSON.stringify(snap.getSnapRelations()));

  const next = { ...b(W.get(active)), width: 420, height: 500 };
  const changed = groups.syncGroupBounds(active, next);
  check('syncGroupBounds 가 숨은 멤버를 반환', changed.includes(hidden), changed.join(','));
  check(
    '숨은 멤버 bounds 가 맞춰짐',
    fmt(b(W.get(hidden))) === fmt(next),
    `${fmt(b(W.get(hidden)))} vs ${fmt(next)}`
  );
  check('리사이즈가 스냅 관계를 죽이지 않음', snap.getSnapRelations().length === 1);
  check('리사이즈가 이웃을 밀지 않음', b(outside).x === g.x - SPECS.patients.width);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== D1-d) 탭 분리: 그룹은 관계를 유지하고 분리된 창은 자유로워진다 ===');
{
  const W = freshWorld();
  W.get('diagnosis').place({ x: 900, y: 300 });
  await makeGroup(W, 'terms', 'diagnosis');
  const st = groups.getGroupsState()[0];
  const g = b(W.get(st.active));
  const outside = W.get('patients');
  outside.place({ x: g.x - SPECS.patients.width - 18, y: g.y, ...SPECS.patients });
  await outside.userDrag(2, 0);
  check('사전 조건: 그룹-바깥창 흡착', snap.getSnapRelations().length === 1);

  // 그룹 대표(tabs[0]) 를 떼어낸다 = 관계 키가 반드시 넘어가야 하는 경우.
  groups.detachTab(st.tabs[0]);
  check('그룹 해체 후에도 관계 1건 유지', snap.getSnapRelations().length === 1, JSON.stringify(snap.getSnapRelations()));
  const remaining = st.tabs[1];
  check(
    '남은 창이 여전히 바깥 창과 한 클러스터',
    snap.clusterOf(remaining).includes('patients'),
    snap.clusterOf(remaining).join(',')
  );
  check(
    '분리된 창은 클러스터 밖',
    !snap.clusterOf(remaining).includes(st.tabs[0]),
    snap.clusterOf(remaining).join(',')
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== D2) 조각난 느린 드래그도 하나의 드래그다 ===');
{
  const W = freshWorld();
  const target = W.get('diagnosis');
  const mover = W.get('patients');
  target.place({ x: 900, y: 300 });
  const t = b(target);
  const wantX = t.x - SPECS.patients.width;
  // 목표 지점에서 18px 떨어진 곳까지, 6px 씩 세 조각으로 접근한다.
  // 각 조각은 move 이벤트 2개 + 디바운스보다 긴 정지.
  mover.place({ x: wantX - 18 - 18, y: t.y, ...SPECS.patients });
  // 조각당 스텝 1개 = will-move + move 2개. 예전 기준(move 4개)에 못 미치는,
  // 실제로 조준할 때 나오는 이벤트 수다.
  for (let i = 0; i < 3; i += 1) {
    await mover.userDrag(6, 0, { steps: 1, settle: false });
    await sleep(450); // DROP_SETTLE_MS(320) 보다 긴 정지 = 예전 코드는 여기서 드래그를 끊었다
  }
  // 조각 중간에 흡착이 일어나면 그 뒤 조각은 "클러스터 통째 이동"이 되므로
  // 절대 좌표가 아니라 **맞닿아 있는가** 로 확인한다 (설계된 동작).
  check(
    '조각난 드래그가 하나의 드래그로 취급되어 흡착',
    rel('patients', 'diagnosis'),
    `x=${b(mover).x} rel=${JSON.stringify(snap.getSnapRelations())}`
  );
  check(
    '흡착 결과가 간격 0',
    b(mover).x + SPECS.patients.width === b(target).x,
    `mover=${fmt(b(mover))} target=${fmt(b(target))}`
  );
}

console.log('\n--- 조각난 드래그로도 클러스터가 통째로 따라온다 ---');
{
  const W = freshWorld();
  const A = W.get('diagnosis');
  const B = W.get('patients');
  A.place({ x: 800, y: 300 });
  B.place({ x: 800 - 380 - 18, y: 300, ...SPECS.patients });
  await B.userDrag(2, 0);
  check('사전 조건: 붙어 있음', rel('patients', 'diagnosis'));
  const before = { a: b(A), b: b(B) };
  for (let i = 0; i < 3; i += 1) {
    await B.userDrag(10, 0, { steps: 1, settle: false });
    await sleep(450);
  }
  check(
    '세 조각 합계 30px 를 두 창이 동일하게 이동',
    b(A).x - before.a.x === 30 && b(B).x - before.b.x === 30,
    `dA=${b(A).x - before.a.x} dB=${b(B).x - before.b.x}`
  );
}

console.log('\n--- 변위 없는 헛 이동 이벤트는 드래그가 아니다 ---');
{
  const W = freshWorld();
  const target = W.get('diagnosis');
  const mover = W.get('patients');
  target.place({ x: 900, y: 300 });
  const t = b(target);
  mover.place({ x: t.x - SPECS.patients.width - 20, y: t.y, ...SPECS.patients });
  // show/focus 등이 만드는 "움직이지 않은 이동 이벤트" 20개.
  await mover.userDrag(0, 0, { steps: 20 });
  check('변위 0 이면 흡착하지 않는다', !rel('patients', 'diagnosis'), `x=${b(mover).x}`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== D3) 라이브 흡착이 진동하지 않는다 ===');
{
  const W = freshWorld();
  const target = W.get('diagnosis');
  const mover = W.get('patients');
  target.place({ x: 900, y: 300 });
  const t = b(target);
  const wantX = t.x - SPECS.patients.width;
  // 흡착 밴드(48px) 안으로 들어간 뒤, 그 자리에서 계속 move 이벤트만 발생시킨다.
  mover.place({ x: wantX - 30 - 12, y: t.y, ...SPECS.patients });
  const beforeApproach = snap.getSnapDiagnostics().appliedBoundsCount;
  await mover.userDrag(12, 0, { steps: 4, settle: false });
  // 밴드에 들어오는 순간 드래그 도중에 한 번 끌어당긴다(래치). 이후 OS(여기서는
  // 스텁의 드래그 궤적)가 창을 다시 커서 위치로 돌려놓아도 재적용하지 않는다 —
  // 그게 진동을 원천 차단하는 지점이다.
  const pull = snap.getSnapDiagnostics().appliedBoundsCount - beforeApproach;
  check('밴드 진입 시 드래그 중에 끌어당김이 정확히 1회', pull === 1, `${pull}회`);
  const beforeIdle = snap.getSnapDiagnostics().appliedBoundsCount;
  // 커서가 밴드 안에 머무는 동안 40번의 이동 이벤트 — 되먹임이 있으면 여기서 폭주한다.
  await mover.userDrag(0, 0, { steps: 40, settle: false });
  const applied = snap.getSnapDiagnostics().appliedBoundsCount - beforeIdle;
  check(
    `밴드 안에 머무는 동안 프로그램적 setBounds 가 유한 (${applied}회 ≤ 2)`,
    applied <= 2,
    `${applied}`
  );
  await sleep(450);
  check(
    '놓으면 정확히 맞닿는다',
    b(mover).x === wantX && b(mover).y === t.y,
    `got=${fmt(b(mover))} wantX=${wantX}`
  );
  check('관계 기록', rel('patients', 'diagnosis'));
}

// ═══════════════════════════════════════════════════════════════════════════
// D4) 라이브 추종: 드래그 **도중에** 클러스터가 통째로 따라온다.
//
// 사용자 신고: "붙는건 잘돼" 그러나 끌면 나머지가 제자리에 있다가 놓을 때/손이
// 멈출 때만 툭 따라온다. 즉 사용자가 보는 시간 내내 클러스터가 깨져 있었다.
// 수정 전에는 아래 검사들이 전부 실패한다 (팔로워가 릴리즈 전까지 정지).
console.log('\n=== D4) 드래그 도중 클러스터가 함께 움직인다 (라이브 추종) ===');

/**
 * 릴리즈 없는 드래그. 스텝마다 콜백을 줘서 **드래그 도중** 상태를 관측한다.
 * FakeWindow.userDrag 은 중간을 볼 수 없어서 여기서 직접 이벤트를 만든다.
 */
function stepDrag(w, dx, dy, steps, onStep) {
  const s = w.getBounds();
  for (let i = 1; i <= steps; i += 1) {
    w.emit('will-move');
    w.place({ x: s.x + Math.round((dx * i) / steps), y: s.y + Math.round((dy * i) / steps) });
    w.emit('move');
    onStep?.(i);
  }
}
const release = async (w) => {
  w.emit('moved');
  await sleep(SETTLE_MS);
};

/** A(diagnosis) 왼쪽에 B(patients) 를 붙인 2-unit 클러스터. */
async function pairWorld() {
  const W = freshWorld();
  const A = W.get('diagnosis');
  const B = W.get('patients');
  A.place({ x: 800, y: 300 });
  B.place({ x: 800 - SPECS.patients.width - 18, y: 300, ...SPECS.patients });
  await B.userDrag(2, 0);
  return { W, A, B };
}

{
  const { A, B } = await pairWorld();
  check('사전 조건: 붙어 있음', rel('patients', 'diagnosis'));
  const gap0 = b(A).x - (b(B).x + b(B).width);
  const a0 = b(A);
  const b0 = b(B);
  // 릴리즈도, 정지도 없는 매끄러운 드래그. 스텝마다 팔로워를 확인한다.
  let laggedSteps = 0;
  let drifted = 0;
  stepDrag(B, 240, -120, 24, () => {
    const dB = { x: b(B).x - b0.x, y: b(B).y - b0.y };
    const dA = { x: b(A).x - a0.x, y: b(A).y - a0.y };
    if (dA.x !== dB.x || dA.y !== dB.y) laggedSteps += 1;
    if (b(A).x - (b(B).x + b(B).width) !== gap0) drifted += 1;
  });
  check(
    '드래그 매 스텝에서 팔로워가 리더를 따라온다 (릴리즈 전)',
    laggedSteps === 0,
    `뒤처진 스텝=${laggedSteps}/24`
  );
  check('드래그 내내 간격이 정확히 유지된다 (표류 0)', drifted === 0, `어긋난 스텝=${drifted}/24`);

  // 이중 적용 금지: 마지막 이동 이벤트 시점의 위치 == 릴리즈 후 위치.
  const duringLast = { a: b(A), b: b(B) };
  await release(B);
  check(
    '릴리즈 후 위치 == 마지막 이동 이벤트 시점 위치 (delta 이중 적용 없음)',
    fmt(b(A)) === fmt(duringLast.a) && fmt(b(B)) === fmt(duringLast.b),
    `A ${fmt(duringLast.a)} → ${fmt(b(A))} / B ${fmt(duringLast.b)} → ${fmt(b(B))}`
  );
  check('관계 유지', rel('patients', 'diagnosis'));
}

console.log('\n--- 긴 드래그에서도 표류가 없다 (작은 이동 200회) ---');
{
  const { A, B } = await pairWorld();
  const gap0 = b(A).x - (b(B).x + b(B).width);
  const yGap0 = b(A).y - b(B).y;
  let bad = 0;
  // 스텝당 2px — DRAG_DISTANCE_PX(2) 이상이어야 첫 스텝부터 드래그로 인정된다
  // (1px 이동 하나는 설계상 "드래그가 아직 아님"). 클램프에 닿지 않게 오른쪽으로.
  for (let i = 0; i < 200; i += 1) {
    stepDrag(B, 2, i % 2 === 0 ? 2 : -2, 1);
    if (b(A).x - (b(B).x + b(B).width) !== gap0 || b(A).y - b(B).y !== yGap0) bad += 1;
  }
  await release(B);
  check(
    '작은 이동 200회 뒤에도 시작과 정확히 같은 밀착도',
    bad === 0 && b(A).x - (b(B).x + b(B).width) === gap0 && b(A).y - b(B).y === yGap0,
    `어긋난 스텝=${bad} gap=${b(A).x - (b(B).x + b(B).width)} (기대 ${gap0})`
  );
}

console.log('\n--- 이동 이벤트당 프로그램적 setBounds 가 유계다 (진동 없음) ---');
{
  const { B } = await pairWorld();
  const per = [];
  stepDrag(B, 100, 0, 50, () => {
    per.push(snap.getSnapDiagnostics().appliedBoundsCount);
  });
  await release(B);
  const deltas = per.map((v, i) => v - (i === 0 ? per[0] - 0 : per[i - 1]));
  const max = Math.max(...deltas.slice(1));
  check(
    `이동 이벤트 하나당 setBounds ≤ 팔로워 창 수(1) — 실측 최대 ${max}`,
    max <= 1,
    deltas.slice(1).join(',')
  );
  // 같은 자리에서 이동 이벤트만 40번 — 되먹임이 있으면 여기서 폭주한다.
  const before = snap.getSnapDiagnostics().appliedBoundsCount;
  stepDrag(B, 0, 0, 40);
  await release(B);
  const idle = snap.getSnapDiagnostics().appliedBoundsCount - before;
  check(`제자리 이동 이벤트 40회 → setBounds ${idle}회 (0 이어야 한다)`, idle === 0, `${idle}`);
}

console.log('\n--- 3-unit 사슬(탭 그룹 포함)이 숨은 탭까지 따라온다 ---');
{
  const W = freshWorld();
  W.get('diagnosis').place({ x: 900, y: 300 });
  await makeGroup(W, 'terms', 'diagnosis');
  const st = groups.getGroupsState()[0];
  const active = st.active;
  const hidden = st.tabs.find((t) => t !== active);
  const g = b(W.get(active));

  // patients 를 그룹 왼쪽에 붙이고, questions 를 patients 왼쪽에 붙인다.
  const P = W.get('patients');
  P.place({ x: g.x - SPECS.patients.width - 18, y: g.y, ...SPECS.patients });
  await P.userDrag(2, 0);
  const pb = b(P);
  const Q = W.get('questions');
  Q.place({ x: pb.x - SPECS.questions.width - 18, y: pb.y, ...SPECS.questions });
  await Q.userDrag(2, 0);
  check(
    '사전 조건: questions-patients-그룹 3-unit 사슬',
    snap.clusterOf('questions').length === 3,
    snap.clusterOf('questions').join(',')
  );

  const o = {
    q: b(Q),
    p: b(P),
    a: b(W.get(active)),
    h: b(W.get(hidden))
  };
  let bad = 0;
  let hiddenBad = 0;
  // 사슬 전체 폭이 1140px 이고 왼쪽 끝이 x=140 이므로 -100 까지가 클램프 밖이다.
  // (클램프 동작은 아래 별도 절에서 본다 — 여기서는 순수 추종만 본다.)
  stepDrag(Q, -100, 90, 20, () => {
    const d = { x: b(Q).x - o.q.x, y: b(Q).y - o.q.y };
    const same = (cur, org) => cur.x - org.x === d.x && cur.y - org.y === d.y;
    if (!same(b(P), o.p) || !same(b(W.get(active)), o.a)) bad += 1;
    if (!same(b(W.get(hidden)), o.h)) hiddenBad += 1;
  });
  check('드래그 도중 사슬의 두 이웃 unit 이 모두 따라온다', bad === 0, `어긋난 스텝=${bad}/20`);
  check('숨은 탭도 드래그 도중 내내 따라온다', hiddenBad === 0, `어긋난 스텝=${hiddenBad}/20`);
  check(
    '숨은 탭이 활성 탭과 같은 자리',
    fmt(b(W.get(hidden))) === fmt(b(W.get(active))),
    `${fmt(b(W.get(hidden)))} vs ${fmt(b(W.get(active)))}`
  );
  await release(Q);
  check('숨은 탭은 여전히 숨어 있다', !W.get(hidden).isVisible());
}

console.log('\n--- 화면 끝에서: 팔로워는 멈추고, 놓으면 리더가 합류한다 ---');
{
  const { W, A, B } = await pairWorld();
  // 클러스터를 왼쪽 끝 근처로 옮긴 뒤, 더 왼쪽으로 끈다.
  const bb = b(B);
  const ab = b(A);
  const shift = -(bb.x - WORK_AREA.x) + 40; // B 의 왼쪽 변이 작업영역에서 40px 안쪽
  B.place({ x: bb.x + shift, y: bb.y, width: bb.width, height: bb.height });
  A.place({ x: ab.x + shift, y: ab.y, width: ab.width, height: ab.height });
  const gap0 = b(A).x - (b(B).x + b(B).width);

  // 리더가 클램프 지점을 넘어 앞서 나가는 것은 설계된 동작(드래그 중 리더는 OS
  // 소유). 금지되는 것은 팔로워가 화면 밖으로 나가는 것과, 놓은 뒤에도 벌어져
  // 있는 것이다.
  let outside = 0;
  stepDrag(B, -300, 0, 30, () => {
    if (b(A).x < WORK_AREA.x) outside += 1;
  });
  check('드래그 중 팔로워가 작업영역 밖으로 나가지 않는다', outside === 0, `${outside}회`);
  await release(B);
  const after = { a: b(A), b: b(B) };
  check(
    '놓으면 리더가 클램프 지점으로 되돌아와 클러스터가 다시 강체가 된다',
    after.a.x - (after.b.x + after.b.width) === gap0,
    `gap=${after.a.x - (after.b.x + after.b.width)} (기대 ${gap0}) A=${fmt(after.a)} B=${fmt(after.b)}`
  );
  check(
    '클러스터 전체가 작업영역 안',
    after.b.x >= WORK_AREA.x && after.a.x >= WORK_AREA.x,
    `B.x=${after.b.x} A.x=${after.a.x} wa.x=${WORK_AREA.x}`
  );
  check('관계 유지 (클램프가 클러스터를 끊지 않는다)', rel('patients', 'diagnosis'));
  void W;
}

console.log(`\n${failures === 0 ? '=== ALL PASS ===' : `=== ${failures} FAILURE(S) ===`}`);
process.exit(failures === 0 ? 0 : 1);
