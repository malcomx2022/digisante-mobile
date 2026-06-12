import type { Metadata, Viewport } from 'next';

import { fontBody, fontDisplay } from '@/lib/fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'DigiSanté Mobile',
  description: 'PWA e-santé pour le Bénin — NEXT IMPACT',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#1F7040',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${fontDisplay.variable} ${fontBody.variable}`}>
      <body>{children}</body>
    </html>
  );
}
