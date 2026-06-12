import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Résout l'alias `@/` (identique à tsconfig paths) pour les tests qui
// importent le serveur et ses modules.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Les tests d'intégration partagent la DB/Redis : pas de parallélisme entre fichiers.
    fileParallelism: false,
  },
});
