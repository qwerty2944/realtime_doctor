/**
 * 프로그램적 setBounds 가드 (windowSnap ↔ windowGroups 공용).
 *
 * 두 모듈 모두 "사용자가 창을 끌었다" 를 창의 'move' 이벤트로 판정한다. 그런데
 * 두 모듈 모두 프로그램적으로 창을 옮기기도 한다(스냅 클러스터 이동, 탭 그룹
 * bounds 동기화). 예전에는 각자 자기 카운터만 들고 있어서, **한쪽이 옮긴 창의
 * 'move' 를 다른 쪽이 사용자 드래그로 오해**할 수 있었다. 탭 그룹이 스냅에
 * 참여하기 전에는 두 모듈이 건드리는 창 집합이 겹치지 않아 드러나지 않았을
 * 뿐이다.
 *
 * 그래서 가드를 프로세스 전역 카운터 하나로 합친다. 누가 옮기든 그 동안 도착한
 * 이동 이벤트는 양쪽 모두에서 무시된다.
 *
 * 카운터인 이유(불리언이 아니라): 중첩 호출이 실제로 일어난다 —
 * windowSnap 의 클러스터 이동이 windowGroups 의 bounds 동기화를 부를 수 있다.
 */

let depth = 0;

/** 지금 프로그램적 setBounds 가 진행 중인가. 이동 이벤트 핸들러의 첫 줄. */
export function isApplyingBounds(): boolean {
  return depth > 0;
}

/** fn 이 도는 동안의 창 이동을 "프로그램적" 으로 표시한다. 예외에도 균형이 맞는다. */
export function withAppliedBounds<T>(fn: () => T): T {
  depth += 1;
  try {
    return fn();
  } finally {
    depth -= 1;
  }
}
