// Pièces jointes du DMP (lot 3 / C2) : téléversement chiffré, téléchargement,
// et surtout MINIMISATION §4 — la portée par-entrée doit valoir aussi pour les
// fichiers, sinon elle serait contournable par les pièces jointes.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290196100001', '+2290196100002', '+2290196100003'];

// Fichiers minimaux VALIDES : seuls les octets d'en-tête sont contrôlés.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('contenu-radio')]);
const PDF = Buffer.from('%PDF-1.4\ncompte-rendu\n');

describe.skipIf(!HAS_INFRA)('DMP — pièces jointes (intégration)', () => {
  let app: FastifyInstance;
  let patientToken: string;
  let otherPatientToken: string;
  let doctorToken: string;
  let patientId: string;
  let sharedRecordId: string;
  let privateRecordId: string;
  let privateDocId: string;
  let shareToken: string;

  const auth = (t: string, share?: string) => ({ authorization: `Bearer ${t}`, ...(share ? { 'x-share-token': share } : {}) });
  const cleanup = () => app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });

  async function createRecord(title: string): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/dmp/records', headers: auth(patientToken),
      payload: { type: 'LAB_RESULT', title, data: { note: title } },
    });
    return res.json().id as string;
  }

  async function attach(recordId: string, file: Buffer, mimeType: string, filename: string, headers = auth(patientToken)) {
    return app.inject({
      method: 'POST', url: `/api/v1/dmp/records/${recordId}/documents`, headers,
      payload: { mimeType, filename, dataBase64: file.toString('base64') },
    });
  }

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const patient = await app.prisma.user.create({
      data: { phone: PHONES[0], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Sika', lastName: 'A' } }, patient: { create: {} } },
      include: { patient: true },
    });
    patientId = patient.patient!.id;
    patientToken = app.jwt.sign({ sub: patient.id, role: 'PATIENT' }, { expiresIn: '15m' });

    const other = await app.prisma.user.create({
      data: { phone: PHONES[1], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Kossi', lastName: 'B' } }, patient: { create: {} } },
    });
    otherPatientToken = app.jwt.sign({ sub: other.id, role: 'PATIENT' }, { expiresIn: '15m' });

    const doctor = await app.prisma.user.create({
      data: { phone: PHONES[2], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Nadia', lastName: 'T' } }, doctor: { create: { speciality: 'Radiologie', licenseNumber: 'BJ-MED-6101', consultFee: 4000, verifiedAt: new Date() } } },
    });
    doctorToken = app.jwt.sign({ sub: doctor.id, role: 'MEDECIN' }, { expiresIn: '15m' });

    sharedRecordId = await createRecord('Entrée partagée');
    privateRecordId = await createRecord('Entrée NON partagée');

    // Le patient ne partage QUE la première entrée.
    const share = await app.inject({
      method: 'POST', url: `/api/v1/dmp/records/${sharedRecordId}/share`, headers: auth(patientToken),
      payload: { shareType: 'QR_CODE', ttlHours: 24 },
    });
    shareToken = share.json().shareToken as string;
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('joint un fichier et le restitue octet pour octet', async () => {
    const added = await attach(sharedRecordId, PNG, 'image/png', 'radio thorax.png');
    expect(added.statusCode).toBe(201);
    expect(added.json().size).toBe(PNG.length);
    const docId = added.json().id as string;

    const file = await app.inject({ method: 'GET', url: `/api/v1/dmp/documents/${docId}/file`, headers: auth(patientToken) });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toContain('image/png');
    expect(file.headers['cache-control']).toBe('no-store');
    expect(Buffer.from(file.rawPayload).equals(PNG)).toBe(true);
  });

  it('stocke le fichier CHIFFRÉ (le contenu en clair n’est pas sur le disque)', async () => {
    const added = await attach(sharedRecordId, PNG, 'image/png', 'chiffre.png');
    const doc = await app.prisma.document.findUnique({ where: { id: added.json().id }, select: { encryptedUrl: true, checksum: true } });
    // `encryptedUrl` est un identifiant de stockage opaque, jamais une URL publique.
    expect(doc!.encryptedUrl).toMatch(/^[a-f0-9-]{36}$/);
    expect(doc!.encryptedUrl).not.toContain('http');
    expect(doc!.checksum).toHaveLength(64);
  });

  it('sert un PDF en attachment (jamais de rendu dans l’onglet)', async () => {
    const added = await attach(sharedRecordId, PDF, 'application/pdf', 'compte-rendu.pdf');
    expect(added.statusCode).toBe(201);
    const file = await app.inject({ method: 'GET', url: `/api/v1/dmp/documents/${added.json().id}/file`, headers: auth(patientToken) });
    expect(file.headers['content-disposition']).toContain('attachment');
  });

  it('refuse un contenu qui ne correspond pas au MIME déclaré (magic bytes)', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const res = await attach(sharedRecordId, html, 'image/png', 'piege.png');
    expect(res.statusCode).toBe(400);
  });

  it('refuse un MIME hors liste blanche → 422', async () => {
    const res = await attach(sharedRecordId, PNG, 'text/html', 'x.html');
    expect(res.statusCode).toBe(422);
  });

  // ── §4 : la portée par-entrée vaut AUSSI pour les fichiers ──
  it('un soignant consenti sur UNE entrée ne télécharge PAS les pièces d’une autre', async () => {
    const added = await attach(privateRecordId, PNG, 'image/png', 'prive.png');
    privateDocId = added.json().id as string;

    // Le médecin réclame son consentement via le token : il ne porte QUE sharedRecordId.
    const allowedRead = await app.inject({
      method: 'GET', url: `/api/v1/dmp/records?patientId=${patientId}`, headers: auth(doctorToken, shareToken),
    });
    expect(allowedRead.statusCode).toBe(200);

    // Pièce de l'entrée partagée → autorisée.
    const sharedDoc = await attach(sharedRecordId, PNG, 'image/png', 'partage.png');
    const ok = await app.inject({ method: 'GET', url: `/api/v1/dmp/documents/${sharedDoc.json().id}/file`, headers: auth(doctorToken) });
    expect(ok.statusCode).toBe(200);

    // Pièce de l'entrée NON partagée → refusée, même consentement actif.
    const denied = await app.inject({ method: 'GET', url: `/api/v1/dmp/documents/${privateDocId}/file`, headers: auth(doctorToken) });
    expect(denied.statusCode).toBe(403);
  });

  it('un soignant consenti ne peut pas JOINDRE une pièce à une entrée hors portée', async () => {
    const res = await attach(privateRecordId, PNG, 'image/png', 'intrus.png', auth(doctorToken));
    expect(res.statusCode).toBe(403);
  });

  it('un autre patient ne télécharge rien → 403', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/dmp/documents/${privateDocId}/file`, headers: auth(otherPatientToken) });
    expect(res.statusCode).toBe(403);
  });

  it('seul le patient propriétaire supprime une pièce', async () => {
    const added = await attach(sharedRecordId, PNG, 'image/png', 'a-supprimer.png');
    const docId = added.json().id as string;

    const byDoctor = await app.inject({ method: 'DELETE', url: `/api/v1/dmp/documents/${docId}`, headers: auth(doctorToken) });
    expect(byDoctor.statusCode).toBe(403);

    const byOwner = await app.inject({ method: 'DELETE', url: `/api/v1/dmp/documents/${docId}`, headers: auth(patientToken) });
    expect(byOwner.statusCode).toBe(200);

    const gone = await app.inject({ method: 'GET', url: `/api/v1/dmp/documents/${docId}/file`, headers: auth(patientToken) });
    expect(gone.statusCode).toBe(404);
  });

  it('la liste des entrées expose le nombre de pièces (pas d’appel par entrée)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/dmp/records', headers: auth(patientToken) });
    const shared = res.json().find((r: { id: string }) => r.id === sharedRecordId);
    expect(shared.documentCount).toBeGreaterThan(0);
  });

  it('journalise DMP_DOCUMENT_ADD sans le contenu du fichier (§4)', async () => {
    const log = await app.prisma.auditLog.findFirst({
      where: { action: 'DMP_DOCUMENT_ADD', targetId: patientId },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    const meta = JSON.stringify(log!.meta);
    expect(meta).toContain('image/png');
    expect(meta).not.toContain('contenu-radio'); // le contenu ne fuit pas dans l'audit
  });
});
