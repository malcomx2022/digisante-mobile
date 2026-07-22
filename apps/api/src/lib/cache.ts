// ─────────────────────────────────────────────────────────────
// Cache Redis « read-through » générique — réduction de la charge DB pour les
// lectures répétées de données quasi statiques.
//
// S'appuie sur la connexion PARTAGÉE `app.redis` (plugin redis) — ne JAMAIS
// ouvrir une seconde connexion ici. Généralise le motif déjà éprouvé pour la
// configuration d'intégrations (lib/integrations.ts : get → miss → compute →
// set EX → del à l'écriture).
//
// ⚠️ CONFIDENTIALITÉ (CLAUDE.md §4) : RÉSERVÉ aux données NON sensibles et NON
// personnelles (référentiels publics : catalogue assureurs, contenus éducatifs
// publiés, etc.). Ne JAMAIS mettre en cache de données de santé / DMP / PII :
// Redis n'est pas le magasin chiffré au repos et le cache est partagé entre
// workers (PM2 ×2). En cas de doute, NE PAS cacher.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';

/**
 * Lecture avec cache. Renvoie la valeur en cache si présente, sinon exécute
 * `fn`, met le résultat en cache pour `ttlSeconds`, puis le renvoie.
 *
 * Le résultat DOIT être sérialisable JSON (une `Date` est sérialisée en chaîne
 * ISO — préférer des projections `select` sans champs `Date`, ou typer/parser
 * en conséquence côté appelant).
 */
export async function getCached<T>(
  app: FastifyInstance,
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  const cached = await app.redis.get(key);
  if (cached !== null) return JSON.parse(cached) as T;
  const data = await fn();
  await app.redis.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  return data;
}

/** Invalide une ou plusieurs clés de cache (à appeler après toute écriture). */
export async function invalidateCache(app: FastifyInstance, ...keys: string[]): Promise<void> {
  if (keys.length > 0) await app.redis.del(...keys);
}
