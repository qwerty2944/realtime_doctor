import { BrowserWindow, screen } from 'electron';
import { randomUUID } from 'node:crypto';
import { IPC, type OverlayKey, type WindowGroupInfo } from '../shared/types.js';
import { isApplyingBounds, withAppliedBounds } from './boundsGuard.js';
import { store, type WindowKey } from './store.js';

/**
 * 창 드래그앤드랍 탭 머지.
 *
 * 사용자가 오버레이 창을 드래그해서 다른 오버레이 창 위에 놓으면 두 창을
 * 하나의 "탭 그룹"으로 합친다. 그룹은 같은 bounds 를 공유하고, 활성 탭의
 * 창만 보이며 나머지 멤버 창은 hide 상태로 React 상태를 유지한 채 대기한다
 * (webContents 를 옮기지 않으므로 각 창의 상태가 그대로 보존됨).
 *
 * - 드랍 판정: 드래그 종료 시점에 마우스 커서가 다른 오버레이 창 위면 머지.
 * - Dock 은 컨트롤 허브라 그룹 대상에서 제외.
 * - 그룹 상태는 electron-store 에 저장되어 재시작 후 복원.
 *
 * ── 스냅과의 관계 ────────────────────────────────────────────────────────
 * 탭 그룹은 rect 하나를 공유하므로 windowSnap 에서는 **unit 하나**로 취급된다
 * (대표 키 = tabs[0] = groupAnchor). 그룹도 스냅에 참여하고 클러스터로 함께
 * 움직인다 — 예전처럼 "그룹이면 스냅 제외" 가 아니다. 그래서 이 모듈은 그룹
 * 구성이 바뀔 때마다 두 가지를 알린다:
 *
 *   onSnapUnitReassign(from, to)   대표가 그룹을 떠났다 → 관계를 넘겨라
 *   onGroupChangedMembers(keys)    구성/기하가 바뀌었다 → 관계를 정규화하라
 *
 * 프로그램적 창 이동 가드는 boundsGuard 로 windowSnap 과 **공유**한다. 두
 * 모듈이 같은 창을 옮기게 됐으므로, 각자 카운터를 들면 한쪽이 옮긴 창의
 * 'move' 를 다른 쪽이 사용자 드래그로 오해한다.
 */

interface Group {
  id: string;
  tabs: WindowKey[];
  active: WindowKey;
}

const GROUPABLE: WindowKey[] = [
  'transcript',
  'diagnosis',
  'terms',
  'questions',
  'summary',
  'dictation',
  'patients'
];

let groups: Group[] = [];
let windowsRef: Map<WindowKey, BrowserWindow> | null = null;
let broadcastFn: ((channel: string, payload: unknown) => void) | null = null;
let onGroupsChangedFn: (() => void) | null = null;
/**
 * 탭 그룹이 새로 구성되면 그 멤버들의 스냅 관계를 끊기 위한 훅.
 * (windowSnap 을 직접 import 하면 순환 참조가 되므로 콜백으로 받는다.)
 */
let onGroupChangedMembersFn: ((keys: WindowKey[]) => void) | null = null;
/**
 * 그룹 대표(tabs[0]) 가 바뀔 때 스냅 관계의 키를 넘겨주기 위한 훅.
 * 스냅은 그룹을 "대표 키 하나" 로 취급하므로, 대표가 그룹을 떠나면 관계가
 * 떠나는 창을 따라가 버린다 — 그 전에 남는 대표로 옮겨야 한다.
 */
let onSnapUnitReassignFn: ((from: WindowKey, to: WindowKey) => void) | null = null;

/** 현재 드래그 중인 창과 머지 후보 타깃. */
let draggingKey: WindowKey | null = null;
let hoverTarget: WindowKey | null = null;
/**
 * 드래그 시작 위치. "사용자 드래그인가" 를 이벤트 개수가 아니라 **누적 변위**로
 * 판정하기 위해 들고 있는다.
 *
 * [왜 개수가 아니라 거리인가] 예전에는 move 이벤트 4개 이상을 요구했다. 그런데
 * 천천히 겨누는 드래그는 손이 멈출 때마다 디바운스에 잘려 조각이 되고, 조각
 * 하나에는 이벤트가 1~3개뿐이라 통째로 버려졌다(실사용 로그 /tmp/dev.log 에
 * "move 가 적다" 가 도배됨). 개수 임계값의 원래 목적 — 프로그램적 setBounds 를
 * 사용자 드래그로 오해하지 않기 — 는 boundsGuard 가 이미 완전히 처리하므로,
 * 남은 판정 기준은 "사용자가 창을 옮길 의도가 있었는가" 하나이고 그건 거리다.
 */
