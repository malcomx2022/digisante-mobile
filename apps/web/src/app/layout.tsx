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
  // Icônes PNG (Android/Chrome) + apple-touch-icon (iOS « Ajouter à l'écran d'accueil »,
  // qui n'accepte pas le SVG → PNG 180px opaque dérivé de l'icône maskable).
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  // Mode standalone iOS : titre, statut « capable » et barre d'état assortie au thème.
  appleWebApp: {
    capable: true,
    title: 'DigiSanté',
    statusBarStyle: 'black-translucent',
  },
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
