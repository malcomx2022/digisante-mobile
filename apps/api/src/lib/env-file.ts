// ─────────────────────────────────────────────────────────────
// Chargement de apps/api/.env PAR L'API ELLE-MÊME, avant la validation de env.ts.
//
// L'API ne dépend ainsi plus de son lanceur (PM2 cluster ou fork, `node`, `tsx`) : le
// fichier est résolu depuis CE module (src/lib ou dist/lib → ../../.env), jamais depuis le
// répertoire courant ni depuis des arguments Node que le lanceur pourrait ne pas transmettre.
//
// Même analyseur que `node --env-file` (`util.parseEnv`) et même priorité : une variable
// déjà présente dans l'environnement du processus n'est JAMAIS remplacée (PM2 pose
// NODE_ENV/API_PORT/API_HOST ; deploy.sh vérifie NODE_ENV/DATABASE_URL/REDIS_URL hérités).
// Fichier absent : rien n'est chargé, la validation de env.ts signale ce qui manque.
// NODE_ENV=test (Vitest, CI) : rien n'est chargé — un .env de développement ne doit pas
// modifier les tests. Aucun secret n'est journalisé ici.
// ─────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/** apps/api/.env du checkout qui contient ce module (src/lib/ ou dist/lib/). */
export const API_ENV_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');

export type EnvFileOutcome = 'loaded' | 'absent' | 'skipped';

export function loadApiEnvFile(
  file: string = API_ENV_FILE,
  target: NodeJS.ProcessEnv = process.env,
): EnvFileOutcome {
  if (target.NODE_ENV === 'test') return 'skipped';
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
    // Illisible (droits, répertoire…) : échec explicite plutôt qu'un démarrage sans config.
    throw new Error(`Fichier d'environnement de l'API illisible : ${file}`);
  }
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (target[key] === undefined && value !== undefined) target[key] = value;
  }
  return 'loaded';
}
