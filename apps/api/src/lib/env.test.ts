// Non-régression du durcissement FAIL-SAFE de la config (CLAUDE.md §4).
// Hors `test`, un environnement sans chiffrement santé / JWT solide DOIT être rejeté,
// et NODE_ENV est requis (pas de repli silencieux vers « development »).
import { describe, expect, it } from 'vitest';

import { envSchema } from './env.js';

const LONG = 'x'.repeat(40); // ≥ 32 caractères
const base = {
  DATABASE_URL: 'postgresql://u@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('envSchema — durcissement fail-safe', () => {
  it('rejette une config sans NODE_ENV (pas de défaut silencieux)', () => {
    const r = envSchema.safeParse({ ...base, JWT_SECRET: LONG, HEALTH_ENCRYPTION_KEY: LONG });
    expect(r.success).toBe(false);
  });

  it('development : refuse l’absence de HEALTH_ENCRYPTION_KEY', () => {
    const r = envSchema.safeParse({ ...base, NODE_ENV: 'development', JWT_SECRET: LONG });
    expect(r.success).toBe(false);
  });

  it('development : refuse un JWT_SECRET < 32', () => {
    const r = envSchema.safeParse({ ...base, NODE_ENV: 'development', JWT_SECRET: 'short123', HEALTH_ENCRYPTION_KEY: LONG });
    expect(r.success).toBe(false);
  });

  it('production : refuse l’absence de chiffrement santé', () => {
    const r = envSchema.safeParse({ ...base, NODE_ENV: 'production', JWT_SECRET: LONG });
    expect(r.success).toBe(false);
  });

  it('development complet (clé + JWT ≥ 32) : accepté', () => {
    const r = envSchema.safeParse({ ...base, NODE_ENV: 'development', JWT_SECRET: LONG, HEALTH_ENCRYPTION_KEY: LONG });
    expect(r.success).toBe(true);
  });

  it('test : reste permissif (JWT court, pas de clé santé) — pour la CI', () => {
    const r = envSchema.safeParse({ ...base, NODE_ENV: 'test', JWT_SECRET: 'ci-secret' });
    expect(r.success).toBe(true);
  });
});
