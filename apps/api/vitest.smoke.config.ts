// ─────────────────────────────────────────────────────────────
// Smoke tests FOURNISSEURS — appels RÉELS vers FedaPay sandbox / Twilio / Daily / Firebase / Resend.
// Opt-in strict : un seul fournisseur, métadonnées L10 et SHA exact exigés avant DB.
// Voir docs/CONTRAT_Preproduction_L10.md ; ce fichier de config est lu par
// `pnpm --filter @digisante/api test:smoke`. `pnpm test` les EXCLUT (vitest.config.ts).
//
// Les identifiants sont résolus comme en production (base chiffrée → `.env`) : lancer
// sur l'environnement cible, avec son DATABASE_URL/REDIS_URL/HEALTH_ENCRYPTION_KEY.
// Aucun secret, numéro complet ni jeton n'est affiché (lib/redact).
// ─────────────────────────────────────────────────────────────
import { defineConfig } from 'vitest/config';

import base from './vitest.config';
import { selectedSmokeFiles } from '../../scripts/preproduction/smoke-guard.mjs';

// Pas de mergeConfig : il CONCATÈNE les tableaux `exclude`, et celui de la config
// de base exclut justement les smoke tests. On reprend la base et on remplace `test`.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: selectedSmokeFiles(process.env).length === 1 ? selectedSmokeFiles(process.env) : ['src/**/*.smoke.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Ne PAS hériter du setup des tests ordinaires : il purge Redis.
    globalSetup: './vitest.smoke.setup.ts',
    testTimeout: 60_000,
  },
});
