// Tests d'intégration KYC (via app.inject). Exécutés si DB+Redis présents (CI).
import { ADMIN_PRESETS } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290195000001', '+2290195000002', '+2290195000003'];
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='; // PNG 1×1

describe.skipIf(!HAS_INFRA)('KYC (intégration)', () => {
  let app: FastifyInstance;
  let caregiverToken: string;
  let adminToken: string;
  let patientToken: string;
  let doctorId: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  // Supprime d'abord les soumissions (cascade reviews+docs) pour libérer la FK
  // kyc_reviews.reviewerId → admin, puis les utilisateurs.
  const cleanup = async () => {
    await app.prisma.kycSubmission.deleteMany({ where: { user: { phone: { in: PHONES } } } });
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
  };

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const caregiver = await app.prisma.user.create({
      data: {
        phone: PHONES[0],
        role: 'MEDECIN',
        status: 'PENDING_KYC',
        lang: 'FR',
        profile: { create: { firstName: 'Awa', lastName: 'Koffi' } },
        doctor: { create: { speciality: 'Cardiologie', licenseNumber: 'BJ-MED-9001', consultFee: 5000 } },
      },
      include: { doctor: true },
    });
    doctorId = caregiver.doctor!.id;

    const admin = await app.prisma.user.create({
      data: {
        phone: PHONES[1], role: 'ADMIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Admin', lastName: 'Sys' } },
        adminProfile: { create: { scopes: [...ADMIN_PRESETS.SUPER_ADMIN], preset: 'SUPER_ADMIN' } },
      },
    });
    const patient = await app.prisma.user.create({
      data: { phone: PHONES[2], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Koffi', lastName: 'D' } }, patient: { create: {} } },
    });

    caregiverToken = app.jwt.sign({ sub: caregiver.id, role: 'MEDECIN' }, { expiresIn: '15m' });
    adminToken = app.jwt.sign({ sub: admin.id, role: 'ADMIN' }, { expiresIn: '15m' });
    patientToken = app.jwt.sign({ sub: patient.id, role: 'PATIENT' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('parcours complet : soumission → revue admin → badge vérifié', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/v1/kyc', headers: auth(caregiverToken) });
    expect(create.statusCode).toBe(201);
    expect(create.json().status).toBe('NOT_SUBMITTED');

    const doc = await app.inject({
      method: 'POST',
      url: '/api/v1/kyc/documents',
      headers: auth(caregiverToken),
      payload: { type: 'MEDICAL_DEGREE', mimeType: 'image/png', fileName: 'diplome.png', dataBase64: PNG_B64 },
    });
    expect(doc.statusCode).toBe(201);

    const submit = await app.inject({ method: 'POST', url: '/api/v1/kyc/submit', headers: auth(caregiverToken) });
    expect(submit.statusCode).toBe(200);
    expect(submit.json().status).toBe('UNDER_REVIEW');
    const submissionId = submit.json().id as string;

    // RBAC : un patient ne peut pas accéder à la file d'attente admin.
    const forbidden = await app.inject({ method: 'GET', url: '/api/v1/kyc/submissions', headers: auth(patientToken) });
    expect(forbidden.statusCode).toBe(403);

    // Admin voit le dossier dans la file.
    const queue = await app.inject({ method: 'GET', url: '/api/v1/kyc/submissions', headers: auth(adminToken) });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().total).toBeGreaterThanOrEqual(1);

    // Revue : approbation → CNOM vérifié + badge posé.
    const review = await app.inject({
      method: 'POST',
      url: `/api/v1/kyc/submissions/${submissionId}/review`,
      headers: auth(adminToken),
      payload: { decision: 'APPROVED', notes: 'Diplôme conforme' },
    });
    expect(review.statusCode).toBe(200);
    expect(review.json().status).toBe('APPROVED');
    expect(review.json().cnom.verified).toBe(true);

    // Fiche pro : badge « vérifié » actif.
    const card = await app.inject({ method: 'GET', url: `/api/v1/professionals/${doctorId}`, headers: auth(patientToken) });
    expect(card.statusCode).toBe(200);
    expect(card.json().isVerified).toBe(true);

    // Audit : un KYC_APPROVE a bien été journalisé pour ce professionnel.
    const audits = await app.prisma.auditLog.count({ where: { action: 'KYC_APPROVE' } });
    expect(audits).toBeGreaterThanOrEqual(1);
  });

  it('revue enrichie : détail des pièces + aperçu CNOM + coche de vérification', async () => {
    // Nouveau dossier (le précédent est APPROVED) avec deux pièces, puis soumission.
    await app.inject({ method: 'POST', url: '/api/v1/kyc', headers: auth(caregiverToken) });
    await app.inject({ method: 'POST', url: '/api/v1/kyc/documents', headers: auth(caregiverToken), payload: { type: 'NATIONAL_ID', mimeType: 'image/png', fileName: 'cni.png', dataBase64: PNG_B64 } });
    await app.inject({ method: 'POST', url: '/api/v1/kyc/documents', headers: auth(caregiverToken), payload: { type: 'ORDER_LICENSE', mimeType: 'image/png', fileName: 'ordre.png', dataBase64: PNG_B64 } });
    const submit = await app.inject({ method: 'POST', url: '/api/v1/kyc/submit', headers: auth(caregiverToken) });
    const submissionId = submit.json().id as string;

    // Détail admin : pièces visibles + aperçu CNOM (format plausible) + non vérifiées.
    const detail = await app.inject({ method: 'GET', url: `/api/v1/kyc/submissions/${submissionId}`, headers: auth(adminToken) });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.documents).toHaveLength(2);
    expect(body.cnom.verified).toBe(true);
    expect(body.documents.every((d: { verified: boolean }) => d.verified === false)).toBe(true);
    const docId = body.documents[0].id as string;

    // RBAC : un patient ne voit pas le détail.
    const denied = await app.inject({ method: 'GET', url: `/api/v1/kyc/submissions/${submissionId}`, headers: auth(patientToken) });
    expect(denied.statusCode).toBe(403);

    // Coche d'une pièce comme vérifiée.
    const verify = await app.inject({ method: 'POST', url: `/api/v1/kyc/documents/${docId}/verify`, headers: auth(adminToken), payload: { verified: true } });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().verified).toBe(true);

    const detail2 = await app.inject({ method: 'GET', url: `/api/v1/kyc/submissions/${submissionId}`, headers: auth(adminToken) });
    expect(detail2.json().documents.find((d: { id: string }) => d.id === docId).verified).toBe(true);

    // Revue « à corriger » (NEEDS_REVISION) : décision non terminale, mais
    // désormais journalisée (§4) — traçabilité complète des actions admin.
    const revision = await app.inject({
      method: 'POST',
      url: `/api/v1/kyc/submissions/${submissionId}/review`,
      headers: auth(adminToken),
      payload: { decision: 'NEEDS_REVISION', notes: 'Pièce illisible' },
    });
    expect(revision.statusCode).toBe(200);
    expect(revision.json().status).toBe('NEEDS_REVISION');

    // Audit : KYC_REVISION (renvoi) + KYC_SUBMIT (soumission) bien journalisés.
    expect(await app.prisma.auditLog.count({ where: { action: 'KYC_REVISION' } })).toBeGreaterThanOrEqual(1);
    expect(await app.prisma.auditLog.count({ where: { action: 'KYC_SUBMIT' } })).toBeGreaterThanOrEqual(1);
  });

  it('pièces : upload chiffré + lecture contrôlée (propriétaire/admin oui, tiers non)', async () => {
    // Le dossier courant est en NEEDS_REVISION (test précédent) → encore éditable.
    const up = await app.inject({
      method: 'POST',
      url: '/api/v1/kyc/documents',
      headers: auth(caregiverToken),
      payload: { type: 'PROFESSIONAL_PHOTO', mimeType: 'image/png', fileName: 'photo.png', dataBase64: PNG_B64 },
    });
    expect(up.statusCode).toBe(201);
    const docId = up.json().id as string;
    // La réponse n'expose PAS l'identifiant de stockage interne.
    expect(up.json().fileUrl).toBeUndefined();

    // Propriétaire : lecture OK, contenu déchiffré identique à l'original.
    const mine = await app.inject({ method: 'GET', url: `/api/v1/kyc/documents/${docId}/file`, headers: auth(caregiverToken) });
    expect(mine.statusCode).toBe(200);
    expect(mine.headers['content-type']).toContain('image/png');
    expect(mine.headers['cache-control']).toBe('no-store');
    expect(Buffer.from(mine.rawPayload).equals(Buffer.from(PNG_B64, 'base64'))).toBe(true);

    // Tiers (patient) : refusé (§4).
    const denied = await app.inject({ method: 'GET', url: `/api/v1/kyc/documents/${docId}/file`, headers: auth(patientToken) });
    expect(denied.statusCode).toBe(403);

    // Admin kyc:review : lecture OK (revue des pièces).
    const adminRead = await app.inject({ method: 'GET', url: `/api/v1/kyc/documents/${docId}/file`, headers: auth(adminToken) });
    expect(adminRead.statusCode).toBe(200);
  });
});
