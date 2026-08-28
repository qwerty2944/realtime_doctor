import { BrowserWindow, screen } from 'electron';
import { appendFileSync } from 'node:fs';
import {
  IPC,
  type OverlayKey,
  type SnapChoiceAction,
  type SnapChoicePrompt
} from '../shared/types.js';
import { isApplyingBounds, withAppliedBounds } from './boundsGuard.js';
import { saveBounds, store, type WindowKey } from './store.js';
import {
  canMerge,
  groupAnchor,
  groupTabsOf,
  mergeTargetAtCursor,
  mergeWindows,
  visibleTabOf
} from './windowGroups.js';

/**
 * 창 붙이기(스냅)와 탭 머지 — **전부 사용자가 고를 때만** 일어난다.
 *
 * 오버레이 창을 다른 창 위에 겹쳐 놓으면 선택지가 뜨고, 거기서 고른 방향으로만
 * 붙는다. 붙은 창들은 하나의 "클러스터"가 되어 같이 움직인다. A-B-C 처럼
 * 사슬로 이어져도 전체가 한 덩어리다.
 *
 * ── 드래그는 언제나 "클러스터 통째 이동" ──────────────────────────────────
 * 분리는 드래그가 아니라 **명시적 동작**(단축키 windowSnapDetach / 타이틀바의
 * 분리 버튼)으로만 일어난다. 예전에는 이동 거리로 둘을 구분했는데, 그러면
 * 클러스터를 한 번에 옮길 수 있는 거리에 천장이 생겨(96px) 화면을 가로질러
 * 옮기려면 여러 번 끌어야 했다. 신호가 겹치지 않게 분리하면 드래그 거리에
 * 제한이 사라진다.
 *
 * ── 겹쳐 놓으면 "묻는다" (자동 실행 금지) ───────────────────────────────
 * 드랍 시점에 끌던 창이 **다른 창 하나와 실질적으로 겹쳐 있으면** 아무것도
 * 자동으로 하지 않는다. 대신 대상 창 위에 선택지를 띄우고(상/하/좌/우 붙이기 +
 * 합치기 + 취소) **고른 것만** 실행한다.
 *
 *   겹침 대상이 정확히 1개  → 선택지. 창은 놓인 자리에 그대로 남는다.
 *   겹침 대상이 2개 이상    → 아무것도 하지 않는다 (무엇에 붙일지 모른다).
 *   겹침 없음               → 아무 일도 일어나지 않는다 (자동 흡착 자체가 없다).
 *
 * [왜 바뀌었나] 예전에는 겹치면 커서 위치에 따라 탭 머지 또는 흡착이 **즉시**
 * 일어났다. 겹쳐 놓는 동작 하나에 결과가 여러 가지라 사용자는 매번 되돌려야
 * 했다("너무 공격적이다"). 판정을 사람에게 넘기면 모호함이 사라진다.
 *
 * 탭 머지의 자동 실행은 windowGroups.finishDrag 에서 제거됐고, 흡착·머지를 통틀어
 * 실행 경로는 applySnapChoice 하나뿐이다.
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
 * ── 자석(자동 흡착)은 존재하지 않는다 ────────────────────────────────────
 * 드래그 중 끌어당김(라이브 흡착)도, 드랍 시점의 근접 흡착도 **전부 제거됐다.**
 * 창은 끄는 대로 자유롭게 움직이고, 어디에 놓든 저절로 달라붙지 않는다.
 * 붙는 일은 오직 위의 선택지에서 사용자가 방향을 고를 때만 일어난다.
 *
 * [왜 지웠나] 얕게 스치는 드랍에만 자석을 남겨 두면 규칙이 둘이 된다 —
 * "겹치면 묻고, 살짝 닿으면 말없이 붙는다". 사용자는 그 경계를 볼 수 없으므로
 * 결국 "왜 어떤 때는 묻고 어떤 때는 그냥 붙지?" 가 된다. 실사용 피드백대로
 * 자동 붙임을 하나도 남기지 않는 편이 예측 가능하다.
 * (흡착 밴드 상수 ENGAGE_PX/PENETRATE_PX/MIN_SHARE_PX 는 저장된 관계가 지금
 *  기하로도 성립하는지 확인하는 stillAdjacent 에서만 계속 쓰인다.)
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
 *   4) **추종은 이미 붙은 unit 에만 돈다.** 아직 아무 데도 붙지 않은 창은 드래그
 *      중 아무런 프로그램적 이동을 받지 않는다 (자석이 없으므로).
 *
 * [클램프 규칙] 클러스터가 작업영역 밖으로 **더** 나가려 하면 **클러스터 전체의
 * 이동량** 을 깎는다(clampDelta). 이미 밖으로 걸쳐 있는 만큼은 강제로 되돌리지
 * 않는다 — 되돌리면 사용자가 가로로만 끌어도 클러스터가 세로로 튀어 "둘이 같이
 * 안 움직인다" 로 보인다 (실사용 신고의 실제 원인). 팔로워끼리는 언제나 같은 delta 를 받으므로
 * 클러스터가 소리 없이 늘어나는 일은 없다. 리더만은 OS 가 커서를 따라 계속
 * 끌고 가므로 드래그 중 잠시 앞서 나갈 수 있는데, 드랍 시점에 규율 3 이 리더를
 * 클램프된 자리로 되돌려 강체 배치를 복원한다. 대안(팔로워를 화면 밖으로
 * 내보내기)은 창을 영영 잃게 만들고, 다른 대안(리더를 드래그 중에 붙잡기)은
 * OS 드래그 루프와 싸운다 — 그래서 "팔로워는 멈추고, 놓는 순간 리더가 합류"
 * 를 고른다.
 *
 * 끄려면 RD_SNAP_LIVE=0 (드래그 중 개입을 전부 끈다 = 붙은 창은 드랍 때 합류).
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
// 아래 세 값(ENGAGE/PENETRATE/MIN_SHARE)은 **흡착을 발동시키지 않는다.** 저장된
// 관계가 지금 기하로도 여전히 성립하는지 확인하는 stillAdjacent 의 허용 오차일
// 뿐이다 (재시작·리사이즈로 몇 px 어긋났다고 관계를 버리지 않기 위한 폭).

/** 두 변 사이 간격이 이 이하면 아직 "맞닿아 있다" 로 인정한다. */
const ENGAGE_PX = 48;
/** 이만큼까지 파고든 것도 아직 "맞닿아 있다" 로 인정한다. */
const PENETRATE_PX = 96;
/**
 * 맞닿는 변이 최소 이만큼은 겹쳐야 한다. 모서리만 스친 대각선을 인접으로 세지
 * 않기 위한 하한 (창 높이 240~460 기준).
 */
