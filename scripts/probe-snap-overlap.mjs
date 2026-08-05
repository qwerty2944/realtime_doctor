#!/usr/bin/env node
// 사용자가 실제로 겪은 실패의 회귀 프로브: "창을 이웃 안으로 살짝 밀어 넣었는데
// 아무 일도 일어나지 않는다".
//
// 실행:
//   node --import ./scripts/probe-snap-register.mjs scripts/probe-snap-overlap.mjs
//
// 왜 기존 probe-snap.mjs 가 이걸 못 잡았나:
//   probe-snap 은 언제나 "겹치지 않는 0~24px 간격"에서만 드랍한다. 그런데 손으로
//   창을 끌어다 붙이는 자연스러운 동작은 이웃 안으로 몇 px 밀어 넣는 것이다.
//   그 순간 두 rect 가 겹치고, 예전 findEngage 는 겹치는 후보를 통째로 버렸다.
//   한편 탭 머지는 "커서가 상대 rect 안"을 요구하는데, 타이틀바를 잡고 끄는
//   커서는 끌던 창 위에 있으므로 얕은 겹침에서는 상대 rect 밖이다.
//   => 스냅도 머지도 발동하지 않는 사각지대. 이 파일이 그 사각지대를 고정한다.
//
// 화면 캡처와 합성 입력이 불가능한 환경이라 관측은 전부 bounds 숫자다.

import { FakeWindow, BACKING, setCursor } from './probe-snap-stubs.mjs';

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures += 1;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}
const b = (w) => w.getBounds();
const fmt = (r) => `${r.x},${r.y} ${r.width}x${r.height}`;

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
 * @param snapFirst true 면 스냅 핸들러를 머지 핸들러보다 **먼저** 등록한다.
 *   실제 앱(index.ts)은 머지가 먼저지만, 우선순위가 등록 순서에 의존하지
 *   않는다는 것을 보이기 위해 뒤집어 본다.
 */
function freshWorld(snapFirst = false) {
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
    onGroupChangedMembers: (ks) => snap.dropSnapsFor(ks)
  });
  snap.initWindowSnap({ windows });
  for (const [k, w] of windows) {
    if (snapFirst) {
      snap.attachSnapDragHandlers(w, k);
      groups.attachGroupDragHandlers(w, k);
    } else {
      groups.attachGroupDragHandlers(w, k);
      snap.attachSnapDragHandlers(w, k);
    }
  }
  setCursor(-10000, -10000);
  return windows;
}

const rel = (x, y) =>
  snap
    .getSnapRelations()
    .some((r) => (r.a === x && r.b === y) || (r.a === y && r.b === x));

/**
 * 타이틀바를 잡고 끄는 실제 커서 위치를 흉내낸다.
 * 커서는 언제나 **끌던 창** 의 타이틀바 위(상단 중앙 근처)에 있다.
 */
function cursorOnTitlebarOf(rect) {
  setCursor(rect.x + Math.round(rect.width / 2), rect.y + 12);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== R1) 이웃 안으로 12px 밀어 넣고 놓으면 딱 붙는다 (사용자 신고 케이스) ===');
{
  const W = freshWorld();
  const target = W.get('diagnosis'); // 380x460
  const mover = W.get('patients'); // 380x420
  target.place({ x: 900, y: 300 });
  const t = b(target);

  // mover 의 오른쪽 변이 target 의 왼쪽 변을 12px 파고든 상태로 드랍한다.
  const endX = t.x - SPECS.patients.width + 12; // 532
  mover.place({ x: endX - 16, y: t.y, ...SPECS.patients });
  cursorOnTitlebarOf({ x: endX, y: t.y, ...SPECS.patients }); // target rect 밖
  await mover.userDrag(16, 0);

  const got = b(mover);
  check(
    '12px 겹치게 드랍 → 상대 왼쪽 변에 딱 붙는다',
    got.x === t.x - SPECS.patients.width && got.y === t.y,
    `got ${fmt(got)} / want ${t.x - SPECS.patients.width},${t.y}`
  );
  check('관계 기록', rel('patients', 'diagnosis'), JSON.stringify(snap.getSnapRelations()));
  check('탭 그룹은 생기지 않음', groups.getGroupsState().length === 0);
  check(
    '크기는 그대로',
    got.width === SPECS.patients.width && got.height === SPECS.patients.height
  );
}