let dragOrigin: Electron.Rectangle | null = null;
/**
 * 사용자 드래그로 인정할 최소 누적 변위(px). 손 떨림/클릭 흔들림과 "창을
 * 옮기려 했다" 의 경계. 첫 move 이벤트가 도착한 지점을 시작점으로 잡으므로
 * 실제 손 이동보다 한 스텝만큼 적게 측정된다 — 그만큼 여유를 두고 낮게 잡았다.
 * 프로그램적 이동은 boundsGuard 가 전부 걸러내므로, 여기서 걸러야 할 것은
 * "변위가 없는 헛 이동 이벤트" 뿐이다.
 */
const DRAG_DISTANCE_PX = 2;
/**
 * 드랍 판정: 마지막 이동 이벤트로부터 이만큼 조용하면 놓은 것으로 본다.
 *
 * macOS 의 'moved' 는 "드래그 끝"에 한 번이 아니라 이동마다 온다(실측:
 * scripts/probe-snap-electron.mjs). 그걸로 즉시 finishDrag 를 하면 매 스텝마다
 * 드래그 상태가 리셋되어 판정이 영영 서지 못한다.
 *
 * windowSnap 의 값보다 짧게 잡아 머지가 항상 먼저 결론난다.
 */
const DROP_SETTLE_MS = 250;
let dropTimer: NodeJS.Timeout | null = null;

function win(key: WindowKey): BrowserWindow | null {
  const w = windowsRef?.get(key);
  return w && !w.isDestroyed() ? w : null;
}

function persist(): void {
  store.set(
    'windowGroups',
    groups.map((g) => ({ id: g.id, tabs: [...g.tabs], active: g.active }))
  );
}

export function getGroupsState(): WindowGroupInfo[] {
  return groups.map((g) => ({
    id: g.id,
    tabs: [...g.tabs] as OverlayKey[],
    active: g.active as OverlayKey
  }));
}

function broadcastState(): void {
  broadcastFn?.(IPC.WindowGroupsState, getGroupsState());
  onGroupsChangedFn?.();
}

function broadcastHover(target: WindowKey | null): void {
  if (hoverTarget === target) return;
  hoverTarget = target;
  broadcastFn?.(IPC.WindowGroupsHover, target);
}

/**
 * 이 드래그가 드랍되면 탭 머지가 일어나는가 (드래그 상태 기준).
 *
 * 주의: 'moved' 핸들러 등록 순서상 windowGroups 의 finishDrag 가 먼저 돌면서
 * draggingKey/hoverTarget 을 이미 비운 뒤에 windowSnap 이 이걸 읽을 수 있다.
 * 그래서 이 함수만으로는 배타성을 보장하지 못한다 — mergeTargetAtCursor 를 함께 쓴다.
 */
export function isMergePending(key: WindowKey): boolean {
  return draggingKey === key && hoverTarget !== null;
}

/**
 * "지금 이 창을 놓으면 머지가 일어나는가" 를 **드래그 상태와 무관하게** 커서와
 * rect 로만 다시 계산한다.
 *
 * windowSnap 이 스냅-머지 우선순위를 판정하는 근거다. 드래그 상태를 보지 않으므로
 * 두 모듈의 이벤트 핸들러 등록 순서가 바뀌어도 답이 달라지지 않는다.
 * 머지가 실제로 성립하는 조건(양쪽 다 GROUPABLE)까지 여기서 확인한다 — dock 처럼
 * 머지 대상이 아닌 창이 스냅을 못 하게 되는 오검출을 막기 위해서다.
 */
export function mergeTargetAtCursor(dragged: WindowKey): WindowKey | null {
  if (!GROUPABLE.includes(dragged)) return null;
  return findHoverTarget(dragged);
}

export function groupOf(key: WindowKey): Group | null {
  return groups.find((g) => g.tabs.includes(key)) ?? null;
}

/** 그룹에 속해 있지만 활성 탭이 아니어서 숨겨져 있어야 하는 창인지. */
export function isHiddenGroupMember(key: WindowKey): boolean {
  const g = groupOf(key);
  return !!g && g.active !== key;
}

