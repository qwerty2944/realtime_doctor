import { BrowserWindow, screen } from 'electron';
import { randomUUID } from 'node:crypto';
import { IPC, type OverlayKey, type WindowGroupInfo } from '../shared/types.js';
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

/** 프로그램이 setBounds 하는 동안 drag 핸들러가 오작동하지 않게 하는 가드. */
let applyingBounds = 0;

/** 현재 드래그 중인 창과 머지 후보 타깃. */
let draggingKey: WindowKey | null = null;
let hoverTarget: WindowKey | null = null;
/**
 * 실제 사용자 드래그는 'move' 이벤트가 연속으로 다수 발생한다. 프로그램적
 * setBounds 는 1~2회로 끝나므로(이벤트가 guard 해제 후 비동기로 도착할 수
 * 있음) 일정 횟수를 넘겨야 드래그로 인정해 오인 머지를 막는다.
 */
let dragMoveCount = 0;
const DRAG_MOVE_THRESHOLD = 4;
/** macOS 외 플랫폼은 'moved' 이벤트가 없어 move 디바운스로 드랍을 판정. */
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

export function groupOf(key: WindowKey): Group | null {
  return groups.find((g) => g.tabs.includes(key)) ?? null;
}

/** 그룹에 속해 있지만 활성 탭이 아니어서 숨겨져 있어야 하는 창인지. */
export function isHiddenGroupMember(key: WindowKey): boolean {
  const g = groupOf(key);
  return !!g && g.active !== key;
}

function removeFromGroup(key: WindowKey): void {
  const g = groupOf(key);
  if (!g) return;
  g.tabs = g.tabs.filter((t) => t !== key);
  if (g.active === key) g.active = g.tabs[0];
  if (g.tabs.length < 2) {
    // 1개 남은 그룹은 의미가 없으므로 해체. 남은 창은 현 상태 유지.
    groups = groups.filter((x) => x !== g);
  }
}

function showAt(key: WindowKey, bounds: Electron.Rectangle): void {
  const w = win(key);
  if (!w) return;
  applyingBounds += 1;
  try {
    if (w.isMinimized()) w.restore();
    w.setBounds(bounds);
    w.show();
    w.setAlwaysOnTop(true, 'screen-saver');
    w.focus();
  } finally {
    applyingBounds -= 1;
  }
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
  removeFromGroup(key); // g.active 갱신 + 1개 남으면 그룹 해체까지 처리

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

function finishDrag(): void {
  if (dropTimer) {
    clearTimeout(dropTimer);
    dropTimer = null;
  }
  const dragged = draggingKey;
  const target = hoverTarget;
  const wasRealDrag = dragMoveCount >= DRAG_MOVE_THRESHOLD;
  draggingKey = null;
  dragMoveCount = 0;
  broadcastHover(null);
  if (wasRealDrag && dragged && target) merge(dragged, target);
}

function onWindowMove(key: WindowKey): void {
  if (applyingBounds > 0) return;
  if (!GROUPABLE.includes(key)) return;
  if (draggingKey !== key) {
    draggingKey = key;
    dragMoveCount = 0;
  }
  dragMoveCount += 1;
  if (dragMoveCount < DRAG_MOVE_THRESHOLD) return;
  // 그룹 활성 탭을 드래그해서 옮기는 건 "그룹 전체 이동" — 머지 대상 탐색은
  // 하되, 숨은 멤버들은 activate 시점에 bounds 를 따라오므로 별도 동기화 불필요.
  broadcastHover(findHoverTarget(key));

  // win32/linux 에는 'moved'(드래그 종료) 이벤트가 없어 디바운스로 대체.
  if (process.platform !== 'darwin') {
    if (dropTimer) clearTimeout(dropTimer);
    dropTimer = setTimeout(finishDrag, 250);
  }
}

export function attachGroupDragHandlers(w: BrowserWindow, key: WindowKey): void {
  if (!GROUPABLE.includes(key)) return;
  w.on('move', () => onWindowMove(key));
  // macOS: 'moved' 가 드래그 한 번이 끝날 때 1회 발생.
  w.on('moved', () => {
    if (applyingBounds > 0) return;
    if (draggingKey !== key) return;
    finishDrag();
  });
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
      if (bounds) {
        applyingBounds += 1;
        try {
          w.setBounds(bounds);
        } finally {
          applyingBounds -= 1;
        }
      }
      w.hide();
    }
  }
  persist();
  broadcastState();
}

export function initWindowGroups(opts: {
  windows: Map<WindowKey, BrowserWindow>;
  broadcast: (channel: string, payload: unknown) => void;
  onGroupsChanged?: () => void;
}): void {
  windowsRef = opts.windows;
  broadcastFn = opts.broadcast;
  onGroupsChangedFn = opts.onGroupsChanged ?? null;
}
