import { BrowserWindow, screen } from 'electron';
import { appendFileSync } from 'node:fs';
import { isApplyingBounds, withAppliedBounds } from './boundsGuard.js';
import { saveBounds, store, type WindowKey } from './store.js';
import {
  groupAnchor,
  groupTabsOf,
  isMergePending,
  mergeTargetAtCursor,
  visibleTabOf
} from './windowGroups.js';

/**
 * 창 가장자리 스냅(자석 붙이기).
 *
 * 오버레이 창을 다른 창 가까이(겹치지 않게) 끌어다 놓으면 맞닿은 변에 딱
 * 붙고, 그 관계가 기록된다. 관계로 이어진 창들은 하나의 "클러스터"가 되어
 * 같이 움직인다. A-B-C 처럼 사슬로 이어져도 전체가 한 덩어리다.
 *
 * ── 드래그는 언제나 "클러스터 통째 이동" ──────────────────────────────────
 * 분리는 드래그가 아니라 **명시적 동작**(단축키 windowSnapDetach / 타이틀바의
 * 분리 버튼)으로만 일어난다. 예전에는 이동 거리로 둘을 구분했는데, 그러면
 * 클러스터를 한 번에 옮길 수 있는 거리에 천장이 생겨(96px) 화면을 가로질러
 * 옮기려면 여러 번 끌어야 했다. 신호가 겹치지 않게 분리하면 드래그 거리에
 * 제한이 사라진다.
 *
 * ── 스냅 vs 탭 머지 우선순위 (명시) ─────────────────────────────────────
 * **머지가 이긴다.** 판정 근거는 커서 위치 하나다:
 *
 *   드랍 시점 커서가 다른 창 rect 안에 있다  → 탭 머지. 스냅은 관여하지 않는다.
 *   그렇지 않다                              → 스냅. 가장 가까운 변에 흡착한다.
 *
 * 커서를 상대 창 **안** 까지 끌고 들어가는 것은 의도적인 행위이므로 머지의
 * 신호로 삼고, 변끼리 가까워지는 것은 스냅의 신호로 삼는다. 두 신호는 겹치지
 * 않으므로 한 드랍이 둘 다 트리거할 수 없다.
 *
 * [왜 바뀌었나] 예전에는 "rect 가 겹치면 머지, 안 겹치면 스냅" 으로 갈랐다.
 * 그런데 창을 이웃 안으로 살짝 밀어 넣는 것 — 붙이려 할 때 사람이 실제로 하는
 * 동작 — 은 rect 를 겹치게 만들면서도 커서는 상대 창 밖에 남긴다. 그 구간에서
 * 스냅은 "겹쳤다"며 거부하고 머지는 "커서가 밖"이라며 거부해서 아무 일도
 * 일어나지 않는 사각지대가 생겼다 (실제 사용자 신고). 그래서 스냅이 겹침을
 * 허용하도록 바꾸고, 경계는 커서 위치로 다시 그었다.
 * 회귀 프로브: scripts/probe-snap-overlap.mjs
 *
 * ── 탭 그룹도 스냅에 참여한다 (단위 = unit) ────────────────────────────
 * 탭 그룹은 멤버 전원이 **하나의 rect** 를 공유한다. 그러므로 스냅의 참여
 * 단위는 "창" 이 아니라 "unit" 이다: 홀로 있는 창은 그 자신이 unit 이고, 탭
 * 그룹은 멤버 전체가 합쳐서 unit 하나다. unit 의 대표 키는 groupAnchor(tabs[0])
 * 이며 관계(SnapRelation)는 언제나 대표 키로 저장된다. 클러스터가 움직이면
 * unit 의 **모든 멤버**(숨은 탭 포함)가 같은 delta 를 받으므로 그룹의 bounds
 * 공유 전제가 깨지지 않는다.
 *
 * [왜 바뀌었나] 예전에는 그룹 멤버를 스냅에서 통째로 제외했다. 그런데 머지가
 * 잘 동작하게 되자 사용자의 창은 대부분 그룹에 들어갔고, 그 순간부터 스냅이
 * 영영 발동하지 않았다 — 실사용 로그에 "스냅 안 함 — 끌린 창이 탭 그룹 멤버"
 * 만 반복됐다. 기능이 정상 사용 중에 죽어버린 셈이다.
 * 회귀 프로브: scripts/probe-snap-groups.mjs
 *
 * 대표 키가 그룹을 떠날 때(탭 분리/다른 그룹으로 이동)는 windowGroups 가
 * onSnapUnitReassign 으로 알려주고, 관계는 남는 대표에게 넘어간다. 그룹이
 * 재구성되면 normalizeSnapUnits 가 관계를 다시 대표 키로 정규화하고 기하가
 * 죽은 관계를 버린다.
 *
 * ── 진단 로그 ───────────────────────────────────────────────────────────
 * 화면을 볼 수 없는 환경에서 "왜 안 붙었는지" 를 숫자로 받기 위한 옵트인 로그.
 * 기본은 꺼져 있고, 켜는 방법은 한 줄이다:
 *
 *   RD_SNAP_DEBUG=1 npm run dev        # 기록 위치: /tmp/dev.log
 *
 * (기록 위치를 바꾸려면 RD_SNAP_DEBUG_LOG=/path/to/file)
 *
 * ── 라이브 흡착 (드래그 중 자석) ─────────────────────────────────────────
 * 드랍 후에야 붙으면 "자석" 처럼 느껴지지 않는다는 지적을 받아, 흡착 밴드에
 * 들어오는 순간 한 번 끌어당긴다. OS 의 네이티브 드래그 루프 안에서 setBounds
 * 를 부르는 것은 되먹임 위험이 있는 동작이므로 **래치(latch)** 로 엄격히
 * 제한한다:
 *
 *   밴드 진입 → setBounds 1회 → 래치. 래치가 걸려 있는 동안에는 무슨 이동
 *   이벤트가 몇 번 오든 다시 적용하지 않는다. 래치 지점에서 LIVE_UNLATCH_PX
 *   이상 벗어나야 래치가 풀리고 다시 판정한다.
 *
 * 즉 "밴드 안에 머무는 동안의 프로그램적 setBounds 횟수" 는 이벤트 수와 무관하게
 * 상수로 묶인다 = 진동이 원리적으로 불가능하다. 이 성질은 숫자로 검증한다
 * (scripts/probe-snap-groups.mjs D3: 이동 이벤트 40회 → setBounds ≤ 2회).
 *
 * macOS 에서는 OS 가 창을 다시 커서 위치로 되돌리므로 사용자가 보는 것은
 * "한 번 끌어당겨지는 느낌" 이고, 최종 정렬은 드랍 시점에 확정된다. 진동이
 * 아니라 단발 신호다. 끄려면 RD_SNAP_LIVE=0.
 *
 * ── 라이브 추종 (드래그 중 클러스터가 통째로 따라온다) ────────────────────
 * 붙은 창을 끌면 나머지도 **끌리는 동안 내내** 따라와야 한다. 예전에는 드랍
 * 판정(디바운스/릴리즈) 때만 따라와서, 사용자가 보는 시간 내내 클러스터가
 * 흩어져 있다가 툭툭 끊겨 따라붙었다 (실사용 신고: "붙는건 잘돼" / 같이 안 움직임).
 *
 * 규율:
 *
 *   1) **원점 기준 절대 계산.** 드래그 세션이 시작될 때 클러스터 각 unit 의
 *      rect 를 dragOrigins 에 박아 두고, 이동 이벤트마다
 *      `목표 = 원점 + (리더 현재 - 리더 원점)` 으로 **다시 계산**한다.
 *      이벤트별 delta 를 누적하지 않으므로 수백 번 끌어도 표류(drift)가 0 이다.
 *      반올림도 누적되지 않는다.
 *   2) **리더는 건드리지 않는다.** 드래그 중 리더의 위치는 OS 소유다. 여기서
 *      리더에 setBounds 하면 네이티브 드래그 루프와 싸운다. 추종은 나머지만.
 *   3) **드랍은 같은 식으로 한 번 더.** 드랍 시점 계산도 같은 원점·같은 식이라
 *      팔로워의 목표값이 이미 맞아 있으면 setBounds 자체가 생략된다
 *      (applyUnitTargets 의 동일 좌표 스킵) = delta 이중 적용이 원리적으로 불가능.
 *      클램프가 걸렸던 경우에만 리더가 클러스터 자리로 되돌아온다.
 *   4) **라이브 흡착과 배타적.** 라이브 흡착(tryLiveSnap)은 아직 아무 데도 붙지
 *      않은 unit 에만, 라이브 추종(liveFollow)은 이미 붙은 unit 에만 돈다.
 *      한 이동 이벤트가 둘 다 발동할 수 없으므로 서로 싸울 지점이 없다.
 *
 * [클램프 규칙] 팔로워가 작업영역 밖으로 나가려 하면 **클러스터 전체의 이동량**
 * 을 깎는다(clampDelta). 즉 팔로워끼리는 언제나 정확히 같은 delta 를 받으므로
 * 클러스터가 소리 없이 늘어나는 일은 없다. 리더만은 OS 가 커서를 따라 계속
 * 끌고 가므로 드래그 중 잠시 앞서 나갈 수 있는데, 드랍 시점에 규율 3 이 리더를
 * 클램프된 자리로 되돌려 강체 배치를 복원한다. 대안(팔로워를 화면 밖으로
 * 내보내기)은 창을 영영 잃게 만들고, 다른 대안(리더를 드래그 중에 붙잡기)은
 * OS 드래그 루프와 싸운다 — 그래서 "팔로워는 멈추고, 놓는 순간 리더가 합류"
 * 를 고른다.
 *
 * 끄려면 RD_SNAP_LIVE=0 (라이브 흡착과 같은 스위치 — 둘 다 "드래그 중 개입").
 */

