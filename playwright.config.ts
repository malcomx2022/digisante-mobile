import { defineConfig, devices } from '@playwright/test';

// ─────────────────────────────────────────────────────────────
// Tests e2e — pile RÉELLE (web Next.js + API Fastify + Postgres + Redis).
// Volontairement en `start` et non `dev` : on teste ce qui est déployé.
//
// TOPOLOGIE — le web PROXIFIE l'API (`/api/*` → Fastify) via une rewrite Next
// activée par `E2E_API_PROXY`. Ce n'est pas un artifice de test : c'est la
// topologie de PRODUCTION, où Nginx sert le web et l'API sous UNE SEULE origine.
// Deux raisons impératives, découvertes en montant ces tests :
//   1. notre propre CSP (`connect-src 'self' https: wss:`) BLOQUE un appel `http://`
//      vers une autre origine — un e2e web:3000 → api:3011 est refusé par le
//      navigateur avant même de partir ;
//   2. le cookie de refresh `SameSite=Strict` deviendrait cross-site.
// Le client appelle donc `/api/v1/...` en relatif (`NEXT_PUBLIC_API_URL` vide).
//
// ⚠️ PIÈGE — `NEXT_PUBLIC_*` est inliné et les rewrites sont figées AU BUILD.
// Les poser dans `webServer.env` ne suffit PAS : le web doit être CONSTRUIT avec.
//
//   NEXT_PUBLIC_API_URL= E2E_API_PROXY=http://127.0.0.1:3011 pnpm build
//   pnpm test:e2e
//
// ⚠️ PIÈGE — tout sur `127.0.0.1`, jamais `localhost` : ce dernier peut résoudre
// en `::1` (IPv6) côté Chromium alors que l'API n'écoute que sur `127.0.0.1`.
//
// Les e2e NE SONT PAS dans `pnpm test` (qui reste `pnpm -r test`, sans serveur) :
// ils exigent une pile démarrée, d'où un script et un job CI séparés.
// ─────────────────────────────────────────────────────────────
const WEB = 'http://127.0.0.1:3000';
const API_PORT = process.env.E2E_API_PORT ?? '3011';
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;

// `NODE_ENV=test` côté API : rate-limit désactivé, config permissive, et surtout
// `devCode` exposé dans la réponse d'OTP (`auth.service.ts`) — sans quoi aucun
// test ne pourrait franchir l'authentification par SMS. Jamais vrai en production.
// Base Redis dédiée (…/2) pour ne pas marcher sur les tests d'intégration (…/1).
const apiEnv: Record<string, string> = {
  NODE_ENV: 'test',
  API_PORT,
  API_HOST: '127.0.0.1',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://digisante:devpassword@localhost:5434/digisante?schema=public',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6380/2',
  JWT_SECRET: process.env.JWT_SECRET ?? 'e2e-secret-at-least-32-characters-long-xx',
  // Le navigateur ne parle qu'au web (même origine) ; l'API ne voit que le proxy.
  CORS_ORIGIN: WEB,
};

export default defineConfig({
  testDir: './e2e',
  // Les scénarios partagent la base : pas de parallélisme.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Cible réelle du produit : smartphone d'entrée de gamme, pas un desktop.
    ...devices['Pixel 5'],
  },

  projects: [{ name: 'chromium-mobile' }],

  webServer: [
    {
      command: 'pnpm --filter @digisante/api start',
      url: `${API_ORIGIN}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: apiEnv,
    },
    {
      command: 'pnpm --filter @digisante/web start',
      url: WEB,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { E2E_API_PROXY: API_ORIGIN, NEXT_PUBLIC_API_URL: '' },
    },
  ],
});
