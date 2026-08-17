import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Tests unitaires du frontend. Environnement `node` volontairement : les cibles
// testées ici sont de la LOGIQUE (file hors-ligne, intercepteur de refresh,
// routage par rôle), pas du rendu. Pas de jsdom, pas de Testing Library tant
// qu'on ne teste pas de composant — cf. docs/REVUE_Ecarts_et_Plan_2026-08.md (C4).
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Source plutôt que dist : en CI, le build de shared vient APRÈS les tests.
      '@digisante/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
