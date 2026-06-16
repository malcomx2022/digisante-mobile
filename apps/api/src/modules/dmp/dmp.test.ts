// Tests d'intégration DMP + prescriptions (via app.inject). Si DB+Redis (CI).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290193000001', '+2290193000002', '+2290193000003'];

describe.skipIf(!HAS_INFRA)('DMP & prescriptions (intégration)', () => {
  let app: FastifyInstance;
  let patientToken: string;
  let doctorToken: string;
  let adminToken: string;
  let patientId: string;

  const auth = (t: string, share?: string) => ({ authorization: `Bearer ${t}`, ...(share ? { 'x-share-token': share } : {}) });
  const cleanup = async () => {
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
  };

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const patient = await app.prisma.user.create({
      data: { phone: PHONES[0], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Koffi', lastName: 'D' } }, patient: { create: { allergies: ['Pénicilline'] } } },
      include: { patient: true },
    });
    const doctor = await app.prisma.user.create({
      data: { phone: PHONES[1], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Awa', lastName: 'K' } }, doctor: { create: { speciality: 'Généraliste', licenseNumber: 'BJ-MED-6001', consultFee: 3000, verifiedAt: new Date() } } },
    });
    const admin = await app.prisma.user.create({
      data: { phone: PHONES[2], role: 'ADMIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'A', lastName: 'D' } } },
    });
    patientId = patient.patient!.id;
    patientToken = app.jwt.sign({ sub: patient.id, role: 'PATIENT' }, { expiresIn: '15m' });
    doctorToken = app.jwt.sign({ sub: doctor.id, role: 'MEDECIN' }, { expiresIn: '15m' });
    adminToken = app.jwt.sign({ sub: admin.id, role: 'ADMIN' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('DMP : création, partage consenti, lecture soignant, refus admin, export', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/dmp/records',
      headers: auth(patientToken),
      payload: { type: 'VITAL_SIGNS', title: 'Constantes', data: { bp: '120/80' } },
    });
    expect(create.statusCode).toBe(201);
    const recordId = create.json().id as string;

    // Le patient lit son dossier (donnée déchiffrée/restituée).
    const own = await app.inject({ method: 'GET', url: '/api/v1/dmp/records', headers: auth(patientToken) });
    expect(own.statusCode).toBe(200);
    expect(own.json()[0].data.bp).toBe('120/80');

    // Soignant SANS partage → refusé (NO_CONSENT).
    const denied = await app.inject({ method: 'GET', url: `/api/v1/dmp/records?patientId=${patientId}`, headers: auth(doctorToken) });
    expect(denied.statusCode).toBe(403);

    // Le patient partage l'entrée.
    const share = await app.inject({ method: 'POST', url: `/api/v1/dmp/records/${recordId}/share`, headers: auth(patientToken), payload: { shareType: 'QR_CODE', ttlHours: 24 } });
    expect(share.statusCode).toBe(200);
    const token = share.json().shareToken as string;

    // Soignant AVEC partage → autorisé.
    const granted = await app.inject({ method: 'GET', url: `/api/v1/dmp/records?patientId=${patientId}`, headers: auth(doctorToken, token) });
    expect(granted.statusCode).toBe(200);
    expect(granted.json().length).toBeGreaterThanOrEqual(1);

    // Admin → JAMAIS le contenu médical (cloisonnement).
    const adminTry = await app.inject({ method: 'GET', url: `/api/v1/dmp/records?patientId=${patientId}`, headers: auth(adminToken) });
    expect(adminTry.statusCode).toBe(403);

    // Export FHIR (portabilité) + audit DATA_EXPORT.
    const before = await app.prisma.auditLog.count({ where: { action: 'DATA_EXPORT' } });
    const exp = await app.inject({ method: 'GET', url: '/api/v1/dmp/export', headers: auth(patientToken) });
    expect(exp.statusCode).toBe(200);
    expect(exp.json().resourceType).toBe('Bundle');
    const after = await app.prisma.auditLog.count({ where: { action: 'DATA_EXPORT' } });
    expect(after).toBe(before + 1);
  });

  it('Prescriptions : conflit d’allergie bloquant, puis ordonnance signée (QR)', async () => {
    const validUntil = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();

    const conflict = await app.inject({
      method: 'POST',
      url: '/api/v1/prescriptions',
      headers: auth(doctorToken),
      payload: { patientId, validUntil, items: [{ medicationName: 'Pénicilline', dosage: '500mg', frequency: '2x/j', duration: '7j' }] },
    });
    expect(conflict.statusCode).toBe(400);
    expect(conflict.json().details.allergyConflicts).toContain('Pénicilline');

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/prescriptions',
      headers: auth(doctorToken),
      payload: { patientId, validUntil, items: [{ medicationName: 'Paracétamol', dosage: '1g', frequency: '3x/j', duration: '5j' }] },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().qrCode).toBeTruthy(); // signature numérique
    expect(ok.json().items).toHaveLength(1);

    // Le patient retrouve son ordonnance.
    const mine = await app.inject({ method: 'GET', url: '/api/v1/prescriptions', headers: auth(patientToken) });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().length).toBeGreaterThanOrEqual(1);
  });
});
