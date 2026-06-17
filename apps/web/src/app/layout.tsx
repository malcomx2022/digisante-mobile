import type { Metadata, Viewport } from 'next';

import { AuthProvider } from '@/auth/AuthProvider';
import { OfflineBanner } from '@/components/pwa/OfflineBanner';
import { PwaRegister } from '@/components/pwa/PwaRegister';
import { LocaleProvider } from '@/i18n/LocaleProvider';
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
  // Étend le contenu sous les encoches ; combiné à `.pb-safe` pour la zone sûre.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${fontDisplay.variable} ${fontBody.variable}`}>
      <body>
        <LocaleProvider>
          <AuthProvider>
            <PwaRegister />
            <OfflineBanner />
            {children}
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