console.log('\n--- 위/아래 방향도 같은 사각지대였다 ---');
{
  const W = freshWorld();
  const target = W.get('diagnosis');
  const mover = W.get('patients');
  target.place({ x: 700, y: 520 });
  const t = b(target);
  // mover 아래 변이 target 위 변을 20px 파고든다.
  const endY = t.y - SPECS.patients.height + 20;
  mover.place({ x: t.x, y: endY - 16, ...SPECS.patients });
  cursorOnTitlebarOf({ x: t.x, y: endY, ...SPECS.patients });
  await mover.userDrag(0, 16);
  const got = b(mover);
  check(
    '아래 변이 20px 파고든 드랍 → 위쪽에 딱 붙는다',
    got.y === t.y - SPECS.patients.height && got.x === t.x,
    `got ${fmt(got)} / want ${t.x},${t.y - SPECS.patients.height}`
  );
  check('관계 기록', rel('patients', 'diagnosis'));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== R2) 간격이 있는 드랍(기존 동작)도 그대로 붙는다 ===');
{
  const W = freshWorld();
  const target = W.get('diagnosis');
  const mover = W.get('patients');
  target.place({ x: 900, y: 300 });
  const t = b(target);
  const endX = t.x - SPECS.patients.width - 18;
  mover.place({ x: endX - 16, y: t.y, ...SPECS.patients });
  cursorOnTitlebarOf({ x: endX, y: t.y, ...SPECS.patients });
  await mover.userDrag(16, 0);
  check(
    '18px 간격 드랍 → 흡착',
    b(mover).x === t.x - SPECS.patients.width && rel('patients', 'diagnosis'),
    `x=${b(mover).x}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== R3) 커서가 상대 rect 안이면 머지가 이긴다 (스냅은 절대 같이 발동 안 함) ===');
{
  const W = freshWorld();
  const target = W.get('diagnosis');
  const mover = W.get('patients');
  target.place({ x: 900, y: 300 });
  const t = b(target);
  // 얕게 겹치되(스냅 조건도 성립), 커서는 target rect 안에 둔다.
  const endX = t.x - SPECS.patients.width + 12;
  mover.place({ x: endX - 16, y: t.y, ...SPECS.patients });
  setCursor(t.x + 40, t.y + 40);
  await mover.userDrag(16, 0);

  const gs = groups.getGroupsState();
  check('탭 그룹 생성', gs.length === 1 && gs[0].tabs.length === 2, JSON.stringify(gs));
  check(
    '스냅 관계는 생기지 않음 (둘이 동시에 발동하지 않는다)',
    snap.getSnapRelations().length === 0,
    JSON.stringify(snap.getSnapRelations())
  );
}

console.log('\n--- 핸들러 등록 순서를 뒤집어도(스냅이 먼저) 결과는 같다 ---');
{
  const W = freshWorld(true);
  const target = W.get('diagnosis');
  const mover = W.get('patients');
  target.place({ x: 900, y: 300 });
  const t = b(target);
  const endX = t.x - SPECS.patients.width + 12;
  mover.place({ x: endX - 16, y: t.y, ...SPECS.patients });
  setCursor(t.x + 40, t.y + 40);
  await mover.userDrag(16, 0);
  check('스냅 핸들러가 먼저여도 머지가 이긴다', groups.getGroupsState().length === 1);
  check(
    '스냅 관계 없음 (등록 순서 무관)',
    snap.getSnapRelations().length === 0,
    JSON.stringify(snap.getSnapRelations())
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== R4) 깊게 파묻은 드랍은 스냅하지 않는다 (튀어나오는 놀람 방지) ===');
{
  const W = freshWorld();
  const target = W.get('diagnosis');
  const mover = W.get('patients');
  target.place({ x: 900, y: 300 });
  const t = b(target);
  // 오른쪽 변이 200px 파고든 상태 — 붙이려는 동작이 아니라 포개는 동작이다.
  const endX = t.x - SPECS.patients.width + 200;
  mover.place({ x: endX - 16, y: t.y + 6, ...SPECS.patients });
  // 커서를 타이틀바 **왼쪽 끝** 을 잡은 것처럼 둔다 = 깊게 겹쳤는데도 커서는
  // target rect 밖. (중앙을 잡으면 200px 겹침에서 커서가 target 안으로 들어가
  // 머지가 이긴다 — 그건 R3 가 다루는 경우다.)
  setCursor(endX + 20, t.y + 18);
  const before = b(mover);
  await mover.userDrag(16, 0);
  const got = b(mover);
  check('깊은 겹침 → 흡착 없음', !rel('patients', 'diagnosis'), JSON.stringify(snap.getSnapRelations()));
  check(
    '깊은 겹침 → 창이 순간이동하지 않음',
    got.x === before.x + 16 && got.y === before.y,
    `got ${fmt(got)}`
  );
  check('탭 그룹도 없음', groups.getGroupsState().length === 0);
}

console.log(`\n${failures === 0 ? '=== ALL PASS ===' : `=== ${failures} FAILURE(S) ===`}`);
process.exit(failures === 0 ? 0 : 1);
