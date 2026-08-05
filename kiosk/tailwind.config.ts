import type { Config } from 'tailwindcss';

/**
 * 환자는 대부분 고령이다. 기본 타이포 스케일을 통째로 키우는 대신
 * 컴포넌트에서 큰 값(text-xl 이상)을 직접 쓰고, 여기서는 터치 타깃 최소치만
 * 유틸리티로 제공한다 — 스케일을 바꾸면 Tailwind 문서와 어긋나서
 * 나중에 화면을 고칠 때 오히려 헷갈린다.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      minHeight: {
        touch: '3.5rem'
      },
      minWidth: {
        touch: '3.5rem'
      }
    }
  },
  plugins: []
};

export default config;
