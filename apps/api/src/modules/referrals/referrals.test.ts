// Test d'intégration du référencement entre médecins (cas limites). CI uniquement.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
// drA (expéditeur) · drB (destinataire) · patient · patient2 (pour tests RBAC)
const PHONES = ['+2290195430001', '+2290195430002', '+2290195430003', '+2290195430004'];
// cuid valide (regex) mais inexistant en base → 404 attendu.
const MISSING_CUID = 'caaaaaaaaaaaaaaaaaaaaaaaa';

describe.skipIf(!HAS_INFRA)('Référencement médecins (intégration — cas limites)', () => {
  let app: FastifyInstance;
  let drAToken: string;
  let drBToken: string;
  let patientToken: string;
  let drAId: string;
  let drBId: string;
  let patientId: string;
  let referralId: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  async function cleanup() {
    // Retirer d'abord les orientations (FK vers Doctor sans cascade), puis les comptes.
    await app.prisma.referral.deleteMany({ where: { patient: { user: { phone: { in: PHONES } } } } });
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
  }

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const drA = await app.prisma.user.create({
      data: {
        phone: PHONES[0], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Ama', lastName: 'Doss' } },
        doctor: { create: { speciality: 'Généraliste', licenseNumber: 'BJ-MED-4301', consultFee: 2000, verifiedAt: new Date() } },
      },
      include: { doctor: true },
    });
    drAId = drA.doctor!.id;
    drAToken = app.jwt.sign({ sub: drA.id, role: 'MEDECIN' }, { expiresIn: '15m' });

    const drB = await app.prisma.user.create({
      data: {
        phone: PHONES[1], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Kofi', lastName: 'Mensah' } },
        doctor: { create: { speciality: 'Cardiologie', licenseNumber: 'BJ-MED-4302', consultFee: 3000, verifiedAt: new Date() } },
      },
      include: { doctor: true },
    });
    drBId = drB.doctor!.id;
    drBToken = app.jwt.sign({ sub: drB.id, role: 'MEDECIN' }, { expiresIn: '15m' });

    const patient = await app.prisma.user.create({
      data: { phone: PHONES[2], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Yao', lastName: 'Adjo' } }, patient: { create: {} } },
      include: { patient: true },
    });
    patientId = patient.patient!.id;
    patientToken = app.jwt.sign({ sub: patient.id, role: 'PATIENT' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('refuse un non-médecin (RBAC) → 403', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/referrals', headers: auth(patientToken),
      payload: { toDoctorId: drBId, patientId, reason: 'Avis cardiologique' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejette un corps invalide (reason trop court) → 422', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/referrals', headers: auth(drAToken),
      payload: { toDoctorId: drBId, patientId, reason: 'x' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('interdit de s’orienter soi-même → 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/referrals', headers: auth(drAToken),
      payload: { toDoctorId: drAId, patientId, reason: 'Auto-orientation' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('médecin destinataire inexistant → 404', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/referrals', headers: auth(drAToken),
      payload: { toDoctorId: MISSING_CUID, patientId, reason: 'Avis spécialisé' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('patient inexistant → 404', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/referrals', headers: auth(drAToken),
      payload: { toDoctorId: drBId, patientId: MISSING_CUID, reason: 'Avis spécialisé' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('crée une orientation valide → 201 (PENDING)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/referrals', headers: auth(drAToken),
      payload: { toDoctorId: drBId, patientId, reason: 'Suspicion HTA, avis cardiologique.' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('PENDING');
    referralId = res.json().id;
  });

  it('l’expéditeur ne peut PAS répondre (seul le destinataire) → 403', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/referrals/${referralId}/respond`, headers: auth(drAToken),
      payload: { action: 'ACCEPT' },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── C3 : le destinataire est notifié, et l'audit ne porte pas le motif clinique ──
  it('notifie le médecin destinataire dans SA langue', async () => {
    const notif = await app.prisma.notification.findFirst({
      where: { recipient: { phone: PHONES[1] } },
      orderBy: { createdAt: 'desc' },
    });
    expect(notif).not.toBeNull();
    expect(notif!.title).toBe('Nouvelle orientation de patient');
    // Le motif est destiné au confrère : il a bien sa place dans la notification.
    expect(notif!.body).toContain('Suspicion HTA');
  });

  it('journalise REFERRAL_CREATE SANS le motif clinique (§4)', async () => {
    const log = await app.prisma.auditLog.findFirst({
      where: { action: 'REFERRAL_CREATE', targetId: referralId },
    });
    expect(log).not.toBeNull();
    // L'admin lit l'audit : il doit y trouver des identifiants, jamais de clinique.
    expect(JSON.stringify(log!.meta)).not.toContain('Suspicion HTA');
    expect(JSON.stringify(log!.meta)).toContain(patientId);
  });

  // ── C6 : machine à états complète ──
  it('terminer une orientation encore PENDING → 400', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/v1/referrals', headers: auth(drAToken),
      payload: { toDoctorId: drBId, patientId, reason: 'Orientation à annuler.' },
    });
    const pendingId = created.json().id;

    const res = await app.inject({
      method: 'POST', url: `/api/v1/referrals/${pendingId}/respond`, headers: auth(drBToken),
      payload: { action: 'COMPLETE' },
    });
    expect(res.statusCode).toBe(400);

    // Depuis PENDING, l'annulation reste légitime.
    const cancel = await app.inject({
      method: 'POST', url: `/api/v1/referrals/${pendingId}/respond`, headers: auth(drBToken),
      payload: { action: 'CANCEL' },
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe('CANCELLED');

    // CANCELLED est TERMINAL : plus aucune transition.
    const reopen = await app.inject({
      method: 'POST', url: `/api/v1/referrals/${pendingId}/respond`, headers: auth(drBToken),
      payload: { action: 'COMPLETE' },
    });
    expect(reopen.statusCode).toBe(400);
  });

  it('le destinataire accepte → 200 (ACCEPTED)', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/referrals/${referralId}/respond`, headers: auth(drBToken),
      payload: { action: 'ACCEPT' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ACCEPTED');
  });

  it('accepter une orientation déjà traitée → 400', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/referrals/${referralId}/respond`, headers: auth(drBToken),
      payload: { action: 'ACCEPT' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('ACCEPTED → COMPLETED, puis COMPLETED est terminal → 400', async () => {
    const done = await app.inject({
      method: 'POST', url: `/api/v1/referrals/${referralId}/respond`, headers: auth(drBToken),
      payload: { action: 'COMPLETE' },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().status).toBe('COMPLETED');

    const cancelAfter = await app.inject({
      method: 'POST', url: `/api/v1/referrals/${referralId}/respond`, headers: auth(drBToken),
      payload: { action: 'CANCEL' },
    });
    expect(cancelAfter.statusCode).toBe(400);
  });

  // ── C1 : la liste doit être affichable (noms + sens), pas des cuid bruts ──
  it('liste les orientations avec noms et direction', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/referrals', headers: auth(drAToken) });
    expect(res.statusCode).toBe(200);
    const sent = res.json().find((r: { id: string }) => r.id === referralId);
    expect(sent.direction).toBe('SENT');
    expect(sent.patientName).toBe('Yao Adjo');
    expect(sent.toDoctorName).toBe('Kofi Mensah');
    expect(sent.toSpeciality).toBe('Cardiologie');

    // Le même enregistrement est « reçu » du point de vue du destinataire.
    const asB = await app.inject({ method: 'GET', url: '/api/v1/referrals', headers: auth(drBToken) });
    expect(asB.json().find((r: { id: string }) => r.id === referralId).direction).toBe('RECEIVED');
  });

  it('répondre à une orientation inexistante → 404', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/referrals/${MISSING_CUID}/respond`, headers: auth(drBToken),
      payload: { action: 'ACCEPT' },
    });
    expect(res.statusCode).toBe(404);
  });
});
