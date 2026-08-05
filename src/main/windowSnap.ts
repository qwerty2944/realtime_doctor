import { BrowserWindow, screen } from 'electron';
import { appendFileSync } from 'node:fs';
import { saveBounds, store, type WindowKey } from './store.js';
import { groupOf, isMergePending, mergeTargetAtCursor } from './windowGroups.js';

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
 * ── 진단 로그 ───────────────────────────────────────────────────────────
 * 화면을 볼 수 없는 환경에서 "왜 안 붙었는지" 를 숫자로 받기 위한 옵트인 로그.
 * 기본은 꺼져 있고, 켜는 방법은 한 줄이다:
 *
 *   RD_SNAP_DEBUG=1 npm run dev        # 기록 위치: /tmp/dev.log
 *
 * (기록 위치를 바꾸려면 RD_SNAP_DEBUG_LOG=/path/to/file)
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

/** 사용자 드래그로 인정할 최소 move 이벤트 수 (windowGroups 와 동일 규율). */
const DRAG_MOVE_THRESHOLD = 4;
/**
 * 드랍 판정: 마지막 이동 이벤트로부터 이만큼 조용하면 드래그가 끝난 것으로 본다.
 *
 * [왜 'moved' 로 즉시 끝내지 않나] macOS 의 'moved' 는 "드래그 한 번의 끝"에
 * 한 번만 오지 않는다. 실측(scripts/probe-snap-electron.mjs)에서는 'move' 하나마다
 * 'moved' 가 뒤따라 왔다 — NSWindowDidMoveNotification 이 이동마다 발생하기
 * 때문이다. 그 신호로 곧바로 finishDrag 를 하면 매 스텝마다 드래그가 리셋되어
 * move 카운트가 영영 DRAG_MOVE_THRESHOLD 에 닿지 못한다. 즉 macOS 에서는 스냅이
 * 조건과 무관하게 **한 번도** 발동할 수 없었다. 그래서 'move'/'moved' 를 모두
 * "아직 움직이는 중" 신호로만 쓰고, 조용해질 때 한 번 판정한다. 플랫폼 분기도
 * 사라진다('moved' 가 없는 win32/linux 도 같은 경로).
 *
 * windowGroups 의 250ms 보다 길게 잡아 머지 판정이 항상 먼저 끝나게 한다.
 * 드래그 도중 이만큼 멈춰 있으면 드랍으로 오인할 수 있지만, 그 경우에도 결과는
 * "이미 흡착 범위 안이던 이웃에 붙는 것" 이라 사용자가 향하던 방향과 어긋나지 않는다.
 */
const DROP_SETTLE_MS = 320;

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

  for (const [other, w] of windowsRef ?? []) {
    if (own.has(other)) continue;
    if (!w || w.isDestroyed()) continue;
    if (!w.isVisible() || w.isMinimized()) {
      trace?.push(`  후보 ${other}: 탈락 — 보이지 않음(hidden/minimized)`);
      continue;
    }
    // 탭 그룹에 속한 창은 스냅에 참여하지 않는다 (아래 finishDrag 와 같은 규칙).
    if (groupOf(other)) {
      trace?.push(`  후보 ${other}: 탈락 — 탭 그룹 멤버`);
      continue;
    }
    const t = w.getBounds();

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
  draggingKey = null;
  dragStart = null;
  dragMoveCount = 0;
}

function finishDrag(): void {
  const key = draggingKey;
  const start = dragStart;
  const moves = dragMoveCount;
  const wasRealDrag = dragMoveCount >= DRAG_MOVE_THRESHOLD;
  resetDrag();
  if (!key || !start) return;

  const trace: string[] = [];
  const log = SNAP_DEBUG ? trace : undefined;
  const decide = (line: string): void => {
    if (!SNAP_DEBUG) return;
    trace.push(`  결정: ${line}`);
    debugWrite(trace);
  };
  log?.push(
    `[snap] ${new Date().toISOString()} 드랍 key=${key} ` +
      `start=${fmtRect(start)} move이벤트=${moves}`
  );

  if (!wasRealDrag) {
    decide(`무시 — 사용자 드래그로 보기엔 move 가 적다 (${moves} < ${DRAG_MOVE_THRESHOLD})`);
    return;
  }

  const w = win(key);
  if (!w) {
    decide('무시 — 창이 사라짐');
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
    return;
  }
  // 탭 그룹 멤버는 스냅에 참여하지 않는다 — 그룹은 하나의 rect 를 공유하므로
  // 개별 멤버의 스냅 관계는 눈에 보이지 않는 기하가 되어 버린다.
  if (groupOf(key)) {
    decide('스냅 안 함 — 끌린 창이 탭 그룹 멤버');
    return;
  }

  const dropped = w.getBounds();
  const dx = dropped.x - start.x;
  const dy = dropped.y - start.y;

  if (hasRelation(key)) {
    // 붙어 있는 창의 드래그는 언제나 클러스터 통째 이동이다 — 거리 제한 없음.
    // 빼내려면 명시적 분리 동작(detachFromCluster)을 써야 한다.
    moveCluster(key, start, dx, dy);
    decide(`클러스터 통째 이동 delta=${dx},${dy} 멤버=[${clusterOf(key).join(',')}]`);
    return;
  }

  const current = win(key)?.getBounds();
  if (!current) {
    decide('무시 — 창이 사라짐');
    return;
  }
  log?.push(`  드랍 bounds=${fmtRect(current)}`);
  const engage = findEngage(key, current, log);
  if (!engage) {
    decide('흡착 없음 — 조건을 통과한 후보가 없다');
    return;
  }

  // 흡착도 강체 이동으로 적용한다 — key 가 이미 다른 창을 달고 있으면
  // 그 창들도 같이 따라와야 배치가 깨지지 않는다.
  moveCluster(key, current, engage.x - current.x, engage.y - current.y);
  relations.push({ a: key, b: engage.target, edge: engage.edge });
  persist();
  decide(`흡착 ${key} → ${engage.target} (edge=${engage.edge}) 위치=${engage.x},${engage.y}`);
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
  scheduleDrop();
}

/** 드랍 판정을 뒤로 민다. 이동 이벤트가 올 때마다 다시 밀린다. */
function scheduleDrop(): void {
  if (dropTimer) clearTimeout(dropTimer);
  dropTimer = setTimeout(finishDrag, DROP_SETTLE_MS);
}

export function attachSnapDragHandlers(w: BrowserWindow, key: WindowKey): void {
  // will-move 는 실제 이동 직전에 오므로 드래그 시작 위치를 정확히 잡을 수 있다.
  w.on('will-move', () => onDragTick(key));
  w.on('move', () => onDragTick(key));
  // macOS 의 'moved' 는 이동마다 오므로 여기서 즉시 끝내지 않는다 —
  // 다른 이동 이벤트와 똑같이 "아직 움직이는 중" 으로 취급하고 판정을 미룬다.
  w.on('moved', () => {
    if (applyingBounds > 0) return;
    if (draggingKey !== key) return;
    scheduleDrop();
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
