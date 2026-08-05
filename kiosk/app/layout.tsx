import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: '사전 문진',
  description: '진료 전 문진을 도와드립니다.',
  // 대기실 태블릿이 검색엔진에 노출될 이유가 없다.
  robots: { index: false, follow: false }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 확대는 허용한다(고령 환자에게 필요할 수 있다). 다만 자동 확대는 막는다.
  maximumScale: 5
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
