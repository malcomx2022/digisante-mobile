// Habilitation pharmacie (bloquant pilote) : sans badge KYC `verifiedAt`, une
// officine ne scanne ni ne délivre d'ordonnance et reste absente de la
// recherche patient ; l'approbation KYC exige identité + autorisation vérifiées.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290194500001', '+2290194500002', '+2290194500003']; // pharmacie, patient, admin

describe.skipIf(!HAS_INFRA)('Pharmacie — habilitation KYC (intégration)', () => {
  let app: FastifyInstance;
  let pharmaTok: string;
  let patientTok: string;
  let adminTok: string;
  let pharmaUserId: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  const cleanup = async () => {
    // La revue KYC référence l'admin relecteur : la retirer avant les comptes.
    await app.prisma.kycReview.deleteMany({ where: { reviewer: { phone: { in: PHONES } } } });
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
  };

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();
    const ph = await app.prisma.user.create({
      data: { phone: PHONES[0], role: 'PHARMACIE', status: 'ACTIVE', lang: 'FR', pharmacy: { create: { name: 'Officine Non Vérifiée', address: 'Parakou', phone: PHONES[0] } } },
    });
    const pat = await app.prisma.user.create({ data: { phone: PHONES[1], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', patient: { create: {} } } });
    const admin = await app.prisma.user.create({
      data: { phone: PHONES[2], role: 'ADMIN', status: 'ACTIVE', lang: 'FR', adminProfile: { create: { scopes: ['kyc:review'], preset: 'MODERATION' } } },
    });
    pharmaUserId = ph.id;
    pharmaTok = app.jwt.sign({ sub: ph.id, role: 'PHARMACIE' }, { expiresIn: '15m' });
    patientTok = app.jwt.sign({ sub: pat.id, role: 'PATIENT' }, { expiresIn: '15m' });
    adminTok = app.jwt.sign({ sub: admin.id, role: 'ADMIN' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('non vérifiée : /me le signale, scan et délivrance refusés (403)', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/v1/pharmacy/me', headers: auth(pharmaTok) });
    expect(me.statusCode).toBe(200);
    expect(me.json().verified).toBe(false);
    const scan = await app.inject({ method: 'POST', url: '/api/v1/pharmacy/scan', headers: auth(pharmaTok), payload: { qrCode: 'x'.repeat(32) } });
    expect(scan.statusCode).toBe(403);
    const dispense = await app.inject({
      method: 'POST', url: '/api/v1/pharmacy/prescriptions/ck00000000000000000000000/dispense', headers: auth(pharmaTok),
      payload: { qrCode: 'x'.repeat(32), items: [{ itemId: 'ck00000000000000000000001', status: 'DISPENSED' }] },
    });
    expect(dispense.statusCode).toBe(403);
  });

  it('non vérifiée : le stock se prépare mais reste invisible des patients', async () => {
    const add = await app.inject({ method: 'POST', url: '/api/v1/pharmacy/stock', headers: auth(pharmaTok), payload: { displayName: 'Quininevérif', status: 'IN_STOCK' } });
    expect(add.statusCode).toBe(201);
    const search = await app.inject({ method: 'GET', url: '/api/v1/pharmacy/availability?q=quininevérif', headers: auth(patientTok) });
    expect(search.json().items).toHaveLength(0);
  });

  it('approbation KYC : refusée sans autorisation d’exercice vérifiée, puis badge posé', async () => {
    const sub = await app.prisma.kycSubmission.create({ data: { userId: pharmaUserId, status: 'UNDER_REVIEW', submittedAt: new Date() } });
    await app.prisma.kycDocument.create({ data: { submissionId: sub.id, type: 'NATIONAL_ID', fileUrl: 'synthetic-id', verified: true, verifiedAt: new Date() } });
    const review = () => app.inject({ method: 'POST', url: `/api/v1/kyc/submissions/${sub.id}/review`, headers: auth(adminTok), payload: { decision: 'APPROVED' } });

    const refused = await review();
    expect(refused.statusCode).toBe(400);
    expect((await app.prisma.kycSubmission.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('UNDER_REVIEW');
    expect((await app.prisma.pharmacy.findUniqueOrThrow({ where: { userId: pharmaUserId } })).verifiedAt).toBeNull();

    await app.prisma.kycDocument.create({ data: { submissionId: sub.id, type: 'PRACTICE_LICENSE', fileUrl: 'synthetic-lic', verified: true, verifiedAt: new Date() } });
    const ok = await review();
    expect(ok.statusCode).toBe(200);

    const me = await app.inject({ method: 'GET', url: '/api/v1/pharmacy/me', headers: auth(pharmaTok) });
    expect(me.json().verified).toBe(true);
    const search = await app.inject({ method: 'GET', url: '/api/v1/pharmacy/availability?q=quininevérif', headers: auth(patientTok) });
    expect(search.json().items).toHaveLength(1);
    // Scan désormais autorisé : un QR inconnu donne 404, plus 403.
    const scan = await app.inject({ method: 'POST', url: '/api/v1/pharmacy/scan', headers: auth(pharmaTok), payload: { qrCode: 'x'.repeat(32) } });
    expect(scan.statusCode).toBe(404);
  });
});
