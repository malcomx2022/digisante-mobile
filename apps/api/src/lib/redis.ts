// ─────────────────────────────────────────────────────────────
// Connexions Valkey/Redis de l'API — définies UNE SEULE FOIS (revue GO du 22/10/2026,
// résiduel 2 « isolement Valkey »).
//
// Sur l'hôte IONOS partagé, chaque environnement se connecte avec SON utilisateur ACL,
// limité aux clés `~<REDIS_KEY_PREFIX>*` et aux canaux `&<REDIS_KEY_PREFIX>*`, sans
// commande d'administration (règles : provision-ionos.sh, bloc `valkey-acl`).
//  - `keyPrefix` préfixe toute clé (GET/SET/DEL/INCR/EVAL KEYS…) ; il ne préfixe PAS les
//    canaux pub/sub : passer par `redisChannel()`.
//  - `disableClientInfo` : pas de CLIENT SETINFO (refusé par l'ACL, bruit dans ACL LOG).
//  - `enableReadyCheck: false` : la vérification d'ioredis exécute INFO, refusé par l'ACL
//    (INFO décrit les index et la configuration de l'hôte partagé).
// Ne jamais ouvrir de connexion par `new Redis(env.REDIS_URL)` en direct : elle perdrait
// le préfixe et chaque commande serait refusée (NOPERM) en préproduction/production.
// ─────────────────────────────────────────────────────────────
import Redis, { type RedisOptions } from 'ioredis';

import { env } from './env.js';

export function redisOptions(extra: RedisOptions = {}): RedisOptions {
  return {
    ...(env.REDIS_KEY_PREFIX ? { keyPrefix: env.REDIS_KEY_PREFIX } : {}),
    disableClientInfo: true,
    enableReadyCheck: false,
    ...extra,
  };
}

export function createRedis(extra: RedisOptions = {}): Redis {
  return new Redis(env.REDIS_URL, redisOptions(extra));
}

/** Nom d'un canal pub/sub de cet environnement (le `keyPrefix` d'ioredis ne s'y applique pas). */
export function redisChannel(name: string): string {
  return `${env.REDIS_KEY_PREFIX ?? ''}${name}`;
}
