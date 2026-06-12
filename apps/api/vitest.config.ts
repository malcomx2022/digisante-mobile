import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Résout les alias pour les tests qui importent le serveur et ses modules.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Pointe @digisante/shared vers sa SOURCE : les tests ne dépendent pas
      // du build dist (qui, en CI, n'est produit qu'après l'étape de test).
      '@digisante/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // Les tests d'intégration partagent la DB/Redis : pas de parallélisme entre fichiers.
    fileParallelism: false,
    // Chaque fichier d'intégration démarre un serveur complet (Prisma + Redis) dans
    // beforeAll : marge confortable pour éviter les timeouts de hook sous charge.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
