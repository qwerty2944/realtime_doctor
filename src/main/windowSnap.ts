import { BrowserWindow, screen } from 'electron';
import { saveBounds, store, type WindowKey } from './store.js';
import { groupOf, isMergePending } from './windowGroups.js';

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
 * ── 스냅 vs 탭 머지 경계 ────────────────────────────────────────────────
 * windowGroups.ts 의 탭 머지는 "드랍 시점 커서가 다른 창 rect 안"일 때
 * 발동한다. 커서는 드래그 중인 창의 타이틀바 위에 있으므로 그 조건은
 * 반드시 두 창 rect 의 겹침을 동반한다. 그래서 스냅은 정반대 조건 —
 * **두 rect 가 전혀 겹치지 않을 때만** 발동하도록 정의한다. 두 기능의
 * 발동 조건이 논리적으로 배타적이라 한 드랍이 둘 다 트리거할 수 없다.
 * 안전장치로 isMergePending() 도 확인해 머지가 예약된 드랍은 건너뛴다.
 *
 * ── 드래그 중에는 아무 창도 프로그램적으로 움직이지 않는다 ──────────────
 * OS 의 네이티브 드래그 루프(Windows 의 WM_ENTERSIZEMOVE 모달 루프) 안에서
 * setBounds 를 부르면 이벤트 되먹임과 끊김이 생긴다. 따라서 따라오는 창들은
 * **드랍 시점에 한 번만** 옮긴다. 대신 드래그 중 화면은 끌던 창만 움직이고
 * 나머지는 드랍 순간 따라붙는다 (의도된 트레이드오프).
 */

export type SnapEdge = 'left' | 'right' | 'top' | 'bottom';

/** a 의 `edge` 쪽 변이 b 에 붙어 있다. 클러스터 판정에는 방향이 무의미하다. */
export interface SnapRelation {
  a: WindowKey;
  b: WindowKey;
  edge: SnapEdge;
}

// ── 임계값 ────────────────────────────────────────────────────────────────
/**
 * 붙는 거리. 드랍 시점 두 변 사이 간격이 이 이하면 흡착한다.
 * 마우스 손떨림(수 px)보다 넉넉하고, 의도치 않은 이웃을 잡아채기엔 작다.
 */
const ENGAGE_PX = 24;
/** 맞닿는 변이 최소 이만큼은 겹쳐야 한다. 모서리만 스친 대각선 흡착 방지. */
const MIN_SHARE_PX = 24;
/** 수직축 정렬(예: 오른쪽에 붙일 때 위쪽 맞추기) 허용 오차. */
const ALIGN_PX = 24;

/** 사용자 드래그로 인정할 최소 move 이벤트 수 (windowGroups 와 동일 규율). */
const DRAG_MOVE_THRESHOLD = 4;
/**
 * 'moved' 가 오지 않는 플랫폼용 드랍 판정 디바운스.
 * windowGroups 의 250ms 보다 길게 잡아 머지 판정이 항상 먼저 끝나게 한다.
 */
const DROP_DEBOUNCE_MS = 320;

// ── 상태 ──────────────────────────────────────────────────────────────────
let relations: SnapRelation[] = [];
let windowsRef: Map<WindowKey, BrowserWindow> | null = null;
/** 관계가 바뀔 때마다 호출 — 렌더러에 클러스터 소속을 알려 분리 버튼을 띄운다. */
let onSnapsChanged: (() => void) | null = null;

/** 프로그램적 setBounds 중임을 알리는 가드 (windowGroups.applyingBounds 와 동일 규율). */
let applyingBounds = 0;
/** 프로그램적으로 적용한 setBounds 누적 횟수 — 되먹임 폭주 검증용 계측값. */
let appliedBoundsCount = 0;

let draggingKey: WindowKey | null = null;
let dragStart: Electron.Rectangle | null = null;
let dragMoveCount = 0;
let dropTimer: NodeJS.Timeout | null = null;

function win(key: WindowKey): BrowserWindow | null {
  const w = windowsRef?.get(key);
  return w && !w.isDestroyed() ? w : null;
}

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
    set.add(r.a);
    set.add(r.b);
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
  applyingBounds += 1;
  appliedBoundsCount += 1;
  try {
    w.setBounds(bounds);
  } finally {
    applyingBounds -= 1;
  }
  // 프로그램적 setBounds 는 'moved'/'resized' 를 발생시키지 않으므로
  // windows.ts 의 persist 핸들러에 기대지 않고 직접 저장한다 (M5 와 같은 이유).
  saveBounds(key, bounds);
}