export type SnapEdge = 'left' | 'right' | 'top' | 'bottom';

/** a 의 `edge` 쪽 변이 b 에 붙어 있다. 클러스터 판정에는 방향이 무의미하다. */
export interface SnapRelation {
  a: WindowKey;
  b: WindowKey;
  edge: SnapEdge;
}

// ── 임계값 ────────────────────────────────────────────────────────────────
//
// [튜닝 근거] 오버레이 창은 폭 380~420px 이고 테두리 없는 프레임리스라 잡을 수
// 있는 곳이 타이틀바뿐이다. 손으로 끌어 놓는 정확도는 실측상 수십 px 단위이므로
// 예전의 24px 밴드는 사람이 맞히기 어려웠다. 아래 값은 "창 폭의 1/8 정도면
// 붙이려던 것" 이라는 기준으로 잡았다.

/**
 * 바깥쪽 흡착 거리. 드랍 시점 두 변 사이 간격이 이 이하면 흡착한다.
 * 380px 폭의 1/8. 손으로 겨눌 수 있는 폭이면서, 옆 창을 우연히 잡아채기엔
 * 여전히 창 폭보다 한참 작다.
 */
const ENGAGE_PX = 48;
/**
 * 안쪽 흡착 거리(파고든 깊이). 이웃 안으로 이만큼까지 밀어 넣어도 밀려나며
 * 딱 붙는다 — "밀어서 붙인다" 는 자연스러운 동작을 그대로 받아준다.
 * ENGAGE 의 두 배로, 창 폭의 1/4 만큼 파묻힐 때까지 허용한다. 그보다 깊으면
 * 붙이려는 게 아니라 포개는 동작으로 보고 아무것도 하지 않는다(원치 않는
 * 순간이동 방지 — 대개 그 지점에서는 커서가 상대 창 안이라 머지가 가져간다).
 */
const PENETRATE_PX = 96;
/**
 * 맞닿는 변이 최소 이만큼은 겹쳐야 한다. 모서리만 스친 대각선 흡착 방지.
 * 겹침을 허용하게 되면서 모서리 근처 오검출 여지가 늘었으므로 24 → 40 으로
 * 올렸다 (창 높이 240~460 기준으로도 "변이 맞닿았다" 고 부를 최소치).
 */
const MIN_SHARE_PX = 40;
/** 수직축 정렬(예: 오른쪽에 붙일 때 위쪽 맞추기) 허용 오차. ENGAGE 와 동일 감각. */
const ALIGN_PX = 48;

/**
 * 사용자 드래그로 인정할 최소 **누적 변위**(px). windowGroups 와 동일 규율.
 *
 * [왜 move 이벤트 개수가 아닌가] 예전 기준은 "move 이벤트 4개 이상" 이었다.
 * 그 기준의 목적은 프로그램적 setBounds 를 사용자 드래그로 오해하지 않는 것인데,
 * 프로그램적 이동은 boundsGuard 가 이미 **전부** 걸러낸다 — 개수 기준은 목적을
 * 잃은 채 부작용만 남아 있었다. 실사용 로그(/tmp/dev.log)를 보면 천천히 겨누는
 * 드래그는 손이 멈출 때마다 조각으로 잘리고, 조각마다 이벤트가 1~3개뿐이라
 * "move 가 적다" 며 통째로 버려졌다. 붙이려고 조준하는 동작이 정확히 그 모양이다.
 *
 * 거리 기준은 그 문제가 없다. 조각들의 변위는 같은 시작점에서 계속 누적되므로
 * 몇 조각으로 잘리든 결국 임계값을 넘는다.
 *
 * [왜 2px 인가] 이 값이 걸러야 하는 것은 이제 "변위가 없는 이동 이벤트" 뿐이다
 * (show/focus/디스플레이 변경 등이 만드는 헛 이벤트). 사용자가 창을 조금이라도
 * 옮겼다면 그건 드래그다 — 살짝 밀어 붙이는 동작을 거절하지 않는 것이 자석 같은
 * 감각의 전제이기도 하다.
 */
const DRAG_DISTANCE_PX = 2;
/**
 * 드래그 세션을 버리는 무활동 시간. 조각난 드래그를 잇기 위해 세션은 드랍
 * 판정 뒤에도 살아 있는데, 영원히 살아 있으면 한참 전 시작점이 되살아난다.
 */
