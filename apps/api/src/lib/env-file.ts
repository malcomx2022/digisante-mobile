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
// Sous Vitest (VITEST=true, quel que soit NODE_ENV : Vitest garde un NODE_ENV exporté) ou en
// NODE_ENV=test (CI) : rien n'est chargé — sinon un `export NODE_ENV=development` suffisait à
// lancer les suites d'intégration contre la base et le Redis nommés par le .env.
// Aucun secret n'est journalisé ici (le chemin du fichier n'en est pas un).
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
  if (target.NODE_ENV === 'test' || target.VITEST) return 'skipped';
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
    // Illisible (droits, répertoire…) : échec explicite plutôt qu'un démarrage sans config.
    // Message sûr (chemin seul) : main.ts l'affiche tel quel grâce à son code.
    throw Object.assign(new Error(`Fichier d'environnement de l'API illisible : ${file}`), {
      code: 'API_ENV_FILE_UNREADABLE',
    });
  }
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (target[key] === undefined && value !== undefined) target[key] = value;
  }
  return 'loaded';
}
