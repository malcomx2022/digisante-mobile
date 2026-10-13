// API réelle + DB/Redis isolés ; seul le fournisseur Daily est simulé.
import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/daily.js', async (original) => ({
  ...await original<typeof import('@/services/daily.js')>(),
  createRoom: vi.fn(), createMeetingToken: vi.fn(), deleteRoom: vi.fn(), ejectParticipants: vi.fn(),
}));
const daily = await import('@/services/daily.js');
const appointments = await import('@/modules/appointments/appointments.service.js');
const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290177000501', '+2290177000502', '+2290177000503', '+2290177000504'];

describe.skipIf(!HAS_INFRA)('L5 — accès consultation courant', () => {
  let app: FastifyInstance;
  let patientId: string; let doctorId: string;
  let patient: string; let doctor: string; let stranger: string; let admin: string;
  let consultationId: string; let appointmentId: string;
  const auth = (id: string) => ({ authorization: `Bearer ${app.jwt.sign({ sub: id, role: 'PATIENT' }, { expiresIn: '15m' })}` });
  const req = (who: string, path: string, method: 'POST' | 'GET' = 'POST') => app.inject({ method, url: `/api/v1/consultations/${consultationId}/${path}`, headers: auth(who), ...(method === 'POST' ? { payload: {} } : {}) });
  beforeAll(async () => {
    const { buildServer } = await import('@/server.js'); app = await buildServer(); await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    const p = await app.prisma.user.create({ data: { phone: PHONES[0]!, role: 'PATIENT', status: 'ACTIVE', patient: { create: {} } }, include: { patient: true } });
    const d = await app.prisma.user.create({ data: { phone: PHONES[1]!, role: 'MEDECIN', status: 'ACTIVE', doctor: { create: { speciality: 'Généraliste', licenseNumber: 'L5-TEST-ONLY', consultFee: 3000, verifiedAt: new Date() } } }, include: { doctor: true } });
    patient = p.id; patientId = p.patient!.id; doctor = d.id; doctorId = d.doctor!.id;
    await app.prisma.wallet.create({ data: { userId: doctor, balance: 5000 } });
    const paid = await app.inject({ method: 'POST', url: '/api/v1/subscriptions', headers: auth(doctor), payload: { plan: 'PRO', method: 'WALLET', requestId: 'a6000000-0000-4000-8000-000000000002' } });
    expect(paid.statusCode).toBe(200);
    stranger = (await app.prisma.user.create({ data: { phone: PHONES[2]!, role: 'PATIENT', status: 'ACTIVE' } })).id;
    admin = (await app.prisma.user.create({ data: { phone: PHONES[3]!, role: 'ADMIN', status: 'ACTIVE' } })).id;
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    await app.prisma.doctor.update({ where: { id: doctorId }, data: { verifiedAt: new Date() } });
    await app.prisma.user.update({ where: { id: patient }, data: { role: 'PATIENT', status: 'ACTIVE' } });
    await app.prisma.user.update({ where: { id: doctor }, data: { role: 'MEDECIN', status: 'ACTIVE' } });
    const appt = await app.prisma.appointment.create({ data: { patientId, doctorId, type: 'TELECONSULTATION', status: 'CONFIRMED', scheduledAt: new Date() } });
    appointmentId = appt.id;
    consultationId = (await app.prisma.consultation.create({ data: { appointmentId, mode: 'VIDEO', status: 'ACTIVE', startedAt: new Date(), dailyRoomName: 'consult-test', dailyRoomUrl: 'https://digisante.daily.co/consult-test', notes: 'test-only-private-note' } })).id;
    vi.mocked(daily.createMeetingToken).mockResolvedValue({ token: 'jwt.test.signature', roomUrl: 'https://digisante.daily.co/consult-test', expiresAt: Math.floor(Date.now() / 1000) + 900 });
    vi.mocked(daily.createRoom).mockResolvedValue({ name: 'new-room', url: 'https://digisante.daily.co/new-room', expiresAt: Math.floor(Date.now() / 1000) + 14_400 });
    vi.mocked(daily.ejectParticipants).mockResolvedValue(true); vi.mocked(daily.deleteRoom).mockResolvedValue(true);
  });
  afterAll(async () => { if (app) { await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } }); await app.close(); } });

  it('patient et médecin rejoignent avec leur identité propre, réponse non cachable', async () => {
    for (const id of [patient, doctor]) {
      const res = await req(id, 'join'); expect(res.statusCode).toBe(200); expect(res.json().token).toBe('jwt.test.signature');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(daily.createMeetingToken).toHaveBeenLastCalledWith(expect.objectContaining({ userId: id, audioOnly: false }));
    }
  });
  it('tiers et admin refusés avant tout appel Daily', async () => {
    for (const id of [stranger, admin]) expect((await req(id, 'join')).statusCode).toBe(403);
    expect(daily.createMeetingToken).not.toHaveBeenCalled();
  });
  it('ancien JWT du patient suspendu refusé', async () => {
    const headers = auth(patient); await app.prisma.user.update({ where: { id: patient }, data: { status: 'SUSPENDED' } });
    expect((await app.inject({ method: 'POST', url: `/api/v1/consultations/${consultationId}/join`, headers })).statusCode).toBe(401);
    expect(daily.createMeetingToken).not.toHaveBeenCalled();
  });
  it('médecin suspendu : le patient ne reçoit plus de jeton', async () => {
    await app.prisma.user.update({ where: { id: doctor }, data: { status: 'SUSPENDED' } });
    expect((await req(patient, 'join')).statusCode).toBe(403); expect(daily.createMeetingToken).not.toHaveBeenCalled();
  });
  it('rôle actuel retiré : aucun accès même si le profil existe encore', async () => {
    await app.prisma.user.update({ where: { id: doctor }, data: { role: 'ASC' } });
    expect((await req(patient, 'join')).statusCode).toBe(403); expect(daily.createMeetingToken).not.toHaveBeenCalled();
  });
  it('habilitation médecin retirée : pas de jeton clinique', async () => {
    await app.prisma.doctor.update({ where: { id: doctorId }, data: { verifiedAt: null } });
    expect((await req(patient, 'join')).statusCode).toBe(403); expect(daily.createMeetingToken).not.toHaveBeenCalled();
  });
  it('consultation terminée : join et surveillance refusés', async () => {
    await app.prisma.consultation.update({ where: { id: consultationId }, data: { status: 'COMPLETED' } });
    expect((await req(patient, 'join')).statusCode).toBe(400); expect((await req(patient, 'session', 'GET')).statusCode).toBe(400);
    expect(daily.createMeetingToken).not.toHaveBeenCalled();
  });
  it('RDV annulé : aucun jeton et aucune dégradation de mode', async () => {
    await app.prisma.appointment.update({ where: { id: appointmentId }, data: { status: 'CANCELLED' } });
    expect((await req(patient, 'join')).statusCode).toBe(400); expect((await req(patient, 'downgrade')).statusCode).toBe(400);
    expect(daily.createMeetingToken).not.toHaveBeenCalled();
    expect((await req(doctor, 'end')).statusCode).toBe(200);
    expect((await app.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status).toBe('CANCELLED');
  });
  it('4 h écoulées : accès expiré même si Daily répond encore', async () => {
    await app.prisma.consultation.update({ where: { id: consultationId }, data: { startedAt: new Date(Date.now() - 5 * 3600_000) } });
    expect((await req(patient, 'join')).statusCode).toBe(400); expect(daily.createMeetingToken).not.toHaveBeenCalled();
    // Une expiration ne doit pas empêcher la clôture par le médecin.
    expect((await req(doctor, 'end')).statusCode).toBe(200);
  });
  it('début historique inconnu : pas de bail arbitraire de 4 h', async () => {
    await app.prisma.consultation.update({ where: { id: consultationId }, data: { startedAt: null } });
    expect((await req(patient, 'join')).statusCode).toBe(400); expect(daily.createMeetingToken).not.toHaveBeenCalled();
  });
  it('CHAT : ne contacte pas Daily et ne renvoie aucun jeton/URL', async () => {
    await app.prisma.consultation.update({ where: { id: consultationId }, data: { mode: 'CHAT' } });
    const res = await req(patient, 'join'); expect(res.json()).toMatchObject({ mode: 'CHAT', token: null, roomUrl: null });
    expect(daily.createMeetingToken).not.toHaveBeenCalled();
  });
  it('surveillance : aucune note, URL ni token, refus des tiers', async () => {
    const res = await req(patient, 'session', 'GET'); expect(res.json()).toEqual({ mode: 'VIDEO', status: 'ACTIVE' });
    expect((await req(stranger, 'session', 'GET')).statusCode).toBe(403); expect(daily.createMeetingToken).not.toHaveBeenCalled();
  });
  it('clôture pendant émission Daily : jeton non transmis au client', async () => {
    vi.mocked(daily.createMeetingToken).mockImplementationOnce(async () => {
      await app.prisma.consultation.update({ where: { id: consultationId }, data: { status: 'COMPLETED' } });
      return { token: 'jwt.test.signature', roomUrl: 'https://digisante.daily.co/consult-test', expiresAt: 99_999_999_999 };
    });
    const res = await req(patient, 'join'); expect(res.statusCode).toBe(400); expect(res.body).not.toContain('jwt.test.signature');
  });
  it('suspension pendant émission Daily : réponse fermée', async () => {
    vi.mocked(daily.createMeetingToken).mockImplementationOnce(async () => {
      await app.prisma.user.update({ where: { id: doctor }, data: { status: 'SUSPENDED' } });
      return { token: 'jwt.test.signature', roomUrl: 'https://digisante.daily.co/consult-test', expiresAt: 99_999_999_999 };
    });
    expect((await req(patient, 'join')).statusCode).toBe(403);
  });
  it('dégradations concurrentes : palier CHAT final, jamais de remontée', async () => {
    const results = await Promise.all([req(patient, 'downgrade'), req(doctor, 'downgrade')]);
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect((await req(patient, 'session', 'GET')).json().mode).toBe('CHAT');
  });
  it('clôture : éjection nominative et suppression, deuxième clôture refusée', async () => {
    expect((await req(patient, 'end')).statusCode).toBe(403); expect((await req(doctor, 'end')).statusCode).toBe(200);
    const ejection = vi.mocked(daily.ejectParticipants).mock.calls[0]![0];
    expect(ejection.name).toBe('consult-test');
    expect(ejection.userIds).toEqual([doctor, patient]);
    expect(daily.deleteRoom).toHaveBeenCalledOnce(); expect((await req(doctor, 'end')).statusCode).toBe(400);
  });
  it('panne fournisseur au démarrage : aucune consultation ni notification créée', async () => {
    await app.prisma.consultation.delete({ where: { id: consultationId } });
    vi.mocked(daily.createRoom).mockRejectedValueOnce(new Error('test-only-provider-failure'));
    const count = await app.prisma.notification.count({ where: { recipientId: patient } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/consultations', headers: auth(doctor), payload: { appointmentId } });
    expect(res.statusCode).toBe(500); expect(await app.prisma.consultation.count({ where: { appointmentId } })).toBe(0);
    expect(await app.prisma.notification.count({ where: { recipientId: patient } })).toBe(count);
  });

  describe('B5 — démarrage : aucun appel Daily sous verrou, salle propre à la tentative', () => {
    const ROOM_NAME = /^consult-[a-z0-9]{1,64}-[0-9a-f]{32}$/;
    const startReq = () => app.inject({ method: 'POST', url: '/api/v1/consultations', headers: auth(doctor), payload: { appointmentId } });
    const dailyRoom = (name: string) => ({ name, url: `https://digisante.daily.co/${name}`, expiresAt: Math.floor(Date.now() / 1000) + 14_400 });
    const createdNames = () => vi.mocked(daily.createRoom).mock.calls.map(([opts]) => opts.name);
    const notifications = () => app.prisma.notification.count({ where: { recipientId: patient, type: 'CONSULTATION_START' } });
    /** Autre connexion, bornée : sur un verrou tenu, échoue en 2 s au lieu de bloquer le test. */
    const outside = (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => app.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`; await fn(tx);
    }).then(() => true, () => false);

    beforeEach(async () => {
      await app.prisma.consultation.delete({ where: { id: consultationId } });
      vi.mocked(daily.createRoom).mockImplementation(async ({ name }) => dailyRoom(name));
    });

    it('succès : salle relue rattachée, notification unique, aucune suppression', async () => {
      const before = await notifications();
      const res = await startReq();
      expect(res.statusCode).toBe(201); expect(res.json()).toMatchObject({ provider: 'DAILY' });
      const [name] = createdNames(); expect(name).toMatch(ROOM_NAME);
      expect(res.json().roomUrl).toBe(`https://digisante.daily.co/${name}`); expect(res.body).not.toContain('token');
      expect((await app.prisma.consultation.findUniqueOrThrow({ where: { appointmentId } })).dailyRoomName).toBe(name);
      expect(await notifications()).toBe(before + 1); expect(daily.deleteRoom).not.toHaveBeenCalled();
    });
    it('sans Daily configuré : vidéo explicitement indisponible, aucun nom de salle', async () => {
      vi.mocked(daily.createRoom).mockImplementation(async ({ name }) => ({ name, url: null, expiresAt: 0 }));
      const res = await startReq();
      expect(res.statusCode).toBe(201); expect(res.json()).toMatchObject({ provider: 'UNAVAILABLE', roomUrl: null });
      expect((await app.prisma.consultation.findUniqueOrThrow({ where: { appointmentId } })).dailyRoomName).toBeNull();
    });
    it('démarrage refusé d’emblée : aucun appel fournisseur', async () => {
      await app.prisma.appointment.update({ where: { id: appointmentId }, data: { status: 'CANCELLED' } });
      expect((await startReq()).statusCode).toBe(400); expect(daily.createRoom).not.toHaveBeenCalled();
    });
    it('pendant l’appel Daily, RDV et médecin restent verrouillables et réservables ; panne sans consultation', async () => {
      let locksFree: unknown = 'not-run'; let booked: unknown = 'not-run';
      vi.mocked(daily.createRoom).mockImplementationOnce(async () => {
        // Un verrou encore tenu par le démarrage ferait échouer NOWAIT immédiatement.
        locksFree = await app.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${appointmentId} FOR UPDATE NOWAIT`;
          await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${doctorId} FOR UPDATE NOWAIT`;
        }).then(() => true, () => false);
        // Réservation réelle chez ce médecin (doctors FOR UPDATE) : jamais suspendue au fournisseur.
        booked = await Promise.race([
          appointments.book(app, patient, { doctorId, type: 'TELECONSULTATION', scheduledAt: new Date(Date.now() + 40 * 86_400_000) }).then(() => true, () => false),
          new Promise((resolve) => setTimeout(() => resolve('blocked'), 3_000)),
        ]);
        throw new Error('test-only-provider-failure');
      });
      const before = await notifications();
      expect((await startReq()).statusCode).toBe(500);
      expect(locksFree).toBe(true); expect(booked).toBe(true);
      expect(await app.prisma.consultation.count({ where: { appointmentId } })).toBe(0);
      expect(await notifications()).toBe(before); expect(daily.deleteRoom).not.toHaveBeenCalled();
    });
    it('RDV annulé pendant l’appel Daily : 400, aucune consultation, salle de la tentative supprimée', async () => {
      let cancelled: unknown = 'not-run';
      vi.mocked(daily.createRoom).mockImplementationOnce(async ({ name }) => {
        cancelled = await outside((tx) => tx.appointment.update({ where: { id: appointmentId }, data: { status: 'CANCELLED' } }));
        return dailyRoom(name);
      });
      const before = await notifications();
      const res = await startReq();
      expect(cancelled).toBe(true);
      expect(res.statusCode).toBe(400); expect(res.json().message).toBe('Le rendez-vous doit être confirmé');
      expect(await app.prisma.consultation.count({ where: { appointmentId } })).toBe(0);
      expect(await notifications()).toBe(before);
      const [name] = createdNames(); expect(daily.deleteRoom).toHaveBeenCalledOnce();
      expect(vi.mocked(daily.deleteRoom).mock.calls[0]![0].name).toBe(name);
    });
    it('patient suspendu ou PRO révoqué pendant l’appel Daily : 403 et suppression', async () => {
      const mutations = [
        () => outside((tx) => tx.user.update({ where: { id: patient }, data: { status: 'SUSPENDED' } })),
        () => outside((tx) => tx.subscriptionOrder.updateMany({ where: { doctorId }, data: { revokedAt: new Date() } })),
      ];
      try {
        for (const mutate of mutations) {
          vi.clearAllMocks();
          await app.prisma.user.update({ where: { id: patient }, data: { status: 'ACTIVE' } });
          let applied: unknown = 'not-run';
          vi.mocked(daily.createRoom).mockImplementationOnce(async ({ name }) => { applied = await mutate(); return dailyRoom(name); });
          expect((await startReq()).statusCode).toBe(403); expect(applied).toBe(true);
          expect(await app.prisma.consultation.count({ where: { appointmentId } })).toBe(0);
          expect(vi.mocked(daily.deleteRoom).mock.calls.map(([o]) => o.name)).toEqual(createdNames());
        }
      } finally {
        await app.prisma.subscriptionOrder.updateMany({ where: { doctorId }, data: { revokedAt: null } });
      }
    });
    it('suppression impossible : l’erreur d’origine reste la réponse, nom journalisé seul', async () => {
      vi.mocked(daily.deleteRoom).mockResolvedValue(false);
      vi.mocked(daily.createRoom).mockImplementationOnce(async ({ name }) => {
        await outside((tx) => tx.appointment.update({ where: { id: appointmentId }, data: { status: 'CANCELLED' } }));
        return dailyRoom(name);
      });
      const warn = vi.spyOn(app.log, 'warn');
      try {
        const res = await startReq();
        expect(res.statusCode).toBe(400); expect(res.json().message).toBe('Le rendez-vous doit être confirmé');
        expect(warn).toHaveBeenCalledWith({ room: createdNames()[0] }, expect.stringContaining('[Daily]'));
      } finally { warn.mockRestore(); }
    });
    it('verrou médecin tenu plus de 5 s (souscription PRO concurrente) : le démarrage attend puis réussit', async () => {
      // subscriptions.subscribe tient doctors FOR UPDATE pendant ses appels FedaPay (jusqu'à 25 s) ;
      // requireProWithin (FOR SHARE) attend ce verrou dans les phases 1 et 3 du démarrage.
      let locked!: () => void;
      const held = new Promise<void>((resolve) => { locked = resolve; });
      const holder = app.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${doctorId} FOR UPDATE`;
        locked();
        await new Promise((resolve) => setTimeout(resolve, 6_000));
      }, { timeout: 15_000 });
      await held;
      const res = await startReq();
      await holder;
      expect(res.statusCode).toBe(201);
      expect(await app.prisma.consultation.count({ where: { appointmentId } })).toBe(1);
      expect(daily.deleteRoom).not.toHaveBeenCalled();
    });
    it('deux démarrages simultanés : une consultation, une notification, salle perdante supprimée', async () => {
      let arrived = 0; let release!: () => void;
      const barrier = new Promise<void>((resolve) => { release = resolve; });
      vi.mocked(daily.createRoom).mockImplementation(async ({ name }) => {
        if (++arrived === 2) release();
        // Les deux tentatives sont simultanément chez le fournisseur (borne : 1 s).
        await Promise.race([barrier, new Promise((resolve) => setTimeout(resolve, 1_000))]);
        return dailyRoom(name);
      });
      const before = await notifications();
      const results = await Promise.all([startReq(), startReq()]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 400]);
      expect(results.find((r) => r.statusCode === 400)!.json().message).toBe('Une consultation existe déjà pour ce rendez-vous');
      const names = createdNames();
      expect(names).toHaveLength(2); expect(new Set(names).size).toBe(2);
      for (const name of names) { expect(name).toMatch(ROOM_NAME); expect(name.length).toBeLessThanOrEqual(daily.ROOM_NAME_MAX_LENGTH); }
      const kept = (await app.prisma.consultation.findUniqueOrThrow({ where: { appointmentId } })).dailyRoomName;
      expect(names).toContain(kept);
      expect(vi.mocked(daily.deleteRoom).mock.calls.map(([o]) => o.name)).toEqual(names.filter((n) => n !== kept));
      expect(await notifications()).toBe(before + 1);
    });
  });
});