const DRAG_SESSION_EXPIRE_MS = 4000;
/** 라이브 흡착 래치가 풀리는 거리. 이만큼 벗어나야 다시 흡착을 판정한다. */
const LIVE_UNLATCH_PX = 64;
/**
 * 드랍 판정: 마지막 이동 이벤트로부터 이만큼 조용하면 드래그가 끝난 것으로 본다.
 *
 * [왜 'moved' 로 즉시 끝내지 않나] macOS 의 'moved' 는 "드래그 한 번의 끝"에
 * 한 번만 오지 않는다. 실측(scripts/probe-snap-electron.mjs)에서는 'move' 하나마다
 * 'moved' 가 뒤따라 왔다 — NSWindowDidMoveNotification 이 이동마다 발생하기
 * 때문이다. 그 신호로 곧바로 finishDrag 를 하면 매 스텝마다 드래그가 리셋되어
 * 드래그 판정이 영영 서지 못한다. 즉 macOS 에서는 스냅이
 * 조건과 무관하게 **한 번도** 발동할 수 없었다. 그래서 'move'/'moved' 를 모두
 * "아직 움직이는 중" 신호로만 쓰고, 조용해질 때 한 번 판정한다. 플랫폼 분기도
 * 사라진다('moved' 가 없는 win32/linux 도 같은 경로).
 *
 * windowGroups 의 250ms 보다 길게 잡아 머지 판정이 항상 먼저 끝나게 한다.
 * 드래그 도중 이만큼 멈춰 있으면 드랍으로 오인할 수 있지만, 그 경우에도 결과는
 * "이미 흡착 범위 안이던 이웃에 붙는 것" 이라 사용자가 향하던 방향과 어긋나지 않는다.
 * 조각난 드래그는 세션이 살아남아 이어지므로, 이 값이 짧아도 드래그가 잘리지 않는다.
 */
const DROP_SETTLE_MS = 320;
/**
 * 라이브 흡착이 이미 걸린 상태의 드랍 판정 시간. 붙을 곳이 확정된 뒤에는
 * 기다릴 이유가 없으므로 짧게 잡아 "손을 떼자마자 붙는" 감각을 만든다.
 * windowGroups 의 250ms 보다 짧지만 배타성은 시간이 아니라 mergeTargetAtCursor
 * (커서 위치 재계산)로 보장되므로 순서가 뒤바뀌어도 답이 달라지지 않는다.
 */
const DROP_SETTLE_ENGAGED_MS = 140;

// ── 상태 ──────────────────────────────────────────────────────────────────
let relations: SnapRelation[] = [];
let windowsRef: Map<WindowKey, BrowserWindow> | null = null;
/** 관계가 바뀔 때마다 호출 — 렌더러에 클러스터 소속을 알려 분리 버튼을 띄운다. */
let onSnapsChanged: (() => void) | null = null;

/** 프로그램적으로 적용한 setBounds 누적 횟수 — 되먹임 폭주 검증용 계측값. */
let appliedBoundsCount = 0;

/** 라이브 흡착 끄기: RD_SNAP_LIVE=0 */
const LIVE_SNAP = process.env.RD_SNAP_LIVE !== '0';

let draggingKey: WindowKey | null = null;
let dragStart: Electron.Rectangle | null = null;
let dragLastMoveAt = 0;
let dropTimer: NodeJS.Timeout | null = null;
/** 라이브 흡착 래치 — 걸려 있는 동안 같은 자리에서 다시 setBounds 하지 않는다. */
let liveLatch: { unit: WindowKey; x: number; y: number } | null = null;
/**
 * 드래그 세션 시작 시점의 unit 별 rect. 라이브 추종과 드랍 이동은 **언제나**
 * 여기서 절대 좌표를 다시 계산한다 (delta 누적 금지 = 표류 0).
 */
let dragOrigins: Map<WindowKey, Electron.Rectangle> | null = null;
/** 라이브 추종 진단 누적 — 드래그 한 번당 한 줄로 요약해서 로그를 지킨다. */
let follow = { events: 0, applied: 0, clamped: 0 };

function win(key: WindowKey): BrowserWindow | null {
  const w = windowsRef?.get(key);
  return w && !w.isDestroyed() ? w : null;
}

// ── 진단 로그 (옵트인) ─────────────────────────────────────────────────────
// 켜기: RD_SNAP_DEBUG=1 npm run dev   (기본 출력 /tmp/dev.log)

const SNAP_DEBUG = process.env.RD_SNAP_DEBUG === '1';
const SNAP_DEBUG_LOG = process.env.RD_SNAP_DEBUG_LOG || '/tmp/dev.log';

/** 로그 실패가 창 동작을 막아서는 안 된다 — 조용히가 아니라 '한 번만' 알린다. */
let debugWriteFailed = false;

function debugWrite(lines: string[]): void {
  if (!SNAP_DEBUG || lines.length === 0) return;
  try {
    appendFileSync(SNAP_DEBUG_LOG, lines.map((l) => `${l}\n`).join(''));
  } catch (err) {
    if (!debugWriteFailed) {
      debugWriteFailed = true;
      console.error(`[snap] 진단 로그를 쓸 수 없다 (${SNAP_DEBUG_LOG}):`, err);
    }
  }
}

const fmtRect = (r: Electron.Rectangle): string =>
  `${r.x},${r.y} ${r.width}x${r.height}`;

function persist(): void {
  store.set(
    'windowSnaps',
    relations.map((r) => ({ a: r.a, b: r.b, edge: r.edge }))
  );
  onSnapsChanged?.();
}

export function getSnapRelations(): SnapRelation[] {
  return relations.map((r) => ({ ...r }));
}

/** 지금 어떤 창이라도 붙어 있는 창들. 렌더러의 분리 버튼 표시 조건. */
export function getSnappedKeys(): WindowKey[] {
  const set = new Set<WindowKey>();
  for (const r of relations) {
    // unit 이 그룹이면 멤버 전원에게 분리 버튼이 보여야 한다 — 어느 탭을 보고
    // 있든 "이 창은 붙어 있다" 는 사실은 같기 때문이다.
    for (const m of [...unitMembers(r.a), ...unitMembers(r.b)]) set.add(m);
  }
  return [...set];
}

/** 되먹임 폭주 검증용 계측값. 프로덕션 동작에는 영향이 없다. */
export function getSnapDiagnostics(): { appliedBoundsCount: number } {
  return { appliedBoundsCount };
}

function setBoundsGuarded(key: WindowKey, bounds: Electron.Rectangle): void {
  const w = win(key);
  if (!w) return;
  appliedBoundsCount += 1;
  withAppliedBounds(() => w.setBounds(bounds));
  // 프로그램적 setBounds 는 'moved'/'resized' 를 발생시키지 않으므로
  // windows.ts 의 persist 핸들러에 기대지 않고 직접 저장한다 (M5 와 같은 이유).
  saveBounds(key, bounds);
}

// ── unit: 스냅의 참여 단위 ─────────────────────────────────────────────────
//
// 홀로 있는 창은 그 자신이 unit. 탭 그룹은 rect 하나를 공유하므로 멤버 전체가
// unit 하나이고, 대표 키는 groupAnchor(tabs[0]) 이다.

