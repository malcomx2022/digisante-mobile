// ─────────────────────────────────────────────────────────────
// Point d'entrée de l'API : PM2 (ecosystem.config.cjs), `pnpm start`, `pnpm dev`.
//
// Démarre TOUJOURS, quel que soit le lanceur. Ne pas y remettre de garde
// `import.meta.url === process.argv[1]` : PM2 importe le script depuis son propre
// conteneur (process.argv[1] = ProcessContainer.js en cluster, ProcessContainerFork.js en
// fork) et réécrit process.title en `node <script>` — la garde était fausse, l'API restait
// « online » sans écouter, sans un seul journal (préprod IONOS, 15/10/2026).
// server.ts reste importable sans effet de bord (tests : buildServer()).
// ─────────────────────────────────────────────────────────────
// Configuration d'abord : apps/api/.env chargé et validé avant tout autre module.
import '@/lib/env.js';
import { start } from '@/server.js';

void start();
