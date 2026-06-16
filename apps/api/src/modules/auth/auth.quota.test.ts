// Couverture du chemin critique « anti-abus OTP » (quota d'envoi, P7.2).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONE = '+2290187000111';

describe.skipIf(!HAS_INFRA)('Anti-abus OTP (intégration)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: PHONE } });
    await app.redis.del(`otp:${PHONE}`, `otp:attempts:${PHONE}`, `otp:lock:${PHONE}`, `otp:send:${PHONE}`);
    await app.prisma.user.create({
      data: { phone: PHONE, role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Q', lastName: 'T' } }, patient: { create: {} } },
    });
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: PHONE } });
    await app.redis.del(`otp:${PHONE}`, `otp:attempts:${PHONE}`, `otp:lock:${PHONE}`, `otp:send:${PHONE}`);
    await app.close();
  });

  it('bloque l’envoi d’OTP au-delà du quota (429)', async () => {
    const req = () => app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: PHONE } });

    // 5 envois autorisés dans la fenêtre.
    for (let i = 0; i < 5; i++) {
      const res = await req();
      expect(res.statusCode).toBe(200);
    }
    // 6e envoi → quota dépassé.
    const blocked = await req();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('TOO_MANY_REQUESTS');
  });
});