/** 이 창이 속한 unit 의 대표 키. */
function unitOf(key: WindowKey): WindowKey {
  return groupAnchor(key) ?? key;
}

/** unit 을 이루는 창 전부 (숨은 탭 포함). 클러스터 이동은 이 전부를 옮긴다. */
function unitMembers(unit: WindowKey): WindowKey[] {
  return groupTabsOf(unit) ?? [unit];
}

/** unit 을 대표해 지금 화면에 보이는 창 — rect 와 가시성의 출처. */
function unitWindowKey(unit: WindowKey): WindowKey {
  return visibleTabOf(unit);
}

function unitRect(unit: WindowKey): Electron.Rectangle | null {
  return win(unitWindowKey(unit))?.getBounds() ?? null;
}

/**
 * unit 이 지금 화면에 있는가.
 *
 * 판정은 항상 **지금** BrowserWindow 에 물어본다(캐시 없음). 그룹의 숨은 탭은
 * 대표 창이 아니라 아예 열거되지 않으므로 "숨겨져 있다" 로 떨어지는 게 아니라
 * 애초에 후보가 아니다 — 진짜로 hide/minimize 된 창만 이 검사에 걸린다.
 */
function unitVisible(unit: WindowKey): boolean {
  const w = win(unitWindowKey(unit));
  return !!w && w.isVisible() && !w.isMinimized();
}

/** 지금 존재하는 unit 목록 (중복 제거). */
function allUnits(): WindowKey[] {
  const seen = new Set<WindowKey>();
  for (const key of windowsRef?.keys() ?? []) seen.add(unitOf(key));
  return [...seen];
}

// ── 클러스터 그래프 ────────────────────────────────────────────────────────

/** key 와 스냅으로 연결된 모든 unit (자기 unit 포함). 사슬을 따라 전파한다. */
export function clusterOf(key: WindowKey): WindowKey[] {
  const root = unitOf(key);
  const seen = new Set<WindowKey>([root]);
  const queue: WindowKey[] = [root];
  while (queue.length > 0) {
    const cur = queue.shift() as WindowKey;
    for (const r of relations) {
      const next = r.a === cur ? r.b : r.b === cur ? r.a : null;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen];
}

/** 클러스터에 실제로 존재하는 창 전부 — 그룹 unit 은 숨은 탭까지 펼친다. */
function clusterWindows(key: WindowKey): WindowKey[] {
  return clusterOf(key).flatMap((u) => unitMembers(u));
}

function hasRelation(key: WindowKey): boolean {
  const unit = unitOf(key);
  return relations.some((r) => r.a === unit || r.b === unit);
}

/** 지정한 창들의 스냅 관계를 모두 끊는다. 레이아웃 적용 등에서 사용. */
export function dropSnapsFor(keys: WindowKey[]): void {
  const set = new Set(keys.map(unitOf));
  const before = relations.length;
  relations = relations.filter((r) => !set.has(r.a) && !set.has(r.b));
  if (relations.length !== before) persist();
}

/**
 * 그룹 대표가 바뀌었다 — 관계의 끝점을 새 대표에게 넘긴다.
 *
 * 그룹은 제자리에 있고 대표만 바뀌는 것이므로 기하 검증은 하지 않는다.
 * (windowGroups.removeFromGroup 에서 호출)
 */
export function reassignSnapUnit(from: WindowKey, to: WindowKey): void {
  if (from === to) return;
  let touched = false;
  relations = relations.map((r) => {
    if (r.a === from) {
      touched = true;
      return { ...r, a: to };
    }
    if (r.b === from) {
      touched = true;
      return { ...r, b: to };
    }
    return r;
  });
  if (touched) persist();
}

/**
 * 그룹 구성이 바뀐 뒤 관계를 unit 기준으로 다시 정리한다.
 *
 * 1) 모든 끝점을 현재 대표 키로 정규화한다.
 * 2) 같은 unit 안으로 들어와 버린 관계(=한 그룹으로 머지됨)는 버린다 —
 *    rect 를 공유하는 두 창 사이의 "맞닿음" 은 의미가 없다.
 * 3) 이번에 바뀐 창이 걸린 관계는 기하를 다시 확인한다. 머지된 창이 들고
 *    있던 옛 이웃 관계는 여기서 조용히 사라진다(그룹 자리로 순간이동했으므로).
 *    바뀌지 않은 관계는 건드리지 않는다 — 멀쩡한 클러스터를 흔들지 않기 위해서.
 */
export function normalizeSnapUnits(changed: WindowKey[] = []): void {
  const changedSet = new Set<WindowKey>([...changed, ...changed.map(unitOf)]);
  const next: SnapRelation[] = [];
  for (const r of relations) {
    const a = unitOf(r.a);
    const b = unitOf(r.b);
    if (a === b) continue;
    if (!win(unitWindowKey(a)) || !win(unitWindowKey(b))) continue;
    const rekeyed = a !== r.a || b !== r.b;
    if ((rekeyed || changedSet.has(r.a) || changedSet.has(r.b)) && !stillAdjacent(a, b, r.edge)) {
      continue;
    }
    if (next.some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))) continue;
    next.push({ a, b, edge: r.edge });
  }
  const same =
    next.length === relations.length &&
    next.every((x, i) => x.a === relations[i].a && x.b === relations[i].b);
  relations = next;
  if (!same) persist();
}

/**
 * 명시적 분리: 이 창만 클러스터에서 빼낸다 (단축키 / 타이틀바 버튼).
 *
 * [사슬 판정] A-B-C 에서 B 를 빼면 A 와 C 는 서로 이어지지 **않는다**.
 * 둘 사이에는 B 의 폭만큼 빈 공간이 있어 실제로 맞닿아 있지 않기 때문이다.
 * 여기서 A-C 를 이어 두면 눈에 보이지 않는 기하로 두 창이 함께 움직이게 되고,
 * 사용자는 왜 떨어진 창이 따라오는지 알 수 없다. 그래서 사슬은 끊는다.
 *
 * 빠진 창은 제자리에 그대로 남는다(순간이동 금지). 여전히 이웃과 맞닿아
 * 있으므로 24px 밖으로 끌어내지 않고 놓으면 다시 붙는 것이 정상이다.
 *
 * @returns 실제로 끊긴 관계가 있었으면 true.
 */
export function detachFromCluster(key: WindowKey): boolean {
  if (!hasRelation(key)) return false;
  dropSnapsFor([key]);
  return true;
}

/** 레이아웃 프리셋은 모든 창을 개별 위치로 재배치하므로 스냅 관계를 전부 해체한다. */
export function dissolveAllSnaps(): void {
  if (relations.length === 0) return;
  relations = [];
  persist();
}

// ── 기하 ──────────────────────────────────────────────────────────────────

function overlaps(a: Electron.Rectangle, b: Electron.Rectangle): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function overlapLength(a1: number, a2: number, b1: number, b2: number): number {
  return Math.min(a2, b2) - Math.max(a1, b1);
}

