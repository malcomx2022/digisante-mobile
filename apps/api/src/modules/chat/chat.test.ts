// Tests d'intégration du module Chat via app.inject().
// Exécutés UNIQUEMENT si DATABASE_URL et REDIS_URL sont présents (CI) ;
// sinon le bloc est ignoré (pnpm test reste vert en local sans infra).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

const PHONE_PATIENT = '+2290196010001';
const PHONE_DOCTOR = '+2290196010002';
const PHONE_OTHER = '+2290196010003';
const ALL_PHONES = [PHONE_PATIENT, PHONE_DOCTOR, PHONE_OTHER];

describe.skipIf(!HAS_INFRA)('Chat (intégration)', () => {
  let app: FastifyInstance;

  /** Inscrit + active un compte et renvoie { userId, accessToken }. */
  async function registerAndLogin(payload: Record<string, unknown>) {
    const reg = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload });
    if (reg.statusCode !== 201) throw new Error(`register ${reg.statusCode}: ${reg.body}`);
    const devCode = reg.json().otp.devCode as string;
    const userId = reg.json().user.id as string;
    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { phone: payload.phone, code: devCode },
    });
    return { userId, accessToken: verify.json().accessToken as string };
  }

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  let patientToken: string;
  let doctorToken: string;
  let doctorId: string;
  let patientId: string;
  let threadId: string;

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: ALL_PHONES } } });

    const patient = await registerAndLogin({
      phone: PHONE_PATIENT,
      role: 'PATIENT',
      lang: 'FR',
      firstName: 'Koffi',
      lastName: 'Dossou',
    });
    patientToken = patient.accessToken;
    patientId = (await app.prisma.patient.findUniqueOrThrow({
      where: { userId: patient.userId },
      select: { id: true },
    })).id;

    const doctor = await registerAndLogin({
      phone: PHONE_DOCTOR,
      role: 'MEDECIN',
      lang: 'FR',
      firstName: 'Awa',
      lastName: 'Sanni',
      speciality: 'Cardiologie',
      licenseNumber: 'ORD-CHAT-001',
      consultFee: 5000,
    });
    doctorToken = doctor.accessToken;
    doctorId = (await app.prisma.doctor.findUniqueOrThrow({
      where: { userId: doctor.userId },
      select: { id: true },
    })).id;
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: { in: ALL_PHONES } } });
    await app.close();
  });

  it('le patient ouvre un fil avec le médecin (idempotent)', async () => {
    const open = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/threads',
      headers: auth(patientToken),
      payload: { counterpartId: doctorId },
    });
    expect(open.statusCode).toBe(201);
    expect(open.json().counterpart.role).toBe('MEDECIN');
    threadId = open.json().id as string;

    // Idempotence : ré-ouvrir renvoie le même fil.
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/threads',
      headers: auth(patientToken),
      payload: { counterpartId: doctorId },
    });
    expect(again.json().id).toBe(threadId);

    // Côté médecin : ouvrir avec le Patient.id renvoie le MÊME fil (branche MEDECIN).
    const fromDoctor = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/threads',
      headers: auth(doctorToken),
      payload: { counterpartId: patientId },
    });
    expect(fromDoctor.json().id).toBe(threadId);
    expect(fromDoctor.json().counterpart.role).toBe('PATIENT');
  });

  it('échange de messages + non-lus + lecture', async () => {
    const send = await app.inject({
      method: 'POST',
      url: `/api/v1/chat/threads/${threadId}/messages`,
      headers: auth(patientToken),
      payload: { body: 'Bonjour docteur, j’ai une question.' },
    });
    expect(send.statusCode).toBe(201);
    expect(send.json().mine).toBe(true);
    expect(send.json().body).toBe('Bonjour docteur, j’ai une question.');

    // Côté médecin : le message apparaît comme non-lu.
    const threads = await app.inject({ method: 'GET', url: '/api/v1/chat/threads', headers: auth(doctorToken) });
    const docThread = threads.json().find((t: { id: string }) => t.id === threadId);
    expect(docThread.unreadCount).toBe(1);
    expect(docThread.counterpart.role).toBe('PATIENT');

    // Le médecin lit les messages (corps déchiffré).
    const msgs = await app.inject({
      method: 'GET',
      url: `/api/v1/chat/threads/${threadId}/messages`,
      headers: auth(doctorToken),
    });
    expect(msgs.json()[0].body).toBe('Bonjour docteur, j’ai une question.');
    expect(msgs.json()[0].mine).toBe(false);

    // Marquage lu → plus de non-lus.
    const read = await app.inject({
      method: 'POST',
      url: `/api/v1/chat/threads/${threadId}/read`,
      headers: auth(doctorToken),
    });
    expect(read.json().updated).toBe(1);

    const after = await app.inject({ method: 'GET', url: '/api/v1/chat/threads', headers: auth(doctorToken) });
    expect(after.json().find((t: { id: string }) => t.id === threadId).unreadCount).toBe(0);
  });

  it('un non-participant ne peut pas lire le fil (403)', async () => {
    const other = await registerAndLogin({
      phone: PHONE_OTHER,
      role: 'PATIENT',
      lang: 'FR',
      firstName: 'Intrus',
      lastName: 'Test',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/chat/threads/${threadId}/messages`,
      headers: auth(other.accessToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejette l’accès sans authentification (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/chat/threads' });
    expect(res.statusCode).toBe(401);
  });

  it('rejette un corps de message vide (422)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/chat/threads/${threadId}/messages`,
      headers: auth(patientToken),
      payload: { body: '   ' },
    });
    expect(res.statusCode).toBe(422);
  });
});
