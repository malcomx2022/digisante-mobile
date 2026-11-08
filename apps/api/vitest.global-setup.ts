// ─────────────────────────────────────────────────────────────
// globalSetup Vitest — garantit un Redis PROPRE au début de CHAQUE run de tests.
// Évite les fuites d'état inter-runs (ex. verrou OTP 30 min laissé par un run
// précédent interrompu, qui faisait flaker le test de verrouillage OTP).
// Best-effort : si Redis est indisponible, les tests d'intégration le signaleront
// eux-mêmes ; on ne fait pas échouer le run unitaire pour autant.
// ⚠️ Purge la base Redis pointée par REDIS_URL — utiliser une base DÉDIÉE aux
// tests (ex. redis://…/1), distincte de la base de dev (db 0).
// REDIS_ADMIN_URL (facultatif) : connexion de purge quand REDIS_URL vise un utilisateur ACL
// sans FLUSHDB (suite rejouée en CI sous l'utilisateur de l'environnement, cf. valkey-acl).
// ─────────────────────────────────────────────────────────────
import Redis from 'ioredis';

export default async function globalSetup(): Promise<void> {
  const url = process.env.REDIS_ADMIN_URL || process.env.REDIS_URL;
  if (!url) return; // pas d'infra → tests d'intégration skippés
  if (process.env.NODE_ENV === 'production') return; // garde-fou : jamais en prod

  const redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
    await redis.flushdb();
  } catch {
    // Redis indisponible : non bloquant (les suites d'intégration échoueront si besoin).
  } finally {
    redis.disconnect();
  }
}