// ── 클러스터 그래프 ────────────────────────────────────────────────────────

/** key 와 스냅으로 연결된 모든 창 (자기 자신 포함). 사슬을 따라 전파한다. */
export function clusterOf(key: WindowKey): WindowKey[] {
  const seen = new Set<WindowKey>([key]);
  const queue: WindowKey[] = [key];
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

function hasRelation(key: WindowKey): boolean {
  return relations.some((r) => r.a === key || r.b === key);
}

/** 지정한 창들의 스냅 관계를 모두 끊는다. 탭 그룹 편입/레이아웃 적용 시 사용. */
export function dropSnapsFor(keys: WindowKey[]): void {
  const set = new Set(keys);
  const before = relations.length;
  relations = relations.filter((r) => !set.has(r.a) && !set.has(r.b));
  if (relations.length !== before) persist();
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
  const members = clusterOf(leader);
  const origin = new Map<WindowKey, Electron.Rectangle>();
  origin.set(leader, leaderOrigin);
  for (const m of members) {
    if (m === leader) continue;
    const b = win(m)?.getBounds();
    if (b) origin.set(m, b);
  }

  const wa = screen.getDisplayMatching({
    ...leaderOrigin,
    x: leaderOrigin.x + dx,
    y: leaderOrigin.y + dy
  }).workArea;
  const clamped = clampDelta([...origin.values()], dx, dy, wa);

  for (const [key, b] of origin) {
    const next = { x: b.x + clamped.dx, y: b.y + clamped.dy, width: b.width, height: b.height };
    const cur = win(key)?.getBounds();
    if (cur && cur.x === next.x && cur.y === next.y && cur.width === next.width && cur.height === next.height) {
      continue; // 이미 목표 위치 — 불필요한 setBounds 를 만들지 않는다.
    }
    setBoundsGuarded(key, next);
  }
}

interface EngageResult {
  target: WindowKey;
  edge: SnapEdge;
  x: number;
  y: number;
}

/** 드랍한 창이 흡착할 이웃과 최종 위치를 찾는다. 겹치는 쌍은 후보에서 제외. */
function findEngage(key: WindowKey, b: Electron.Rectangle): EngageResult | null {
  const own = new Set(clusterOf(key));
  let best: (EngageResult & { gap: number }) | null = null;

  for (const [other, w] of windowsRef ?? []) {
    if (own.has(other)) continue;
    if (!w || w.isDestroyed() || !w.isVisible() || w.isMinimized()) continue;
    // 탭 그룹에 속한 창은 스냅에 참여하지 않는다 (아래 finishDrag 와 같은 규칙).
    if (groupOf(other)) continue;
    const t = w.getBounds();
    // 겹치면 탭 머지의 영역이다 — 스냅은 관여하지 않는다.
    if (overlaps(b, t)) continue;

    const vShare = overlapLength(b.y, b.y + b.height, t.y, t.y + t.height);
    const hShare = overlapLength(b.x, b.x + b.width, t.x, t.x + t.width);

    const candidates: Array<{ edge: SnapEdge; gap: number; x: number; y: number }> = [];
    if (vShare >= MIN_SHARE_PX) {
      // 내 오른쪽 변을 상대 왼쪽 변에.
      candidates.push({ edge: 'right', gap: t.x - (b.x + b.width), x: t.x - b.width, y: b.y });
      // 내 왼쪽 변을 상대 오른쪽 변에.
      candidates.push({ edge: 'left', gap: b.x - (t.x + t.width), x: t.x + t.width, y: b.y });
    }
    if (hShare >= MIN_SHARE_PX) {
      candidates.push({ edge: 'bottom', gap: t.y - (b.y + b.height), x: b.x, y: t.y - b.height });
      candidates.push({ edge: 'top', gap: b.y - (t.y + t.height), x: b.x, y: t.y + t.height });
    }

    for (const c of candidates) {
      if (c.gap < 0 || c.gap > ENGAGE_PX) continue;
      // 수직축 정렬: 이미 거의 맞아 있으면 딱 맞춘다. 크기는 절대 바꾸지
      // 않는다 — 오버레이마다 의도된 높이/폭이 다르기 때문(dock 130 vs
      // diagnosis 460). 강제로 맞추면 정보가 잘린다.
      let { x, y } = c;
      if (c.edge === 'right' || c.edge === 'left') {
        if (Math.abs(b.y - t.y) <= ALIGN_PX) y = t.y;
      } else if (Math.abs(b.x - t.x) <= ALIGN_PX) {
        x = t.x;
      }
      if (!best || c.gap < best.gap) best = { target: other, edge: c.edge, x, y, gap: c.gap };
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
  draggingKey = null;
  dragStart = null;
  dragMoveCount = 0;
}

function finishDrag(): void {
  const key = draggingKey;
  const start = dragStart;
  const wasRealDrag = dragMoveCount >= DRAG_MOVE_THRESHOLD;
  resetDrag();
  if (!key || !start || !wasRealDrag) return;

  const w = win(key);
  if (!w) return;
  // 탭 머지가 예약된 드랍은 머지가 가져간다 (경계 규칙 1).
  if (isMergePending(key)) return;
  // 탭 그룹 멤버는 스냅에 참여하지 않는다 — 그룹은 하나의 rect 를 공유하므로
  // 개별 멤버의 스냅 관계는 눈에 보이지 않는 기하가 되어 버린다.
  if (groupOf(key)) return;

  const dropped = w.getBounds();
  const dx = dropped.x - start.x;
  const dy = dropped.y - start.y;

  if (hasRelation(key)) {
    // 붙어 있는 창의 드래그는 언제나 클러스터 통째 이동이다 — 거리 제한 없음.
    // 빼내려면 명시적 분리 동작(detachFromCluster)을 써야 한다.
    moveCluster(key, start, dx, dy);
    return;
  }

  const current = win(key)?.getBounds();
  if (!current) return;
  const engage = findEngage(key, current);
  if (!engage) return;

  // 흡착도 강체 이동으로 적용한다 — key 가 이미 다른 창을 달고 있으면
  // 그 창들도 같이 따라와야 배치가 깨지지 않는다.
  moveCluster(key, current, engage.x - current.x, engage.y - current.y);
  relations.push({ a: key, b: engage.target, edge: engage.edge });
  persist();
}

function onDragTick(key: WindowKey): void {
  if (applyingBounds > 0) return;
  if (draggingKey !== key) {
    // 다른 창의 드래그가 정리되지 않은 채 남아 있으면 먼저 마무리한다.
    if (draggingKey) finishDrag();
    draggingKey = key;
    dragStart = win(key)?.getBounds() ?? null;
    dragMoveCount = 0;
  }
  dragMoveCount += 1;

  // 'moved' 가 오지 않는 플랫폼(win32/linux)용 백스톱. 'moved' 가 오는
  // 플랫폼에서는 finishDrag 가 먼저 타이머를 지우므로 중복 실행되지 않는다.
  if (dropTimer) clearTimeout(dropTimer);
  dropTimer = setTimeout(finishDrag, DROP_DEBOUNCE_MS);
}

export function attachSnapDragHandlers(w: BrowserWindow, key: WindowKey): void {
  // will-move 는 실제 이동 직전에 오므로 드래그 시작 위치를 정확히 잡을 수 있다.
  w.on('will-move', () => onDragTick(key));
  w.on('move', () => onDragTick(key));
  w.on('moved', () => {
    if (applyingBounds > 0) return;
    if (draggingKey !== key) return;
    finishDrag();
  });
  w.on('closed', () => dropSnapsFor([key]));
}

/**
 * 저장된 관계가 지금 기하로도 여전히 성립하는지.
 *
 * 시작 시 레이아웃 프리셋이 창을 흩어 놓았다면 관계는 의미가 없다. 좌표를
 * 다시 맞추는 대신(사용자가 고른 프리셋을 덮어쓰게 된다) 관계를 버린다.
 */
function stillAdjacent(a: WindowKey, b: WindowKey, edge: SnapEdge): boolean {
  const wa = win(a)?.getBounds();
  const wb = win(b)?.getBounds();
  if (!wa || !wb) return false;
  if (overlaps(wa, wb)) return false;
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
  return gap >= 0 && gap <= ENGAGE_PX && share >= MIN_SHARE_PX;
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
      const { a, b, edge } = r as Partial<SnapRelation>;
      if (!a || !b || a === b) continue;
      if (!win(a) || !win(b)) continue;
      if (edge !== 'left' && edge !== 'right' && edge !== 'top' && edge !== 'bottom') continue;
      const dup = relations.some(
        (x) => (x.a === a && x.b === b) || (x.a === b && x.b === a)
      );
      if (dup) continue;
      if (groupOf(a) || groupOf(b)) continue;
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