/**
 * 클러스터 전체가 작업 영역 안에 남도록 이동량을 깎는다.
 * 클러스터 폭/높이가 작업 영역보다 크면 좌/상단 정렬을 우선한다.
 */
function clampDelta(
  rects: Electron.Rectangle[],
  dx: number,
  dy: number,
  wa: Electron.Rectangle
): { dx: number; dy: number } {
  if (rects.length === 0) return { dx, dy };
  const minX = Math.min(...rects.map((r) => r.x));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));

  let ndx = dx;
  if (maxX + ndx > wa.x + wa.width) ndx = wa.x + wa.width - maxX;
  if (minX + ndx < wa.x) ndx = wa.x - minX;

  let ndy = dy;
  if (maxY + ndy > wa.y + wa.height) ndy = wa.y + wa.height - maxY;
  if (minY + ndy < wa.y) ndy = wa.y - minY;

  return { dx: ndx, dy: ndy };
}

/**
 * 클러스터를 강체(rigid)로 이동한다. leader 는 dragStart 기준, 나머지는
 * 현재 위치 기준으로 같은 delta 를 받으므로 상대 배치가 정확히 보존된다.
 */
function moveCluster(
  leader: WindowKey,
  leaderOrigin: Electron.Rectangle,
  dx: number,
  dy: number
): void {
  // 이동의 단위는 unit 이다. 그룹 unit 은 rect 하나를 옮기고, 그 rect 를
  // 멤버 전원(숨은 탭 포함)에게 그대로 적용한다 — 그래야 그룹의 bounds 공유
  // 전제가 유지되어 탭을 전환해도 창이 튀지 않는다.
  const leaderUnit = unitOf(leader);
  const origin = new Map<WindowKey, Electron.Rectangle>();
  origin.set(leaderUnit, leaderOrigin);
  for (const u of clusterOf(leader)) {
    if (u === leaderUnit) continue;
    const r = unitRect(u);
    if (r) origin.set(u, r);
  }

  const wa = screen.getDisplayMatching({
    ...leaderOrigin,
    x: leaderOrigin.x + dx,
    y: leaderOrigin.y + dy
  }).workArea;
  const clamped = clampDelta([...origin.values()], dx, dy, wa);

  const targets = new Map<WindowKey, Electron.Rectangle>();
  for (const [unit, b] of origin) {
    targets.set(unit, {
      x: b.x + clamped.dx,
      y: b.y + clamped.dy,
      width: b.width,
      height: b.height
    });
  }
  applyUnitTargets(targets);
}

/**
 * unit → 목표 rect 를 실제 창에 적용한다.
 *
 * unit 이 그룹이면 멤버 전원(숨은 탭 포함)이 같은 rect 를 받는다 — 그래야 탭을
 * 전환해도 창이 튀지 않는다. 이미 목표 좌표에 있는 창은 건너뛴다: 이것이
 * "드랍이 라이브 추종을 이중 적용하지 않는다" 를 보장하는 지점이자, 밴드 안에
 * 머무는 동안 setBounds 가 상수로 묶이는 이유다.
 *
 * @param skipUnit 이 unit 은 건드리지 않는다 (드래그 중인 리더 = OS 소유).
 * @returns 실제로 발생시킨 setBounds 횟수.
 */
function applyUnitTargets(
  targets: Map<WindowKey, Electron.Rectangle>,
  skipUnit?: WindowKey
): number {
  let applied = 0;
  for (const [unit, next] of targets) {
    if (unit === skipUnit) continue;
    for (const m of unitMembers(unit)) {
      const cur = win(m)?.getBounds();
      if (
        cur &&
        cur.x === next.x &&
        cur.y === next.y &&
        cur.width === next.width &&
        cur.height === next.height
      ) {
        continue; // 이미 목표 위치 — 불필요한 setBounds 를 만들지 않는다.
      }
      setBoundsGuarded(m, next);
      applied += 1;
    }
  }
  return applied;
}

/**
 * 리더의 현재 위치와 세션 원점으로부터 클러스터 전체의 목표 위치를 계산한다.
 *
 * 매번 원점에서 다시 계산하므로 이벤트가 몇 번 오든 결과가 같다(멱등). 이동
 * 이벤트마다 delta 를 더해 나가는 방식이었다면 반올림·클램프·놓친 이벤트가
 * 그대로 누적돼 오래 끌수록 클러스터가 벌어졌을 것이다.
 */
function clusterTargets(
  key: WindowKey,
  leaderCur: Electron.Rectangle
): {
  targets: Map<WindowKey, Electron.Rectangle>;
  dx: number;
  dy: number;
  clamped: boolean;
} | null {
  const origins = dragOrigins;
  const leaderOrigin = origins?.get(unitOf(key));
  if (!origins || !leaderOrigin) return null;

  const rawDx = leaderCur.x - leaderOrigin.x;
  const rawDy = leaderCur.y - leaderOrigin.y;
  const wa = screen.getDisplayMatching(leaderCur).workArea;
  const c = clampDelta([...origins.values()], rawDx, rawDy, wa);

  const targets = new Map<WindowKey, Electron.Rectangle>();
  for (const [unit, b] of origins) {
    targets.set(unit, { x: b.x + c.dx, y: b.y + c.dy, width: b.width, height: b.height });
  }
  return { targets, dx: c.dx, dy: c.dy, clamped: c.dx !== rawDx || c.dy !== rawDy };
}

interface EngageResult {
  target: WindowKey;
  edge: SnapEdge;
  x: number;
  y: number;
}

/**
 * 드랍한 창이 흡착할 이웃과 최종 위치를 찾는다.
 *
 * 간격은 음수(= 이웃 안으로 파고든 상태)도 허용한다. 파고들었으면 밀려나며
 * 딱 붙는다. 후보 정렬 기준은 |간격| 이라 "가장 얕게 빠져나가는 변" 이 이긴다.
 *
 * @param trace 넘기면 후보별 계산값과 탈락 사유를 여기에 쌓는다 (진단 로그용).
 */
