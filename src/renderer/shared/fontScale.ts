import { clampFontScale } from '../../shared/types';

/**
 * 전역 글씨 배율 적용기.
 *
 * main 이 단축키로 배율을 바꾸면 전 창에 broadcast 하고, 각 렌더러는 :root 의
 * --font-scale 만 갈아끼운다 (globals.css 의 html { font-size: calc(16px * var(--font-scale)) }).
 * 나중에 뜬 창은 get() 으로 현재 값을 직접 채운다.
 */
function apply(scale: number): void {
  document.documentElement.style.setProperty(
    '--font-scale',
    String(clampFontScale(scale))
  );
}

/** 각 창의 main.tsx 진입점에서 1회 호출. 반환값은 구독 해제 함수. */
export function initFontScale(): () => void {
  window.api.fontScale
    .get()
    .then(apply)
    .catch(() => {
      // 값을 못 읽어도 CSS 기본값(1) 로 동작하므로 조용히 무시하지 않고 로그만 남긴다.
      console.warn('[fontScale] 초기 배율을 불러오지 못했습니다.');
    });
  return window.api.fontScale.onChange(apply);
}
