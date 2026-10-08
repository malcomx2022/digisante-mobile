import bundleAnalyzer from '@next/bundle-analyzer';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/** @type {import('next').NextConfig} */

// En-têtes de sécurité (défense clickjacking / MIME-sniffing / fuite de referrer)
// + CSP de base. La CSP autorise explicitement les intégrations légitimes :
// Daily/FCM et WS même origine en production. unsafe-eval réservé au bundler dev.
// unsafe-inline reste nécessaire à l'hydratation Next sans nonce (résiduel X8).
const csp = (development) => [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self' https://*.fedapay.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "frame-src 'self' https://*.daily.co",
  `connect-src 'self' https://*.daily.co wss://*.daily.co https://*.daily-video.com wss://*.daily-video.com https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com${development ? ' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*' : ''}`,
  "worker-src 'self' blob:",
].join('; ');

// CSP DU SERVICE WORKER FCM. Un service worker est régi par la CSP livrée AVEC SON
// SCRIPT : la CSP globale (`script-src 'self'`) bloquait ses `importScripts` depuis
// www.gstatic.com ⇒ SW en échec ⇒ AUCUNE notification en arrière-plan. Le SDK compat
// FCM n'existe que sur ce CDN. Cette entrée, déclarée APRÈS la globale, la remplace
// pour ce seul chemin (Next : pour une même clé, la dernière règle gagne).
const cspFcmServiceWorker = [
  "default-src 'self'",
  "script-src 'self' https://www.gstatic.com",
  "connect-src 'self' https://*.googleapis.com",
  "img-src 'self' data:",
].join('; ');

const securityHeaders = (development) => [
  { key: 'Content-Security-Policy', value: csp(development) },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // La QR (caméra), la téléconsultation (micro) et le SOS (géoloc) sont autorisés
  // sur la même origine ; l'API Payment Request n'est pas utilisée.
  { key: 'Permissions-Policy', value: 'camera=(self "https://*.daily.co"), microphone=(self "https://*.daily.co"), geolocation=(self), payment=()' },
];

// Analyseur de bundle (opt-in) : `ANALYZE=true pnpm --filter @digisante/web analyze`
// produit un rapport HTML dans .next/analyze. Désactivé par défaut → AUCUN impact
// sur les builds normaux (dev, CI, production).
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === 'true' });

const nextConfig = (phase) => ({
  reactStrictMode: true,
  transpilePackages: ['@digisante/shared'],
  // Sécurité (CLAUDE.md §4) : retirer les appels `console.*` du bundle de
  // production livré aux navigateurs — ils pourraient exposer des données
  // sensibles (identifiants, chemins, jetons) dans la console cliente. Seul
  // `console.error` est conservé (diagnostic d'erreur, sans fuite volontaire).
  // En développement, tous les logs restent disponibles.
  compiler: {
    removeConsole: phase === PHASE_DEVELOPMENT_SERVER ? false : { exclude: ['error'] },
  },
  // PWA / offline-first : brancher next-pwa ou un service worker custom ici.
  // L'offline-first n'est pas optionnel (cf. CLAUDE.md §3).
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders(phase === PHASE_DEVELOPMENT_SERVER) },
      { source: '/firebase-messaging-sw.js', headers: [{ key: 'Content-Security-Policy', value: cspFcmServiceWorker }] },
    ];
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
});
// next build/start doivent rester stricts même dans la pile E2E NODE_ENV=test.
export default (phase) => withBundleAnalyzer(nextConfig(phase));