function findEngage(
  key: WindowKey,
  b: Electron.Rectangle,
  trace?: string[]
): EngageResult | null {
  const own = new Set(clusterOf(key));
  let best: (EngageResult & { gap: number }) | null = null;

  for (const other of allUnits()) {
    if (own.has(other)) continue;
    if (!unitVisible(other)) {
      trace?.push(`  후보 ${other}: 탈락 — 보이지 않음(hidden/minimized)`);
      continue;
    }
    const t = unitRect(other);
    if (!t) continue;
    const groupTabs = groupTabsOf(other);
    if (groupTabs) trace?.push(`  후보 ${other}: 탭 그룹 [${groupTabs.join(',')}] 을 rect 하나로 취급`);

    const vShare = overlapLength(b.y, b.y + b.height, t.y, t.y + t.height);
    const hShare = overlapLength(b.x, b.x + b.width, t.x, t.x + t.width);

    const candidates: Array<{ edge: SnapEdge; gap: number; share: number; x: number; y: number }> =
      [
        // 내 오른쪽 변을 상대 왼쪽 변에.
        { edge: 'right', gap: t.x - (b.x + b.width), share: vShare, x: t.x - b.width, y: b.y },
        // 내 왼쪽 변을 상대 오른쪽 변에.
        { edge: 'left', gap: b.x - (t.x + t.width), share: vShare, x: t.x + t.width, y: b.y },
        { edge: 'bottom', gap: t.y - (b.y + b.height), share: hShare, x: b.x, y: t.y - b.height },
        { edge: 'top', gap: b.y - (t.y + t.height), share: hShare, x: b.x, y: t.y + t.height }
      ];

    // 로그 가독성: 애초에 근처에도 없는 창은 변별 없이 한 줄로 접는다.
    // (판정에는 영향이 없다 — 어차피 아래 필터에서 전부 탈락한다.)
    const nearestGap = Math.min(...candidates.map((c) => Math.abs(c.gap)));
    if (trace && nearestGap > ENGAGE_PX * 4) {
      trace.push(`  후보 ${other}: bounds=${fmtRect(t)} → 탈락: 멀리 떨어짐 (최소 |gap|=${nearestGap})`);
      continue;
    }
    trace?.push(
      `  후보 ${other}: bounds=${fmtRect(t)} vShare=${vShare} hShare=${hShare}` +
        `${overlaps(b, t) ? ' (겹침)' : ''}`
    );

    for (const c of candidates) {
      if (c.share < MIN_SHARE_PX) {
        trace?.push(
          `    edge=${c.edge} gap=${c.gap} share=${c.share} → 탈락: 공유 변 부족 (< ${MIN_SHARE_PX})`
        );
        continue;
      }
      if (c.gap > ENGAGE_PX) {
        trace?.push(`    edge=${c.edge} gap=${c.gap} → 탈락: 너무 멂 (> ${ENGAGE_PX})`);
        continue;
      }
      if (c.gap < -PENETRATE_PX) {
        trace?.push(`    edge=${c.edge} gap=${c.gap} → 탈락: 너무 깊이 겹침 (< -${PENETRATE_PX})`);
        continue;
      }
      // 수직축 정렬: 이미 거의 맞아 있으면 딱 맞춘다. 크기는 절대 바꾸지
      // 않는다 — 오버레이마다 의도된 높이/폭이 다르기 때문(dock 130 vs
      // diagnosis 460). 강제로 맞추면 정보가 잘린다.
      let { x, y } = c;
      if (c.edge === 'right' || c.edge === 'left') {
        if (Math.abs(b.y - t.y) <= ALIGN_PX) y = t.y;
      } else if (Math.abs(b.x - t.x) <= ALIGN_PX) {
        x = t.x;
      }
      const better = !best || Math.abs(c.gap) < Math.abs(best.gap);
      trace?.push(
        `    edge=${c.edge} gap=${c.gap} share=${c.share} → 통과 (→ ${x},${y})${better ? ' [현재 최선]' : ''}`
      );
      if (better) best = { target: other, edge: c.edge, x, y, gap: c.gap };
    }
  }

  if (!best) return null;
  return { target: best.target, edge: best.edge, x: best.x, y: best.y };
}

// ── 드래그 수명주기 ────────────────────────────────────────────────────────

function resetDrag(): void {
  if (dropTimer) {
    clearTimeout(dropTimer);
    dropTimer = null;
  }
  flushFollowSummary();
  draggingKey = null;
  dragStart = null;
  dragLastMoveAt = 0;
  liveLatch = null;
  dragOrigins = null;
}

/**
 * 드래그 세션의 기준점을 다시 잡는다: 리더의 현재 rect + 클러스터 각 unit 의
 * 현재 rect. 이 스냅샷이 라이브 추종의 유일한 기준이므로, 창을 옮긴 직후
 * (rebase) 에는 반드시 다시 찍어야 한다.
 */
function captureDragOrigins(key: WindowKey): void {
  const leader = win(key)?.getBounds() ?? null;
  dragStart = leader;
  if (!leader) {
    dragOrigins = null;
    return;
  }
  const origins = new Map<WindowKey, Electron.Rectangle>();
  for (const u of clusterOf(key)) {
    const r = unitRect(u);
    if (r) origins.set(u, r);
  }
  // 리더는 끌리고 있는 그 창의 rect 를 쓴다 (그룹 대표 rect 와 어긋날 여지 제거).
  origins.set(unitOf(key), leader);
  dragOrigins = origins;
}

/** 드래그 한 번의 라이브 추종을 한 줄로 요약한다 — 이동 이벤트마다 찍으면 로그가 죽는다. */
function flushFollowSummary(): void {
  if (follow.events === 0) {
    follow = { events: 0, applied: 0, clamped: 0 };
    return;
  }
  debugWrite([
    `[snap] ${new Date().toISOString()} 라이브 추종 요약 key=${draggingKey ?? '?'} ` +
      `이동이벤트=${follow.events} setBounds=${follow.applied} 클램프=${follow.clamped}`
  ]);
  follow = { events: 0, applied: 0, clamped: 0 };
}

/** 드래그 시작점에서 지금까지의 이동 거리(체비쇼프 — 축 하나만 커도 인정). */
function dragDistance(key: WindowKey): number {
  const cur = win(key)?.getBounds();
  if (!cur || !dragStart) return 0;
  return Math.max(Math.abs(cur.x - dragStart.x), Math.abs(cur.y - dragStart.y));
}

/**
 * 판정이 끝난 뒤 세션을 어떻게 할지.
 *
 * - 'keep': 아무 일도 하지 않았다 → 세션을 남긴다. 손이 잠깐 멈춘 것과 손을 뗀
 *   것은 창 이벤트만으로 구분할 수 없으므로, 남겨 두어야 다음 조각이 같은
 *   시작점에서 거리를 계속 누적한다 (= 끊어진 드래그가 하나로 이어진다).
 * - 'rebase': 창을 옮겼다 → 시작점을 현재 위치로 옮긴다. 남은 세션이 이미 적용한
 *   delta 를 다시 적용하지 않게 하는 것이 핵심이다.
 */
function endDragSession(mode: 'keep' | 'rebase', key: WindowKey): void {
  if (dropTimer) {
    clearTimeout(dropTimer);
    dropTimer = null;
  }
  if (mode === 'rebase') {
    // 원점을 지금 위치로 다시 찍는다 — 남은 세션이 이미 적용한 delta 를 다시
    // 적용하지 않게 하는 것이 핵심이다. 클러스터 구성이 방금 바뀌었을 수도
    // 있으므로(흡착으로 새 이웃이 생김) 팔로워 원점도 같이 다시 찍는다.
    captureDragOrigins(key);
    liveLatch = null;
  }
  flushFollowSummary();
}

