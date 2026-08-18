// Tests d'intégration Éducation + Admin (via app.inject). Si DB+Redis (CI).
import { ADMIN_PRESETS } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290191000001', '+2290191000002', '+2290191000003', '+2290191000004'];

describe.skipIf(!HAS_INFRA)('Éducation & Admin (intégration)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let doctorToken: string;
  let patientUserId: string;
  let patientToken: string;
  let unverifiedDoctorToken: string;
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

    const admin = await app.prisma.user.create({
      data: {
        phone: PHONES[0], role: 'ADMIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Adm', lastName: 'In' } },
        adminProfile: { create: { scopes: [...ADMIN_PRESETS.SUPER_ADMIN], preset: 'SUPER_ADMIN' } },
      },
    });
    const doctor = await app.prisma.user.create({ data: { phone: PHONES[1], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Dr', lastName: 'V' } }, doctor: { create: { speciality: 'G', licenseNumber: 'BJ-MED-4001', consultFee: 0, verifiedAt: new Date() } } } });
    const patient = await app.prisma.user.create({ data: { phone: PHONES[2], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'P', lastName: 'A' } }, patient: { create: {} } } });
    // Médecin inscrit mais KYC non approuvé : ne doit voir NI la file NI pouvoir valider (§4).
    const unverified = await app.prisma.user.create({ data: { phone: PHONES[3], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Dr', lastName: 'NV' } }, doctor: { create: { speciality: 'G', licenseNumber: 'BJ-MED-4002', consultFee: 0 } } } });
    unverifiedDoctorToken = app.jwt.sign({ sub: unverified.id, role: 'MEDECIN' }, { expiresIn: '15m' });
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

    // Liste de gestion (admin) : visible avec filtre statut PUBLISHED.
    const manage = await app.inject({ method: 'GET', url: '/api/v1/education/manage?status=PUBLISHED&pageSize=100', headers: auth(adminToken) });
    expect(manage.statusCode).toBe(200);
    expect(manage.json().data.some((c: { id: string }) => c.id === id)).toBe(true);
    // RBAC : un patient (sans education:write) n'accède pas à la gestion.
    const denied = await app.inject({ method: 'GET', url: '/api/v1/education/manage', headers: auth(patientToken) });
    expect(denied.statusCode).toBe(403);
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

  // Lot 9 / écart D3 : `/manage` étant réservée à l'admin, le médecin n'avait
  // AUCUN moyen de savoir quel contenu attendait sa validation — le pipeline
  // restait donc bloqué en MEDICAL_REVIEW pour toujours.
  it('Éducation : file de relecture (médecin vérifié) → le contenu en sort une fois validé', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/v1/education', headers: auth(adminToken), payload: { title: 'Hydratation', body: 'Buvez de l’eau potable.', category: 'PREVENTION' } });
    const id = create.json().id as string;
    createdContentIds.push(id);
    await app.inject({ method: 'POST', url: `/api/v1/education/${id}/submit-review`, headers: auth(adminToken) });

    const inQueue = async (token: string) => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/education/review-queue?pageSize=100', headers: auth(token) });
      return res;
    };

    // Le médecin vérifié voit le contenu soumis.
    const queue = await inQueue(doctorToken);
    expect(queue.statusCode).toBe(200);
    expect(queue.json().data.some((c: { id: string }) => c.id === id)).toBe(true);
    // La file ne contient QUE des contenus en attente (pas les brouillons d'autrui).
    expect(queue.json().data.every((c: { status: string }) => c.status === 'MEDICAL_REVIEW')).toBe(true);

    // Médecin NON vérifié : 403 (côté UI, la tuile du tableau de bord est masquée).
    expect((await inQueue(unverifiedDoctorToken)).statusCode).toBe(403);
    // Patient : 403 (RBAC de rôle).
    expect((await inQueue(patientToken)).statusCode).toBe(403);
    // Admin : 403 aussi — §4, l'admin ne valide JAMAIS un contenu médical.
    expect((await inQueue(adminToken)).statusCode).toBe(403);

    // Validation → le contenu quitte la file et avance dans le pipeline.
    const approved = await app.inject({ method: 'POST', url: `/api/v1/education/${id}/medical-review`, headers: auth(doctorToken), payload: { approve: true } });
    expect(approved.json().status).toBe('TRANSLATION');
    const after = await inQueue(doctorToken);
    expect(after.json().data.some((c: { id: string }) => c.id === id)).toBe(false);
  });

  it('Éducation : un refus renvoie le contenu en brouillon (et le sort de la file)', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/v1/education', headers: auth(adminToken), payload: { title: 'Brouillon à revoir', body: 'Texte imprécis.', category: 'PREVENTION' } });
    const id = create.json().id as string;
    createdContentIds.push(id);
    await app.inject({ method: 'POST', url: `/api/v1/education/${id}/submit-review`, headers: auth(adminToken) });

    const rejected = await app.inject({ method: 'POST', url: `/api/v1/education/${id}/medical-review`, headers: auth(doctorToken), payload: { approve: false } });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().status).toBe('DRAFT');
    const queue = await app.inject({ method: 'GET', url: '/api/v1/education/review-queue?pageSize=100', headers: auth(doctorToken) });
    expect(queue.json().data.some((c: { id: string }) => c.id === id)).toBe(false);
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
