// Tests d'intégration RBAC admin (profilage par scopes). Exécutés si DB+Redis (CI).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290196500001', '+2290196500002'];

const SUPER = [
  'admin:manage', 'users:read', 'users:write', 'kyc:review', 'ops:read',
  'finance:read', 'finance:write', 'support:write', 'otp:write',
  'webhooks:read', 'webhooks:replay', 'audit:read', 'audit:export', 'education:write',
];

describe.skipIf(!HAS_INFRA)('Admin RBAC (intégration)', () => {
  let app: FastifyInstance;
  let superToken: string;
  let promotedUserId: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  const cleanup = async () => {
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } }); // cascade adminProfile + supportNotes
    await app.redis.del(...PHONES.flatMap((p) => [`otp:lock:${p}`, `otp:attempts:${p}`, `otp:send:${p}`]));
  };

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const superAdmin = await app.prisma.user.create({
      data: {
        phone: PHONES[0], role: 'ADMIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Sup', lastName: 'Admin' } },
        adminProfile: { create: { scopes: SUPER, preset: 'SUPER_ADMIN' } },
      },
    });
    const futureAdmin = await app.prisma.user.create({
      data: { phone: PHONES[1], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Mod', lastName: 'X' } }, patient: { create: {} } },
    });
    promotedUserId = futureAdmin.id;
    superToken = app.jwt.sign({ sub: superAdmin.id, role: 'ADMIN' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('expose les scopes de l\'appelant via /admin/me', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: auth(superToken) });
    expect(me.statusCode).toBe(200);
    expect(me.json().scopes).toContain('admin:manage');
  });

  it('promotion d\'un compte en admin (preset MODERATION) + scopes restreints appliqués', async () => {
    const create = await app.inject({
      method: 'POST', url: '/api/v1/admin/admins', headers: auth(superToken),
      payload: { phone: PHONES[1], preset: 'MODERATION' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().user.id).toBe(promotedUserId);

    // Le compte promu a désormais le rôle ADMIN et le jeu de scopes MODERATION.
    const modToken = app.jwt.sign({ sub: promotedUserId, role: 'ADMIN' }, { expiresIn: '15m' });
    const me = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: auth(modToken) });
    expect(me.json().scopes).toEqual(expect.arrayContaining(['kyc:review', 'users:write', 'audit:read']));
    expect(me.json().scopes).not.toContain('users:read');

    // Enforcement : MODERATION n'a pas `users:read` → 403 sur la liste des users…
    const users = await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: auth(modToken) });
    expect(users.statusCode).toBe(403);
    // …mais a `audit:read` → 200 sur l'audit.
    const audit = await app.inject({ method: 'GET', url: '/api/v1/admin/audit', headers: auth(modToken) });
    expect(audit.statusCode).toBe(200);
    // …et n'a pas `admin:manage` → 403 sur la gestion des admins.
    const admins = await app.inject({ method: 'GET', url: '/api/v1/admin/admins', headers: auth(modToken) });
    expect(admins.statusCode).toBe(403);
  });

  it('anti-verrouillage : un super-admin ne peut pas retirer son propre admin:manage', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/admins', headers: auth(superToken) });
    const selfId = list.json().data.find((a: { user: { phone: string }; id: string }) => a.user.phone === PHONES[0]).id as string;
    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/admins/${selfId}`, headers: auth(superToken),
      payload: { preset: 'CONTENT' }, // CONTENT n'a pas admin:manage
    });
    expect(patch.statusCode).toBe(400);
  });

  it('filtre la liste utilisateurs par rôle et recherche (serveur)', async () => {
    const has = (r: { json: () => { data: { phone: string }[] } }, phone: string) => r.json().data.some((u) => u.phone === phone);

    const byRole = await app.inject({ method: 'GET', url: '/api/v1/admin/users?role=ADMIN&pageSize=100', headers: auth(superToken) });
    expect(byRole.statusCode).toBe(200);
    expect(has(byRole, PHONES[0])).toBe(true); // le super-admin (rôle ADMIN)

    // Recherche par prénom ("Sup Admin") → trouve le super-admin.
    const byName = await app.inject({ method: 'GET', url: '/api/v1/admin/users?q=Sup&pageSize=100', headers: auth(superToken) });
    expect(has(byName, PHONES[0])).toBe(true);

    // Filtre rôle PATIENT + recherche "Sup" → exclut le super-admin.
    const byOther = await app.inject({ method: 'GET', url: '/api/v1/admin/users?role=PATIENT&q=Sup&pageSize=100', headers: auth(superToken) });
    expect(has(byOther, PHONES[0])).toBe(false);
  });

  it('support : verrou OTP → déverrouillage (audit OTP_RESET) + note interne', async () => {
    // Pose un verrou OTP sur le compte super-admin (clés Redis).
    await app.redis.set(`otp:lock:${PHONES[0]}`, '1');
    await app.redis.set(`otp:attempts:${PHONES[0]}`, '5');

    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/admins?pageSize=100', headers: auth(superToken) });
    const selfUserId = list.json().data.find((a: { user: { phone: string; id: string } }) => a.user.phone === PHONES[0]).user.id as string;

    const acc = await app.inject({ method: 'GET', url: `/api/v1/admin/support/account/${selfUserId}`, headers: auth(superToken) });
    expect(acc.statusCode).toBe(200);
    expect(acc.json().lockout.locked).toBe(true);

    const unlock = await app.inject({ method: 'POST', url: `/api/v1/admin/support/account/${selfUserId}/unlock`, headers: auth(superToken) });
    expect(unlock.statusCode).toBe(200);
    expect(await app.redis.get(`otp:lock:${PHONES[0]}`)).toBeNull();
    expect(await app.prisma.auditLog.count({ where: { action: 'OTP_RESET' } })).toBeGreaterThanOrEqual(1);

    const note = await app.inject({ method: 'POST', url: `/api/v1/admin/support/account/${selfUserId}/notes`, headers: auth(superToken), payload: { body: 'Appel client OK' } });
    expect(note.statusCode).toBe(200);

    const acc2 = await app.inject({ method: 'GET', url: `/api/v1/admin/support/account/${selfUserId}`, headers: auth(superToken) });
    expect(acc2.json().lockout.locked).toBe(false);
    expect(acc2.json().notes.some((n: { body: string }) => n.body === 'Appel client OK')).toBe(true);
  });

  it('finances : aperçu lecture seule (scope finance:read) + journal webhooks (webhooks:read)', async () => {
    const overview = await app.inject({ method: 'GET', url: '/api/v1/admin/finance/overview?days=7', headers: auth(superToken) });
    expect(overview.statusCode).toBe(200);
    const body = overview.json();
    expect(body.periodDays).toBe(7);
    expect(body.currency).toBe('XOF');
    expect(Array.isArray(body.payments.byStatus)).toBe(true);
    expect(Array.isArray(body.payments.byMethod)).toBe(true);
    expect(typeof body.reconciliation.backlog).toBe('number');
    expect(typeof body.wallets.count).toBe('number');

    const webhooks = await app.inject({ method: 'GET', url: '/api/v1/admin/finance/webhooks', headers: auth(superToken) });
    expect(webhooks.statusCode).toBe(200);
    expect(Array.isArray(webhooks.json().data)).toBe(true);

    // Enforcement : MODERATION (promu plus haut) n'a pas finance:read/webhooks:read → 403.
    const modToken = app.jwt.sign({ sub: promotedUserId, role: 'ADMIN' }, { expiresIn: '15m' });
    const denied = await app.inject({ method: 'GET', url: '/api/v1/admin/finance/overview', headers: auth(modToken) });
    expect(denied.statusCode).toBe(403);
    const deniedWh = await app.inject({ method: 'GET', url: '/api/v1/admin/finance/webhooks', headers: auth(modToken) });
    expect(deniedWh.statusCode).toBe(403);
  });
});
