// ─────────────────────────────────────────────────────────────
// Non-régression — audit de sécurité de release (sept. 2026,
// docs/AUDIT_Securite_Release_2026-09.md). Un test par correctif serveur :
// chacun ÉCHOUE sur le code d'avant l'audit.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { redactAuditMetaForAdmin } from '@/lib/audit.js';
import { isValidServiceToken } from '@/lib/service-token.js';
import { linkCare } from '@/test/care-fixture.js';

describe('Jeton de service (tâches cron) — comparaison fail-closed', () => {
  const SECRET = 'x'.repeat(40);
  it('accepte le bon jeton, refuse tout le reste', () => {
    expect(isValidServiceToken(SECRET, SECRET)).toBe(true);
    expect(isValidServiceToken(`${SECRET}y`, SECRET)).toBe(false);
    expect(isValidServiceToken('', SECRET)).toBe(false);
    expect(isValidServiceToken(undefined, SECRET)).toBe(false);
    expect(isValidServiceToken(['a'], SECRET)).toBe(false);
  });
  it('refuse TOUJOURS si aucun jeton n’est configuré', () => {
    expect(isValidServiceToken('', undefined)).toBe(false);
    expect(isValidServiceToken('anything', undefined)).toBe(false);
  });
});

describe('Journal d’audit vu par l’admin — contenu sensible masqué (§4)', () => {
  it('masque valeurs critiques de labo et coordonnées SOS, garde les identifiants', () => {
    const out = redactAuditMetaForAdmin({
      orderId: 'o1',
      critical: [{ name: 'K+', value: 7.1 }],
      latitude: 6.36,
      longitude: 2.42,
      nested: { note: 'texte libre', count: 2 },
    }) as Record<string, unknown>;
    expect(out.orderId).toBe('o1');
    expect(out.critical).toBe('[masqué]');
    expect(out.latitude).toBe('[masqué]');
    expect(out.longitude).toBe('[masqué]');
    expect(out.nested).toEqual({ note: '[masqué]', count: 2 });
    expect(JSON.stringify(out)).not.toContain('7.1');
  });
});

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = [
  '+2290196190001', // 0 patient (allergique)
  '+2290196190002', // 1 médecin vérifié en relation de soin
  '+2290196190003', // 2 médecin vérifié SANS relation
  '+2290196190004', // 3 médecin NON vérifié
  '+2290196190005', // 4 pharmacie
  '+2290196190006', // 5 super admin
  '+2290196190007', // 6 second admin
  '+2290196190008', // 7 patient OTP
];

