// Tests d'intégration Éducation + Admin (via app.inject). Si DB+Redis (CI).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+22991000001', '+22991000002', '+22991000003'];

describe.skipIf(!HAS_INFRA)('Éducation & Admin (intégration)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let doctorToken: string;
  let patientUserId: string;
  let patientToken: string;
  const createdContentIds: string[] = [];

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  const cleanup = async () => {
    await app.prisma.healthContent.deleteMany({ where: { id: { in: createdContentIds } } });
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
  };

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const admin = await app.prisma.user.create({ data: { phone: PHONES[0], role: 'ADMIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Adm', lastName: 'In' } } } });
    const doctor = await app.prisma.user.create({ data: { phone: PHONES[1], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Dr', lastName: 'V' } }, doctor: { create: { speciality: 'G', licenseNumber: 'BJ-MED-4001', consultFee: 0, verifiedAt: new Date() } } } });
    const patient = await app.prisma.user.create({ data: { phone: PHONES[2], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'P', lastName: 'A' } }, patient: { create: {} } } });
    patientUserId = patient.id;
    adminToken = app.jwt.sign({ sub: admin.id, role: 'ADMIN' }, { expiresIn: '15m' });
    doctorToken = app.jwt.sign({ sub: doctor.id, role: 'MEDECIN' }, { expiresIn: '15m' });
    patientToken = app.jwt.sign({ sub: patient.id, role: 'PATIENT' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('Éducation : workflow brouillon → relecture → traduction → publié', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/v1/education', headers: auth(adminToken), payload: { title: 'Prévention paludisme', body: 'Dormez sous moustiquaire.', category: 'PREVENTION' } });
    expect(create.statusCode).toBe(201);
    const id = create.json().id as string;
    createdContentIds.push(id);

    // Publication impossible depuis DRAFT.
    const tooEarly = await app.inject({ method: 'POST', url: `/api/v1/education/${id}/publish`, headers: auth(adminToken) });
    expect(tooEarly.statusCode).toBe(400);

    await app.inject({ method: 'POST', url: `/api/v1/education/${id}/submit-review`, headers: auth(adminToken) });

    const review = await app.inject({ method: 'POST', url: `/api/v1/education/${id}/medical-review`, headers: auth(doctorToken), payload: { approve: true } });
    expect(review.statusCode).toBe(200);
    expect(review.json().status).toBe('TRANSLATION');

    await app.inject({ method: 'PATCH', url: `/api/v1/education/${id}/translations`, headers: auth(adminToken), payload: { translations: { FON: { title: 'Sɔ́…', body: '…' } } } });

    const publish = await app.inject({ method: 'POST', url: `/api/v1/education/${id}/publish`, headers: auth(adminToken) });
    expect(publish.statusCode).toBe(200);
    expect(publish.json().isPublished).toBe(true);

    // Visible au catalogue (patient).
    const list = await app.inject({ method: 'GET', url: '/api/v1/education?category=PREVENTION', headers: auth(patientToken) });
    expect(list.statusCode).toBe(200);
    expect(list.json().some((c: { id: string }) => c.id === id)).toBe(true);
  });

  it('Éducation : relecture médicale réservée aux médecins vérifiés', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/v1/education', headers: auth(adminToken), payload: { title: 'Nutrition', body: 'Mangez équilibré.', category: 'NUTRITION' } });
    const id = create.json().id as string;
    createdContentIds.push(id);
    await app.inject({ method: 'POST', url: `/api/v1/education/${id}/submit-review`, headers: auth(adminToken) });
    // Un patient ne peut pas faire la relecture médicale (RBAC 403).
    const denied = await app.inject({ method: 'POST', url: `/api/v1/education/${id}/medical-review`, headers: auth(patientToken), payload: { approve: true } });
    expect(denied.statusCode).toBe(403);
  });

  it('Admin : métriques + suspension d’un utilisateur (audit USER_SUSPEND)', async () => {
    const metrics = await app.inject({ method: 'GET', url: '/api/v1/admin/metrics', headers: auth(adminToken) });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.json().users).toBeDefined();
    expect(typeof metrics.json().uptimeSeconds).toBe('number');

    const before = await app.prisma.auditLog.count({ where: { action: 'USER_SUSPEND' } });
    const suspend = await app.inject({ method: 'POST', url: `/api/v1/admin/users/${patientUserId}/suspend`, headers: auth(adminToken) });
    expect(suspend.statusCode).toBe(200);
    expect(suspend.json().status).toBe('SUSPENDED');
    const after = await app.prisma.auditLog.count({ where: { action: 'USER_SUSPEND' } });
    expect(after).toBe(before + 1);

    // RBAC : un patient n'accède pas aux métriques.
    const forbidden = await app.inject({ method: 'GET', url: '/api/v1/admin/metrics', headers: auth(patientToken) });
    expect(forbidden.statusCode).toBe(403);
  });
});
