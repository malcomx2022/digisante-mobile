// L1 : droits par entrée, pièces jointes et auteur authentifié. Infra synthétique dédiée.
import type { Role } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = Array.from({ length: 10 }, (_, i) => `+22901946100${String(i).padStart(2, '0')}`);
const PDF = Buffer.from('%PDF-1.4\n% L1 synthetic attachment\n').toString('base64');

describe.skipIf(!HAS_INFRA)('DMP L1 — échéances et auteurs (intégration)', () => {
  let app: FastifyInstance;
  let patientId: string;
  let patientUserId: string;
  let patientToken: string;
  let otherPatientToken: string;
  let doctorId: string;
  let doctorToken: string;
  let doctor2Token: string;
  let deniedTokens: Record<string, string>;
  let baseTime: number;
  let caseNumber = 0;

  const auth = (token: string, shareToken?: string) => ({
    authorization: `Bearer ${token}`,
    // Une IP synthétique par cas : le seau rate-limit ne mélange pas les scénarios.
    'x-forwarded-for': `192.0.2.${caseNumber}`,
    ...(shareToken ? { 'x-share-token': shareToken } : {}),
  });
  const cleanup = () => app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
  const tokenFor = (user: { id: string; role: Role }) => app.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: '7d' });
  const list = (token = doctorToken, shareToken?: string) => app.inject({
    method: 'GET', url: `/api/v1/dmp/records?patientId=${patientId}`, headers: auth(token, shareToken),
  });
  const detail = (id: string, token = doctorToken, shareToken?: string) => app.inject({
    method: 'GET', url: `/api/v1/dmp/records/${id}`, headers: auth(token, shareToken),
  });
  const makeRecord = async (token = patientToken) => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/dmp/records', headers: auth(token),
      payload: { patientId, type: 'DIAGNOSIS', title: 'L1 synthétique', data: { note: 'fixture' } },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  };
  const share = async (recordId: string, ttlHours = 24) => {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/dmp/records/${recordId}/share`, headers: auth(patientToken), payload: { ttlHours },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { shareToken: string; expiresAt: string };
  };
  const claim = async (recordId: string, ttlHours = 24, token = doctorToken) => {
    const s = await share(recordId, ttlHours);
    expect((await list(token, s.shareToken)).statusCode).toBe(200);
    return s;
  };
  const addFile = async (recordId: string, token = patientToken) => app.inject({
    method: 'POST', url: `/api/v1/dmp/records/${recordId}/documents`, headers: auth(token),
    payload: { filename: 'l1.pdf', mimeType: 'application/pdf', dataBase64: PDF },
  });
  const download = (id: string, token = doctorToken) => app.inject({
    method: 'GET', url: `/api/v1/dmp/documents/${id}/file`, headers: auth(token),
  });
  const revoke = () => app.inject({ method: 'DELETE', url: `/api/v1/dmp/consents/${doctorId}`, headers: auth(patientToken) });
  const regrant = () => app.inject({
    method: 'POST', url: `/api/v1/dmp/consents/${doctorId}/regrant`, headers: auth(patientToken), payload: { ttlHours: 48 },
  });

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
  });
  beforeEach(async () => {
    caseNumber++;
    await cleanup();
    baseTime = Date.now();
    // Seule l'horloge métier est avancée : les dates natives de l'audit restent réelles.
    vi.spyOn(Date, 'now').mockReturnValue(baseTime);
    const roles: Role[] = ['PATIENT', 'PATIENT', 'MEDECIN', 'MEDECIN', 'MEDECIN', 'ADMIN', 'ASC', 'DIASPORA', 'PHARMACIE', 'LABORATOIRE'];
    const users = await Promise.all(roles.map((role, i) => app.prisma.user.create({
      data: {
        phone: PHONES[i], role, status: 'ACTIVE',
        ...(role === 'PATIENT' ? { patient: { create: {} } } : {}),
        ...(role === 'MEDECIN' ? { doctor: { create: {
          speciality: 'Généraliste', licenseNumber: `L1-SYNTH-${i}`, consultFee: 1000,
          verifiedAt: i === 4 ? null : new Date(),
        } } } : {}),
      },
      include: { patient: true },
    })));
    patientId = users[0].patient!.id;
    patientUserId = users[0].id;
    patientToken = tokenFor(users[0]);
    otherPatientToken = tokenFor(users[1]);
    doctorId = users[2].id;
    doctorToken = tokenFor(users[2]);
    doctor2Token = tokenFor(users[3]);
    deniedTokens = Object.fromEntries(users.slice(4).map((u) => [u.role === 'MEDECIN' ? 'NON_VERIFIE' : u.role, tokenFor(u)]));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { if (app) { await cleanup(); await app.close(); } });

  it('réclamer une entrée longue ne prolonge pas la courte ; liste/export/pièces suivent leur échéance exacte', async () => {
    const short = await makeRecord();
    const long = await makeRecord();
    const shortFile = await addFile(short);
    const longFile = await addFile(long);
    expect(shortFile.statusCode).toBe(201);
    expect(longFile.statusCode).toBe(201);
    const s = await claim(short, 1);
    await claim(long, 72);
    const stored = await app.prisma.consentRecord.findFirstOrThrow({ where: { recordId: short } });
    expect(stored.expiresAt?.toISOString()).toBe(s.expiresAt);

    vi.mocked(Date.now).mockReturnValue(new Date(s.expiresAt).getTime());
    expect((await detail(short)).statusCode).toBe(403);
    expect((await detail(short, doctorToken, s.shareToken)).statusCode).toBe(403);
    expect((await detail(long)).statusCode).toBe(200);
    const visible = await list();
    expect(visible.statusCode).toBe(200);
    expect(visible.json().map((r: { id: string }) => r.id)).toEqual([long]);
    const exp = await app.inject({ method: 'GET', url: `/api/v1/dmp/export?patientId=${patientId}`, headers: auth(doctorToken) });
    expect(exp.statusCode).toBe(200);
    expect(exp.json().entry.map((r: { resource: { id: string } }) => r.resource.id)).toEqual([long]);
    expect((await download(shortFile.json().id)).statusCode).toBe(403);
    expect((await download(longFile.json().id)).statusCode).toBe(200);
    expect((await addFile(short, doctorToken)).statusCode).toBe(403);
    expect((await download(shortFile.json().id, patientToken)).statusCode).toBe(200);
    const consents = await app.inject({ method: 'GET', url: '/api/v1/dmp/consents', headers: auth(patientToken) });
    const c = consents.json()[0];
    expect(c.recordCount).toBe(1);
    expect(c.records.find((r: { recordId: string }) => r.recordId === short)).toMatchObject({ active: false, expiresAt: s.expiresAt });
  });

  it('réclamer une entrée courte ne raccourcit pas la longue déjà consentie', async () => {
    const long = await makeRecord();
    const short = await makeRecord();
    const l = await claim(long, 72);
    await claim(short, 1);
    vi.mocked(Date.now).mockReturnValue(baseTime + 2 * 3600_000);
    expect((await detail(long)).statusCode).toBe(200);
    expect((await detail(short)).statusCode).toBe(403);
    expect((await app.prisma.consentRecord.findFirstOrThrow({ where: { recordId: long } })).expiresAt?.toISOString()).toBe(l.expiresAt);
  });

  it('un autre médecin et une rotation QR ne prolongent pas le consentement du premier', async () => {
    const id = await makeRecord();
    const initial = await claim(id, 1);
    vi.mocked(Date.now).mockReturnValue(baseTime + 1000);
    const fresh = await share(id, 72);
    expect((await list(doctor2Token, fresh.shareToken)).statusCode).toBe(200);
    vi.mocked(Date.now).mockReturnValue(new Date(initial.expiresAt).getTime());
    expect((await detail(id, doctorToken, initial.shareToken)).statusCode).toBe(403);
    expect((await detail(id, doctor2Token)).statusCode).toBe(200);
    expect((await detail(id, doctorToken, fresh.shareToken)).statusCode).toBe(200);
  });

  it('révoquer une entrée la retire aussi du ré-octroi, sans toucher à la seconde', async () => {
    const removed = await makeRecord();
    const kept = await makeRecord();
    const s = await claim(removed);
    await claim(kept);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/dmp/records/${removed}/share`, headers: auth(patientToken) })).statusCode).toBe(200);
    expect((await detail(removed, doctorToken, s.shareToken)).statusCode).toBe(403);
    expect((await detail(kept)).statusCode).toBe(200);
    expect((await revoke()).statusCode).toBe(200);
    expect((await detail(kept)).statusCode).toBe(403);
    const renewed = await regrant();
    expect(renewed.statusCode).toBe(200);
    expect(renewed.json().recordCount).toBe(1);
    expect((await detail(removed)).statusCode).toBe(403);
    expect((await detail(kept)).statusCode).toBe(200);
  });

  it('la révocation du médecin reste persistante même avec un nouveau jeton', async () => {
    const id = await makeRecord();
    await claim(id);
    await revoke();
    const s = await share(id, 72);
    expect((await list(doctorToken, s.shareToken)).statusCode).toBe(403);
    expect((await regrant()).statusCode).toBe(200);
    expect((await detail(id)).statusCode).toBe(200);
  });

  it('un lien historique NULL reste fermé après ré-octroi ; un nouveau partage est nécessaire', async () => {
    const id = await makeRecord();
    await app.prisma.consent.create({ data: {
      patientId, granteeId: doctorId, expiresAt: new Date(baseTime + 72 * 3600_000), revokedAt: new Date(),
      records: { create: { recordId: id, expiresAt: null } },
    } });
    expect((await detail(id)).statusCode).toBe(403);
    const renewal = await regrant();
    expect(renewal.statusCode).toBe(200);
    expect(renewal.json()).toMatchObject({ recordCount: 0, requiresNewShare: true });
    expect((await detail(id)).statusCode).toBe(403);
    const s = await share(id);
    expect((await detail(id, doctorToken, s.shareToken)).statusCode).toBe(200);
  });

  async function expectRoleDenied(role: string) {
    const id = await makeRecord();
    const s = await share(id);
    const file = await addFile(id);
    const token = deniedTokens[role];
    expect((await list(token, s.shareToken)).statusCode).toBe(403);
    expect((await detail(id, token, s.shareToken)).statusCode).toBe(403);
    expect((await download(file.json().id, token)).statusCode).toBe(403);
    expect(await app.prisma.consent.count({ where: { patientId } })).toBe(0);
  }

  it('refuse ADMIN même avec un QR valide', () => expectRoleDenied('ADMIN'));
  it('refuse ASC même avec un QR valide', () => expectRoleDenied('ASC'));
  it('refuse DIASPORA même avec un QR valide', () => expectRoleDenied('DIASPORA'));
  it('refuse PHARMACIE même avec un QR valide', () => expectRoleDenied('PHARMACIE'));
  it('refuse LABORATOIRE même avec un QR valide', () => expectRoleDenied('LABORATOIRE'));
  it('refuse NON_VERIFIE même avec un QR valide', () => expectRoleDenied('NON_VERIFIE'));

  it('refuse le dossier d’un autre patient et un jeton appartenant à un autre dossier', async () => {
    const id = await makeRecord();
    const s = await share(id);
    expect((await detail(id, otherPatientToken, s.shareToken)).statusCode).toBe(403);
    const other = await makeRecord(otherPatientToken);
    expect((await detail(other, doctorToken, s.shareToken)).statusCode).toBe(403);
  });

  it('recontrôle le rôle, le statut et la vérification actuels du médecin', async () => {
    const id = await makeRecord();
    const s = await claim(id);
    await app.prisma.doctor.update({ where: { userId: doctorId }, data: { verifiedAt: null } });
    expect((await detail(id, doctorToken, s.shareToken)).statusCode).toBe(403);
    await app.prisma.doctor.update({ where: { userId: doctorId }, data: { verifiedAt: new Date() } });
    await app.prisma.user.update({ where: { id: doctorId }, data: { role: 'ASC' } });
    expect((await detail(id, doctorToken, s.shareToken)).statusCode).toBe(403);
    await app.prisma.user.update({ where: { id: doctorId }, data: { role: 'MEDECIN', status: 'SUSPENDED' } });
    expect((await detail(id)).statusCode).toBe(401);
  });

  it('les réclamations concurrentes restent indépendantes et ne survivent pas à la révocation', async () => {
    const ids = await Promise.all([makeRecord(), makeRecord()]);
    const shares = await Promise.all(ids.map((id, i) => share(id, i === 0 ? 1 : 72)));
    const results = await Promise.all(shares.map((s) => list(doctorToken, s.shareToken)));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const links = await app.prisma.consentRecord.findMany({ where: { recordId: { in: ids } } });
    expect(links).toHaveLength(2);
    for (let i = 0; i < ids.length; i++) expect(links.find((r) => r.recordId === ids[i])?.expiresAt?.toISOString()).toBe(shares[i].expiresAt);
    await Promise.all([revoke(), list(doctorToken, shares[0].shareToken)]);
    expect((await list()).statusCode).toBe(403);
  });

  it('réclamation et retrait d’un partage concurrents ne recréent pas son accès', async () => {
    const id = await makeRecord();
    const s = await share(id);
    await Promise.all([
      list(doctorToken, s.shareToken),
      app.inject({ method: 'DELETE', url: `/api/v1/dmp/records/${id}/share`, headers: auth(patientToken) }),
    ]);
    expect((await detail(id, doctorToken, s.shareToken)).statusCode).toBe(403);
    expect(await app.prisma.consentRecord.count({ where: { recordId: id } })).toBe(0);
  });

  it('attribue le patient authentifié et ignore l’auteur proposé par le client', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/dmp/records', headers: auth(patientToken),
      payload: { type: 'DIAGNOSIS', title: 'Auteur synthétique', data: {}, authorId: doctorId, authorRole: 'ADMIN' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ authorId: patientUserId, authorRole: 'PATIENT' });
    expect((await detail(res.json().id, patientToken)).json()).toMatchObject({ authorId: patientUserId, authorRole: 'PATIENT' });
    const exported = await app.inject({ method: 'GET', url: '/api/v1/dmp/export', headers: auth(patientToken) });
    expect(exported.json().entry[0].resource.performer).toEqual([{ reference: `urn:digisante:user:${patientUserId}`, type: 'Patient' }]);
  });

  it('attribue le médecin authentifié à sa nouvelle entrée, sans élargir sa portée de lecture', async () => {
    const shared = await makeRecord();
    await claim(shared);
    const created = await makeRecord(doctorToken);
    const stored = await app.prisma.medicalRecord.findUniqueOrThrow({ where: { id: created } });
    expect(stored).toMatchObject({ authorId: doctorId, authorRole: 'MEDECIN' });
    expect((await detail(created)).statusCode).toBe(403);
    expect((await detail(created, patientToken)).json()).toMatchObject({ authorId: doctorId, authorRole: 'MEDECIN' });
    await app.prisma.user.delete({ where: { id: doctorId } });
    expect((await detail(created, patientToken)).json()).toMatchObject({ authorId: doctorId, authorRole: 'MEDECIN' });
  });

  it('conserve l’auteur inconnu d’une entrée historique, sans faux performer dans l’export', async () => {
    const old = await app.prisma.medicalRecord.create({ data: { patientId, type: 'DIAGNOSIS', title: 'Héritage inconnu' } });
    expect((await detail(old.id, patientToken)).json()).toMatchObject({ authorId: null, authorRole: null });
    const exported = await app.inject({ method: 'GET', url: '/api/v1/dmp/export', headers: auth(patientToken) });
    expect(exported.json().entry[0].resource).not.toHaveProperty('performer');
  });
});
