// Tests d'intégration — Diffusion / veille sanitaire (admin). CI (DB+Redis).
// Vérifie : RBAC campaigns:write, ciblage rôle/langue, fan-out Notification DANS
// LA LANGUE du destinataire (repli FR), campagne figée après diffusion, audit.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
// admin CONTENT (a campaigns:write), admin restreint (ne l'a pas),
// patient FR, patient EN, médecin FR, patient suspendu (exclu de l'audience).
const PHONES = ['+2290197700001', '+2290197700002', '+2290197700003', '+2290197700004', '+2290197700005', '+2290197700006'];

const CONTENT = ['education:write', 'campaigns:write'];
const RESTRICTED = ['users:read', 'audit:read'];

describe.skipIf(!HAS_INFRA)('Admin — diffusion / veille sanitaire (intégration)', () => {
  let app: FastifyInstance;
  let contentToken: string;
  let restrictedToken: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  const recipientIds: string[] = [];

  const cleanup = async () => {
    if (recipientIds.length) await app.prisma.notification.deleteMany({ where: { recipientId: { in: recipientIds } } });
    await app.prisma.healthCampaign.deleteMany({ where: { category: 'VACCINATION' } });
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
  };

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const contentAdmin = await app.prisma.user.create({
      data: { phone: PHONES[0], role: 'ADMIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Camp', lastName: 'Content' } }, adminProfile: { create: { scopes: CONTENT, preset: 'CONTENT' } } },
    });
    const restricted = await app.prisma.user.create({
      data: { phone: PHONES[1], role: 'ADMIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Camp', lastName: 'Restr' } }, adminProfile: { create: { scopes: RESTRICTED, preset: null } } },
    });
    const patFr = await app.prisma.user.create({ data: { phone: PHONES[2], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Pat', lastName: 'Fr' } }, patient: { create: {} } } });
    const patEn = await app.prisma.user.create({ data: { phone: PHONES[3], role: 'PATIENT', status: 'ACTIVE', lang: 'EN', profile: { create: { firstName: 'Pat', lastName: 'En' } }, patient: { create: {} } } });
    const docFr = await app.prisma.user.create({ data: { phone: PHONES[4], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Doc', lastName: 'Fr' } }, doctor: { create: { speciality: 'GEN', licenseNumber: 'BJ-CAM-00001', consultFee: 0 } } } });
    const patSuspended = await app.prisma.user.create({ data: { phone: PHONES[5], role: 'PATIENT', status: 'SUSPENDED', lang: 'FR', profile: { create: { firstName: 'Pat', lastName: 'Susp' } }, patient: { create: {} } } });
    recipientIds.push(patFr.id, patEn.id, docFr.id, patSuspended.id);

    contentToken = app.jwt.sign({ sub: contentAdmin.id, role: 'ADMIN' }, { expiresIn: '15m' });
    restrictedToken = app.jwt.sign({ sub: restricted.id, role: 'ADMIN' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('RBAC : un admin sans campaigns:write est refusé (403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/campaigns', headers: auth(restrictedToken) });
    expect(res.statusCode).toBe(403);
  });

  it('aperçu de la portée : ciblage rôle PATIENT compte les patients ACTIFS (hors suspendu)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/campaigns/audience?audienceRole=PATIENT', headers: auth(contentToken) });
    expect(res.statusCode).toBe(200);
    // patFr + patEn (le suspendu est exclu). D'autres patients d'autres tests peuvent exister → >= 2.
    expect(res.json().audienceCount).toBeGreaterThanOrEqual(2);
  });

  it('diffusion : fan-out Notification par destinataire dans SA langue (repli FR), campagne figée', async () => {
    // Campagne ciblée PATIENT, FR + EN fournis.
    const create = await app.inject({
      method: 'POST', url: '/api/v1/admin/campaigns', headers: auth(contentToken),
      payload: {
        category: 'VACCINATION',
        translations: {
          FR: { title: 'Campagne vaccination', body: 'Faites vacciner vos enfants cette semaine.' },
          EN: { title: 'Vaccination drive', body: 'Get your children vaccinated this week.' },
        },
        audienceRole: 'PATIENT',
        channel: 'IN_APP',
      },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().id as string;

    const send = await app.inject({ method: 'POST', url: `/api/v1/admin/campaigns/${id}/send`, headers: auth(contentToken) });
    expect(send.statusCode).toBe(200);
    expect(send.json().audienceCount).toBeGreaterThanOrEqual(2);

    // Le patient FR reçoit le titre FR ; le patient EN reçoit le titre EN.
    const nFr = await app.prisma.notification.findFirst({ where: { recipientId: recipientIds[0], type: 'SYSTEM' }, orderBy: { createdAt: 'desc' } });
    const nEn = await app.prisma.notification.findFirst({ where: { recipientId: recipientIds[1], type: 'SYSTEM' }, orderBy: { createdAt: 'desc' } });
    expect(nFr?.title).toBe('Campagne vaccination');
    expect(nEn?.title).toBe('Vaccination drive'); // localisation par destinataire
    // Le médecin (hors ciblage PATIENT) ne reçoit rien ; le suspendu non plus.
    const nDoc = await app.prisma.notification.findFirst({ where: { recipientId: recipientIds[2], type: 'SYSTEM' } });
    const nSusp = await app.prisma.notification.findFirst({ where: { recipientId: recipientIds[3], type: 'SYSTEM' } });
    expect(nDoc).toBeNull();
    expect(nSusp).toBeNull();

    // Rediffuser est refusé (campagne figée SENT).
    const again = await app.inject({ method: 'POST', url: `/api/v1/admin/campaigns/${id}/send`, headers: auth(contentToken) });
    expect(again.statusCode).toBe(400);

    // Audit CAMPAIGN_SENT écrit, SANS le contenu (métadonnées seulement).
    const audit = await app.prisma.auditLog.findFirst({ where: { action: 'CAMPAIGN_SENT', targetId: id } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.meta ?? {})).not.toContain('Faites vacciner');
  });

  it('modification/suppression interdites après diffusion', async () => {
    const create = await app.inject({
      method: 'POST', url: '/api/v1/admin/campaigns', headers: auth(contentToken),
      payload: { category: 'VACCINATION', translations: { FR: { title: 'T', body: 'B' } }, audienceRole: 'MEDECIN' },
    });
    const id = create.json().id as string;
    // Brouillon → modifiable.
    const edit = await app.inject({ method: 'PUT', url: `/api/v1/admin/campaigns/${id}`, headers: auth(contentToken), payload: { category: 'PREVENTION', translations: { FR: { title: 'T2', body: 'B2' } } } });
    expect(edit.statusCode).toBe(200);
    // Diffusion puis modification refusée.
    await app.inject({ method: 'POST', url: `/api/v1/admin/campaigns/${id}/send`, headers: auth(contentToken) });
    const editAfter = await app.inject({ method: 'PUT', url: `/api/v1/admin/campaigns/${id}`, headers: auth(contentToken), payload: { category: 'PREVENTION', translations: { FR: { title: 'T3', body: 'B3' } } } });
    expect(editAfter.statusCode).toBe(400);
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/admin/campaigns/${id}`, headers: auth(contentToken) });
    expect(del.statusCode).toBe(400);
  });
});