const MIN_SHARE_PX = 40;
/**
 * "실질적으로 겹쳤다" = 선택지를 띄울 조건 (두 축 **모두** 이만큼).
 * 이보다 얕게 스치는 드랍에서는 **아무 일도 일어나지 않는다** — 자석이 없으므로
 * 예전처럼 조용히 붙는 경로가 뒤에 남아 있지 않다.
 */
const MIN_OVERLAP_PX = 24;

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
 * 드래그 도중 이만큼 멈춰 있으면 드랍으로 오인할 수 있지만, 그때 일어나는 일은
 * "겹쳐 있으면 선택지가 뜨는 것" 뿐이고 창은 움직이지 않는다 — 손을 다시 움직이면
 * 선택지는 닫히고 세션이 이어진다. 조각난 드래그도 세션이 살아남아 이어진다.
 */
const DROP_SETTLE_MS = 320;

// ── 상태 ──────────────────────────────────────────────────────────────────
let relations: SnapRelation[] = [];
let windowsRef: Map<WindowKey, BrowserWindow> | null = null;
/** 관계가 바뀔 때마다 호출 — 렌더러에 클러스터 소속을 알려 분리 버튼을 띄운다. */
let onSnapsChanged: (() => void) | null = null;
/** 전 창 broadcast — 겹친 드랍의 선택지를 대상 창 렌더러에 보낸다. */
let broadcastFn: ((channel: string, payload: unknown) => void) | null = null;
/** 지금 떠 있는 선택지. 없으면 null. */
let pendingChoice: SnapChoicePrompt | null = null;

/** 프로그램적으로 적용한 setBounds 누적 횟수 — 되먹임 폭주 검증용 계측값. */
let appliedBoundsCount = 0;

/** 드래그 중 클러스터 추종 끄기: RD_SNAP_LIVE=0 */
const LIVE_SNAP = process.env.RD_SNAP_LIVE !== '0';

