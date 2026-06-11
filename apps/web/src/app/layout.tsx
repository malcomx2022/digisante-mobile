import type { Metadata, Viewport } from 'next';

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
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
