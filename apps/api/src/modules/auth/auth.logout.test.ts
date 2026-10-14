// Une déconnexion tardive du compte A ne révoque pas la session du compte B.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290196031401', '+2290196031402'];
const otpKeys = PHONES.flatMap((phone) => [`otp:${phone}`, `otp:send:${phone}`, `otp:attempts:${phone}`, `otp:lock:${phone}`]);

describe.skipIf(!HAS_INFRA)('Auth — déconnexion liée au compte courant', () => {
  let app: FastifyInstance;
  const sessions: { userId: string; accessToken: string; cookie: string; key: string; fcmToken: string }[] = [];
  const refreshKeys: string[] = [];
  const rememberRefresh = (cookie: string) => {
    const { jti } = app.jwt.verify<{ jti: string }>(cookie);
    const key = `refresh:${jti}`;
    refreshKeys.push(key);
    return key;
  };
  const logout = (accessToken: string, cookie: string) => app.inject({
    method: 'POST', url: '/api/v1/auth/logout',
    headers: { authorization: `Bearer ${accessToken}` }, cookies: { digisante_rt: cookie },
  });
  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await app.redis.del(...otpKeys);
    for (const [index, phone] of PHONES.entries()) {
      const registration = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { phone, role: 'PATIENT', lang: 'FR', firstName: 'Synthétique', lastName: 'Logout' } });
      expect(registration.statusCode).toBe(201);
      const verification = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { phone, code: registration.json().otp.devCode } });
      expect(verification.statusCode).toBe(200);
      const cookie = verification.cookies.find((entry) => entry.name === 'digisante_rt')!.value;
      const { accessToken, user } = verification.json() as { accessToken: string; user: { id: string } };
      const fcmToken = `synthetic-fcm-logout-binding-${index}`;
      expect((await app.inject({ method: 'POST', url: '/api/v1/users/me/device', headers: { authorization: `Bearer ${accessToken}` }, payload: { fcmToken } })).statusCode).toBe(200);
      sessions.push({ userId: user.id, accessToken, cookie, fcmToken, key: rememberRefresh(cookie) });
    }
  });
  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await app.redis.del(...otpKeys, ...refreshKeys);
    await app.close();
  });

  it('access A + cookie B : refus, sans Set-Cookie ni révocation Redis ni purge des appareils', async () => {
    const [a, b] = sessions;
    const response = await logout(a.accessToken, b.cookie);
    expect(response.statusCode).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.cookies).toHaveLength(0);
    for (const session of sessions) {
      expect(await app.redis.get(session.key)).toBe(session.userId);
      expect((await app.prisma.user.findUniqueOrThrow({ where: { id: session.userId } })).fcmToken).toBe(session.fcmToken);
    }
    // B conserve réellement son refresh et peut le faire tourner normalement.
    const refreshed = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { digisante_rt: b.cookie } });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().user.id).toBe(b.userId);
    rememberRefresh(refreshed.cookies.find((entry) => entry.name === 'digisante_rt')!.value);
  });
  it('access A + cookie A : déconnexion normale, cookie effacé et seul A révoqué', async () => {
    const [a, b] = sessions;
    const response = await logout(a.accessToken, a.cookie);
    expect(response.statusCode).toBe(204);
    expect(response.cookies.find((entry) => entry.name === 'digisante_rt')?.maxAge).toBe(0);
    expect(await app.redis.get(a.key)).toBeNull();
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: a.userId } })).fcmToken).toBeNull();
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: b.userId } })).fcmToken).toBe(b.fcmToken);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { digisante_rt: a.cookie } })).statusCode).toBe(401);
    expect((await logout(a.accessToken, a.cookie)).statusCode).toBe(204);
  });
});
