// Test d'intégration des sondes liveness/readiness. CI uniquement.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

describe.skipIf(!HAS_INFRA)('Health (intégration)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    if (!app) return;
    await app.close();
  });

  it('liveness /health → 200 { status: ok }', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', service: 'digisante-api' });
  });

  it('readiness /ready → 200 (DB + Redis joignables en CI)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ready', db: 'up', redis: 'up' });
  });
});