let draggingKey: WindowKey | null = null;
let dragStart: Electron.Rectangle | null = null;
let dragLastMoveAt = 0;
let dropTimer: NodeJS.Timeout | null = null;
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
 * 클러스터가 작업 영역 밖으로 **더** 나가지 않도록 이동량을 깎는다.
 *
 * [경계는 작업영역이 아니라 "작업영역 ∪ 현재 클러스터"다] 예전에는 작업영역을
 * 그대로 경계로 썼다. 그러면 클러스터가 이미 조금이라도 밖에 걸쳐 있을 때
 * (창을 사용자가 직접 화면 끝으로 옮겨 두는 것은 흔한 일이다) 이동량이 0 이어도
 * `wa.y + wa.height - maxY` 가 음수로 계산되어 **가만히 있는데 클러스터가
 * 끌려 들어왔다.** 리더는 커서를 따라 계속 가는데 팔로워만 반대로 당겨지니
 * 화면에서는 정확히 "둘이 같이 안 움직인다" 로 보인다.
 *
 * 실측(/tmp/dev.log, 2026-08-05T21:52): dictation+patients 클러스터의 아래쪽이
 * 작업영역을 넘어 있어서 이동 이벤트 18개 중 16개가 클램프에 걸렸고,
 * `요청 -173,98 → 클램프 -173,0` 처럼 세로 이동이 통째로 죽었다.
 *
 * 그래서 규칙을 "밖으로 나간 만큼은 그대로 인정하되, 더 나가지는 못한다" 로
 * 바꾼다. 완전히 안에 있는 클러스터에 대해서는 예전과 결과가 같다(경계 = 작업영역).
 * 밖으로 걸친 클러스터는 안쪽으로 들어오는 방향으로는 제한 없이 움직일 수 있고,
 * 바깥으로 더 나가는 방향으로만 멈춘다 — 창을 잃지 않게 한다는 원래 목적은
 * 그대로 지켜진다.
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

  // 이미 넘어선 만큼은 경계를 넓혀 인정한다 (= 강제 교정 금지).
  const left = Math.min(wa.x, minX);
  const right = Math.max(wa.x + wa.width, maxX);
  const top = Math.min(wa.y, minY);
  const bottom = Math.max(wa.y + wa.height, maxY);

  let ndx = dx;
  if (maxX + ndx > right) ndx = right - maxX;
  if (minX + ndx < left) ndx = left - minX;

  let ndy = dy;
  if (maxY + ndy > bottom) ndy = bottom - maxY;
  if (minY + ndy < top) ndy = top - minY;

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


// ── 겹친 드랍: 자동 실행 대신 묻는다 ───────────────────────────────────────

/**
 * 지금 rect 와 실질적으로 겹치는 **다른 unit** 들.
 *
 * 두 축 모두 MIN_OVERLAP_PX 이상 겹쳐야 인정한다 — 변끼리 살짝 파고든 상태는
 * 겹침이 아니라 "붙이려는 중" 이고, 그건 종전대로 자석이 처리한다.
 * 자기 클러스터(같이 움직이는 창들)는 애초에 후보가 아니다.
 */
function overlapTargets(unit: WindowKey, b: Electron.Rectangle): WindowKey[] {
  const own = new Set(clusterOf(unit));
  const hits: WindowKey[] = [];
  for (const other of allUnits()) {
    if (own.has(other)) continue;
    if (!unitVisible(other)) continue;
    const t = unitRect(other);
    if (!t) continue;
    const h = overlapLength(b.x, b.x + b.width, t.x, t.x + t.width);
    const v = overlapLength(b.y, b.y + b.height, t.y, t.y + t.height);
    if (h >= MIN_OVERLAP_PX && v >= MIN_OVERLAP_PX) hits.push(other);
  }
  return hits;
}

/**
 * 선택지를 띄울 대상들. 신호는 두 가지이고 **둘 다 "포개겠다"** 는 뜻이다:
 *
 *   1) rect 가 두 축 모두 MIN_OVERLAP_PX 이상 겹친다.
 *   2) 커서가 상대 창 rect 안이다 — 예전에 탭 머지를 발동시키던 바로 그 신호.
 *
 * 2)를 함께 보는 이유: 커서를 상대 창 안까지 끌고 들어갔는데 rect 겹침은 얕은
 * 경우가 있다(타이틀바 왼쪽 끝을 잡고 밀어 넣기). 예전에는 그 드랍이 머지로
 * 갔으므로, 여기서 빠뜨리면 "머지되던 동작이 말없이 흡착으로 바뀌는" 회귀가 된다.
 */
function choiceTargets(key: WindowKey, b: Electron.Rectangle): WindowKey[] {
  const unit = unitOf(key);
  const hits = new Set(overlapTargets(unit, b));
  const cursorTarget = mergeTargetAtCursor(key);
  if (cursorTarget) {
    const cu = unitOf(cursorTarget);
    if (!clusterOf(unit).includes(cu) && unitVisible(cu)) hits.add(cu);
  }
  return [...hits];
}

function publishChoice(): void {
  broadcastFn?.(IPC.WindowSnapChoiceShow, pendingChoice);
}

