import type { Metadata, Viewport } from 'next';

import { SITE_URL } from '@/lib/site';

import './globals.css';

export const metadata: Metadata = {
  // Set once here so every page's relative og:image / canonical resolves to an
  // absolute URL. Crawlers and answer engines discard relative og:url values.
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'RightHand 사전 문진',
    template: '%s | RightHand 사전 문진',
  },
  description: '진료 전 AI 문진으로 SOAP 초안, 감별진단, 추천 검사를 정리합니다.',
  // favicon.ico is picked up from the file convention in src/app/; these cover
  // the PNG sizes browsers and iOS home-screen prefer.
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Patients are often elderly; do not block pinch zoom.
  maximumScale: 5,
  // Let content extend under the home indicator so env(safe-area-inset-*) works
  // for the fixed-bottom CTA.
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-surface-default text-content-primary">
        {children}
      </body>
    </html>
  );
}
