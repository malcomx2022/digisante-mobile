import bundleAnalyzer from '@next/bundle-analyzer';

/** @type {import('next').NextConfig} */

// En-têtes de sécurité (défense clickjacking / MIME-sniffing / fuite de referrer)
// + CSP de base. La CSP autorise explicitement les intégrations légitimes :
// Daily.co (iframe téléconsultation), et un connect-src large (Firebase FCM,
// WebSocket chat) — baseline à resserrer une fois les origines exactes figées.
// 'unsafe-inline'/'unsafe-eval' sur script-src : requis par Next.js (hydratation
// sans nonce ; eval du bundler en dev).
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self' https://*.fedapay.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "frame-src 'self' https://*.daily.co",
  "connect-src 'self' https: wss:",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // La QR (caméra), la téléconsultation (micro) et le SOS (géoloc) sont autorisés
  // sur la même origine ; l'API Payment Request n'est pas utilisée.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self), payment=()' },
];

// Analyseur de bundle (opt-in) : `ANALYZE=true pnpm --filter @digisante/web analyze`
// produit un rapport HTML dans .next/analyze. Désactivé par défaut → AUCUN impact
// sur les builds normaux (dev, CI, production).
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === 'true' });

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@digisante/shared'],
  // Sécurité (CLAUDE.md §4) : retirer les appels `console.*` du bundle de
  // production livré aux navigateurs — ils pourraient exposer des données
  // sensibles (identifiants, chemins, jetons) dans la console cliente. Seul
  // `console.error` est conservé (diagnostic d'erreur, sans fuite volontaire).
  // En développement, tous les logs restent disponibles.
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error'] } : false,
  },
  // PWA / offline-first : brancher next-pwa ou un service worker custom ici.
  // L'offline-first n'est pas optionnel (cf. CLAUDE.md §3).
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // Proxy /api → API Fastify, activé UNIQUEMENT si E2E_API_PROXY est défini
  // (tests e2e). Objectif : reproduire la topologie de PRODUCTION, où Nginx sert
  // le web et l'API sous UNE SEULE origine. Sans ça, un e2e en http sur deux
  // ports distincts se fait bloquer par notre propre CSP (`connect-src 'self'`),
  // et le cookie de refresh `SameSite=Strict` devient cross-site.
  // Absent des builds normaux (dev, CI classique, production) → aucun impact.
  ...(process.env.E2E_API_PROXY
    ? {
        async rewrites() {
          return [{ source: '/api/:path*', destination: `${process.env.E2E_API_PROXY}/api/:path*` }];
        },
      }
    : {}),
};
export default withBundleAnalyzer(nextConfig);