describe.skipIf(!HAS_INFRA)('Audit de release 2026-09 (intégration)', () => {
  let app: FastifyInstance;
  let patientId: string;
  let patientUserId: string;
  const tokens: Record<string, string> = {};
  let superAdminId: string;
  let otherAdminId: string;
  const auth = (t: string, share?: string) => ({
    authorization: `Bearer ${t}`,
    ...(share ? { 'x-share-token': share } : {}),
  });

  const cleanup = async () => {
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await app.redis.del(...PHONES.flatMap((p) => [`otp:lock:${p}`, `otp:attempts:${p}`, `otp:send:${p}`, `otp:${p}`]));
  };

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const sign = (sub: string, role: 'PATIENT' | 'MEDECIN' | 'PHARMACIE' | 'ADMIN') => app.jwt.sign({ sub, role }, { expiresIn: '15m' });
    const mkDoctor = (phone: string, license: string, verified: boolean) =>
      app.prisma.user.create({
        data: {
          phone, role: 'MEDECIN', status: 'ACTIVE', lang: 'FR',
          profile: { create: { firstName: 'Dr', lastName: license } },
          doctor: { create: { speciality: 'Généraliste', licenseNumber: license, consultFee: 3000, verifiedAt: verified ? new Date() : null } },
        },
      });

    const patient = await app.prisma.user.create({
      data: {
        phone: PHONES[0], role: 'PATIENT', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Ali', lastName: 'Lergique' } },
        patient: { create: { allergies: ['Pénicilline'] } },
      },
      include: { patient: true },
    });
    patientId = patient.patient!.id;
    patientUserId = patient.id;
    tokens.patient = sign(patient.id, 'PATIENT');

    const care = await mkDoctor(PHONES[1], 'BJ-MED-1901', true);
    const stranger = await mkDoctor(PHONES[2], 'BJ-MED-1902', true);
    const unverified = await mkDoctor(PHONES[3], 'BJ-MED-1903', false);
    await linkCare(app, care.id, patientId);
    tokens.care = sign(care.id, 'MEDECIN');
    tokens.stranger = sign(stranger.id, 'MEDECIN');
    tokens.unverified = sign(unverified.id, 'MEDECIN');

    const pharma = await app.prisma.user.create({
      data: {
        phone: PHONES[4], role: 'PHARMACIE', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Ph', lastName: 'X' } },
        pharmacy: { create: { name: 'Pharmacie Audit', address: 'Cotonou', phone: PHONES[4] } },
      },
    });
    tokens.pharma = sign(pharma.id, 'PHARMACIE');

    const ALL_SCOPES = ['admin:manage', 'users:read', 'users:write'];
    const sup = await app.prisma.user.create({
      data: {
        phone: PHONES[5], role: 'ADMIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Sup', lastName: 'Admin' } },
        adminProfile: { create: { scopes: ALL_SCOPES, preset: 'SUPER_ADMIN' } },
      },
    });
    const other = await app.prisma.user.create({
      data: {
        phone: PHONES[6], role: 'ADMIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Oth', lastName: 'Admin' } },
        adminProfile: { create: { scopes: ['users:read', 'users:write'], preset: 'SUPPORT' } },
      },
    });
    superAdminId = sup.id;
    otherAdminId = other.id;
    tokens.otherAdmin = sign(other.id, 'ADMIN');
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  // ── OTP ──
  it('OTP : redemander un code NE remet PAS le compteur d’échecs à zéro', async () => {
    const reg = await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { phone: PHONES[7], role: 'PATIENT', lang: 'FR', firstName: 'Otp', lastName: 'Test' },
    });
    expect(reg.statusCode).toBe(201);
    const verify = (code: string) =>
      app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { phone: PHONES[7], code } });
    for (let i = 0; i < 4; i += 1) expect((await verify('000000')).statusCode).toBe(401);
    // Un nouveau code : avant l'audit, il remettait les tentatives à 0 → brute-force illimité.
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: PHONES[7] } })).statusCode).toBe(200);
    expect((await verify('000000')).statusCode).toBe(429);
  });

  // ── Relation de soin ──
  it('médecin NON vérifié : ne peut pas prescrire (403) et n’apprend pas les allergies', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/prescriptions', headers: auth(tokens.unverified),
      payload: { patientId, validUntil: new Date(Date.now() + 86400_000).toISOString(), items: [{ medicationName: 'Amoxicilline', dosage: '1g', frequency: '2x/j', duration: '7j' }] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toMatch(/nicilline|allerg/i);
  });

  it('médecin vérifié SANS relation de soin : ni ordonnance, ni orientation, ni chat (403)', async () => {
    const presc = await app.inject({
      method: 'POST', url: '/api/v1/prescriptions', headers: auth(tokens.stranger),
      payload: { patientId, validUntil: new Date(Date.now() + 86400_000).toISOString(), items: [{ medicationName: 'Amoxicilline', dosage: '1g', frequency: '2x/j', duration: '7j' }] },
    });
    expect(presc.statusCode).toBe(403);
    expect(presc.body).not.toMatch(/nicilline|allerg/i);
    expect(await app.prisma.prescription.count({ where: { patientId } })).toBe(0);
  });

  it('médecin en relation de soin : l’allergie est bien bloquée (400) — la garde n’a pas cassé le contrôle', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/prescriptions', headers: auth(tokens.care),
      payload: { patientId, validUntil: new Date(Date.now() + 86400_000).toISOString(), items: [{ medicationName: 'Pénicilline G', dosage: '1g', frequency: '2x/j', duration: '7j' }] },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── Rappels ──
  it('rappel programmé : canaux SMS/e-mail refusés (anti-hameçonnage)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/reminders', headers: auth(tokens.patient),
      payload: { type: 'SYSTEM', channel: 'SMS_TWILIO', title: 'Paiement', body: 'Confirmez', scheduledAt: new Date(Date.now() + 3600_000).toISOString() },
    });
    expect([400, 422]).toContain(res.statusCode);
    expect(await app.prisma.notification.count({ where: { recipientId: patientUserId, channel: 'SMS_TWILIO' } })).toBe(0);
  });

  it('rappel pour autrui : refusé au médecin sans relation, accepté au médecin traitant', async () => {
    const payload = { recipientId: patientUserId, type: 'SYSTEM', channel: 'IN_APP', title: 'Contrôle', body: 'RDV', scheduledAt: new Date(Date.now() + 3600_000).toISOString() };
    const denied = await app.inject({ method: 'POST', url: '/api/v1/reminders', headers: auth(tokens.stranger), payload });
    expect(denied.statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/reminders', headers: auth(tokens.care), payload });
    expect(ok.statusCode).toBe(201);
  });

  // ── DMP ──
  it('DMP : un rôle non soignant (pharmacie) ne peut PAS réclamer un jeton de partage', async () => {
    const rec = await app.inject({
      method: 'POST', url: '/api/v1/dmp/records', headers: auth(tokens.patient),
      payload: { type: 'VITAL_SIGNS', title: 'Constantes', data: { bp: '12/8' } },
    });
    const recordId = rec.json().id as string;
    const share = await app.inject({ method: 'POST', url: `/api/v1/dmp/records/${recordId}/share`, headers: auth(tokens.patient), payload: { shareType: 'QR_CODE', ttlHours: 24 } });
    const shareToken = share.json().shareToken as string;
    const res = await app.inject({ method: 'GET', url: `/api/v1/dmp/records?patientId=${patientId}`, headers: auth(tokens.pharma, shareToken) });
    expect(res.statusCode).toBe(403);
    expect(await app.prisma.consent.count({ where: { patientId, grantee: { phone: PHONES[4] } } })).toBe(0);
  });

  it('DMP : révoquer le partage coupe AUSSI l’accès déjà réclamé', async () => {
    const rec = await app.inject({
      method: 'POST', url: '/api/v1/dmp/records', headers: auth(tokens.patient),
      payload: { type: 'VITAL_SIGNS', title: 'Tension', data: { bp: '13/8' } },
    });
    const recordId = rec.json().id as string;
    const share = await app.inject({ method: 'POST', url: `/api/v1/dmp/records/${recordId}/share`, headers: auth(tokens.patient), payload: { shareType: 'QR_CODE', ttlHours: 24 } });
    const claim = await app.inject({ method: 'GET', url: `/api/v1/dmp/records?patientId=${patientId}`, headers: auth(tokens.stranger, share.json().shareToken) });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().map((r: { id: string }) => r.id)).toContain(recordId);

    const revoke = await app.inject({ method: 'DELETE', url: `/api/v1/dmp/records/${recordId}/share`, headers: auth(tokens.patient) });
    expect(revoke.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: `/api/v1/dmp/records?patientId=${patientId}`, headers: auth(tokens.stranger) });
    const ids = after.statusCode === 200 ? after.json().map((r: { id: string }) => r.id) : [];
    expect(ids).not.toContain(recordId);
  });

  // ── Pharmacie ──
  it('pharmacie : une ordonnance déjà délivrée ne peut pas l’être une seconde fois', async () => {
    const presc = await app.inject({
      method: 'POST', url: '/api/v1/prescriptions', headers: auth(tokens.care),
      payload: { patientId, validUntil: new Date(Date.now() + 86400_000).toISOString(), items: [{ medicationName: 'Paracétamol', dosage: '1g', frequency: '3x/j', duration: '3j' }] },
    });
    expect(presc.statusCode).toBe(201);
    const prescId = presc.json().id as string;
    await app.prisma.prescription.update({ where: { id: prescId }, data: { status: 'FULLY_DISPENSED' } });
    const again = await app.inject({ method: 'POST', url: `/api/v1/pharmacy/prescriptions/${prescId}/dispense`, headers: auth(tokens.pharma), payload: { qrCode: presc.json().qrCode, items: [{ itemId: presc.json().items[0].id, status: 'DISPENSED' }] } });
    expect(again.statusCode).toBe(400);
    expect(await app.prisma.dispensation.count({ where: { prescriptionId: prescId } })).toBe(0);
  });

  // ── Admin ──
  it('admin : ne peut suspendre ni un autre administrateur, ni lui-même', async () => {
    const onAdmin = await app.inject({ method: 'POST', url: `/api/v1/admin/users/${superAdminId}/suspend`, headers: auth(tokens.otherAdmin), payload: {} });
    expect(onAdmin.statusCode).toBe(403);
    const onSelf = await app.inject({ method: 'POST', url: `/api/v1/admin/users/${otherAdminId}/suspend`, headers: auth(tokens.otherAdmin), payload: {} });
    expect(onSelf.statusCode).toBe(403);
    const sup = await app.prisma.user.findUniqueOrThrow({ where: { id: superAdminId }, select: { status: true } });
    expect(sup.status).toBe('ACTIVE');
  });

  it('admin : un profil admin SANS aucun scope est refusé partout', async () => {
    await app.prisma.adminProfile.update({ where: { userId: otherAdminId }, data: { scopes: [] } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: auth(tokens.otherAdmin) });
    expect(res.statusCode).toBe(403);
  });
});
