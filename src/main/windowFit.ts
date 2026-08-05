import { screen, type BrowserWindow } from 'electron';
import { saveBounds, type WindowKey } from './store.js';

/**
 * 내용에 맞춘 창 높이 (content fit).
 *
 * Dock 은 구독 배너(로그인 필요 / 체험 만료 / 결제 실패)가 상태에 따라 나타났다
 * 사라진다. 그래서 defaultHeight 같은 **상수는 어떤 값을 골라도 어느 한 상태에서
 * 틀린다** — 배너에 맞추면 평소에 빈 칸이 남고, 평소에 맞추면 배너가 잘린다.
 * 렌더러가 실제 레이아웃에서 잰 높이를 그대로 창에 반영하는 편이 유일하게 옳다.
 *
 * [왜 팝오버용 tempExpand 를 재사용하지 않는가]
 * tempExpand 는 **일시 확장**이다: enter 시점의 bounds 를 기억해 두고 leave 에서
 * 되돌리는 스택이며 depth 가 0 이 되어야 끝난다. Dock 의 내용 높이는 일시적인
 * 것이 아니라 그 창의 *자연 높이*라서 짝이 되는 leave 가 존재하지 않는다.
 * 억지로 얹으면 (a) depth 를 영구히 1 이상 물고 있어야 하고, (b) 그 상태에서
 * 팝오버가 열렸다 닫히면 depth 가 0 이 아니라 1 로 떨어져 아무것도 복귀하지 않고,
 * (c) 기억된 prev 높이가 "잘린 높이" 로 영영 굳는다. 그래서 되돌리지 않는 별도의
 * 영구 경로를 둔다. 두 경로는 아래 훅으로 서로를 명시적으로 존중한다.
 */

interface ContentFitState {
  /** 우리가 마지막으로 적용한 높이 — 사용자 조작 감지 기준선. */
  appliedHeight: number;
  /** 사용자가 직접 높이를 바꿨다. 이후로는 잘릴 때만 키우고 줄이지 않는다. */
  userSized: boolean;
}

export interface WindowFitDeps {
  /** 이 창이 지금 팝오버 때문에 일시 확장 중인가. */
  isTempExpanded: (win: BrowserWindow) => boolean;
  /**
   * 일시 확장 중일 때 "확장이 끝나면 돌아갈 높이" 를 새 자연 높이로 갱신한다.
   * 사용자가 확장 중 직접 크기를 정했으면 구현부가 무시해야 한다.
   */
  noteNaturalHeightWhileExpanded: (win: BrowserWindow, height: number) => void;
  /** 이 창의 저장 키 (없으면 저장하지 않는다). */
  windowKeyOf: (win: BrowserWindow) => WindowKey | null;
}

let deps: WindowFitDeps | null = null;
const states = new Map<number, ContentFitState>();

export function initWindowFit(d: WindowFitDeps): void {
  deps = d;
  states.clear();
}

/** 테스트/재시작용 — 창이 사라졌을 때 상태를 버린다. */
export function forgetWindowFit(win: BrowserWindow): void {
  states.delete(win.id);
}

/**
 * 창 높이를 렌더러가 잰 내용 높이(needed)에 맞춘다. 폭은 건드리지 않는다.
 *
 * 규칙:
 * - 사용자가 손으로 크기를 바꾼 적이 없으면 needed 에 정확히 맞춘다(늘리고 줄인다).
 * - 사용자가 바꾼 적이 있으면 **줄이지 않는다.** 내용이 잘릴 때만 키운다 —
 *   사용자의 선택을 덮어쓰지 않으면서 잘림(이 결함의 본체)은 막는다.
 * - 작업 영역을 넘지 않는다. 아래로 삐져나가면 위로 당긴다.
 *
 * @returns 실제로 창 크기를 바꿨으면 true.
 */
export function fitWindowToContent(win: BrowserWindow, needed: number): boolean {
  if (win.isDestroyed()) return false;
  if (!Number.isFinite(needed) || needed <= 0) return false;

  const cur = win.getBounds();
  const wa = screen.getDisplayMatching(cur).workArea;
  const minH = win.getMinimumSize()[1] ?? 0;
  // 작업 영역보다 커질 수는 없다. 여백 16px 은 화면에 딱 붙는 것을 피하려는 값.
  const want = Math.max(minH, Math.min(Math.round(needed), wa.height - 16));

  // 팝오버로 일시 확장 중이면 지금 크기를 건드리지 않는다. 대신 "복귀할 높이"를
  // 새 자연 높이로 갱신해 둔다 — 팝오버가 닫힐 때 잘린 옛 높이로 돌아가지 않게.
  if (deps?.isTempExpanded(win)) {
    deps.noteNaturalHeightWhileExpanded(win, want);
    return false;
  }

  const existing = states.get(win.id);
  if (!existing) {
    // 첫 측정 이전에 창이 사용자 손을 탔는지는 알 수 없으므로 첫 측정은 항상
    // 그대로 적용한다. 이후의 'resized' 만 사용자 조작으로 센다.
    states.set(win.id, { appliedHeight: want, userSized: false });
    win.on('resized', () => {
      const s = states.get(win.id);
      if (!s || win.isDestroyed()) return;
      if (win.getBounds().height !== s.appliedHeight) s.userSized = true;
    });
  } else if (existing.userSized && cur.height >= want) {
    return false; // 사용자가 정한(넉넉한) 높이 — 줄이지 않는다.
  }

  const state = states.get(win.id);
  if (state) state.appliedHeight = want;
  if (cur.height === want) return false;

  let y = cur.y;
  if (y + want > wa.y + wa.height) y = wa.y + wa.height - want;
  if (y < wa.y) y = wa.y;
  const next = { x: cur.x, y, width: cur.width, height: want };
  win.setBounds(next);
  // 프로그램적 setBounds 는 'resized' 를 발생시키지 않으므로 직접 저장한다.
  const key = deps?.windowKeyOf(win) ?? null;
  if (key) saveBounds(key, next);
  return true;
}
