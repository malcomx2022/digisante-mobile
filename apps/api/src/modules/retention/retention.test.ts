// Tests d'intégration des purges de conservation (D-8). CI uniquement (DB+Redis).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runRetention } from './retention.service.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONE = '+2290195700001';
const TOKEN = 'retention_service_token';
const DAY = 86_400_000;
// Fixtures datées de 400 jours : bien au-delà de la durée de test (30 j), et
// sans effet sur les données récentes des autres suites.
const OLD = new Date(Date.now() - 400 * DAY);

describe.skipIf(!HAS_INFRA)('Purges de conservation (intégration)', () => {
  let app: FastifyInstance;
  let userId: string;
  let patientId: string;

  const cleanup = async () => {
    await app.prisma.notification.deleteMany({ where: { recipient: { phone: PHONE } } });
    await app.prisma.user.deleteMany({ where: { phone: PHONE } });
  };

  // Retire les lignes de test d'un scénario sans toucher au compte.
  const clearFixtures = async () => {
    await app.prisma.notification.deleteMany({ where: { recipientId: userId } });
    await app.prisma.sos.deleteMany({ where: { patientId } });
  };

  const seed = async () => {
    const n = (status: 'PENDING' | 'SENT' | 'READ' | 'FAILED', createdAt: Date, title: string) =>
      app.prisma.notification.create({ data: { recipientId: userId, type: 'SYSTEM', channel: 'IN_APP', title, body: 'x', status, createdAt } });
    const s = (status: 'ACTIVE' | 'RESOLVED' | 'FALSE_ALARM', resolvedAt: Date | null) =>
      app.prisma.sos.create({ data: { patientId, latitude: 6.3, longitude: 2.4, status, resolvedAt, createdAt: OLD } });
    return {
      oldSent: await n('SENT', OLD, 'old-sent'),
      oldRead: await n('READ', OLD, 'old-read'),
      oldFailed: await n('FAILED', OLD, 'old-failed'),
      oldPending: await n('PENDING', OLD, 'old-pending'),
      recentRead: await n('READ', new Date(), 'recent-read'),
      sosResolved: await s('RESOLVED', OLD),
      sosFalse: await s('FALSE_ALARM', OLD),
      sosActive: await s('ACTIVE', null),
      sosRecent: await s('RESOLVED', new Date()),
    };
  };

  beforeAll(async () => {
    process.env.RECONCILE_TOKEN = TOKEN;
    process.env.RETENTION_NOTIFICATIONS_DAYS = '30';
    process.env.RETENTION_SOS_CLOSED_DAYS = '30';
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();
    const user = await app.prisma.user.create({
      data: { phone: PHONE, role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Ret', lastName: 'Ention' } }, patient: { create: {} } },
      include: { patient: true },
    });
    userId = user.id;
    patientId = user.patient!.id;
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  const purge = (query = '') =>
    app.inject({ method: 'POST', url: `/api/v1/retention/purge${query}`, headers: { 'x-service-token': TOKEN } });

  it('refuse sans jeton de service', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/retention/purge' });
    expect(res.statusCode).toBe(401);
  });

  it('simulation : compte sans supprimer ni auditer', async () => {
    const f = await seed();
    const auditsBefore = await app.prisma.auditLog.count({ where: { action: 'RETENTION_PURGE' } });
    const res = await purge('?dryRun=1');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dryRun).toBe(true);
    for (const c of body.categories) {
      expect(c.enabled).toBe(true);
      expect(c.retentionDays).toBe(30);
      expect(c.deleted).toBe(0);
      expect(c.matched).toBeGreaterThanOrEqual(2);
    }
    expect(await app.prisma.notification.count({ where: { id: f.oldSent.id } })).toBe(1);
    expect(await app.prisma.sos.count({ where: { id: f.sosResolved.id } })).toBe(1);
    expect(await app.prisma.auditLog.count({ where: { action: 'RETENTION_PURGE' } })).toBe(auditsBefore);
    await clearFixtures();
  });

  it('supprime les anciennes lignes closes, garde PENDING, ACTIVE et le récent ; audit sans identifiant', async () => {
    await clearFixtures();
    const f = await seed();
    const res = await purge();
    expect(res.statusCode).toBe(200);
    const exists = {
      n: async (id: string) => (await app.prisma.notification.count({ where: { id } })) === 1,
      s: async (id: string) => (await app.prisma.sos.count({ where: { id } })) === 1,
    };
    expect(await exists.n(f.oldSent.id)).toBe(false);
    expect(await exists.n(f.oldRead.id)).toBe(false);
    expect(await exists.n(f.oldFailed.id)).toBe(false);
    expect(await exists.n(f.oldPending.id)).toBe(true);
    expect(await exists.n(f.recentRead.id)).toBe(true);
    expect(await exists.s(f.sosResolved.id)).toBe(false);
    expect(await exists.s(f.sosFalse.id)).toBe(false);
    expect(await exists.s(f.sosActive.id)).toBe(true);
    expect(await exists.s(f.sosRecent.id)).toBe(true);

    const audit = await app.prisma.auditLog.findFirst({ where: { action: 'RETENTION_PURGE' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    expect(audit).not.toBeNull();
    const meta = JSON.stringify(audit!.meta);
    expect(meta).toContain('NOTIFICATIONS');
    expect(meta).toContain('SOS_CLOSED');
    // Compteurs seulement : aucun identifiant de ligne ni de compte.
    for (const id of [f.oldSent.id, f.sosResolved.id, userId, patientId]) expect(meta).not.toContain(id);
  });

  it('sans durée configurée : rien n’est supprimé, aucun audit', async () => {
    await clearFixtures();
    const f = await seed();
    const auditsBefore = await app.prisma.auditLog.count({ where: { action: 'RETENTION_PURGE' } });
    const result = await runRetention(app.prisma, {}, { dryRun: false });
    expect(result.categories.every((c) => !c.enabled && c.deleted === 0)).toBe(true);
    expect(await app.prisma.notification.count({ where: { id: f.oldSent.id } })).toBe(1);
    expect(await app.prisma.sos.count({ where: { id: f.sosResolved.id } })).toBe(1);
    expect(await app.prisma.auditLog.count({ where: { action: 'RETENTION_PURGE' } })).toBe(auditsBefore);
  });
});
