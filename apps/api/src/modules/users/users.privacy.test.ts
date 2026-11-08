// Conformité APDP : consentement versionné aux CGU et droit à l'effacement
// (demande du titulaire → exécution admin, décision du porteur du 7/11/2026).
import { TERMS_VERSION } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readEncryptedFile, storeEncryptedFile } from '@/lib/filestore.js';
import { REGISTER_TERMS } from '@/test/terms-fixture.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290194700001', '+2290194700002', '+2290194700003', '+2290194700004', '+2290194700005'];
// patient effacé, patient refusé, admin users:write, admin lecture seule, médecin

describe.skipIf(!HAS_INFRA)('APDP : CGU versionnées et droit à l’effacement (intégration)', () => {
  let app: FastifyInstance;
  let patientTok: string;
  let otherTok: string;
  let adminTok: string;
  let readerTok: string;
  let patientUserId: string;
  let patientId: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  const cleanup = async () => {
    const users = await app.prisma.user.findMany({ where: { OR: [{ phone: { in: PHONES } }, { phone: { startsWith: 'deleted:' }, profile: { firstName: 'Compte' }, deletionRequests: { some: {} } }] }, select: { id: true } });
    await app.prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  };

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();
    const pat = await app.prisma.user.create({
      data: { phone: PHONES[0], email: 'efface@example.test', role: 'PATIENT', status: 'ACTIVE', profile: { create: { firstName: 'Ama', lastName: 'Efface', emergencyContact: '+2290194799999' } }, patient: { create: {} } },
      include: { patient: true },
    });
    const other = await app.prisma.user.create({ data: { phone: PHONES[1], role: 'PATIENT', status: 'ACTIVE', patient: { create: {} } } });
    const admin = await app.prisma.user.create({ data: { phone: PHONES[2], role: 'ADMIN', status: 'ACTIVE', adminProfile: { create: { scopes: ['users:read', 'users:write'], preset: 'SUPPORT' } } } });
    const reader = await app.prisma.user.create({ data: { phone: PHONES[3], role: 'ADMIN', status: 'ACTIVE', adminProfile: { create: { scopes: ['users:read'], preset: null } } } });
    patientUserId = pat.id;
    patientId = pat.patient!.id;
    patientTok = app.jwt.sign({ sub: pat.id, role: 'PATIENT' }, { expiresIn: '15m' });
    otherTok = app.jwt.sign({ sub: other.id, role: 'PATIENT' }, { expiresIn: '15m' });
    adminTok = app.jwt.sign({ sub: admin.id, role: 'ADMIN' }, { expiresIn: '15m' });
    readerTok = app.jwt.sign({ sub: reader.id, role: 'ADMIN' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('inscription : acceptation explicite de la version courante exigée, puis enregistrée', async () => {
    const base = { phone: PHONES[4], role: 'PATIENT', lang: 'FR', firstName: 'Cgu', lastName: 'Test' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: base })).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { ...base, acceptTerms: true, termsVersion: 'ancienne' } })).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { ...base, ...REGISTER_TERMS } })).statusCode).toBe(201);
    const created = await app.prisma.user.findUniqueOrThrow({ where: { phone: PHONES[4] } });
    expect(created.termsVersion).toBe(TERMS_VERSION);
    expect(created.termsAcceptedAt).not.toBeNull();
  });

  it('compte existant : ré-acceptation de la version courante seulement', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/users/me/terms', headers: auth(otherTok), payload: { version: 'ancienne' } })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/users/me/terms', headers: auth(otherTok), payload: { version: TERMS_VERSION } });
    expect(ok.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/api/v1/users/me', headers: auth(otherTok) });
    expect(me.json().termsVersion).toBe(TERMS_VERSION);
  });

  it('demande d’effacement idempotente ; refus motivé ; un admin ne s’efface pas par ce circuit', async () => {
    const a = await app.inject({ method: 'POST', url: '/api/v1/users/me/deletion-request', headers: auth(otherTok) });
    const b = await app.inject({ method: 'POST', url: '/api/v1/users/me/deletion-request', headers: auth(otherTok) });
    expect(a.statusCode).toBe(201);
    expect(b.json().id).toBe(a.json().id);
    expect((await app.inject({ method: 'POST', url: '/api/v1/users/me/deletion-request', headers: auth(adminTok) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/deletion-requests/${a.json().id}/reject`, headers: auth(readerTok), payload: { reason: 'Obligation légale' } })).statusCode).toBe(403);
    const rej = await app.inject({ method: 'POST', url: `/api/v1/admin/deletion-requests/${a.json().id}/reject`, headers: auth(adminTok), payload: { reason: 'Obligation légale de conservation' } });
    expect(rej.statusCode).toBe(200);
    const mine = await app.inject({ method: 'GET', url: '/api/v1/users/me/deletion-request', headers: auth(otherTok) });
    expect(mine.json().status).toBe('REJECTED');
  });

  it('exécution admin : santé et fichiers effacés, identité anonymisée, compte fermé, audit et finances conservés', async () => {
    const fileId = await storeEncryptedFile(Buffer.from('pièce synthétique'));
    const record = await app.prisma.medicalRecord.create({
      data: { patientId, type: 'OTHER', title: 'Entrée synthétique', documents: { create: { filename: 'x.pdf', mimeType: 'application/pdf', encryptedUrl: fileId, checksum: 'x', size: 1 } } },
    });
    await app.prisma.sos.create({ data: { patientId, latitude: 6.3, longitude: 2.4, status: 'ACTIVE' } });
    await app.prisma.notification.create({ data: { recipientId: patientUserId, type: 'SYSTEM', channel: 'IN_APP', title: 't', body: 'b', status: 'PENDING' } });
    const payment = await app.prisma.payment.create({ data: { userId: patientUserId, amount: 100, currency: 'XOF', method: 'WALLET', type: 'WALLET_TOPUP', status: 'COMPLETED' } });

    const req = await app.inject({ method: 'POST', url: '/api/v1/users/me/deletion-request', headers: auth(patientTok) });
    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/deletion-requests?status=PENDING', headers: auth(readerTok) });
    expect(list.json().some((r: { id: string }) => r.id === req.json().id)).toBe(true);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/deletion-requests/${req.json().id}/execute`, headers: auth(readerTok) })).statusCode).toBe(403);

    const exec = await app.inject({ method: 'POST', url: `/api/v1/admin/deletion-requests/${req.json().id}/execute`, headers: auth(adminTok) });
    expect(exec.statusCode).toBe(200);
    expect(exec.json()).toMatchObject({ status: 'COMPLETED', records: 1, files: 1, filesNotDeleted: 0 });

    expect(await app.prisma.medicalRecord.findUnique({ where: { id: record.id } })).toBeNull();
    await expect(readEncryptedFile(fileId)).rejects.toThrow();
    expect(await app.prisma.sos.count({ where: { patientId } })).toBe(0);
    expect(await app.prisma.notification.count({ where: { recipientId: patientUserId } })).toBe(0);
    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: patientUserId }, include: { profile: true } });
    expect(user.phone).toBe(`deleted:${patientUserId}`);
    expect(user.email).toBeNull();
    expect(user.status).toBe('SUSPENDED');
    expect(user.deletedAt).not.toBeNull();
    expect(user.profile).toMatchObject({ firstName: 'Compte', lastName: 'supprimé', emergencyContact: null });
    // Conservés, pseudonymisés : paiement et audit.
    expect(await app.prisma.payment.findUnique({ where: { id: payment.id } })).not.toBeNull();
    expect(await app.prisma.auditLog.count({ where: { action: 'ACCOUNT_DELETION_EXECUTED', targetId: patientUserId } })).toBe(1);
    // Compte fermé : l'ancien jeton est refusé ; seconde exécution refusée.
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me', headers: auth(patientTok) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/deletion-requests/${req.json().id}/execute`, headers: auth(adminTok) })).statusCode).toBe(400);
  });
});
