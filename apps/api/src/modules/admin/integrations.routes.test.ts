// Tests d'intégration — API admin des intégrations tierces (§3.6, Lot B).
// Invariants vérifiés : secrets JAMAIS renvoyés en clair, écriture auditée SANS
// valeur, RBAC integrations:read/write, FedaPay gelé (§5). Exécutés si DB+Redis (CI).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290196700001', '+2290196700002']; // super-admin, admin restreint

// SUPER_ADMIN complet (inclut integrations:read/write) ; RESTRICTED ne les a pas.
const SUPER = [
  'admin:manage', 'users:read', 'users:write', 'kyc:review', 'ops:read',
  'finance:read', 'finance:write', 'support:write', 'otp:write',
  'webhooks:read', 'webhooks:replay', 'audit:read', 'audit:export', 'education:write',
  'integrations:read', 'integrations:write',
];
const RESTRICTED = ['users:read', 'audit:read'];

const TWILIO_TOKEN = 'super-secret-twilio-token-9999';

describe.skipIf(!HAS_INFRA)('Admin intégrations API (intégration)', () => {
  let app: FastifyInstance;
  let superToken: string;
  let restrictedToken: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  const cleanup = async () => {
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await app.prisma.integrationConfig.deleteMany({ where: { provider: { in: ['TWILIO', 'RESEND'] } } });
    await app.redis.del('integration:TWILIO', 'integration:RESEND', 'integration:FEDAPAY');
  };

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const superAdmin = await app.prisma.user.create({
      data: {
        phone: PHONES[0], role: 'ADMIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Int', lastName: 'Super' } },
        adminProfile: { create: { scopes: SUPER, preset: 'SUPER_ADMIN' } },
      },
    });
    const restricted = await app.prisma.user.create({
      data: {
        phone: PHONES[1], role: 'ADMIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Int', lastName: 'Restr' } },
        adminProfile: { create: { scopes: RESTRICTED, preset: null } },
      },
    });
    superToken = app.jwt.sign({ sub: superAdmin.id, role: 'ADMIN' }, { expiresIn: '15m' });
    restrictedToken = app.jwt.sign({ sub: restricted.id, role: 'ADMIN' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('liste masquée des providers ; FedaPay marqué gelé', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/integrations', headers: auth(superToken) });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ provider: string; frozen: boolean }>;
    const providers = items.map((i) => i.provider);
    expect(providers).toEqual(expect.arrayContaining(['FEDAPAY', 'TWILIO', 'DAILY', 'FIREBASE', 'RESEND']));
    expect(items.find((i) => i.provider === 'FEDAPAY')?.frozen).toBe(true);
    expect(items.find((i) => i.provider === 'TWILIO')?.frozen).toBe(false);
  });

  it('RBAC : sans integrations:read → 403 ; sans integrations:write → 403', async () => {
    const read = await app.inject({ method: 'GET', url: '/api/v1/admin/integrations', headers: auth(restrictedToken) });
    expect(read.statusCode).toBe(403);
    const write = await app.inject({
      method: 'PUT', url: '/api/v1/admin/integrations/TWILIO', headers: auth(restrictedToken),
      payload: { secrets: { authToken: 'x' } },
    });
    expect(write.statusCode).toBe(403);
  });

  it('PUT enregistre les clés (chiffrées) et ne renvoie JAMAIS le secret en clair', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/v1/admin/integrations/TWILIO', headers: auth(superToken),
      payload: { secrets: { accountSid: 'AC_sid_test', authToken: TWILIO_TOKEN, fromNumber: '+2290100000000' }, meta: { region: 'bj' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe('db');
    expect(body.configured).toBe(true);
    // Secret masqué, jamais en clair (ni dans les secrets, ni ailleurs dans la réponse).
    expect(body.secrets.authToken).toBe('••••9999');
    expect(JSON.stringify(body)).not.toContain(TWILIO_TOKEN);
    expect(body.meta).toEqual({ region: 'bj' });

    // En base : le blob est SCELLÉ (≠ JSON clair).
    const row = await app.prisma.integrationConfig.findUniqueOrThrow({ where: { provider: 'TWILIO' } });
    expect(row.secretsEnc).not.toContain(TWILIO_TOKEN);

    // Audit INTEGRATION_UPDATE écrit SANS la valeur (noms de clés uniquement).
    const audit = await app.prisma.auditLog.findFirst({ where: { action: 'INTEGRATION_UPDATE' }, orderBy: { createdAt: 'desc' } });
    expect(audit).not.toBeNull();
    const meta = (audit!.meta ?? {}) as { provider?: string; keys?: string[] };
    expect(meta.provider).toBe('TWILIO');
    expect(meta.keys).toEqual(['accountSid', 'authToken', 'fromNumber']);
    expect(JSON.stringify(audit!.meta)).not.toContain(TWILIO_TOKEN);
  });

  it('PUT rejette une clé inconnue pour le provider (400)', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/v1/admin/integrations/TWILIO', headers: auth(superToken),
      payload: { secrets: { bogusKey: 'x' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('FedaPay est gelé §5 : PUT/PATCH/test refusés (400)', async () => {
    const put = await app.inject({ method: 'PUT', url: '/api/v1/admin/integrations/FEDAPAY', headers: auth(superToken), payload: { secrets: { secretKey: 'sk' } } });
    expect(put.statusCode).toBe(400);
    const patch = await app.inject({ method: 'PATCH', url: '/api/v1/admin/integrations/FEDAPAY', headers: auth(superToken), payload: { enabled: false } });
    expect(patch.statusCode).toBe(400);
    const test = await app.inject({ method: 'POST', url: '/api/v1/admin/integrations/FEDAPAY/test', headers: auth(superToken) });
    expect(test.statusCode).toBe(400);
  });

  it('PATCH active/désactive une config existante + invalide le cache', async () => {
    const off = await app.inject({ method: 'PATCH', url: '/api/v1/admin/integrations/TWILIO', headers: auth(superToken), payload: { enabled: false } });
    expect(off.statusCode).toBe(200);
    expect(off.json().enabled).toBe(false);
    // Désactivé → plus « configured ».
    expect(off.json().configured).toBe(false);
    const on = await app.inject({ method: 'PATCH', url: '/api/v1/admin/integrations/TWILIO', headers: auth(superToken), payload: { enabled: true } });
    expect(on.json().enabled).toBe(true);
  });

  it('PATCH sur un provider sans config en base → 400', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/v1/admin/integrations/RESEND', headers: auth(superToken), payload: { enabled: true } });
    expect(res.statusCode).toBe(400);
  });

  it('test de complétude : TWILIO prêt (ok) ; DAILY incomplet (missing)', async () => {
    const twilio = await app.inject({ method: 'POST', url: '/api/v1/admin/integrations/TWILIO/test', headers: auth(superToken) });
    expect(twilio.statusCode).toBe(200);
    expect(twilio.json().ok).toBe(true);
    expect(twilio.json().missing).toEqual([]);

    // DAILY sans config DB ni .env en CI → incomplet, missing = ['apiKey'] (jamais de valeur).
    const daily = await app.inject({ method: 'POST', url: '/api/v1/admin/integrations/DAILY/test', headers: auth(superToken) });
    expect(daily.statusCode).toBe(200);
    if (!daily.json().ok) expect(daily.json().missing).toContain('apiKey');
  });
});
