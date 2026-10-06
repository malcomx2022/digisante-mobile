// L2 : preuves via HTTP + PostgreSQL réel (concurrence, cloisonnement, KYC).
import { ADMIN_PRESETS } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { linkCare } from '@/test/care-fixture.js';
import { claimOrder } from './laboratory.service.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = Array.from({ length: 7 }, (_, i) => `+229019320000${i}`);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const identity = { name: 'Laboratoire Pilote', address: 'Cotonou', phone: PHONES[2], licenseNumber: 'BJ-LAB-TEST' };

describe.skipIf(!HAS_INFRA)('Habilitation laboratoire L2', () => {
  let app: FastifyInstance;
  let patientId: string;
  let doctorId: string;
  let userIds: string[];
  let labIds: string[];
  let tokens: string[];
  let ip = 0;
  let failNotification = false;
  const auth = (i: number) => ({ authorization: `Bearer ${tokens[i]}`, 'x-forwarded-for': `192.0.2.${ip}` });
  const request = (i: number, method: 'GET' | 'POST' | 'PUT', path: string, payload?: object) => app.inject({ method, url: `/api/v1${path}`, headers: auth(i), payload });
  const cleanup = async () => {
    await app.prisma.labOrder.deleteMany({ where: { patient: { user: { phone: { in: PHONES } } } } });
    await app.prisma.kycSubmission.deleteMany({ where: { user: { phone: { in: PHONES } } } });
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
  };
  const order = (labId?: string, status: 'PENDING' | 'SAMPLE_COLLECTED' | 'PROCESSING' = 'PENDING') => app.prisma.labOrder.create({ data: { patientId, prescribedById: doctorId, labId, status, testType: 'Test pilote' } });
  const upload = (type: string) => request(2, 'POST', '/kyc/documents', { type, mimeType: 'image/png', fileName: 'preuve.png', dataBase64: PNG });
  async function dossier() {
    const opened = await request(2, 'POST', '/kyc');
    expect(opened.statusCode).toBe(201);
    expect((await request(2, 'PUT', '/kyc/laboratory', identity)).statusCode).toBe(200);
    expect((await upload('NATIONAL_ID')).statusCode).toBe(201);
    expect((await upload('PRACTICE_LICENSE')).statusCode).toBe(201);
    const submitted = await request(2, 'POST', '/kyc/submit');
    expect(submitted.statusCode).toBe(200);
    return submitted.json() as { id: string; documents: { id: string }[] };
  }
  async function verifiedDossier() {
    const d = await dossier();
    for (const doc of d.documents) expect((await request(5, 'POST', `/kyc/documents/${doc.id}/verify`, { verified: true })).statusCode).toBe(200);
    return d;
  }
  const decision = (id: string, value: string) => request(5, 'POST', `/kyc/submissions/${id}/review`, { decision: value });

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer(); await app.ready(); await cleanup();
    app.prisma.$use(async (params, next) => {
      if (failNotification && params.model === 'Notification' && params.action === 'create') throw new Error('Panne synthétique de notification');
      return next(params);
    });
    userIds = []; labIds = []; tokens = [];
    const roles = ['LABORATOIRE', 'LABORATOIRE', 'LABORATOIRE', 'PATIENT', 'MEDECIN', 'ADMIN', 'ADMIN'] as const;
    for (const [i, role] of roles.entries()) {
      const user = await app.prisma.user.create({ data: {
        phone: PHONES[i], role, status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Pilote', lastName: String(i) } },
        ...(role === 'LABORATOIRE' ? { lab: { create: { name: 'Labo', address: 'Cotonou', phone: PHONES[i], servicesOffered: [] } } } : {}),
        ...(role === 'PATIENT' ? { patient: { create: {} } } : {}),
        ...(role === 'MEDECIN' ? { doctor: { create: { speciality: 'Bio', licenseNumber: 'BJ-MED-L2', consultFee: 1000, verifiedAt: new Date() } } } : {}),
        ...(role === 'ADMIN' ? { adminProfile: { create: { scopes: i === 5 ? [...ADMIN_PRESETS.MODERATION] : ['users:read'] } } } : {}),
      }, include: { lab: true, patient: true, doctor: true } });
      userIds.push(user.id); tokens.push(app.jwt.sign({ sub: user.id, role }, { expiresIn: '1h' }));
      if (user.lab) labIds.push(user.lab.id);
      if (user.patient) patientId = user.patient.id;
      if (user.doctor) doctorId = user.doctor.id;
    }
    await linkCare(app, userIds[4], patientId);
  });
  beforeEach(async () => {
    ip++;
    await app.prisma.labOrder.deleteMany({ where: { patientId } });
    await app.prisma.kycSubmission.deleteMany({ where: { userId: { in: userIds.slice(0, 3) } } });
    await app.prisma.user.updateMany({ where: { id: { in: userIds.slice(0, 3) } }, data: { status: 'ACTIVE', role: 'LABORATOIRE' } });
    await app.prisma.lab.updateMany({ where: { id: { in: labIds } }, data: { verifiedAt: null, licenseNumber: null } });
    await app.prisma.lab.updateMany({ where: { id: { in: labIds.slice(0, 2) } }, data: { verifiedAt: new Date(), licenseNumber: 'TEST-APPROVED' } });
  });
  afterAll(async () => { if (app) { await cleanup(); await app.close(); } });

  async function deniedLaboratory() {
    const o = await order(labIds[2], 'PROCESSING');
    for (const path of ['/lab/orders', '/lab/orders/available', '/lab/orders/incoming']) {
      expect((await request(2, 'GET', path)).statusCode).toBe(403);
    }
    for (const action of ['claim', 'advance', 'result']) {
      expect((await request(2, 'POST', `/lab/orders/${o.id}/${action}`, action === 'result' ? { values: { glucose: 1 } } : undefined)).statusCode).toBe(403);
    }
    expect(await app.prisma.labResult.count({ where: { labOrderId: o.id } })).toBe(0);
  }
  it('refuse un laboratoire non vérifié sur toutes les lectures et mutations', deniedLaboratory);
  it('refuse un compte PENDING_KYC même avec un badge', async () => {
    await app.prisma.lab.update({ where: { id: labIds[2] }, data: { verifiedAt: new Date() } });
    await app.prisma.user.update({ where: { id: userIds[2] }, data: { status: 'PENDING_KYC' } });
    await deniedLaboratory();
  });
  it('refuse le rejet et conserve le badge absent', async () => {
    const d = await dossier(); expect((await decision(d.id, 'REJECTED')).statusCode).toBe(200);
    await deniedLaboratory();
  });
  it('suspension : conserve les demandes et résultats, ferme chaque endpoint', async () => {
    await app.prisma.lab.update({ where: { id: labIds[2] }, data: { verifiedAt: new Date() } });
    const o = await order(labIds[2], 'PROCESSING');
    const r = await app.prisma.labResult.create({ data: { labOrderId: o.id, values: { glucose: 1 } } });
    await app.prisma.user.update({ where: { id: userIds[2] }, data: { status: 'SUSPENDED' } });
    for (const path of ['/lab/orders', '/lab/orders/available', '/lab/orders/incoming']) expect((await request(2, 'GET', path)).statusCode).toBe(401);
    for (const action of ['claim', 'advance', 'result']) expect((await request(2, 'POST', `/lab/orders/${o.id}/${action}`, action === 'result' ? { values: {} } : undefined)).statusCode).toBe(401);
    expect((await app.prisma.labOrder.findUniqueOrThrow({ where: { id: o.id } })).labId).toBe(labIds[2]);
    expect(await app.prisma.labResult.findUnique({ where: { id: r.id } })).toBeTruthy();
    expect((await request(3, 'GET', '/lab/orders')).json().find((row: { id: string }) => row.id === o.id).result.values).toEqual({ glucose: 1 });
  });
  it('recontrôle le rôle courant malgré un ancien JWT laboratoire', async () => {
    await app.prisma.user.update({ where: { id: userIds[0] }, data: { role: 'ADMIN' } });
    expect((await request(0, 'GET', '/lab/orders/incoming')).statusCode).toBe(403);
  });
  it('ouvre un seul dossier lors de deux créations simultanées', async () => {
    const responses = await Promise.all([request(2, 'POST', '/kyc'), request(2, 'POST', '/kyc')]);
    expect(responses.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(responses[0].json().id).toBe(responses[1].json().id);
  });
  it('ne soumet pas une structure incomplète', async () => {
    await request(2, 'POST', '/kyc'); await upload('NATIONAL_ID'); await upload('PRACTICE_LICENSE');
    expect((await request(2, 'POST', '/kyc/submit')).statusCode).toBe(400);
  });
  it('ne soumet pas sans autorisation de la structure', async () => {
    await request(2, 'POST', '/kyc'); await request(2, 'PUT', '/kyc/laboratory', identity); await upload('NATIONAL_ID');
    expect((await request(2, 'POST', '/kyc/submit')).statusCode).toBe(400);
  });
  it('fige l’identité et les uploads pendant la revue', async () => {
    const d = await dossier();
    expect((await request(2, 'PUT', '/kyc/laboratory', { ...identity, name: 'Autre structure' })).statusCode).toBe(403);
    expect((await upload('NATIONAL_ID')).statusCode).toBe(400);
    const detail = await request(5, 'GET', `/kyc/submissions/${d.id}`);
    expect(detail.json().labIdentity).toEqual(identity);
  });
  it('refuse une approbation sans vérification effective des pièces', async () => {
    const d = await dossier();
    expect((await decision(d.id, 'APPROVED')).statusCode).toBe(400);
    expect((await app.prisma.lab.findUniqueOrThrow({ where: { id: labIds[2] } })).verifiedAt).toBeNull();
  });
  it('approbation complète : badge, compte actif et accès laboratoire', async () => {
    const d = await verifiedDossier();
    expect((await decision(d.id, 'APPROVED')).statusCode).toBe(200);
    expect((await request(2, 'GET', '/lab/orders/available')).statusCode).toBe(200);
    expect((await request(2, 'GET', '/kyc/laboratory')).json().canProcess).toBe(true);
    expect((await request(2, 'POST', '/kyc')).json().id).toBe(d.id);
    expect((await request(2, 'PUT', '/kyc/laboratory', identity)).statusCode).toBe(403);
    expect((await request(5, 'POST', `/kyc/documents/${d.documents[0].id}/verify`, { verified: false })).statusCode).toBe(403);
  });
  it('deux décisions concurrentes : une seule décision et un seul audit', async () => {
    const d = await verifiedDossier();
    const responses = await Promise.all([decision(d.id, 'APPROVED'), decision(d.id, 'REJECTED')]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 403]);
    expect(await app.prisma.kycReview.count({ where: { submissionId: d.id } })).toBe(1);
    const audits = await app.prisma.auditLog.findMany({ where: { targetId: userIds[2], action: { in: ['KYC_APPROVE', 'KYC_REJECT'] } } });
    expect(audits.filter((a) => (a.meta as { submissionId?: string })?.submissionId === d.id)).toHaveLength(1);
  });
  it('une approbation ne lève jamais une suspension', async () => {
    const d = await verifiedDossier();
    await app.prisma.user.update({ where: { id: userIds[2] }, data: { status: 'SUSPENDED' } });
    expect((await decision(d.id, 'APPROVED')).statusCode).toBe(403);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: userIds[2] } })).status).toBe('SUSPENDED');
  });
  it('renvoi pour correction puis nouvelle soumission et approbation', async () => {
    const d = await dossier(); expect((await decision(d.id, 'NEEDS_REVISION')).statusCode).toBe(200);
    expect((await request(2, 'PUT', '/kyc/laboratory', identity)).statusCode).toBe(200);
    expect((await request(2, 'POST', '/kyc/submit')).statusCode).toBe(200);
    for (const doc of d.documents) await request(5, 'POST', `/kyc/documents/${doc.id}/verify`, { verified: true });
    expect((await decision(d.id, 'APPROVED')).statusCode).toBe(200);
  });
  it('une resoumission efface les anciennes coches avant une nouvelle revue', async () => {
    const d = await verifiedDossier(); await decision(d.id, 'NEEDS_REVISION');
    await request(2, 'PUT', '/kyc/laboratory', { ...identity, licenseNumber: 'BJ-LAB-NOUVELLE' });
    expect((await request(2, 'POST', '/kyc/submit')).statusCode).toBe(200);
    expect((await decision(d.id, 'APPROVED')).statusCode).toBe(400);
    expect((await request(5, 'GET', `/kyc/submissions/${d.id}`)).json().documents.every((d: { verified: boolean }) => !d.verified)).toBe(true);
  });
  it('rejet : nouveau dossier requis, les anciennes pièces restent historiques', async () => {
    const d = await dossier(); await decision(d.id, 'REJECTED');
    const next = await request(2, 'POST', '/kyc');
    expect(next.json().id).not.toBe(d.id); expect(next.json().documents).toHaveLength(0);
  });
  it('reprend un ancien APPROVED sans badge par une nouvelle revue complète', async () => {
    const legacy = await app.prisma.kycSubmission.create({ data: { userId: userIds[2], status: 'APPROVED' } });
    const opened = await request(2, 'POST', '/kyc');
    expect(opened.json().id).not.toBe(legacy.id); expect(opened.json().status).toBe('NOT_SUBMITTED');
    await deniedLaboratory();
  });
  it('ancien dossier en revue sans identité figée : approbation refusée', async () => {
    const legacy = await app.prisma.kycSubmission.create({ data: { userId: userIds[2], status: 'UNDER_REVIEW' } });
    expect((await decision(legacy.id, 'APPROVED')).statusCode).toBe(400);
  });
  it('admin KYC : identité et pièces seulement, aucun contenu patient ou résultat', async () => {
    const d = await dossier(); const o = await order(labIds[2], 'PROCESSING');
    await app.prisma.labResult.create({ data: { labOrderId: o.id, values: { secret_analyte: 777 } } });
    const detail = await request(5, 'GET', `/kyc/submissions/${d.id}`);
    expect(detail.statusCode).toBe(200); expect(detail.json().labIdentity).toEqual(identity);
    expect(detail.body).not.toContain('secret_analyte'); expect(detail.body).not.toContain(patientId); expect(detail.body).not.toContain(o.id);
    expect((await request(5, 'GET', '/lab/orders')).statusCode).toBe(403);
    expect((await request(6, 'GET', `/kyc/submissions/${d.id}`)).statusCode).toBe(403);
    expect((await request(6, 'POST', `/kyc/submissions/${d.id}/review`, { decision: 'APPROVED' })).statusCode).toBe(403);
  });
  it('deux claims concurrents de laboratoires distincts : un gagnant, une attribution et un audit', async () => {
    const o = await order();
    const responses = await Promise.all([request(0, 'POST', `/lab/orders/${o.id}/claim`), request(1, 'POST', `/lab/orders/${o.id}/claim`)]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 400]);
    const winner = responses[0].statusCode === 200 ? 0 : 1;
    expect((await app.prisma.labOrder.findUniqueOrThrow({ where: { id: o.id } })).labId).toBe(labIds[winner]);
    expect((await request(1 - winner, 'GET', '/lab/orders/incoming')).json()).toHaveLength(0);
    const audits = await app.prisma.auditLog.findMany({ where: { action: 'LAB_ORDER_CLAIM' } });
    expect(audits.filter((a) => (a.meta as { orderId?: string })?.orderId === o.id)).toHaveLength(1);
  });
  it('pool sans identité et commandes privées après attribution', async () => {
    const o = await order();
    const pool = (await request(0, 'GET', '/lab/orders/available')).json();
    expect(Object.keys(pool.find((r: { id: string }) => r.id === o.id)).sort()).toEqual(['createdAt', 'id', 'scheduledAt', 'testType']);
    await request(0, 'POST', `/lab/orders/${o.id}/claim`);
    expect((await request(1, 'GET', '/lab/orders')).json()).toHaveLength(0);
    expect((await request(1, 'POST', `/lab/orders/${o.id}/advance`)).statusCode).toBe(403);
    expect((await request(1, 'POST', `/lab/orders/${o.id}/result`, { values: {} })).statusCode).toBe(403);
  });
  it('prescription ciblée : pool du destinataire seulement puis claim', async () => {
    const res = await request(4, 'POST', '/lab/orders', { patientId, labId: labIds[0], testType: 'Ciblée' });
    expect(res.statusCode).toBe(201); const id = res.json().id;
    expect((await request(1, 'GET', '/lab/orders/available')).json()).toHaveLength(0);
    expect((await request(0, 'GET', '/lab/orders/incoming')).json()).toHaveLength(0);
    expect((await request(1, 'POST', `/lab/orders/${id}/claim`)).statusCode).toBe(400);
    expect((await request(0, 'POST', `/lab/orders/${id}/claim`)).statusCode).toBe(200);
  });
  it('prescription ciblée vers un laboratoire non habilité : refusée', async () => {
    expect((await request(4, 'POST', '/lab/orders', { patientId, labId: labIds[2], testType: 'Ciblée' })).statusCode).toBe(403);
    expect(await app.prisma.labOrder.count({ where: { patientId } })).toBe(0);
  });
  it('ne publie pas avant traitement et ne recommence pas une transition', async () => {
    const o = await order(); await request(0, 'POST', `/lab/orders/${o.id}/claim`);
    expect((await request(0, 'POST', `/lab/orders/${o.id}/result`, { values: {} })).statusCode).toBe(400);
    expect((await request(0, 'POST', `/lab/orders/${o.id}/advance`)).statusCode).toBe(200);
    expect((await request(0, 'POST', `/lab/orders/${o.id}/advance`)).statusCode).toBe(400);
  });
  it('publications concurrentes : un résultat et une notification patient', async () => {
    const o = await order(labIds[0], 'PROCESSING');
    const before = await app.prisma.notification.count({ where: { recipientId: userIds[3], type: 'LAB_RESULT' } });
    const responses = await Promise.all([request(0, 'POST', `/lab/orders/${o.id}/result`, { values: { glucose: 1 } }), request(0, 'POST', `/lab/orders/${o.id}/result`, { values: { glucose: 2 } })]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 400]);
    expect(await app.prisma.labResult.count({ where: { labOrderId: o.id } })).toBe(1);
    expect(await app.prisma.notification.count({ where: { recipientId: userIds[3], type: 'LAB_RESULT' } })).toBe(before + 1);
  });
  it('un échec de notification annule résultat et transition dans la même transaction', async () => {
    const o = await order(labIds[0], 'PROCESSING');
    const before = await app.prisma.notification.count({ where: { recipientId: userIds[3], type: 'LAB_RESULT' } });
    failNotification = true;
    try { expect((await request(0, 'POST', `/lab/orders/${o.id}/result`, { values: { glucose: 1 } })).statusCode).toBe(500); }
    finally { failNotification = false; }
    expect((await app.prisma.labOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('PROCESSING');
    expect(await app.prisma.labResult.count({ where: { labOrderId: o.id } })).toBe(0);
    expect(await app.prisma.notification.count({ where: { recipientId: userIds[3], type: 'LAB_RESULT' } })).toBe(before);
    expect((await request(0, 'POST', `/lab/orders/${o.id}/result`, { values: { glucose: 1 } })).statusCode).toBe(201);
  });
  it('une suspension gagnante au verrou est revérifiée avant attribution', async () => {
    const o = await order();
    let release!: () => void; let locked!: () => void;
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const suspension = app.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userIds[0] }, data: { status: 'SUSPENDED' } });
      locked(); await gate;
    });
    await ready;
    const claim = claimOrder(app, userIds[0], o.id);
    release(); await suspension;
    await expect(claim).rejects.toMatchObject({ statusCode: 403 });
    expect((await app.prisma.labOrder.findUniqueOrThrow({ where: { id: o.id } })).labId).toBeNull();
  });
});
