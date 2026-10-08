// Régressions L8 : DB/Redis dédiés, fournisseurs simulés, aucune recette réelle.
import { createHash, randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { computeAuditHash, writeAudit } from '@/lib/audit.js';
import { env, envSchema } from '@/lib/env.js';
import { hashOtp } from '@/modules/auth/auth.otp.js';
import { sendOtp } from '@/services/twilio.js';

vi.mock('@/services/twilio.js', () => ({ sendOtp: vi.fn(async () => ({ delivered: true, stub: false })) }));

describe.skipIf(!process.env.DATABASE_URL || !process.env.REDIS_URL)('L8 — sécurité intégrée', () => {
  let app: FastifyInstance;
  const phones = ['+2290196008801', '+2290196008802', '+2290196008803', '+2290196008804'];
  const originalMode = env.NODE_ENV;
  const originalTtl = env.JWT_REFRESH_TTL;
  const originalServiceToken = env.RECONCILE_TOKEN;
  const input = (phone: string) => ({ phone, role: 'PATIENT', lang: 'FR', firstName: 'Synthétique', lastName: 'L8' });
  const keys = () => phones.flatMap((p) => [`otp:${p}`, `otp:send:${p}`, `otp:lock:${p}`, `otp:attempts:${p}`]);
  beforeAll(async () => {
    env.RECONCILE_TOKEN = originalServiceToken ?? 'l8-synthetic-service-token';
    const { buildServer } = await import('@/server.js');
    app = await buildServer(); await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: phones } } });
    await app.redis.del(...keys());
  });
  afterEach(() => { env.NODE_ENV = originalMode; env.JWT_REFRESH_TTL = originalTtl; vi.restoreAllMocks(); });
  afterAll(async () => {
    await app.prisma.user.deleteMany({ where: { phone: { in: phones } } });
    await app.redis.del(...keys()); await app.close(); env.RECONCILE_TOKEN = originalServiceToken;
  });
  const register = (phone: string, extra = {}) => app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { ...input(phone), ...extra } });
  const request = (phone: string) => app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone } });
  const verify = (phone: string, code: string) => app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { phone, code } });

  it('production : inscription nouvelle/existante même réponse sans identité ni OTP, profil existant inchangé', async () => {
    env.NODE_ENV = 'production';
    const a = await register(phones[0]);
    const before = await app.prisma.user.findUniqueOrThrow({ where: { phone: phones[0] }, include: { profile: true } });
    const b = await register(phones[0], { firstName: 'Attaquant', role: 'DIASPORA' });
    expect(a.statusCode).toBe(201); expect(b.statusCode).toBe(201); expect(b.json()).toEqual(a.json());
    expect(a.json().user).toBeUndefined(); expect(a.body).not.toContain('devCode');
    const after = await app.prisma.user.findUniqueOrThrow({ where: { phone: phones[0] }, include: { profile: true } });
    expect(after.id).toBe(before.id); expect(after.role).toBe('PATIENT'); expect(after.profile?.firstName).toBe(before.profile?.firstName);
  });
  it('production : demande pour numéro connu/inconnu même réponse ; aucun SMS pour inconnu', async () => {
    env.NODE_ENV = 'production'; vi.mocked(sendOtp).mockClear();
    const known = await request(phones[0]); const unknown = await request(phones[1]);
    expect(known.statusCode).toBe(200); expect(unknown.statusCode).toBe(200); expect(unknown.json()).toEqual(known.json());
    expect(sendOtp).toHaveBeenCalledOnce(); expect(await app.prisma.user.findUnique({ where: { phone: phones[1] } })).toBeNull();
    expect(await app.redis.get(`otp:${phones[1]}`)).toMatch(/^[a-f0-9]{64}$/);
  });
  it('conflit e-mail : 201 générique, ni compte partiel ni session avec le code fictif', async () => {
    await register(phones[2], { email: 'l8-synthetic@example.test' });
    const collision = await register(phones[3], { email: 'l8-synthetic@example.test' });
    expect(collision.statusCode).toBe(201); expect(collision.json().user).toBeUndefined();
    expect(await app.prisma.user.findUnique({ where: { phone: phones[3] } })).toBeNull();
    const res = await verify(phones[3], collision.json().otp.devCode);
    expect(res.statusCode).toBe(401); expect(res.json().accessToken).toBeUndefined(); expect(res.cookies).toHaveLength(0);
  });
  it('empreinte Redis poivrée ; ancien SHA256 et clé précédente refusés, nouvelle demande réussit', async () => {
    const req = await request(phones[2]); const code = req.json().devCode;
    expect(await app.redis.get(`otp:${phones[2]}`)).toBe(hashOtp(phones[2], code));
    await app.redis.set(`otp:${phones[2]}`, createHash('sha256').update(`${phones[2]}:${code}`).digest('hex'), 'EX', 300);
    expect((await verify(phones[2], code)).statusCode).toBe(401);
    await app.redis.set(`otp:${phones[2]}`, hashOtp(phones[2], code, 'ancienne-cle'), 'EX', 300);
    expect((await verify(phones[2], code)).statusCode).toBe(401);
    const next = await request(phones[2]); expect((await verify(phones[2], next.json().devCode)).statusCode).toBe(200);
  });
  it('vérification inconnue/expirée/invalide : même erreur et verrou après cinq essais sans code stocké', async () => {
    await app.redis.del(`otp:${phones[1]}`, `otp:attempts:${phones[1]}`);
    const a = await verify(phones[1], '123456'); const b = await verify(phones[0], 'notnum');
    expect(a.statusCode).toBe(401); expect(b.statusCode).toBe(422); // validation de forme indépendante de l'existence
    const known = await verify(phones[0], '123456'); expect(known.json()).toEqual(a.json());
    for (let n = 0; n < 3; n++) expect((await verify(phones[1], '123456')).statusCode).toBe(401);
    expect((await verify(phones[1], '123456')).statusCode).toBe(429);
    expect((await request(phones[1])).statusCode).toBe(429);
  });
  it('quota de renvoi inconnu identique : sixième envoi refusé sans appel Twilio', async () => {
    await app.redis.del(`otp:lock:${phones[3]}`, `otp:send:${phones[3]}`); vi.mocked(sendOtp).mockClear();
    for (let i = 0; i < 5; i++) expect((await request(phones[3])).statusCode).toBe(200);
    expect((await request(phones[3])).statusCode).toBe(429); expect(sendOtp).not.toHaveBeenCalled();
  });
  it('JWT_REFRESH_TTL configure ensemble JWT, cookie et allowlist Redis, y compris rotation', async () => {
    env.JWT_REFRESH_TTL = '2h'; await app.redis.del(`otp:send:${phones[2]}`);
    const req = await request(phones[2]); const res = await verify(phones[2], req.json().devCode);
    expect(res.statusCode).toBe(200); const cookie = res.cookies.find((c) => c.name === 'digisante_rt')!;
    expect(cookie.maxAge).toBe(7200);
    const jwt = app.jwt.verify<{ exp: number; iat: number; jti: string }>(cookie.value);
    expect(jwt.exp - jwt.iat).toBe(7200); expect(await app.redis.ttl(`refresh:${jwt.jti}`)).toBeGreaterThan(7190);
    const rotated = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { digisante_rt: cookie.value } });
    expect(rotated.statusCode).toBe(200); expect(rotated.cookies[0].maxAge).toBe(7200);
  });
  it('cinq validations simultanées du même OTP : une seule session et code consommé', async () => {
    await app.redis.del(`otp:send:${phones[2]}`, `otp:attempts:${phones[2]}`);
    const req = await request(phones[2]);
    const results = await Promise.all(Array.from({ length: 5 }, () => verify(phones[2], req.json().devCode)));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode !== 200).every((r) => r.statusCode === 401 || r.statusCode === 429)).toBe(true);
    expect(await app.redis.get(`otp:${phones[2]}`)).toBeNull();
  });
  it('renvoi entre lecture et consommation : ancien code refusé, nouveau code non effacé', async () => {
    await app.redis.del(`otp:send:${phones[2]}`, `otp:attempts:${phones[2]}`);
    const req = await request(phones[2]); const nextCode = '456789';
    const get = app.redis.get.bind(app.redis);
    const interception = vi.spyOn(app.redis, 'get').mockImplementation(async (key) => {
      const value = await get(key);
      if (key === `otp:${phones[2]}`) await app.redis.set(key, hashOtp(phones[2], nextCode), 'EX', 300);
      return value;
    });
    expect((await verify(phones[2], req.json().devCode)).statusCode).toBe(401); interception.mockRestore();
    expect(await app.redis.get(`otp:${phones[2]}`)).toBe(hashOtp(phones[2], nextCode));
    expect((await verify(phones[2], nextCode)).statusCode).toBe(200);
  });
  it('Redis indisponible : aucune session délivrée ni quota ignoré', async () => {
    vi.spyOn(app.redis, 'get').mockRejectedValueOnce(new Error('synthetic outage'));
    expect((await request(phones[2])).statusCode).toBe(500);
  });
  it('audit concurrent sous horloge figée puis reculée : chaîne unique, ordre strict et hash recalculables', async () => {
    const action = `L8_${randomUUID()}`;
    const head = await app.prisma.auditLog.findFirst({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    vi.spyOn(Date, 'now').mockReturnValue(head?.createdAt.getTime() ?? Date.now());
    await Promise.all(Array.from({ length: 12 }, () => writeAudit(app.prisma, { action })));
    vi.mocked(Date.now).mockReturnValue(0); await writeAudit(app.prisma, { action });
    const rows = await app.prisma.auditLog.findMany({ where: { action }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(rows).toHaveLength(13); expect(rows[0].prevHash).toBe(head?.hash ?? null);
    rows.forEach((r, i) => {
      expect(r.hash).toBe(computeAuditHash(r.prevHash, { action: r.action, actorId: r.actorId, targetId: r.targetId, ip: r.ip, meta: r.meta as Record<string, unknown> }, r.createdAt.toISOString()));
      if (i) { expect(r.prevHash).toBe(rows[i - 1].hash); expect(r.createdAt.getTime()).toBeGreaterThan(rows[i - 1].createdAt.getTime()); }
    });
  });
  it('réconciliation refuse jeton absent/faux/array et garde la voie valide sans paiement', async () => {
    for (const token of [undefined, 'x', ['a', 'b']]) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/payments/reconcile', headers: token ? { 'x-service-token': token } : {} });
      expect(res.statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'POST', url: '/api/v1/payments/reconcile', headers: { 'x-service-token': env.RECONCILE_TOKEN! } })).statusCode).toBe(200);
  });
});

describe('L8 — configuration refresh', () => {
  it('durées documentées acceptées ; unités absentes, zéro, fraction, >90 j et overflow refusés', () => {
    for (const ttl of ['30d', '2h', '60m', '1s']) expect(envSchema.safeParse({ ...env, JWT_REFRESH_TTL: ttl }).success).toBe(true);
    for (const ttl of ['0d', '91d', '-1d', '1.5h', '30', 'xxx', '999999999999999999d']) expect(envSchema.safeParse({ ...env, JWT_REFRESH_TTL: ttl }).success).toBe(false);
  });
});
