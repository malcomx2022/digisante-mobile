// Tests d'intégration RDV + téléconsultation (via app.inject). Si DB+Redis (CI).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantPro } from '@/test/pro-fixture.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290194000001', '+2290194000002'];
const TOMORROW = new Date(Date.now() + 24 * 3600_000);

describe.skipIf(!HAS_INFRA)('RDV & téléconsultation (intégration)', () => {
  let app: FastifyInstance;
  let patientToken: string;
  let doctorToken: string;
  let patientUserId: string;
  let doctorId: string;
  let patientId: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  const cleanup = async () => {
    await app.prisma.payment.deleteMany({ where: { user: { phone: { in: PHONES } } } });
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
  };

  beforeAll(async () => {
    process.env.RECONCILE_TOKEN = 'appt_reminder_test_token';
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const patient = await app.prisma.user.create({
      data: { phone: PHONES[0], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Koffi', lastName: 'D' } }, patient: { create: {} } },
      include: { patient: true },
    });
    const doctor = await app.prisma.user.create({
      data: { phone: PHONES[1], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Awa', lastName: 'K' } }, doctor: { create: { speciality: 'Généraliste', licenseNumber: 'BJ-MED-7001', consultFee: 3000, slotDuration: 30, verifiedAt: new Date() } } },
      include: { doctor: true },
    });
    patientUserId = patient.id;
    patientId = patient.patient!.id;
    doctorId = doctor.doctor!.id;
    patientToken = app.jwt.sign({ sub: patient.id, role: 'PATIENT' }, { expiresIn: '15m' });
    doctorToken = app.jwt.sign({ sub: doctor.id, role: 'MEDECIN' }, { expiresIn: '15m' });
    // Fixture L6 : droits issus d'une période confirmée par le fournisseur, jamais d'une
    // colonne PRO (A8 : l'abonnement ne se règle plus par wallet).
    await grantPro(app, doctor.id);
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('réservation → confirmation → téléconsultation → bascule → clôture', async () => {
    const book = await app.inject({
      method: 'POST',
      url: '/api/v1/appointments',
      headers: auth(patientToken),
      payload: { doctorId, type: 'TELECONSULTATION', scheduledAt: TOMORROW.toISOString() },
    });
    expect(book.statusCode).toBe(201);
    const apptId = book.json().id as string;

    // Conflit : même créneau, même médecin.
    const clash = await app.inject({
      method: 'POST',
      url: '/api/v1/appointments',
      headers: auth(patientToken),
      payload: { doctorId, type: 'TELECONSULTATION', scheduledAt: TOMORROW.toISOString() },
    });
    expect(clash.statusCode).toBe(409);

    const confirm = await app.inject({ method: 'POST', url: `/api/v1/appointments/${apptId}/confirm`, headers: auth(doctorToken) });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().status).toBe('CONFIRMED');

    const startC = await app.inject({ method: 'POST', url: '/api/v1/consultations', headers: auth(doctorToken), payload: { appointmentId: apptId } });
    expect(startC.statusCode).toBe(201);
    expect(startC.json().roomUrl).toBeNull();
    expect(startC.json().provider).toBe('UNAVAILABLE');
    const consultId = startC.json().consultation.id as string;

    const join = await app.inject({ method: 'POST', url: `/api/v1/consultations/${consultId}/join`, headers: auth(patientToken) });
    expect(join.statusCode).toBe(200);
    expect(join.json().token).toBeNull();
    expect(join.json().roomUrl).toBeNull();

    const down = await app.inject({ method: 'POST', url: `/api/v1/consultations/${consultId}/downgrade`, headers: auth(patientToken) });
    expect(down.json().mode).toBe('AUDIO');

    const end = await app.inject({ method: 'POST', url: `/api/v1/consultations/${consultId}/end`, headers: auth(doctorToken), payload: { notes: 'RAS' } });
    expect(end.statusCode).toBe(200);
    expect(end.json().status).toBe('COMPLETED');
  });

  // Lot 7 / écart D1 : jusqu'ici RIEN ne créait de Consultation depuis l'interface,
  // donc `consultationId` restait null et le bouton « Rejoindre » du patient ne
  // s'affichait jamais. Ce test verrouille la boucle complète côté serveur.
  it('démarrage médecin → patient notifié dans SA langue + RDV devenu rejoignable', async () => {
    const at = new Date(Date.now() + 5 * 3600_000);
    const book = await app.inject({
      method: 'POST', url: '/api/v1/appointments', headers: auth(patientToken),
      payload: { doctorId, type: 'TELECONSULTATION', scheduledAt: at.toISOString() },
    });
    const apptId = book.json().id as string;
    await app.inject({ method: 'POST', url: `/api/v1/appointments/${apptId}/confirm`, headers: auth(doctorToken) });

    // Le patient parle anglais : la notification doit partir en anglais (§4).
    await app.prisma.user.update({ where: { id: patientUserId }, data: { lang: 'EN' } });
    const before = await app.prisma.notification.count({
      where: { recipientId: patientUserId, type: 'CONSULTATION_START' },
    });

    const start = await app.inject({
      method: 'POST', url: '/api/v1/consultations', headers: auth(doctorToken), payload: { appointmentId: apptId },
    });
    expect(start.statusCode).toBe(201);
    const consultId = start.json().consultation.id as string;

    const notif = await app.prisma.notification.findFirst({
      where: { recipientId: patientUserId, type: 'CONSULTATION_START' },
      orderBy: { createdAt: 'desc' },
    });
    expect(await app.prisma.notification.count({ where: { recipientId: patientUserId, type: 'CONSULTATION_START' } })).toBe(before + 1);
    expect(notif?.title).toBe('Teleconsultation'); // gabarit EN, pas le repli FR
    expect(notif?.status).toBe('PENDING');
    await app.prisma.user.update({ where: { id: patientUserId }, data: { lang: 'FR' } });

    // La boucle : le patient voit désormais un consultationId → bouton « Rejoindre ».
    const list = await app.inject({ method: 'GET', url: '/api/v1/appointments', headers: auth(patientToken) });
    const mine = list.json().find((a: { id: string }) => a.id === apptId);
    expect(mine.consultationId).toBe(consultId);

    // Et l'agenda du médecin sait que la salle existe (rejoindre au lieu de démarrer).
    const agenda = await app.inject({
      method: 'GET',
      url: `/api/v1/appointments/agenda?from=${new Date(Date.now() - 3600_000).toISOString()}&to=${new Date(Date.now() + 24 * 3600_000).toISOString()}`,
      headers: auth(doctorToken),
    });
    const slot = agenda.json().find((a: { id: string }) => a.id === apptId);
    expect(slot.consultation.id).toBe(consultId);
    expect(slot.consultation.status).toBe('ACTIVE');

    // Un second démarrage sur le même RDV est refusé (pas de salle en double).
    const again = await app.inject({
      method: 'POST', url: '/api/v1/consultations', headers: auth(doctorToken), payload: { appointmentId: apptId },
    });
    expect(again.statusCode).toBe(400);

    // Clôture réservée au médecin.
    const byPatient = await app.inject({ method: 'POST', url: `/api/v1/consultations/${consultId}/end`, headers: auth(patientToken), payload: {} });
    expect(byPatient.statusCode).toBe(403);
    const end = await app.inject({ method: 'POST', url: `/api/v1/consultations/${consultId}/end`, headers: auth(doctorToken), payload: {} });
    expect(end.statusCode).toBe(200);
    const closed = await app.prisma.appointment.findUnique({ where: { id: apptId }, select: { status: true } });
    expect(closed?.status).toBe('COMPLETED');
  });

  // Prompt 7 (22/09/2026) : mode dégradé VIDEO → AUDIO → CHAT sans appeler Daily.
  // Le mode est porté par le SERVEUR : un participant qui se reconnecte (réseau
  // faible, rechargement) retrouve le palier dégradé au lieu de relancer la vidéo.
  it('mode dégradé : VIDEO → AUDIO → CHAT persistant à la reconnexion, verrouillé après clôture', async () => {
    const at = new Date(Date.now() + 6 * 3600_000);
    const book = await app.inject({
      method: 'POST', url: '/api/v1/appointments', headers: auth(patientToken),
      payload: { doctorId, type: 'TELECONSULTATION', scheduledAt: at.toISOString() },
    });
    const apptId = book.json().id as string;
    await app.inject({ method: 'POST', url: `/api/v1/appointments/${apptId}/confirm`, headers: auth(doctorToken) });
    const start = await app.inject({ method: 'POST', url: '/api/v1/consultations', headers: auth(doctorToken), payload: { appointmentId: apptId } });
    const consultId = start.json().consultation.id as string;
    expect(start.json().consultation.mode).toBe('VIDEO');

    const modes: string[] = [];
    for (const who of [patientToken, doctorToken, patientToken]) {
      const r = await app.inject({ method: 'POST', url: `/api/v1/consultations/${consultId}/downgrade`, headers: auth(who) });
      expect(r.statusCode).toBe(200);
      modes.push(r.json().mode);
    }
    expect(modes).toEqual(['AUDIO', 'CHAT', 'CHAT']); // CHAT = palier plancher

    // Reconnexion : le mode dégradé est restitué (pas de retour silencieux à la vidéo).
    const rejoin = await app.inject({ method: 'POST', url: `/api/v1/consultations/${consultId}/join`, headers: auth(patientToken) });
    expect(rejoin.json().mode).toBe('CHAT');

    const end = await app.inject({ method: 'POST', url: `/api/v1/consultations/${consultId}/end`, headers: auth(doctorToken), payload: { notes: 'Suite par chat' } });
    expect(end.statusCode).toBe(200);
    // Après clôture : ni rejoindre, ni dégrader, ni re-clôturer (notes/endedAt préservés).
    for (const path of ['join', 'downgrade']) {
      const r = await app.inject({ method: 'POST', url: `/api/v1/consultations/${consultId}/${path}`, headers: auth(patientToken) });
      expect(r.statusCode).toBe(400);
    }
    const again = await app.inject({ method: 'POST', url: `/api/v1/consultations/${consultId}/end`, headers: auth(doctorToken), payload: { notes: 'écrasé ?' } });
    expect(again.statusCode).toBe(400);
    const stored = await app.prisma.consultation.findUniqueOrThrow({ where: { id: consultId } });
    expect(stored.notes).toBe('Suite par chat');
  });

  // Lot 10 / écart D5 : l'endpoint de tri existait sans appelant côté web.
  it('le médecin priorise une demande (triage) — le patient ne peut pas', async () => {
    const at = new Date(Date.now() + 8 * 3600_000);
    const book = await app.inject({
      method: 'POST', url: '/api/v1/appointments', headers: auth(patientToken),
      payload: { doctorId, type: 'PHYSICAL', scheduledAt: at.toISOString() },
    });
    const apptId = book.json().id as string;

    const triage = await app.inject({
      method: 'POST', url: `/api/v1/appointments/${apptId}/triage`, headers: auth(doctorToken),
      payload: { level: 'URGENT', note: 'Douleur thoracique' },
    });
    expect(triage.statusCode).toBe(200);

    // Le tri remonte dans l'agenda du médecin (c'est là qu'il se lit).
    const agenda = await app.inject({
      method: 'GET',
      url: `/api/v1/appointments/agenda?from=${new Date(Date.now() - 3600_000).toISOString()}&to=${new Date(Date.now() + 24 * 3600_000).toISOString()}`,
      headers: auth(doctorToken),
    });
    const slot = agenda.json().find((a: { id: string }) => a.id === apptId);
    expect(slot.triage.level).toBe('URGENT');

    // RBAC : le patient ne trie pas son propre rendez-vous.
    const denied = await app.inject({
      method: 'POST', url: `/api/v1/appointments/${apptId}/triage`, headers: auth(patientToken), payload: { level: 'LOW' },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('RBAC : un médecin ne peut pas réserver (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/appointments',
      headers: auth(doctorToken),
      payload: { doctorId, type: 'PHYSICAL', scheduledAt: TOMORROW.toISOString() },
    });
    expect(res.statusCode).toBe(403);
  });

  it('réservations concurrentes et chevauchantes : un seul créneau accepté', async () => {
    const at = Date.now() + 4 * 24 * 3600_000;
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => app.inject({
      method: 'POST', url: '/api/v1/appointments', headers: auth(patientToken),
      payload: { doctorId, type: 'PHYSICAL', scheduledAt: new Date(at + i * 60_000).toISOString() },
    })));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(4);
    expect(await app.prisma.appointment.count({
      where: { doctorId, scheduledAt: { gte: new Date(at), lte: new Date(at + 4 * 60_000) } },
    })).toBe(1);
  });

  it('un créneau qui traverse minuit bloque le chevauchement mais pas le créneau adjacent', async () => {
    const at = new Date(Date.now() + 5 * 24 * 3600_000);
    at.setUTCHours(23, 50, 0, 0);
    const reserve = (minutes: number) => app.inject({
      method: 'POST', url: '/api/v1/appointments', headers: auth(patientToken),
      payload: { doctorId, type: 'PHYSICAL', scheduledAt: new Date(at.getTime() + minutes * 60_000).toISOString() },
    });
    expect((await reserve(0)).statusCode).toBe(201);
    expect((await reserve(15)).statusCode).toBe(409);
    expect((await reserve(30)).statusCode).toBe(201);
  });

  it('annulation médecin d’un RDV payé par wallet : solde restitué une seule fois', async () => {
    await app.prisma.wallet.upsert({
      where: { userId: patientUserId }, create: { userId: patientUserId, balance: 6000 }, update: { balance: 6000 },
    });
    const appt = await app.prisma.appointment.create({
      data: { patientId, doctorId, type: 'PHYSICAL', status: 'CONFIRMED', scheduledAt: new Date(Date.now() + 7 * 24 * 3600_000) },
    });
    const pay = await app.inject({
      method: 'POST', url: '/api/v1/payments', headers: auth(patientToken),
      payload: { type: 'CONSULTATION', method: 'WALLET', appointmentId: appt.id },
    });
    expect(pay.statusCode).toBe(201);
    expect(Number((await app.prisma.wallet.findUniqueOrThrow({ where: { userId: patientUserId } })).balance)).toBe(3000);
    const cancel = await app.inject({
      method: 'POST', url: `/api/v1/appointments/${appt.id}/cancel`, headers: auth(doctorToken), payload: { reason: 'Indisponible' },
    });
    expect(cancel.statusCode).toBe(200);
    expect(Number((await app.prisma.wallet.findUniqueOrThrow({ where: { userId: patientUserId } })).balance)).toBe(6000);
    const paymentId = pay.json().payment.id as string;
    expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('REFUNDED');
    await import('@/modules/payments/payments.service.js').then((p) => p.refund(app, paymentId, { actorId: patientUserId }));
    expect(Number((await app.prisma.wallet.findUniqueOrThrow({ where: { userId: patientUserId } })).balance)).toBe(6000);
    expect(await app.prisma.walletTransaction.count({ where: { reference: paymentId, type: 'REFUND_IN' } })).toBe(1);
  });

  it('annulation par le médecin d’un RDV payé → audit PAYMENT_REFUND', async () => {
    const at = new Date(Date.now() + 48 * 3600_000);
    const appt = await app.prisma.appointment.create({
      data: { patientId, doctorId, type: 'PHYSICAL', status: 'CONFIRMED', scheduledAt: at },
    });
    await app.prisma.payment.create({
      data: { userId: patientUserId, appointmentId: appt.id, type: 'CONSULTATION', method: 'MTN_MOMO', amount: 3000, status: 'COMPLETED' },
    });

    const before = await app.prisma.auditLog.count({ where: { action: 'PAYMENT_REFUND' } });
    const cancel = await app.inject({ method: 'POST', url: `/api/v1/appointments/${appt.id}/cancel`, headers: auth(doctorToken), payload: { reason: 'Indisponible' } });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe('CANCELLED');
    const after = await app.prisma.auditLog.count({ where: { action: 'PAYMENT_REFUND' } });
    expect(after).toBe(before + 1);
  });

  it('liste patient enrichie (nom médecin) + rappel de RDV (générateur idempotent) + annulation patient', async () => {
    const at = new Date(Date.now() + 3 * 3600_000); // dans 3 h → éligible au rappel (< 24 h)
    const book = await app.inject({
      method: 'POST', url: '/api/v1/appointments', headers: auth(patientToken),
      payload: { doctorId, type: 'PHYSICAL', scheduledAt: at.toISOString() },
    });
    const apptId = book.json().id as string;
    await app.inject({ method: 'POST', url: `/api/v1/appointments/${apptId}/confirm`, headers: auth(doctorToken) });

    // Liste enrichie : nom du médecin + spécialité.
    const list = await app.inject({ method: 'GET', url: '/api/v1/appointments', headers: auth(patientToken) });
    const appt = list.json().find((a: { id: string }) => a.id === apptId);
    expect(appt.doctorName).toContain('Awa');
    expect(appt.speciality).toBe('Généraliste');

    // Générateur de rappels + idempotence.
    const gen1 = await app.inject({ method: 'POST', url: '/api/v1/appointments/reminders/generate', headers: { 'x-service-token': 'appt_reminder_test_token' } });
    expect(gen1.json().generated).toBeGreaterThanOrEqual(1);
    const gen2 = await app.inject({ method: 'POST', url: '/api/v1/appointments/reminders/generate', headers: { 'x-service-token': 'appt_reminder_test_token' } });
    expect(gen2.json().generated).toBe(0);

    // Jeton requis.
    const noToken = await app.inject({ method: 'POST', url: '/api/v1/appointments/reminders/generate' });
    expect(noToken.statusCode).toBe(401);

    // Annulation par le patient.
    const cancel = await app.inject({ method: 'POST', url: `/api/v1/appointments/${apptId}/cancel`, headers: auth(patientToken), payload: { reason: 'Empêchement' } });
    expect(cancel.json().status).toBe('CANCELLED');
  });
});