/**
 * 그룹의 대표 키. 스냅은 그룹 하나를 이 키 **한 개**로 취급한다.
 *
 * 활성 탭이 아니라 tabs[0] 을 쓰는 이유: 활성 탭은 클릭 한 번에 바뀌므로
 * 대표로 삼으면 탭을 누를 때마다 스냅 관계를 다시 써야 한다. tabs[0] 은 멤버가
 * 드나들 때만 바뀌고, 그 순간은 onSnapUnitReassign 으로 정확히 통지된다.
 */
export function groupAnchor(key: WindowKey): WindowKey | null {
  return groupOf(key)?.tabs[0] ?? null;
}

/** 그룹 멤버 전원(숨은 탭 포함). 그룹이 아니면 null. */
export function groupTabsOf(key: WindowKey): WindowKey[] | null {
  const g = groupOf(key);
  return g ? [...g.tabs] : null;
}

/** 그룹의 지금 보이는 탭. 그룹이 아니면 자기 자신. */
export function visibleTabOf(key: WindowKey): WindowKey {
  return groupOf(key)?.active ?? key;
}

function removeFromGroup(key: WindowKey): void {
  const g = groupOf(key);
  if (!g) return;
  const prevAnchor = g.tabs[0];
  g.tabs = g.tabs.filter((t) => t !== key);
  if (g.active === key) g.active = g.tabs[0];
  if (g.tabs.length < 2) {
    // 1개 남은 그룹은 의미가 없으므로 해체. 남은 창은 현 상태 유지.
    groups = groups.filter((x) => x !== g);
  }
  // 대표가 그룹을 떠났다면 스냅 관계를 남는 대표에게 넘긴다. 그룹은 제자리에
  // 있으므로 관계도 그 자리에 남아야 한다 — 떠나는 창이 들고 가면 안 된다.
  if (prevAnchor === key && g.tabs[0]) onSnapUnitReassignFn?.(key, g.tabs[0]);
}

function showAt(key: WindowKey, bounds: Electron.Rectangle): void {
  const w = win(key);
  if (!w) return;
  withAppliedBounds(() => {
    if (w.isMinimized()) w.restore();
    w.setBounds(bounds);
    w.show();
    w.setAlwaysOnTop(true, 'screen-saver');
    w.focus();
  });
}

/** 탭 클릭 — 그룹 내 활성 창 전환. */
export function activateTab(key: WindowKey): void {
  const g = groupOf(key);
  if (!g || g.active === key) {
    win(key)?.focus();
    return;
  }
  const current = win(g.active);
  const bounds = current?.isVisible()
    ? current.getBounds()
    : win(key)?.getBounds();
  g.active = key;
  if (bounds) showAt(key, bounds);
  for (const t of g.tabs) {
    if (t !== key) win(t)?.hide();
  }
  persist();
  broadcastState();
}

/** 탭 분리 — 그룹에서 빼서 살짝 어긋난 위치의 독립 창으로 되돌린다. */
export function detachTab(key: WindowKey): void {
  const g = groupOf(key);
  if (!g) return;
  const base = win(g.active)?.getBounds() ?? win(key)?.getBounds();
  const wasActive = g.active === key;
  const remainingTabs = g.tabs.filter((t) => t !== key);
  const affected = [...g.tabs];
  removeFromGroup(key); // g.active 갱신 + 1개 남으면 그룹 해체 + 대표 인계까지 처리

  if (base) {
    // 분리해 나간 창이 활성이었다면 남은 탭 중 하나를 원래 자리에 먼저 표시.
    if (wasActive && remainingTabs[0]) showAt(remainingTabs[0], base);

    const wa = screen.getDisplayMatching(base).workArea;
    const offset = 36;
    showAt(key, {
      x: Math.min(base.x + offset, wa.x + wa.width - base.width - 8),
      y: Math.min(base.y + offset, wa.y + wa.height - base.height - 8),
      width: base.width,
      height: base.height
    });
  }
  persist();
  // 분리로 그룹의 rect 소유자가 바뀌었다 — 스냅이 관계를 다시 정규화하게 알린다.
  onGroupChangedMembersFn?.(affected);
  broadcastState();
}

