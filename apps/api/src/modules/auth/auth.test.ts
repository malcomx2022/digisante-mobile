// Tests d'intégration du module Auth via app.inject().
// Exécutés UNIQUEMENT si DATABASE_URL et REDIS_URL sont présents (CI) ;
// sinon le bloc est ignoré (pnpm test reste vert en local sans infra).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONE = '+22996000777';
const otpKeys = [`otp:${PHONE}`, `otp:attempts:${PHONE}`, `otp:lock:${PHONE}`];

describe.skipIf(!HAS_INFRA)('Auth (intégration)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Import dynamique : ne charge env/serveur que lorsque l'infra est disponible.
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: PHONE } });
    await app.redis.del(...otpKeys);
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: PHONE } });
    await app.redis.del(...otpKeys);
    await app.close();
  });

  it('inscription → OTP → vérification → tokens → /me → refresh', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { phone: PHONE, role: 'PATIENT', lang: 'FR', firstName: 'Test', lastName: 'User' },
    });
    expect(reg.statusCode).toBe(201);
    const devCode = reg.json().otp.devCode as string;
    expect(devCode).toMatch(/^\d{6}$/);

    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { phone: PHONE, code: devCode },
    });
    expect(verify.statusCode).toBe(200);
    const body = verify.json();
    expect(body.user.status).toBe('ACTIVE');
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().phone).toBe(PHONE);

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: body.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().accessToken).toBeTruthy();
  });

  it('rejette /me sans token (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
  });

  it('verrouille après 5 OTP erronés (429)', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: PHONE } });

    let last = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { phone: PHONE, code: '999999' },
    });
    for (let i = 0; i < 4; i++) {
      last = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/otp/verify',
        payload: { phone: PHONE, code: '999999' },
      });
    }
    expect(last.statusCode).toBe(429);

    const locked = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { phone: PHONE, code: '999999' },
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().code).toBe('TOO_MANY_REQUESTS');

    await app.redis.del(...otpKeys); // libère le verrou pour les exécutions suivantes
  });
});
