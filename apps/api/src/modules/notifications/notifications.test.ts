// Tests d'intégration Notifications (via app.inject). Si DB+Redis (CI).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONE = '+22989000001';
const SVC = 'svc_token_p42';

describe.skipIf(!HAS_INFRA)('Notifications (intégration)', () => {
  let app: FastifyInstance;
  let token: string;
  let userId: string;
  const ids: string[] = [];

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    process.env.RECONCILE_TOKEN = SVC; // jeton de service AVANT chargement env
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: PHONE } });

    const user = await app.prisma.user.create({
      data: { phone: PHONE, email: 'u@example.bj', role: 'PATIENT', status: 'ACTIVE', lang: 'FON', profile: { create: { firstName: 'K', lastName: 'D' } }, patient: { create: {} } },
    });
    userId = user.id;
    token = app.jwt.sign({ sub: user.id, role: 'PATIENT' }, { expiresIn: '15m' });

    const seed = await app.prisma.notification.createManyAndReturn({
      data: [
        { recipientId: userId, type: 'APPOINTMENT_REMINDER', channel: 'IN_APP', title: 'RDV', body: 'demain', status: 'PENDING' },
        { recipientId: userId, type: 'LAB_RESULT', channel: 'SMS_TWILIO', title: 'Labo', body: 'résultat', status: 'PENDING' },
        { recipientId: userId, type: 'SOS_ALERT', channel: 'PUSH_FCM', title: 'SOS', body: 'urgence', status: 'PENDING' },
      ],
      select: { id: true },
    });
    ids.push(...seed.map((s) => s.id));
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: PHONE } });
    await app.close();
  });

  it('dispatch sans jeton de service → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/notifications/dispatch' });
    expect(res.statusCode).toBe(401);
  });

  it('dispatch : traite les PENDING dans la langue du destinataire', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/notifications/dispatch', headers: { 'x-service-token': SVC } });
    expect(res.statusCode).toBe(200);
    expect(res.json().processed).toBeGreaterThanOrEqual(3);

    const after = await app.prisma.notification.findMany({ where: { id: { in: ids } }, select: { status: true } });
    expect(after.every((n) => n.status !== 'PENDING')).toBe(true);
  });

  it('liste + marquage comme lue', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/v1/notifications', headers: auth(token) });
    expect(list.statusCode).toBe(200);
    expect(list.json().length).toBeGreaterThanOrEqual(3);

    const read = await app.inject({ method: 'POST', url: `/api/v1/notifications/${ids[0]}/read`, headers: auth(token) });
    expect(read.statusCode).toBe(200);
    expect(read.json().status).toBe('READ');
  });
});
