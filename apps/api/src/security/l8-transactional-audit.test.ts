import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Prisma, MedicalRecord, KycSubmission } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as audit from '@/lib/audit.js';
import { resolveDmpScope } from '@/lib/dmp-consent.js';
import * as dmp from '@/modules/dmp/dmp.service.js';
import * as kyc from '@/modules/kyc/kyc.laboratory.js';
import * as professionalKyc from '@/modules/kyc/kyc.service.js';
import * as lab from '@/modules/laboratory/laboratory.service.js';

describe.skipIf(!process.env.DATABASE_URL || !process.env.REDIS_URL)('L8 — effet et audit indivisibles', () => {
  type FixtureUser = Prisma.UserGetPayload<{ include: { patient: true; doctor: true; lab: true } }>;
  let app: FastifyInstance; let patient: FixtureUser; let doctor: FixtureUser; let laboratory: FixtureUser; let admin: FixtureUser; let record: MedicalRecord; let submission: KycSubmission;
  const ids: string[] = [];
  const create = async (data: Omit<Prisma.UserCreateInput, 'phone'>) => { const user = await app.prisma.user.create({ data: { phone: '+' + randomUUID(), status: 'ACTIVE', ...data }, include: { patient: true, doctor: true, lab: true } }); ids.push(user.id); return user; };
  const failAudit = () => vi.spyOn(audit, 'writeAuditWithin').mockRejectedValueOnce(new Error('synthetic audit outage'));
  const claim = () => resolveDmpScope(app, { actorId: doctor.id, role: 'MEDECIN', patientId: patient.patient!.id, shareToken: record.shareToken! });
  beforeAll(async () => {
    const { buildServer } = await import('@/server.js'); app = await buildServer(); await app.ready();
    patient = await create({ role: 'PATIENT', patient: { create: {} } });
    doctor = await create({ role: 'MEDECIN', doctor: { create: { speciality: 'Synthétique', licenseNumber: randomUUID(), verifiedAt: new Date(), consultFee: 0 } } });
    laboratory = await create({ role: 'LABORATOIRE', lab: { create: { name: 'Synthétique', address: 'Synthétique', phone: '+2290100000000', licenseNumber: randomUUID(), servicesOffered: [], verifiedAt: new Date() } } });
    admin = await create({ role: 'ADMIN' });
  });
  beforeEach(async () => {
    await app.prisma.consent.deleteMany({ where: { patientId: patient.patient!.id } });
    record = await app.prisma.medicalRecord.create({ data: { patientId: patient.patient!.id, type: 'OTHER', title: 'Synthétique', shareToken: randomUUID(), shareExpiry: new Date(Date.now() + 3600000) } });
    submission = await app.prisma.kycSubmission.create({ data: { userId: laboratory.id, labIdentity: { name: 'Synthétique' }, documents: { create: (['NATIONAL_ID', 'PRACTICE_LICENSE'] as const).map((type) => ({ type, fileUrl: 'synthetic-storage', verified: true })) } } });
    await app.prisma.lab.update({ where: { id: laboratory.lab!.id }, data: { verifiedAt: new Date() } });
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (!app) return;
    if (doctor) await app.prisma.labOrder.deleteMany({ where: { prescribedById: doctor.doctor!.id } });
    await app.prisma.user.deleteMany({ where: { id: { in: ids } } }); await app.close();
  });
  it('réclamation refusée sur panne audit : aucun nouveau bail persistant', async () => {
    await app.prisma.consent.deleteMany({ where: { patientId: patient.patient!.id } }); failAudit();
    await expect(claim()).rejects.toThrow(); expect(await app.prisma.consent.count({ where: { patientId: patient.patient!.id } })).toBe(0);
  });
  it('nouveau partage refusé sur panne audit : jeton et échéance d’origine inchangés', async () => {
    failAudit(); await expect(dmp.shareRecord(app, patient.id, record.id, { shareType: 'QR_CODE', ttlHours: 24 })).rejects.toThrow();
    expect((await app.prisma.medicalRecord.findUniqueOrThrow({ where: { id: record.id } })).shareToken).toBe(record.shareToken);
  });
  it('révocation consentement refusée sur panne audit : état antérieur conservé ; retry sain révoque', async () => {
    await claim(); failAudit(); await expect(dmp.revokeConsent(app, patient.id, doctor.id)).rejects.toThrow();
    const where = { patientId_granteeId: { patientId: patient.patient!.id, granteeId: doctor.id } };
    expect((await app.prisma.consent.findUniqueOrThrow({ where })).revokedAt).toBeNull();
    await dmp.revokeConsent(app, patient.id, doctor.id); expect((await app.prisma.consent.findUniqueOrThrow({ where })).revokedAt).not.toBeNull();
  });
  it('ré-octroi refusé sur panne audit : révocation et échéance indépendante inchangées', async () => {
    await claim(); await dmp.revokeConsent(app, patient.id, doctor.id);
    failAudit(); await expect(dmp.regrantConsent(app, patient.id, doctor.id, 24)).rejects.toThrow();
    expect((await app.prisma.consent.findUniqueOrThrow({ where: { patientId_granteeId: { patientId: patient.patient!.id, granteeId: doctor.id } } })).revokedAt).not.toBeNull();
  });
  it('révocation QR refusée sur panne audit : jeton non perdu', async () => {
    failAudit(); await expect(dmp.revokeShare(app, patient.id, record.id)).rejects.toThrow();
    expect((await app.prisma.medicalRecord.findUniqueOrThrow({ where: { id: record.id } })).shareToken).toBe(record.shareToken);
  });
  it('soumission KYC labo : panne audit annule statut et remise à zéro des vérifications', async () => {
    failAudit(); await expect(kyc.submit(app, laboratory.id)).rejects.toThrow();
    const row = await app.prisma.kycSubmission.findUniqueOrThrow({ where: { id: submission.id }, include: { documents: true } });
    expect(row.status).toBe('NOT_SUBMITTED'); expect(row.documents.every((doc) => doc.verified)).toBe(true);
  });
  it('soumission KYC médecin : panne audit annule le passage en revue', async () => {
    const own = await app.prisma.kycSubmission.create({ data: { userId: doctor.id, documents: { create: { type: 'NATIONAL_ID', fileUrl: 'synthetic-storage' } } } });
    failAudit(); await expect(professionalKyc.submitForReview(app, doctor.id)).rejects.toThrow();
    expect((await app.prisma.kycSubmission.findUniqueOrThrow({ where: { id: own.id } })).status).toBe('NOT_SUBMITTED');
  });
  it('approbation médecin : panne audit annule décision, badge et review', async () => {
    const own = await app.prisma.kycSubmission.create({ data: { userId: doctor.id, status: 'UNDER_REVIEW' } });
    await app.prisma.doctor.update({ where: { id: doctor.doctor!.id }, data: { verifiedAt: null } });
    failAudit(); await expect(professionalKyc.reviewSubmission(app, admin.id, own.id, { decision: 'APPROVED' })).rejects.toThrow();
    expect((await app.prisma.kycSubmission.findUniqueOrThrow({ where: { id: own.id } })).status).toBe('UNDER_REVIEW');
    expect((await app.prisma.doctor.findUniqueOrThrow({ where: { id: doctor.doctor!.id } })).verifiedAt).toBeNull();
    expect(await app.prisma.kycReview.count({ where: { submissionId: own.id } })).toBe(0);
    await app.prisma.doctor.update({ where: { id: doctor.doctor!.id }, data: { verifiedAt: new Date() } });
  });
  it('approbation KYC labo : panne audit annule badge, décision et review', async () => {
    await app.prisma.lab.update({ where: { id: laboratory.lab!.id }, data: { verifiedAt: null } });
    await app.prisma.kycSubmission.update({ where: { id: submission.id }, data: { status: 'UNDER_REVIEW' } });
    failAudit(); await expect(kyc.review(app, admin.id, laboratory.id, submission.id, { decision: 'APPROVED' })).rejects.toThrow();
    expect((await app.prisma.lab.findUniqueOrThrow({ where: { id: laboratory.lab!.id } })).verifiedAt).toBeNull();
    expect((await app.prisma.kycSubmission.findUniqueOrThrow({ where: { id: submission.id } })).status).toBe('UNDER_REVIEW');
    expect(await app.prisma.kycReview.count({ where: { submissionId: submission.id } })).toBe(0);
  });
  it('prise en charge labo : panne audit conserve la demande disponible', async () => {
    const order = await app.prisma.labOrder.create({ data: { prescribedById: doctor.doctor!.id, patientId: patient.patient!.id, testType: 'Synthétique' } });
    failAudit(); await expect(lab.claimOrder(app, laboratory.id, order.id)).rejects.toThrow();
    const row = await app.prisma.labOrder.findUniqueOrThrow({ where: { id: order.id } }); expect(row.labId).toBeNull(); expect(row.status).toBe('PENDING');
  });
  it('résultat critique : panne audit annule résultat, transition et notifications', async () => {
    const order = await app.prisma.labOrder.create({ data: { prescribedById: doctor.doctor!.id, patientId: patient.patient!.id, testType: 'Synthétique', labId: laboratory.lab!.id, status: 'PROCESSING' } });
    const before = await app.prisma.notification.count({ where: { recipientId: { in: ids } } });
    failAudit(); await expect(lab.submitResult(app, laboratory.id, order.id, { values: { glucose: 0.1 } })).rejects.toThrow();
    expect(await app.prisma.labResult.count({ where: { labOrderId: order.id } })).toBe(0);
    expect((await app.prisma.labOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PROCESSING');
    expect(await app.prisma.notification.count({ where: { recipientId: { in: ids } } })).toBe(before);
  });
});
