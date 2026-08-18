// Test d'intégration de l'annuaire des médecins (filtre langue + fiche). CI uniquement.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290195400001', '+2290195400002', '+2290195400003'];
// Médecin témoin créé/supprimé par le test du cache de l'annuaire.
const PHONES_EXTRA = '+2290195400004';

describe.skipIf(!HAS_INFRA)('Annuaire médecins (intégration)', () => {
  let app: FastifyInstance;
  let patientToken: string;
  let patientId: string;
  let drFonId: string;
  let drFonToken: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  // L'annuaire (pages de navigation) est servi via un cache Redis TTL : purge
  // pour que les lectures reflètent les fixtures de CE run, quel que soit
  // l'ordre des suites.
  async function purgeDirectoryCache() {
    const keys = await app.redis.keys('professionals:list:*');
    if (keys.length > 0) await app.redis.del(...keys);
  }

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await purgeDirectoryCache();

    const patient = await app.prisma.user.create({
      data: { phone: PHONES[0], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'P', lastName: 'D' } }, patient: { create: {} } },
      include: { patient: true },
    });
    patientId = patient.patient!.id;
    patientToken = app.jwt.sign({ sub: patient.id, role: 'PATIENT' }, { expiresIn: '15m' });

    const drFon = await app.prisma.user.create({
      data: {
        phone: PHONES[1], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Koffi', lastName: 'Agbo', spokenLangs: ['FR', 'FON'] } },
        doctor: { create: { speciality: 'Cardiologie', licenseNumber: 'BJ-MED-9401', consultFee: 3000, bio: 'Cardiologue à Cotonou.', verifiedAt: new Date() } },
      },
      include: { doctor: true },
    });
    drFonId = drFon.doctor!.id;
    drFonToken = app.jwt.sign({ sub: drFon.id, role: 'MEDECIN' }, { expiresIn: '15m' });

    await app.prisma.user.create({
      data: {
        phone: PHONES[2], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Awa', lastName: 'Sani', spokenLangs: ['FR', 'EN'] } },
        doctor: { create: { speciality: 'Dermatologie', licenseNumber: 'BJ-MED-9402', consultFee: 3000, verifiedAt: new Date() } },
      },
    });
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: { in: [...PHONES, PHONES_EXTRA] } } });
    await app.close();
  });

  // Lot 10 / écart D4 : `PATCH /professionals/me` n'avait AUCUN appelant. Le tarif,
  // qui est le montant IMPOSÉ PAR LE SERVEUR au paiement d'une consultation, était
  // donc figé à la valeur du KYC — un médecin ne pouvait jamais le changer.
  it('le médecin met à jour sa fiche (tarif, spécialité, bio) et la valeur fait foi', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/professionals/me',
      headers: auth(drFonToken),
      payload: { consultFee: 7500, speciality: 'Cardiologie interventionnelle', bio: 'Mise à jour.' },
    });
    expect(res.statusCode).toBe(200);
    expect(Number(res.json().consultFee)).toBe(7500);

    // La valeur est bien persistée — c'est elle que `payments.initiate` imposera.
    const doctor = await app.prisma.doctor.findUnique({ where: { id: drFonId }, select: { consultFee: true, speciality: true } });
    expect(Number(doctor?.consultFee)).toBe(7500);
    expect(doctor?.speciality).toBe('Cardiologie interventionnelle');

    // Et elle est relisible par le médecin pour préremplir son formulaire.
    const me = await app.inject({ method: 'GET', url: '/api/v1/users/me', headers: auth(drFonToken) });
    expect(Number(me.json().doctor.consultFee)).toBe(7500);

    // Un patient ne peut pas modifier une fiche professionnelle (403).
    const denied = await app.inject({ method: 'PATCH', url: '/api/v1/professionals/me', headers: auth(patientToken), payload: { consultFee: 1 } });
    expect(denied.statusCode).toBe(403);

    // Remise en état pour les autres tests de la suite : TOUS les champs touchés,
    // bio comprise (une suite ne doit pas dépendre de l'ordre d'exécution).
    await app.prisma.doctor.update({
      where: { id: drFonId },
      data: { consultFee: 3000, speciality: 'Cardiologie', bio: 'Cardiologue à Cotonou.' },
    });
    await purgeDirectoryCache();
  });

  it('filtre par langue parlée : ?lang=FON ne renvoie que le médecin parlant FON', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/professionals?lang=FON', headers: auth(patientToken) });
    expect(res.statusCode).toBe(200);
    const names = res.json().data.map((d: { profile: { firstName: string } }) => d.profile.firstName);
    expect(names).toContain('Koffi');
    expect(names).not.toContain('Awa');
  });

  it('?lang=EN ne renvoie que le médecin parlant EN', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/professionals?lang=EN', headers: auth(patientToken) });
    const names = res.json().data.map((d: { profile: { firstName: string } }) => d.profile.firstName);
    expect(names).toContain('Awa');
    expect(names).not.toContain('Koffi');
  });

  it('fiche détaillée : bio + langues parlées + badge vérifié', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/professionals/${drFonId}`, headers: auth(patientToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bio).toContain('Cardiologue');
    expect(body.profile.spokenLangs).toContain('FON');
    expect(body.isVerified).toBe(true);
  });

  it('avis : refusé sans consultation terminée, puis autorisé après', async () => {
    // Sans RDV terminé → 403.
    const denied = await app.inject({
      method: 'POST', url: `/api/v1/professionals/${drFonId}/reviews`, headers: auth(patientToken),
      payload: { rating: 5, comment: 'Excellent' },
    });
    expect(denied.statusCode).toBe(403);

    // Crée un RDV TERMINÉ entre le patient et ce médecin.
    await app.prisma.appointment.create({
      data: { patientId, doctorId: drFonId, type: 'TELECONSULTATION', status: 'COMPLETED', scheduledAt: new Date(Date.now() - 3600_000) },
    });

    const ok = await app.inject({
      method: 'POST', url: `/api/v1/professionals/${drFonId}/reviews`, headers: auth(patientToken),
      payload: { rating: 5, comment: 'Très à l’écoute' },
    });
    expect(ok.statusCode).toBe(201);

    // Résumé : moyenne 5, 1 avis.
    const list = await app.inject({ method: 'GET', url: `/api/v1/professionals/${drFonId}/reviews`, headers: auth(patientToken) });
    expect(list.json().summary.average).toBe(5);
    expect(list.json().summary.count).toBe(1);

    // La fiche reflète la note + canReview.
    const detail = await app.inject({ method: 'GET', url: `/api/v1/professionals/${drFonId}`, headers: auth(patientToken) });
    expect(detail.json().rating.average).toBe(5);
    expect(detail.json().canReview).toBe(true);

    // L'annuaire affiche la note moyenne. Les pages de navigation étant servies
    // via le cache TTL (≤ 60 s de latence assumée après un nouvel avis), on
    // purge d'abord pour lire l'état frais sans attendre l'expiration.
    await purgeDirectoryCache();
    const dir = await app.inject({ method: 'GET', url: '/api/v1/professionals?lang=FON', headers: auth(patientToken) });
    const item = dir.json().data.find((d: { id: string }) => d.id === drFonId);
    expect(item.rating.average).toBe(5);
  });

  it('l’annuaire (navigation) est servi depuis le cache Redis, la recherche libre non', async () => {
    // 1) Amorce le cache de la page de navigation FON.
    await purgeDirectoryCache();
    await app.inject({ method: 'GET', url: '/api/v1/professionals?lang=FON', headers: auth(patientToken) });

    // 2) Écriture DIRECTE en base : nouveau médecin vérifié parlant FON.
    const extra = await app.prisma.user.create({
      data: {
        phone: PHONES_EXTRA, role: 'MEDECIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Cache', lastName: 'Temoin', spokenLangs: ['FR', 'FON'] } },
        doctor: { create: { speciality: 'Gériatrie', licenseNumber: 'BJ-MED-9403', consultFee: 3000, verifiedAt: new Date() } },
      },
    });

    try {
      // 3) Page de navigation : encore le cache → le nouveau médecin n'apparaît pas.
      const cached = await app.inject({ method: 'GET', url: '/api/v1/professionals?lang=FON', headers: auth(patientToken) });
      const cachedNames = cached.json().data.map((d: { profile: { firstName: string } }) => d.profile.firstName);
      expect(cachedNames).not.toContain('Cache');

      // 4) Recherche libre (`q`) : jamais en cache → état frais immédiat.
      const searched = await app.inject({ method: 'GET', url: '/api/v1/professionals?q=G%C3%A9riatrie', headers: auth(patientToken) });
      const searchedNames = searched.json().data.map((d: { profile: { firstName: string } }) => d.profile.firstName);
      expect(searchedNames).toContain('Cache');

      // 5) Après purge (≙ expiration TTL), la navigation reflète l'état réel.
      await purgeDirectoryCache();
      const fresh = await app.inject({ method: 'GET', url: '/api/v1/professionals?lang=FON', headers: auth(patientToken) });
      const freshNames = fresh.json().data.map((d: { profile: { firstName: string } }) => d.profile.firstName);
      expect(freshNames).toContain('Cache');
    } finally {
      await app.prisma.user.delete({ where: { id: extra.id } });
      await purgeDirectoryCache();
    }
  });
});