/**
 * 선택지를 그리는 창을 z-order 맨 위로 올린다.
 *
 * [왜 필요한가] 선택지는 **대상 창의 렌더러**가 그리는데, 겹쳐 놓은 직후 대상
 * 창은 대개 끌던 창 **아래**에 깔려 있다. 그러면 물어보는 UI 자체가 가려진다
 * (실사용 신고).
 *
 * [왜 moveTop 인가] 대안은 "위에 있는 쪽 창에 그리기" 인데, Electron 은 창들의
 * z-order 를 알려주지 않는다 — 어느 쪽이 위인지 알 수 없으니 신뢰할 수 없다.
 * 반면 moveTop 은 **포커스를 옮기지 않고** 순서만 올린다. 오버레이는 전부
 * alwaysOnTop('screen-saver') 라 같은 레벨 안에서의 재정렬이고, 다른 앱 위로
 * 새로 뛰어오르지 않는다. 키보드 포커스는 그대로 있으므로 타이핑 흐름이 끊기지
 * 않는다(이 기능의 제약 조건).
 *
 * 되돌릴 상태가 없다 — 레벨을 바꾸지 않고 순서만 올리므로 닫을 때 복구할 것이
 * 없고, 실패해도 선택지는 그대로 동작한다(가려질 뿐).
 */
function raiseChoiceWindow(target: WindowKey): void {
  const w = win(target);
  if (!w || !w.isVisible()) return;
  // moveTop 은 bounds 를 바꾸지 않지만, 이 호출이 만드는 어떤 이동 이벤트도
  // 사용자 드래그로 오해되지 않도록 다른 프로그램적 창 조작과 같은 가드를 쓴다.
  withAppliedBounds(() => w.moveTop());
}

/**
 * 선택지를 닫는다 (Esc / 바깥 클릭 / 새 드래그 시작 / 창이 사라짐).
 * 아무것도 실행하지 않는다 — 창은 놓인 자리에 그대로 남는다.
 */
export function cancelSnapChoice(): void {
  if (!pendingChoice) return;
  pendingChoice = null;
  publishChoice();
}

/** 지금 선택지가 떠 있는가 (진단/테스트용). */
export function getPendingSnapChoice(): SnapChoicePrompt | null {
  return pendingChoice ? { ...pendingChoice } : null;
}

function showSnapChoice(dragged: WindowKey, target: WindowKey): void {
  // 대상은 unit 대표가 아니라 **지금 보이는 창** 이어야 한다 — 선택지를 그리는
  // 것은 그 창의 렌더러이고, 숨은 탭은 아무것도 그릴 수 없다.
  const targetWin = visibleTabOf(target);
  pendingChoice = {
    dragged: dragged as OverlayKey,
    target: targetWin as OverlayKey,
    canMerge: canMerge(dragged, targetWin)
  };
  // 먼저 위로 올리고 나서 알린다 — 렌더러가 그리는 순간 이미 보이는 상태다.
  raiseChoiceWindow(targetWin);
  publishChoice();
}

/**
 * 사용자가 고른 동작 하나를 실행한다.
 *
 * 배치 규칙: 고른 변에 간격 0 으로 붙이고 **앞쪽 변을 맞춘다** — 좌/우로 붙이면
 * 위쪽 변을, 위/아래로 붙이면 왼쪽 변을 상대에 맞춘다(읽는 방향의 시작점이라
 * 사람이 "줄이 맞았다" 고 느끼는 기준선). 크기는 절대 바꾸지 않는다 — 오버레이마다
 * 의도된 높이/폭이 다르므로(dock 130 vs diagnosis 460) 맞추면 정보가 잘린다.
 */
