// ─────────────────────────────────────────────────────────────
// Revue indépendante L0–L10 (13/10/2026) — transitions CONCURRENTES.
// `confirm`, `cancel` et la décision KYC lisaient le statut puis écrivaient sans
// condition : une confirmation concurrente ressuscitait un RDV annulé en
// CONFIRMED, deux décisions KYC laissaient un dossier REJECTED avec badge posé.
// Même parade que `applyPaymentStatus` / `wallet.debit` : écriture conditionnelle.
// ─────────────────────────────────────────────────────────────
import { ADMIN_PRESETS } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290190013001', '+2290190013002', '+2290190013003', '+2290190013004'];
const ROUNDS = 8;

describe.skipIf(!HAS_INFRA)('Transitions concurrentes — RDV et revue KYC', () => {
  let app: FastifyInstance;
  let doctorId: string;
  let doctorUserId: string;
  let patientId: string;
  let doctorToken: string;
  let patientToken: string;
  let adminTokens: string[];

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const cleanup = async () => {
    const users = await app.prisma.user.findMany({ where: { phone: { in: PHONES } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await app.prisma.appointment.deleteMany({ where: { OR: [{ doctor: { userId: { in: ids } } }, { patient: { userId: { in: ids } } }] } });
    await app.prisma.kycSubmission.deleteMany({ where: { userId: { in: ids } } });
    await app.prisma.user.deleteMany({ where: { id: { in: ids } } });
  };

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();
    const doctor = await app.prisma.user.create({
      data: {
        phone: PHONES[0], role: 'MEDECIN', status: 'ACTIVE',
        doctor: { create: { speciality: 'Généraliste', licenseNumber: 'BJ-REV-13001', consultFee: 1000, verifiedAt: new Date() } },
      },
      include: { doctor: true },
    });
    const patient = await app.prisma.user.create({
      data: { phone: PHONES[1], role: 'PATIENT', status: 'ACTIVE', patient: { create: {} } }, include: { patient: true },
    });
    const admins = await Promise.all(PHONES.slice(2).map((phone) => app.prisma.user.create({
      data: { phone, role: 'ADMIN', status: 'ACTIVE', adminProfile: { create: { scopes: [...ADMIN_PRESETS.SUPER_ADMIN], preset: 'SUPER_ADMIN' } } },
    })));
    doctorId = doctor.doctor!.id;
    doctorUserId = doctor.id;
    patientId = patient.patient!.id;
    doctorToken = app.jwt.sign({ sub: doctor.id, role: 'MEDECIN' }, { expiresIn: '15m' });
    patientToken = app.jwt.sign({ sub: patient.id, role: 'PATIENT' }, { expiresIn: '15m' });
    adminTokens = admins.map((a) => app.jwt.sign({ sub: a.id, role: 'ADMIN' }, { expiresIn: '15m' }));
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('confirmation ∥ annulation patient : jamais un RDV annulé ressuscité en CONFIRMED', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const appt = await app.prisma.appointment.create({
        data: { doctorId, patientId, type: 'TELECONSULTATION', status: 'PENDING', scheduledAt: new Date(Date.now() + (i + 1) * 3_600_000) },
      });
      const [confirm, cancel] = await Promise.all([
        app.inject({ method: 'POST', url: `/api/v1/appointments/${appt.id}/confirm`, headers: auth(doctorToken) }),
        app.inject({ method: 'POST', url: `/api/v1/appointments/${appt.id}/cancel`, headers: auth(patientToken), payload: { reason: 'concurrence' } }),
      ]);
      expect(cancel.statusCode).toBe(200);
      expect([200, 400]).toContain(confirm.statusCode);
      expect((await app.prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).status).toBe('CANCELLED');
    }
  });

  it('annulation après clôture concurrente : COMPLETED n’est jamais écrasé', async () => {
    const appt = await app.prisma.appointment.create({
      data: { doctorId, patientId, type: 'TELECONSULTATION', status: 'CONFIRMED', scheduledAt: new Date(Date.now() + 3_600_000) },
    });
    await app.prisma.appointment.update({ where: { id: appt.id }, data: { status: 'COMPLETED' } });
    const cancel = await app.inject({ method: 'POST', url: `/api/v1/appointments/${appt.id}/cancel`, headers: auth(doctorToken), payload: { reason: 'trop tard' } });
    expect(cancel.statusCode).toBe(400);
    expect((await app.prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).status).toBe('COMPLETED');
  });

  it('deux décisions KYC simultanées : une seule revue, dossier et badge cohérents', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      await app.prisma.doctor.update({ where: { id: doctorId }, data: { verifiedAt: null } });
      const submission = await app.prisma.kycSubmission.create({ data: { userId: doctorUserId, status: 'UNDER_REVIEW', submittedAt: new Date() } });
      const review = (token: string, decision: 'APPROVED' | 'REJECTED') => app.inject({
        method: 'POST', url: `/api/v1/kyc/submissions/${submission.id}/review`, headers: auth(token), payload: { decision, notes: 'revue concurrente' },
      });
      const results = await Promise.all([review(adminTokens[0], 'APPROVED'), review(adminTokens[1], 'REJECTED')]);
      expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
      const stored = await app.prisma.kycSubmission.findUniqueOrThrow({ where: { id: submission.id }, include: { reviews: true } });
      const badge = (await app.prisma.doctor.findUniqueOrThrow({ where: { id: doctorId } })).verifiedAt;
      expect(stored.reviews).toHaveLength(1);
      expect(stored.reviews[0].decision).toBe(stored.status);
      expect(badge !== null).toBe(stored.status === 'APPROVED');
      await app.prisma.kycSubmission.delete({ where: { id: submission.id } });
    }
  });
});
