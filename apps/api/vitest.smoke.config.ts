// ─────────────────────────────────────────────────────────────
// Smoke tests FOURNISSEURS — appels RÉELS vers Twilio / Daily / Firebase / Resend.
// Opt-in strict : chaque fichier ne s'exécute que si sa variable `SMOKE_<PROVIDER>=1`
// est posée (sinon skippé), et ce fichier de config n'est lu que par
// `pnpm --filter @digisante/api test:smoke`. `pnpm test` les EXCLUT (vitest.config.ts).
//
// Les identifiants sont résolus comme en production (base chiffrée → `.env`) : lancer
// sur l'environnement cible, avec son DATABASE_URL/REDIS_URL/HEALTH_ENCRYPTION_KEY.
// Aucun secret, numéro complet ni jeton n'est affiché (lib/redact).
// ─────────────────────────────────────────────────────────────
import { defineConfig } from 'vitest/config';

import base from './vitest.config';

// Pas de mergeConfig : il CONCATÈNE les tableaux `exclude`, et celui de la config
// de base exclut justement les smoke tests. On reprend la base et on remplace `test`.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['src/**/*.smoke.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 60_000,
  },
});
