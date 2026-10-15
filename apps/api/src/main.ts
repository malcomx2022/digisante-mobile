// ─────────────────────────────────────────────────────────────
// Point d'entrée de l'API : PM2 (ecosystem.config.cjs), `pnpm start`, `pnpm dev`.
//
// Démarre TOUJOURS, quel que soit le lanceur. Ne pas y remettre de garde
// `import.meta.url === process.argv[1]` : PM2 importe le script depuis son propre
// conteneur (process.argv[1] = ProcessContainer.js en cluster, ProcessContainerFork.js en
// fork) et réécrit process.title en `node <script>` — la garde était fausse, l'API restait
// « online » sans écouter, sans un seul journal (préprod IONOS, 15/10/2026).
// server.ts reste importable sans effet de bord (tests : buildServer()).
//
// Tout échec de démarrage SORT en code 1 : PM2 (cluster) intercepte les promesses rejetées
// sans arrêter le worker — une base pas encore prête au redémarrage de l'hôte, un .env
// illisible, laissaient l'API « online », muette, jamais relancée. Imports DYNAMIQUES dans
// le try : une erreur levée à l'évaluation d'un module (env.ts) est couverte aussi. PM2
// relance ensuite avec un délai croissant (exp_backoff_restart_delay de l'ecosystem).
// ─────────────────────────────────────────────────────────────
import { serializeErrorForLog } from '@/lib/log-sanitize.js';

/** Codes dont le message est sûr (noms de variables, chemin du .env) : affiché tel quel. */
const SAFE_MESSAGE_CODES = new Set(['API_ENV_INVALID', 'API_ENV_FILE_UNREADABLE']);

function describeBootError(err: unknown): string {
  const e = err as { code?: unknown; errorCode?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : typeof e?.errorCode === 'string' ? e.errorCode : undefined;
  if (code && SAFE_MESSAGE_CODES.has(code) && err instanceof Error) return err.message;
  // Sinon jamais le message brut (il peut recopier une donnée ou un secret, §4) : type, code,
  // lignes de pile seules (fichiers et fonctions, aucune valeur — comme pour Prisma) et, pour un
  // module introuvable, son chemin. Message seul utile (FST_ERR_PLUGIN_TIMEOUT, SyntaxError de
  // liaison) : relancer `node dist/server.js` sur une configuration synthétique pour le lire.
  const frames = err instanceof Error
    ? (err.stack ?? '').split('\n').filter((line) => line.trimStart().startsWith('at ')).slice(0, 8).join('\n')
    : '';
  const url = typeof (err as { url?: unknown } | null)?.url === 'string' ? (err as { url: string }).url : undefined;
  return JSON.stringify({
    ...serializeErrorForLog(err),
    ...(frames ? { stack: frames } : {}),
    ...(code ? { code } : {}),
    ...(url ? { url } : {}),
  });
}

try {
  // Configuration d'abord : apps/api/.env chargé et validé avant tout autre module.
  await import('@/lib/env.js');
  const { start } = await import('@/server.js');
  await start();
} catch (err) {
  // Sortie APRÈS écriture effective : sous PM2 cluster, le worker écrit son journal par un
  // flux asynchrone et un process.exit immédiat perdait cette ligne. Filet de 2 s si le
  // rappel ne vient jamais.
  process.exitCode = 1;
  const exit = () => process.exit(1);
  const fallback = setTimeout(exit, 2000);
  fallback.unref();
  process.stderr.write(`❌ Démarrage de l'API impossible : ${describeBootError(err)}\n`, () => {
    clearTimeout(fallback);
    exit();
  });
}