/** dragged 를 target 위에 드랍 — 머지해서 탭 그룹 구성. */
function merge(dragged: WindowKey, target: WindowKey): void {
  if (dragged === target) return;
  if (!GROUPABLE.includes(dragged) || !GROUPABLE.includes(target)) return;
  const targetWin = win(target);
  const draggedWin = win(dragged);
  if (!targetWin || !draggedWin) return;

  const bounds = targetWin.getBounds();

  // 드래그한 창이 다른 그룹의 활성 탭이었다면, 그 그룹의 남은 탭을 드래그
  // 시작 전 위치(= dragged 의 직전 그룹 자리)에 표시해 빈 자리를 메운다.
  const prevGroup = groupOf(dragged);
  if (prevGroup && prevGroup.active === dragged) {
    const nextTab = prevGroup.tabs.find((t) => t !== dragged);
    const prevBounds = win(dragged)?.getBounds();
    removeFromGroup(dragged);
    if (nextTab && prevBounds) showAt(nextTab, prevBounds);
  } else {
    removeFromGroup(dragged);
  }

  let g = groupOf(target);
  if (!g) {
    g = { id: randomUUID(), tabs: [target], active: target };
    groups.push(g);
  }
  // 드랍한 탭은 타깃 바로 뒤에 삽입하고 활성화 (Chrome 탭 도킹과 동일).
  g.tabs.splice(g.tabs.indexOf(target) + 1, 0, dragged);
  g.active = dragged;

  showAt(dragged, bounds);
  for (const t of g.tabs) {
    if (t !== dragged) win(t)?.hide();
  }
  persist();
  // 탭 그룹은 rect 하나를 공유하는 스냅 단위다 — 편입으로 대표와 기하가
  // 바뀌었으니 스냅 관계를 대표 키 기준으로 다시 정규화하게 알린다.
  // (편입된 창이 들고 있던 옛 이웃 관계는 기하 검증에서 걸러진다.)
  onGroupChangedMembersFn?.([...g.tabs, dragged]);
  broadcastState();
}

/** 드래그 중 커서 아래의 머지 후보 창을 찾는다. */
function findHoverTarget(dragged: WindowKey): WindowKey | null {
  const cursor = screen.getCursorScreenPoint();
  for (const key of GROUPABLE) {
    if (key === dragged) continue;
    const w = win(key);
    if (!w || !w.isVisible() || w.isMinimized()) continue;
    const b = w.getBounds();
    if (
      cursor.x >= b.x &&
      cursor.x <= b.x + b.width &&
      cursor.y >= b.y &&
      cursor.y <= b.y + b.height
    ) {
      return key;
    }
  }
  return null;
}

/** 드래그 시작점에서 지금까지의 이동 거리(체비쇼프 — 축 하나만 커도 인정). */
function dragDistance(key: WindowKey): number {
  const cur = win(key)?.getBounds();
  if (!cur || !dragOrigin) return 0;
  return Math.max(Math.abs(cur.x - dragOrigin.x), Math.abs(cur.y - dragOrigin.y));
}

function finishDrag(): void {
  if (dropTimer) {
    clearTimeout(dropTimer);
    dropTimer = null;
  }
  const dragged = draggingKey;
  const target = hoverTarget;
  const wasRealDrag = !!dragged && dragDistance(dragged) >= DRAG_DISTANCE_PX;
  broadcastHover(null);
  if (wasRealDrag && dragged && target) {
    merge(dragged, target);
    // 머지가 창을 옮겼으므로 이 드래그 세션은 여기서 끝이다.
    draggingKey = null;
    dragOrigin = null;
    return;
  }
  // [중요] 조건 미달이어도 세션을 버리지 않는다. 손이 잠깐 멈춘 것과 손을 뗀
  // 것은 창 이벤트만으로 구분할 수 없다. 세션을 남겨 두면 다음 조각이 같은
  // 시작점에서 거리를 계속 누적하므로, 끊어진 드래그가 하나로 이어진다.
  // (세션은 다른 창이 드래그되거나 stale 해질 때 정리된다.)
}

/** 이만큼 조용하면 세션 자체를 버린다 — 오래된 시작점이 되살아나지 않게. */
const DRAG_SESSION_EXPIRE_MS = 4000;
let lastMoveAt = 0;

