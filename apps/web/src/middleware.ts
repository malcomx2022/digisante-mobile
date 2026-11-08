// ─────────────────────────────────────────────────────────────
// CSP à nonce (décision du porteur, 08/11/2026 — ferme le résiduel X8).
//
// Un nonce aléatoire par requête : Next l'applique à ses propres scripts quand il
// le lit dans l'en-tête CSP de la REQUÊTE, d'où le rendu dynamique imposé par le
// layout racine (`connection()`), sinon une page prérendue au build porterait des
// scripts sans nonce. `'strict-dynamic'` : les scripts chargés par un script nonce
// (chunks Next, SDK Daily/Firebase importés dynamiquement) restent autorisés ;
// aucun `'unsafe-inline'` pour les scripts. `'self'` ne sert qu'aux navigateurs
// CSP2 (ignoré par CSP3 en présence de 'strict-dynamic').
//
// Les styles gardent 'unsafe-inline' (attributs style et polices next/font) : la
// décision porte sur l'exécution de scripts, vecteur de l'XSS.
//
// Le shell hors ligne du service worker reste cohérent : une navigation précachée
// est stockée AVEC ses en-têtes, donc avec la CSP du nonce de sa propre réponse.
// ─────────────────────────────────────────────────────────────
import { NextResponse, type NextRequest } from 'next/server';

export function buildCsp(nonce: string, development: boolean): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self' https://*.fedapay.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "frame-src 'self' https://*.daily.co",
    `connect-src 'self' https://*.daily.co wss://*.daily.co https://*.daily-video.com wss://*.daily-video.com https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com${development ? ' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*' : ''}`,
    "worker-src 'self' blob:",
  ].join('; ');
}

/** Nonce de 128 bits en base64 (runtime Edge : Web Crypto, pas de Buffer). */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function middleware(request: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp(nonce, process.env.NODE_ENV === 'development');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Documents HTML seulement : l'API (Fastify/helmet), les fichiers statiques et
  // publics ont leur propre CSP fixe (next.config.mjs). Les préchargements du
  // routeur ne portent pas de document à protéger.
  matcher: [
    {
      source: '/((?!api/|_next/static|_next/image|sw\\.js|firebase-messaging-sw\\.js|offline\\.html|manifest\\.json|icon|apple-touch-icon|favicon).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