function finishDrag(): void {
  const key = draggingKey;
  const start = dragStart;
  const moved = key ? dragDistance(key) : 0;
  const wasRealDrag = moved >= DRAG_DISTANCE_PX;
  if (!key || !start) {
    resetDrag();
    return;
  }

  const trace: string[] = [];
  const log = SNAP_DEBUG ? trace : undefined;
  const decide = (line: string): void => {
    if (!SNAP_DEBUG) return;
    trace.push(`  결정: ${line}`);
    debugWrite(trace);
  };
  const unit = unitOf(key);
  log?.push(
    `[snap] ${new Date().toISOString()} 드랍 key=${key} unit=${unit}` +
      `${groupTabsOf(key) ? ` (탭 그룹 [${groupTabsOf(key)?.join(',')}])` : ''} ` +
      `start=${fmtRect(start)} 누적변위=${moved}px`
  );

  if (!wasRealDrag) {
    // 세션은 남긴다 — 다음 조각이 같은 시작점에서 거리를 이어 쌓는다.
    decide(
      `보류 — 누적 변위가 아직 작다 (${moved} < ${DRAG_DISTANCE_PX}) / 세션 유지, 다음 조각과 이어짐`
    );
    endDragSession('keep', key);
    return;
  }

  const w = win(key);
  if (!w) {
    decide('무시 — 창이 사라짐');
    resetDrag();
    return;
  }
  // ── 우선순위: 머지가 스냅을 이긴다 ──────────────────────────────────────
  // 근거는 커서 위치 하나다. 커서가 다른 창 rect 안이면 그건 "포개겠다" 는
  // 의도적 행위이므로 머지가 가져간다. mergeTargetAtCursor 는 드래그 상태가
  // 아니라 커서/rect 로 다시 계산하므로, windowGroups 와 windowSnap 중
  // 어느 쪽 'moved' 핸들러가 먼저 돌든 답이 같다.
  const mergeTarget = mergeTargetAtCursor(key);
  if (mergeTarget || isMergePending(key)) {
    decide(`스냅 안 함 — 커서가 ${mergeTarget ?? '(pending)'} 안 → 탭 머지가 가져간다`);
    endDragSession('keep', key);
    return;
  }

  const dropped = w.getBounds();
  const dx = dropped.x - start.x;
  const dy = dropped.y - start.y;

  if (hasRelation(key)) {
    // 붙어 있는 unit 의 드래그는 언제나 클러스터 통째 이동이다 — 거리 제한 없음.
    // 빼내려면 명시적 분리 동작(detachFromCluster)을 써야 한다.
    //
    // 계산식은 라이브 추종과 **완전히 같다**(같은 원점, 같은 클램프). 그래서
    // 이미 추종으로 제자리에 온 창은 applyUnitTargets 에서 스킵되고, 이중
    // 적용이 일어날 수 없다. 여기서 리더를 빼지 않는 이유는 클램프가 걸렸을 때
    // 앞서 나간 리더를 클러스터 자리로 되돌리기 위해서다.
    const plan = clusterTargets(key, dropped);
    if (plan) {
      const applied = applyUnitTargets(plan.targets);
      decide(
        `클러스터 통째 이동 delta=${plan.dx},${plan.dy}` +
          `${plan.clamped ? ` (요청 ${dx},${dy} → 작업영역 클램프, 리더 합류)` : ''} ` +
          `unit=[${clusterOf(key).join(',')}] 드랍시점 setBounds=${applied}`
      );
    } else {
      moveCluster(key, start, dx, dy);
      decide(`클러스터 통째 이동 delta=${dx},${dy} unit=[${clusterOf(key).join(',')}] (원점 없음)`);
    }
    endDragSession('rebase', key);
    return;
  }

  const current = win(key)?.getBounds();
  if (!current) {
    decide('무시 — 창이 사라짐');
    resetDrag();
    return;
  }
  log?.push(`  드랍 bounds=${fmtRect(current)}`);
  const engage = findEngage(unit, current, log);
  if (!engage) {
    decide('흡착 없음 — 조건을 통과한 후보가 없다');
    // 붙을 곳이 없었을 뿐이므로 세션은 rebase 해서 이어간다 (계속 끌 수 있다).
    endDragSession('rebase', key);
    return;
  }

  // 흡착도 강체 이동으로 적용한다 — unit 이 이미 다른 창을 달고 있으면
  // 그 창들도 같이 따라와야 배치가 깨지지 않는다.
  moveCluster(key, current, engage.x - current.x, engage.y - current.y);
  relations.push({ a: unit, b: engage.target, edge: engage.edge });
  persist();
  decide(`흡착 ${unit} → ${engage.target} (edge=${engage.edge}) 위치=${engage.x},${engage.y}`);
  endDragSession('rebase', key);
}

/**
 * 드래그 중 라이브 흡착 — 밴드에 들어오는 순간 한 번 끌어당긴다.
 *
 * 되먹임 방지는 전적으로 래치가 한다: 한 번 당긴 뒤에는 래치 지점에서
 * LIVE_UNLATCH_PX 이상 벗어나기 전까지 다시 적용하지 않는다. 그래서 밴드 안에
 * 머무는 동안 발생하는 프로그램적 setBounds 는 이동 이벤트 수와 무관하게 상수다.
 */
function tryLiveSnap(key: WindowKey): void {
  if (!LIVE_SNAP) return;
  const unit = unitOf(key);
  const cur = win(key)?.getBounds();
  if (!cur) return;

  if (liveLatch && liveLatch.unit === unit) {
    const away = Math.max(Math.abs(cur.x - liveLatch.x), Math.abs(cur.y - liveLatch.y));
    if (away < LIVE_UNLATCH_PX) return; // 래치 유지 — 아무것도 하지 않는다
    liveLatch = null;
  }
  // 이미 클러스터에 속해 있으면 라이브 흡착은 하지 않는다 — 그 드래그는
  // "클러스터 통째 이동" 이고, 드래그 중에 따라오는 창까지 옮기면 OS 드래그
  // 루프와 싸우게 된다. 따라오기는 종전대로 드랍 시점에 한 번만.
  if (hasRelation(key)) return;
  // 머지가 이긴다 — 커서가 상대 rect 안이면 라이브 흡착도 하지 않는다.
  if (mergeTargetAtCursor(key)) return;

  const engage = findEngage(unit, cur);
  if (!engage) return;
  if (engage.x === cur.x && engage.y === cur.y) {
    liveLatch = { unit, x: cur.x, y: cur.y };
    return;
  }
  moveCluster(key, cur, engage.x - cur.x, engage.y - cur.y);
  liveLatch = { unit, x: engage.x, y: engage.y };
  debugWrite([
    `[snap] ${new Date().toISOString()} 라이브 흡착 unit=${unit} → ${engage.target} ` +
      `(edge=${engage.edge}) ${fmtRect(cur)} → ${engage.x},${engage.y} [래치]`
  ]);
}

/**
 * 드래그 중 라이브 추종 — 붙어 있는 나머지 창들을 리더에 계속 맞춘다.
 *
 * 리더(끌리고 있는 창)는 절대 건드리지 않는다: 드래그 중 그 창의 위치는 OS 가
 * 소유하며, 여기서 setBounds 하면 네이티브 드래그 루프와 싸운다.
 *
 * 한 이동 이벤트당 setBounds 는 최대 "팔로워 창 수" 로 묶이고, 목표에 이미 와
 * 있으면 0 이다 — 추종이 추종을 부르는 되먹임이 없다(팔로워의 이동 이벤트는
 * boundsGuard 가 걸러낸다).
 */