function onWindowMove(key: WindowKey): void {
  if (isApplyingBounds()) return;
  if (!GROUPABLE.includes(key)) return;
  const stale = Date.now() - lastMoveAt > DRAG_SESSION_EXPIRE_MS;
  if (draggingKey !== key || stale || !dragOrigin) {
    draggingKey = key;
    dragOrigin = win(key)?.getBounds() ?? null;
  }
  lastMoveAt = Date.now();
  scheduleDrop();
  if (dragDistance(key) < DRAG_DISTANCE_PX) return;
  // 그룹 활성 탭을 드래그해서 옮기는 건 "그룹 전체 이동" — 머지 대상 탐색은
  // 하되, 숨은 멤버들은 activate 시점에 bounds 를 따라오므로 별도 동기화 불필요.
  broadcastHover(findHoverTarget(key));
}

/** 드랍 판정을 뒤로 민다. 이동 이벤트가 올 때마다 다시 밀린다. */
function scheduleDrop(): void {
  if (dropTimer) clearTimeout(dropTimer);
  dropTimer = setTimeout(finishDrag, DROP_SETTLE_MS);
}

export function attachGroupDragHandlers(w: BrowserWindow, key: WindowKey): void {
  if (!GROUPABLE.includes(key)) return;
  w.on('move', () => onWindowMove(key));
  // macOS 의 'moved' 는 이동마다 온다 — 즉시 끝내지 않고 판정만 미룬다.
  w.on('moved', () => {
    if (isApplyingBounds()) return;
    if (draggingKey !== key) return;
    scheduleDrop();
  });
}

/**
 * 그룹 멤버 창들의 bounds 를 강제로 맞춘다.
 *
 * 그룹은 같은 bounds 를 공유하는 게 전제인데(activateTab/ showAt), 단축키로
 * 활성 창 하나만 리사이즈하면 숨은 멤버가 옛 크기로 남는다. 리사이즈 직후
 * 이걸 불러 동기화한다. 반환값은 실제로 bounds 를 바꾼 멤버 키 목록 —
 * 호출자가 저장 경로에 태울 수 있게 돌려준다.
 */
export function syncGroupBounds(
  key: WindowKey,
  bounds: Electron.Rectangle
): WindowKey[] {
  const g = groupOf(key);
  if (!g) return [];
  const changed: WindowKey[] = [];
  for (const t of g.tabs) {
    if (t === key) continue;
    const w = win(t);
    if (!w) continue;
    withAppliedBounds(() => w.setBounds(bounds));
    changed.push(t);
  }
  return changed;
}

/** 레이아웃 적용 등 전체 재배치 전에 그룹을 전부 해체한다. */
export function dissolveAllGroups(): void {
  if (groups.length === 0) return;
  groups = [];
  persist();
  broadcastState();
}

/** 시작 시 저장된 그룹 복원 — 활성 탭 bounds 기준으로 멤버를 숨긴다. */
export function restoreGroups(): void {
  const saved = (store.get('windowGroups') ?? []) as Group[];
  groups = [];
  for (const g of saved) {
    if (!Array.isArray(g?.tabs)) continue;
    const tabs = g.tabs.filter(
      (t) => GROUPABLE.includes(t) && !groupOf(t) && win(t)
    );
    if (tabs.length < 2) continue;
    const active = tabs.includes(g.active) ? g.active : tabs[0];
    groups.push({ id: g.id ?? randomUUID(), tabs, active });
  }
  for (const g of groups) {
    const activeWin = win(g.active);
    const bounds = activeWin?.getBounds();
    for (const t of g.tabs) {
      if (t === g.active) continue;
      const w = win(t);
      if (!w) continue;
      if (bounds) withAppliedBounds(() => w.setBounds(bounds));
      w.hide();
    }
  }
  persist();
  onGroupChangedMembersFn?.(groups.flatMap((g) => g.tabs));
  broadcastState();
}

export function initWindowGroups(opts: {
  windows: Map<WindowKey, BrowserWindow>;
  broadcast: (channel: string, payload: unknown) => void;
  onGroupsChanged?: () => void;
  onGroupChangedMembers?: (keys: WindowKey[]) => void;
  onSnapUnitReassign?: (from: WindowKey, to: WindowKey) => void;
}): void {
  windowsRef = opts.windows;
  broadcastFn = opts.broadcast;
  onGroupsChangedFn = opts.onGroupsChanged ?? null;
  onGroupChangedMembersFn = opts.onGroupChangedMembers ?? null;
  onSnapUnitReassignFn = opts.onSnapUnitReassign ?? null;
  draggingKey = null;
  dragOrigin = null;
  hoverTarget = null;
}
