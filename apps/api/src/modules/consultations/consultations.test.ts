// API réelle + DB/Redis isolés ; seul le fournisseur Daily est simulé.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/daily.js', async (original) => ({
  ...await original<typeof import('@/services/daily.js')>(),
  createRoom: vi.fn(), createMeetingToken: vi.fn(), deleteRoom: vi.fn(), ejectParticipants: vi.fn(),
}));
const daily = await import('@/services/daily.js');
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
});
