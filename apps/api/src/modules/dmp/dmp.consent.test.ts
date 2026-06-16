// Test d'intégration du consentement DMP PAR SOIGNANT (§4) : réclamation via token,
// gestion (liste/révocation), et révocation persistante. CI uniquement (DB+Redis).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290194000001', '+2290194000002', '+2290194000003'];

describe.skipIf(!HAS_INFRA)('Consentement DMP par soignant (intégration)', () => {
  let app: FastifyInstance;
  let patientToken: string;
  let doctor1Token: string;
  let doctor2Token: string;
  let doctor1Id: string;
  let patientId: string;

  const auth = (t: string, share?: string) => ({
    authorization: `Bearer ${t}`,
    ...(share ? { 'x-share-token': share } : {}),
  });
  const cleanup = () => app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const patient = await app.prisma.user.create({
      data: {
        phone: PHONES[0], role: 'PATIENT', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Koffi', lastName: 'D' } },
        patient: { create: {} },
      },
      include: { patient: true },
    });
    const doctor1 = await app.prisma.user.create({
      data: {
        phone: PHONES[1], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Awa', lastName: 'K' } },
        doctor: { create: { speciality: 'Cardiologie', licenseNumber: 'BJ-MED-7001', consultFee: 3000 } },
      },
    });
    const doctor2 = await app.prisma.user.create({
      data: {
        phone: PHONES[2], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Beni', lastName: 'T' } },
        doctor: { create: { speciality: 'Dermatologie', licenseNumber: 'BJ-MED-7002', consultFee: 3000 } },
      },
    });
    patientId = patient.patient!.id;
    doctor1Id = doctor1.id;
    patientToken = app.jwt.sign({ sub: patient.id, role: 'PATIENT' }, { expiresIn: '15m' });
    doctor1Token = app.jwt.sign({ sub: doctor1.id, role: 'MEDECIN' }, { expiresIn: '15m' });
    doctor2Token = app.jwt.sign({ sub: doctor2.id, role: 'MEDECIN' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('le token lie le consentement au soignant qui le présente, puis l’accès tient sans token', async () => {
    // Le patient crée une entrée et la partage.
    const rec = await app.inject({
      method: 'POST', url: '/api/v1/dmp/records', headers: auth(patientToken),
      payload: { type: 'VITAL_SIGNS', title: 'Constantes', data: { bp: '120/80' } },
    });
    const recordId = rec.json().id as string;
    const share = await app.inject({
      method: 'POST', url: `/api/v1/dmp/records/${recordId}/share`,
      headers: auth(patientToken), payload: { shareType: 'QR_CODE', ttlHours: 24 },
    });
    const token = share.json().shareToken as string;

    // Médecin 1 présente le token → accès + consentement créé pour LUI.
    const claim = await app.inject({ method: 'GET', url: `/api/v1/dmp/records?patientId=${patientId}`, headers: auth(doctor1Token, token) });
    expect(claim.statusCode).toBe(200);

    // Ensuite, médecin 1 accède SANS token (le consentement persiste).
    const again = await app.inject({ method: 'GET', url: `/api/v1/dmp/records?patientId=${patientId}`, headers: auth(doctor1Token) });
    expect(again.statusCode).toBe(200);

    // Le patient voit le soignant dans la liste des consentements (actif).
    const consents = await app.inject({ method: 'GET', url: '/api/v1/dmp/consents', headers: auth(patientToken) });
    expect(consents.statusCode).toBe(200);
    const entry = consents.json().find((c: { granteeId: string }) => c.granteeId === doctor1Id);
    expect(entry).toBeTruthy();
    expect(entry.active).toBe(true);
    expect(entry.speciality).toBe('Cardiologie');

    // Médecin 2 (jamais le token) reste refusé.
    const d2 = await app.inject({ method: 'GET', url: `/api/v1/dmp/records?patientId=${patientId}`, headers: auth(doctor2Token) });
    expect(d2.statusCode).toBe(403);
  });

  it('la révocation est persistante : le soignant révoqué ne peut PAS re-réclamer via l’ancien token', async () => {
    // Récupère le token de partage encore valide.
    const records = await app.inject({ method: 'GET', url: '/api/v1/dmp/records', headers: auth(patientToken) });
    const recordId = records.json()[0].id as string;
    const share = await app.inject({
      method: 'POST', url: `/api/v1/dmp/records/${recordId}/share`,
      headers: auth(patientToken), payload: { shareType: 'QR_CODE', ttlHours: 24 },
    });
    const token = share.json().shareToken as string;

    // Le patient révoque le médecin 1.
    const revoke = await app.inject({ method: 'DELETE', url: `/api/v1/dmp/consents/${doctor1Id}`, headers: auth(patientToken) });
    expect(revoke.statusCode).toBe(200);

    // Accès sans token → refusé.
    const noToken = await app.inject({ method: 'GET', url: `/api/v1/dmp/records?patientId=${patientId}`, headers: auth(doctor1Token) });
    expect(noToken.statusCode).toBe(403);

    // Re-présentation de l'ancien token (toujours valide) → TOUJOURS refusé (révocation persistante).
    const withToken = await app.inject({ method: 'GET', url: `/api/v1/dmp/records?patientId=${patientId}`, headers: auth(doctor1Token, token) });
    expect(withToken.statusCode).toBe(403);

    // La liste marque le consentement comme inactif.
    const consents = await app.inject({ method: 'GET', url: '/api/v1/dmp/consents', headers: auth(patientToken) });
    const entry = consents.json().find((c: { granteeId: string }) => c.granteeId === doctor1Id);
    expect(entry.active).toBe(false);
    expect(entry.revokedAt).toBeTruthy();
  });

  it('le patient peut RÉ-AUTORISER un soignant révoqué (re-octroi délibéré)', async () => {
    // Pré-condition : doctor1 est révoqué (test précédent) → accès refusé.
    const denied = await app.inject({ method: 'GET', url: `/api/v1/dmp/records?patientId=${patientId}`, headers: auth(doctor1Token) });
    expect(denied.statusCode).toBe(403);

    // Le patient ré-autorise explicitement.
    const regrant = await app.inject({
      method: 'POST', url: `/api/v1/dmp/consents/${doctor1Id}/regrant`,
      headers: auth(patientToken), payload: { ttlHours: 48 },
    });
    expect(regrant.statusCode).toBe(200);

    // L'accès est restauré (sans token).
    const granted = await app.inject({ method: 'GET', url: `/api/v1/dmp/records?patientId=${patientId}`, headers: auth(doctor1Token) });
    expect(granted.statusCode).toBe(200);

    // La liste le remarque actif à nouveau.
    const consents = await app.inject({ method: 'GET', url: '/api/v1/dmp/consents', headers: auth(patientToken) });
    const entry = consents.json().find((c: { granteeId: string }) => c.granteeId === doctor1Id);
    expect(entry.active).toBe(true);
    expect(entry.revokedAt).toBeNull();
  });
});