export function applySnapChoice(
  dragged: WindowKey,
  target: WindowKey,
  action: SnapChoiceAction
): void {
  const expected = pendingChoice;
  pendingChoice = null;
  publishChoice();
  // 늦게 도착한 클릭(이미 다른 선택지가 떴거나 취소됨)은 버린다.
  if (!expected || expected.dragged !== dragged || expected.target !== target) return;

  // 남아 있는 드래그 세션을 먼저 끝낸다. 여기서 창을 옮기고 나면 옛 세션의
  // 시작점 기준으로는 "사용자가 창을 크게 끌었다" 로 보이고, 뒤이어 오는 헛
  // 이동 이벤트 하나가 그 세션을 되살려 원치 않는 흡착을 만든다.
  resetDrag();

  if (action === 'merge') {
    if (!canMerge(dragged, target)) return;
    mergeWindows(dragged, target);
    return;
  }

  const unit = unitOf(dragged);
  const b = unitRect(unit);
  const t = unitRect(unitOf(target));
  if (!b || !t) return;

  // 방향은 **드래그한 창이 놓일 자리**. edge 는 "내 어느 변이 상대에 닿는가" 라
  // 반대가 된다 (위에 놓이면 내 아래 변이 닿는다).
  const plan: Record<
    Exclude<SnapChoiceAction, 'merge'>,
    { edge: SnapEdge; x: number; y: number }
  > = {
    top: { edge: 'bottom', x: t.x, y: t.y - b.height },
    bottom: { edge: 'top', x: t.x, y: t.y + t.height },
    left: { edge: 'right', x: t.x - b.width, y: t.y },
    right: { edge: 'left', x: t.x + t.width, y: t.y }
  };
  const p = plan[action];

  moveCluster(dragged, b, p.x - b.x, p.y - b.y);
  relations.push({ a: unit, b: unitOf(target), edge: p.edge });
  persist();
  debugWrite([
    `[snap] ${new Date().toISOString()} 선택 적용 ${unit} → ${unitOf(target)} ` +
      `(${action}, edge=${p.edge}) 위치=${p.x},${p.y}`
  ]);
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
    // 클러스터 이동을 끝낸 자리에서 다른 창과 겹쳐 있으면 선택지를 띄운다.
    // (예전에는 붙어 있는 창도 커서만 상대 창 안이면 곧바로 머지됐다 — 그 길이
    //  사라지면 "붙은 창은 합칠 수 없다" 는 조용한 기능 상실이 된다.)
    const after = win(key)?.getBounds();
    const clusterHits = after ? choiceTargets(key, after) : [];
    if (clusterHits.length === 1) {
      showSnapChoice(key, clusterHits[0]);
      decide(`선택지 표시 — 클러스터 이동 후 ${clusterHits[0]} 과 겹침`);
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

  // ── 겹쳐 놓았으면 실행하지 않고 묻는다 ─────────────────────────────────
  const hits = choiceTargets(key, current);
  if (hits.length === 1) {
    showSnapChoice(key, hits[0]);
    decide(`선택지 표시 — ${unit} 이 ${hits[0]} 과 겹침 (자동 실행 없음)`);
    // 창을 옮기지 않았으므로 세션은 그대로 둔다('keep') — 천천히 조준하는
    // 조각난 드래그가 같은 시작점에서 계속 거리를 쌓을 수 있어야 한다.
    endDragSession('keep', key);
    return;
  }
  if (hits.length > 1) {
    // 무엇에 붙일지 사람도 모르는 상태다 — 임의로 고르지 않는다.
    cancelSnapChoice();
    decide(`아무것도 하지 않음 — 겹친 창이 여럿 [${hits.join(',')}]`);
    endDragSession('keep', key);
    return;
  }

  // 겹치지 않았다 = 아무 일도 일어나지 않는다. 자동 흡착은 존재하지 않는다.
  decide('아무것도 하지 않음 — 겹친 창 없음 (자동 흡착 없음)');
  endDragSession('keep', key);
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
  // 다시 끌기 시작했다 = 앞선 선택지에 대한 답은 "안 할래" 다. 떠 있는 채로
  // 두면 방금 옮긴 위치와 맞지 않는 선택지를 실행하게 된다.
  cancelSnapChoice();
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
  }
  dragLastMoveAt = Date.now();
  if (live && dragDistance(key) >= DRAG_DISTANCE_PX) {
    // 이미 붙어 있는 unit 만 따라 움직인다 (자석은 없다).
    liveFollow(key);
  }
  scheduleDrop();
}

/** 드랍 판정을 뒤로 민다. 이동 이벤트가 올 때마다 다시 밀린다. */
function scheduleDrop(): void {
  if (dropTimer) clearTimeout(dropTimer);
  dropTimer = setTimeout(finishDrag, DROP_SETTLE_MS);
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
  // 선택지의 두 당사자 중 하나가 사라지면(닫힘/숨김/최소화) 선택지도 의미가 없다.
  const dismissIfInvolved = (): void => {
    if (pendingChoice?.dragged === key || pendingChoice?.target === key) {
      cancelSnapChoice();
    }
  };
  w.on('hide', dismissIfInvolved);
  w.on('minimize', dismissIfInvolved);
  w.on('closed', () => {
    dismissIfInvolved();
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
  /** 겹친 드랍의 선택지를 대상 창 렌더러에 보내는 통로. */
  broadcast?: (channel: string, payload: unknown) => void;
}): void {
  windowsRef = opts.windows;
  onSnapsChanged = opts.onSnapsChanged ?? null;
  broadcastFn = opts.broadcast ?? null;
  pendingChoice = null;
  relations = [];
  appliedBoundsCount = 0;
  resetDrag();
}