function liveFollow(key: WindowKey): void {
  if (!LIVE_SNAP) return;
  if (!hasRelation(key)) return;
  const cur = win(key)?.getBounds();
  if (!cur) return;
  const plan = clusterTargets(key, cur);
  if (!plan) return;

  follow.events += 1;
  if (plan.clamped) follow.clamped += 1;
  const applied = applyUnitTargets(plan.targets, unitOf(key));
  if (applied === 0) return;
  if (follow.applied === 0) {
    // 세션당 딱 한 줄. 나머지는 flushFollowSummary 가 요약한다.
    debugWrite([
      `[snap] ${new Date().toISOString()} 라이브 추종 시작 key=${key} ` +
        `unit=[${clusterOf(key).join(',')}] delta=${plan.dx},${plan.dy}`
    ]);
  }
  follow.applied += applied;
}

/**
 * @param live 라이브 흡착/추종을 시도해도 되는 시점인가.
 *   'will-move' 는 OS 가 아직 창을 옮기기 전이라 여기서 setBounds 를 하면
 *   곧바로 덮어써진다(그리고 win32 에서는 이동 직전 훅 안에서 창을 옮기는 셈이
 *   된다). 그래서 라이브 흡착은 이동이 **끝난** 'move' 에서만 한다.
 */
function onDragTick(key: WindowKey, live: boolean): void {
  if (isApplyingBounds()) return;
  const stale = Date.now() - dragLastMoveAt > DRAG_SESSION_EXPIRE_MS;
  if (draggingKey !== key) {
    // 다른 창의 드래그가 정리되지 않은 채 남아 있으면 먼저 마무리한다.
    if (draggingKey) finishDrag();
    resetDrag();
    draggingKey = key;
    captureDragOrigins(key);
  } else if (stale || !dragStart || !dragOrigins) {
    // 세션이 너무 오래 조용했다 — 낡은 시작점을 되살리지 않고 새로 잡는다.
    captureDragOrigins(key);
    liveLatch = null;
  }
  dragLastMoveAt = Date.now();
  if (live && dragDistance(key) >= DRAG_DISTANCE_PX) {
    // 배타적이다: 아직 안 붙은 unit → 라이브 흡착, 이미 붙은 unit → 라이브 추종.
    tryLiveSnap(key);
    liveFollow(key);
  }
  scheduleDrop();
}

/**
 * 드랍 판정을 뒤로 민다. 이동 이벤트가 올 때마다 다시 밀린다.
 * 이미 라이브 흡착이 걸려 있으면(붙을 곳이 확정) 짧게 잡아 즉시 붙는 느낌을 준다.
 */
function scheduleDrop(): void {
  if (dropTimer) clearTimeout(dropTimer);
  dropTimer = setTimeout(finishDrag, liveLatch ? DROP_SETTLE_ENGAGED_MS : DROP_SETTLE_MS);
}

export function attachSnapDragHandlers(w: BrowserWindow, key: WindowKey): void {
  // will-move 는 실제 이동 직전에 오므로 드래그 시작 위치를 정확히 잡을 수 있다.
  w.on('will-move', () => onDragTick(key, false));
  w.on('move', () => onDragTick(key, true));
  // macOS 의 'moved' 는 이동마다 오므로 여기서 즉시 끝내지 않는다 —
  // 다른 이동 이벤트와 똑같이 "아직 움직이는 중" 으로 취급하고 판정을 미룬다.
  w.on('moved', () => {
    if (isApplyingBounds()) return;
    if (draggingKey !== key) return;
    scheduleDrop();
  });
  w.on('closed', () => {
    // 닫힌 창을 **정확히 그 키로** 가리키는 관계만 지운다. unit 으로 넓히면
    // 살아 있는 그룹의 관계까지 함께 날아간다 (그룹은 창 하나가 닫혀도 남는다).
    const before = relations.length;
    relations = relations.filter((r) => r.a !== key && r.b !== key);
    if (relations.length !== before) persist();
  });
}

/**
 * 저장된 관계가 지금 기하로도 여전히 성립하는지.
 *
 * 시작 시 레이아웃 프리셋이 창을 흩어 놓았다면 관계는 의미가 없다. 좌표를
 * 다시 맞추는 대신(사용자가 고른 프리셋을 덮어쓰게 된다) 관계를 버린다.
 */
function stillAdjacent(a: WindowKey, b: WindowKey, edge: SnapEdge): boolean {
  const wa = unitRect(a);
  const wb = unitRect(b);
  if (!wa || !wb) return false;
  const vShare = overlapLength(wa.y, wa.y + wa.height, wb.y, wb.y + wb.height);
  const hShare = overlapLength(wa.x, wa.x + wa.width, wb.x, wb.x + wb.width);
  const gap =
    edge === 'right'
      ? wb.x - (wa.x + wa.width)
      : edge === 'left'
        ? wa.x - (wb.x + wb.width)
        : edge === 'bottom'
          ? wb.y - (wa.y + wa.height)
          : wa.y - (wb.y + wb.height);
  const share = edge === 'right' || edge === 'left' ? vShare : hShare;
  // 흡착 판정과 같은 밴드를 쓴다 (겹침 허용). 스냅이 만든 배치는 간격 0 이지만,
  // 재시작 사이에 리사이즈 등으로 약간 어긋났다고 관계를 버릴 이유는 없다.
  return gap >= -PENETRATE_PX && gap <= ENGAGE_PX && share >= MIN_SHARE_PX;
}

/**
 * 시작 시 저장된 스냅 관계 복원.
 *
 * 창 위치는 이미 bounds 로 복원되므로 여기서는 그래프만 다시 세운다.
 * 없어진 창을 가리키는 낡은 관계는 조용히 버린다 — 시작을 막으면 안 된다.
 */
export function restoreSnaps(): void {
  const saved = store.get('windowSnaps');
  relations = [];
  if (Array.isArray(saved)) {
    for (const r of saved) {
      if (!r || typeof r !== 'object') continue;
      const raw = r as Partial<SnapRelation>;
      const edge = raw.edge;
      if (!raw.a || !raw.b || !win(raw.a) || !win(raw.b)) continue;
      if (edge !== 'left' && edge !== 'right' && edge !== 'top' && edge !== 'bottom') continue;
      // 재시작 사이에 탭 그룹이 복원됐을 수 있다 — 저장된 키를 현재 unit 대표로
      // 정규화한 뒤 기하를 확인한다 (restoreGroups 가 먼저 돈다).
      const a = unitOf(raw.a);
      const b = unitOf(raw.b);
      if (a === b) continue;
      const dup = relations.some(
        (x) => (x.a === a && x.b === b) || (x.a === b && x.b === a)
      );
      if (dup) continue;
      if (!stillAdjacent(a, b, edge)) continue;
      relations.push({ a, b, edge });
    }
  }
  persist();
}

export function initWindowSnap(opts: {
  windows: Map<WindowKey, BrowserWindow>;
  onSnapsChanged?: () => void;
}): void {
  windowsRef = opts.windows;
  onSnapsChanged = opts.onSnapsChanged ?? null;
  relations = [];
  appliedBoundsCount = 0;
  resetDrag();
}
