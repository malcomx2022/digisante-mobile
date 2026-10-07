// L3 : pile PostgreSQL/Redis réelle, effets et reçus atomiques.
import { randomUUID } from 'node:crypto';

import { MUTATION_MAX_AGE_MS, MUTATION_RECEIPT_TTL_MS } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const PHONES = ['+2290193300001', '+2290193300002', '+2290193300003'];
const key = (date = Date.now()) => `v1.${date}.${randomUUID()}`;
const subjectBody = { name: 'Enfant synthétique L3', birthDate: '2025-01-01', isSelf: false };

describe.skipIf(!process.env.DATABASE_URL || !process.env.REDIS_URL)('Reçus de mutation L3 (intégration)', () => {
  let app: FastifyInstance;
  let a: string; let b: string; let patientA: string; let patientB: string; let thread: string;
  let token: string; let otherToken: string;
  let ip = 0;
  let failReceipt = false;
  const send = (path: string, payload?: object, idempotency = key(), bearer = token, method: 'POST' | 'DELETE' = 'POST') =>
    app.inject({ method, url: `/api/v1${path}`, headers: { authorization: `Bearer ${bearer}`, 'idempotency-key': idempotency, 'x-forwarded-for': `192.0.2.${++ip}` }, payload });
  async function repeat(path: string, payload?: object, method: 'POST' | 'DELETE' = 'POST') {
    const k = key();
    const first = await send(path, payload, k, token, method);
    expect(first.statusCode, first.body).toBe(method === 'POST' && ['/vaccinations/subjects', '/maternity'].includes(path) || path.endsWith('/messages') ? 201 : 200);
    const retry = await send(path, payload, k, token, method);
    expect(retry.statusCode, retry.body).toBe(first.statusCode);
    expect(retry.json()).toEqual(first.json());
    expect(await app.prisma.mutationReceipt.count({ where: { userId: a, route: path, key: k } })).toBe(1);
    const verification = await app.inject({ method: 'GET', url: `/api/v1/sync/receipts/${k}?method=${method}&route=${encodeURIComponent(path)}`, headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': `192.0.2.${++ip}` } });
    expect(verification.statusCode, verification.body).toBe(200);
    expect(verification.json()).toEqual({ confirmed: true, status: first.statusCode });
    return first.json();
  }
  const subject = async () => (await send('/vaccinations/subjects', subjectBody)).json();

  beforeAll(async () => {
    process.env.RECONCILE_TOKEN = 'l3-synthetic-service-token';
    const { buildServer } = await import('@/server.js');
    app = await buildServer(); await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    const createPatient = (phone: string) => app.prisma.user.create({ data: { phone, role: 'PATIENT', status: 'ACTIVE', patient: { create: {} } }, include: { patient: true } });
    const ua = await createPatient(PHONES[0]); const ub = await createPatient(PHONES[1]);
    a = ua.id; b = ub.id; patientA = ua.patient!.id; patientB = ub.patient!.id;
    const doctor = await app.prisma.user.create({ data: { phone: PHONES[2], role: 'MEDECIN', status: 'ACTIVE', doctor: { create: { speciality: 'Test', licenseNumber: 'L3-SYNTHETIC', consultFee: 0 } } }, include: { doctor: true } });
    thread = (await app.prisma.chatThread.create({ data: { patientId: patientA, doctorId: doctor.doctor!.id } })).id;
    token = app.jwt.sign({ sub: a, role: 'PATIENT' }); otherToken = app.jwt.sign({ sub: b, role: 'PATIENT' });
    app.prisma.$use(async (params, next) => {
      if (failReceipt && params.model === 'MutationReceipt' && params.action === 'create') throw new Error('synthetic receipt failure');
      return next(params);
    });
  });
  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } }); await app.close();
  });

  it('création PEV : réponse perdue après commit, un seul sujet et reçu chiffré', async () => {
    const result = await repeat('/vaccinations/subjects', subjectBody);
    expect(await app.prisma.vaccinationSubject.count({ where: { id: result.id } })).toBe(1);
    const receipt = await app.prisma.mutationReceipt.findFirstOrThrow({ where: { userId: a, route: '/vaccinations/subjects' } });
    expect(receipt.encryptedResponse.split(':')).toHaveLength(3);
    expect(JSON.stringify(receipt)).not.toContain(subjectBody.name);
    expect(receipt.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.expiresAt.getTime() - receipt.createdAt.getTime()).toBeGreaterThanOrEqual(MUTATION_RECEIPT_TTL_MS - 1000);
  });
  it('suppression PEV : le rejeu confirme la suppression déjà commise', async () => {
    const s = await subject(); await repeat(`/vaccinations/subjects/${s.id}`, undefined, 'DELETE');
    expect(await app.prisma.vaccinationSubject.findUnique({ where: { id: s.id } })).toBeNull();
  });
  it('marquage PEV : un ancien rejeu ne réapplique pas la valeur après une annulation', async () => {
    const s = await subject(); const path = `/vaccinations/${s.vaccinations[0].id}/administered`; const k = key();
    const first = await send(path, { done: true }, k); expect(first.statusCode).toBe(200);
    expect((await send(path, { done: false })).statusCode).toBe(200);
    expect((await send(path, { done: true }, k)).json()).toEqual(first.json());
    expect((await app.prisma.vaccination.findUniqueOrThrow({ where: { id: s.vaccinations[0].id } })).status).toBe('SCHEDULED');
  });
  it('création grossesse : reçu renvoyé avant le conflit grossesse déjà active', async () => {
    const pregnancy = await repeat('/maternity', { lmpDate: '2026-09-01' });
    expect(pregnancy.visits).toHaveLength(8);
  });
  it('CPN : même réponse et date de réalisation au rejeu', async () => {
    const visit = await app.prisma.antenatalVisit.findFirstOrThrow({ where: { pregnancy: { patientId: patientA } } });
    await repeat(`/maternity/visits/${visit.id}/done`, { done: true });
  });
  it('chat : même message au rejeu', async () => {
    const result = await repeat(`/chat/threads/${thread}/messages`, { body: 'Message synthétique L3' });
    expect(await app.prisma.chatMessage.count({ where: { id: result.id } })).toBe(1);
  });
  it('lecture chat : même accusé au rejeu', async () => { await repeat(`/chat/threads/${thread}/read`); });
  it('lecture notification : reçu chiffré et date stable', async () => {
    const n = await app.prisma.notification.create({ data: { recipientId: a, type: 'SYSTEM', channel: 'IN_APP', title: 'Synthétique', body: 'Contenu clinique synthétique L3' } });
    await repeat(`/notifications/${n.id}/read`);
    const receipt = await app.prisma.mutationReceipt.findFirstOrThrow({ where: { userId: a, route: `/notifications/${n.id}/read` } });
    expect(receipt.encryptedResponse).not.toContain(n.body);
  });
  it('deux workers/onglets simultanés : un seul effet, réponses identiques', async () => {
    const k = key(); const before = await app.prisma.chatMessage.count({ where: { threadId: thread } });
    const replies = await Promise.all(Array.from({ length: 6 }, () => send(`/chat/threads/${thread}/messages`, { body: 'Concurrence' }, k)));
    for (const reply of replies) { expect(reply.statusCode, reply.body).toBe(201); expect(reply.json()).toEqual(replies[0].json()); }
    expect(await app.prisma.chatMessage.count({ where: { threadId: thread } })).toBe(before + 1);
  });
  it('contenu changé sous la même clé : 409 sans deuxième effet', async () => {
    const k = key(); expect((await send('/vaccinations/subjects', subjectBody, k)).statusCode).toBe(201);
    expect((await send('/vaccinations/subjects', { ...subjectBody, name: 'Autre contenu' }, k)).statusCode).toBe(409);
    expect(await app.prisma.mutationReceipt.count({ where: { userId: a, key: k } })).toBe(1);
  });
  it('ordre des propriétés JSON et casse UUID : même identité', async () => {
    const k = key(); const first = await send('/vaccinations/subjects', subjectBody, k);
    const next = await send('/vaccinations/subjects', { isSelf: false, birthDate: '2025-01-01', name: subjectBody.name }, k.slice(0, 17) + k.slice(17).toUpperCase());
    expect(next.statusCode, next.body).toBe(201); expect(next.json()).toEqual(first.json());
  });
  it('même clé sous un autre utilisateur : reçu et effet distincts', async () => {
    const k = key(); const first = await send('/vaccinations/subjects', subjectBody, k);
    const second = await send('/vaccinations/subjects', subjectBody, k, otherToken);
    expect(second.statusCode, second.body).toBe(201); expect(second.json().id).not.toBe(first.json().id);
    expect(await app.prisma.mutationReceipt.count({ where: { key: k } })).toBe(2);
  });
  it('même clé sur deux routes : reçus distincts', async () => {
    const k = key(); const s = await send('/vaccinations/subjects', subjectBody, k);
    const done = await send(`/vaccinations/${s.json().vaccinations[0].id}/administered`, { done: true }, k);
    expect(done.statusCode).toBe(200); expect(await app.prisma.mutationReceipt.count({ where: { userId: a, key: k } })).toBe(2);
  });
  it('échec écriture reçu : rollback du sujet et des doses, reprise sûre', async () => {
    const k = key(); const before = await app.prisma.vaccinationSubject.count({ where: { patientId: patientA } });
    failReceipt = true;
    try { expect((await send('/vaccinations/subjects', subjectBody, k)).statusCode).toBe(500); } finally { failReceipt = false; }
    expect(await app.prisma.vaccinationSubject.count({ where: { patientId: patientA } })).toBe(before);
    expect(await app.prisma.mutationReceipt.count({ where: { key: k } })).toBe(0);
    expect((await send('/vaccinations/subjects', subjectBody, k)).statusCode).toBe(201);
  });
  it('propriétaire revalidé avant de lire un reçu existant', async () => {
    const s = await subject(); const path = `/vaccinations/${s.vaccinations[0].id}/administered`; const k = key();
    expect((await send(path, { done: true }, k)).statusCode).toBe(200);
    await app.prisma.vaccinationSubject.update({ where: { id: s.id }, data: { patientId: patientB } });
    expect((await send(path, { done: true }, k)).statusCode).toBe(404);
  });
  it('reçu de création : ressource supprimée ou transférée, aucun contenu restitué', async () => {
    const k = key(); const first = await send('/vaccinations/subjects', subjectBody, k);
    await app.prisma.vaccinationSubject.update({ where: { id: first.json().id }, data: { patientId: patientB } });
    expect((await send('/vaccinations/subjects', subjectBody, k)).statusCode).toBe(404);
    await app.prisma.vaccinationSubject.delete({ where: { id: first.json().id } });
    expect((await send('/vaccinations/subjects', subjectBody, k)).statusCode).toBe(404);
  });
  it('suspension et changement de rôle refusent aussi les reçus existants', async () => {
    const k = key(); expect((await send('/vaccinations/subjects', subjectBody, k)).statusCode).toBe(201);
    await app.prisma.user.update({ where: { id: a }, data: { status: 'SUSPENDED' } });
    try { expect((await send('/vaccinations/subjects', subjectBody, k)).statusCode).toBe(401); }
    finally { await app.prisma.user.update({ where: { id: a }, data: { status: 'ACTIVE', role: 'DIASPORA' } }); }
    try { expect((await send('/vaccinations/subjects', subjectBody, k)).statusCode).toBe(403); }
    finally { await app.prisma.user.update({ where: { id: a }, data: { role: 'PATIENT' } }); }
  });
  it('clé invalide, trop future et plus vieille que sept jours : aucun effet', async () => {
    for (const [k, status] of [['arbitrary-key', 400], [key(Date.now() + 600_000), 400], [key(Date.now() - MUTATION_MAX_AGE_MS - 1000), 410]] as const) {
      expect((await send('/vaccinations/subjects', subjectBody, k)).statusCode).toBe(status);
      expect(await app.prisma.mutationReceipt.count({ where: { key: k } })).toBe(0);
    }
  });
  it('purge authentifiée et clé périmée : jamais recréer après suppression du reçu', async () => {
    const k = key(Date.now() - MUTATION_MAX_AGE_MS + 60_000);
    expect((await send('/vaccinations/subjects', subjectBody, k)).statusCode).toBe(201);
    await app.prisma.mutationReceipt.updateMany({ where: { key: k }, data: { expiresAt: new Date(0) } });
    expect((await app.inject({ method: 'POST', url: '/api/v1/sync/receipts/prune' })).statusCode).toBe(401);
    const purge = await app.inject({ method: 'POST', url: '/api/v1/sync/receipts/prune', headers: { 'x-service-token': process.env.RECONCILE_TOKEN! } });
    expect(purge.statusCode, purge.body).toBe(200); expect(purge.json().deleted).toBeGreaterThanOrEqual(1);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
    try { expect((await send('/vaccinations/subjects', subjectBody, k)).statusCode).toBe(410); } finally { clock.mockRestore(); }
  });
  it('panne Redis après commit : succès durable, rejeu sans nouvelle publication', async () => {
    const publish = vi.spyOn(app.redis, 'publish').mockRejectedValueOnce(new Error('synthetic Redis unavailable'));
    try { await repeat(`/chat/threads/${thread}/messages`, { body: 'Redis indisponible' }); expect(publish).toHaveBeenCalledTimes(1); }
    finally { publish.mockRestore(); }
  });
  it('redémarrage serveur : le reçu PostgreSQL survit', async () => {
    const k = key(); const first = await send('/vaccinations/subjects', subjectBody, k);
    const { buildServer } = await import('@/server.js'); const restarted = await buildServer(); await restarted.ready();
    try {
      const retry = await restarted.inject({ method: 'POST', url: '/api/v1/vaccinations/subjects', headers: { authorization: `Bearer ${token}`, 'idempotency-key': k }, payload: subjectBody });
      expect(retry.statusCode, retry.body).toBe(201); expect(retry.json()).toEqual(first.json());
    } finally { await restarted.close(); }
  });
  const verify = (k: string, path = '/vaccinations/subjects', bearer = token, method = 'POST') => app.inject({ method: 'GET', url: `/api/v1/sync/receipts/${k}?method=${method}&route=${encodeURIComponent(path)}`, headers: bearer ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': `192.0.2.${++ip}` } : {} });
  it('vérification L4 sans corps : reçu seulement, aucun résultat clinique ni nouvelle écriture', async () => {
    const k = key(); const first = await send('/vaccinations/subjects', subjectBody, k);
    expect(first.statusCode).toBe(201); const before = await app.prisma.vaccinationSubject.count();
    const result = await verify(k); expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ confirmed: true, status: 201 });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).not.toContain(subjectBody.name); expect(await app.prisma.vaccinationSubject.count()).toBe(before);
  });
  it('ticket minimal L4 : clé seule suffit, sans divulguer route ni ressource', async () => {
    const k = key(); await send('/vaccinations/subjects', subjectBody, k);
    const result = await app.inject({ method: 'GET', url: `/api/v1/sync/receipts/${k}`, headers: { authorization: `Bearer ${token}` } });
    expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ confirmed: true, status: 201 });
  });
  it('ticket minimal ambigu sur deux routes : conflit conservateur, aucun effet supplémentaire', async () => {
    const k = key(); await send('/vaccinations/subjects', subjectBody, k); await send(`/chat/threads/${thread}/read`, undefined, k);
    const before = await app.prisma.mutationReceipt.count({ where: { userId: a, key: k } });
    const result = await app.inject({ method: 'GET', url: `/api/v1/sync/receipts/${k}`, headers: { authorization: `Bearer ${token}` } });
    expect(result.statusCode).toBe(409); expect(await app.prisma.mutationReceipt.count({ where: { userId: a, key: k } })).toBe(before);
  });
  it('vérification absente ou autre utilisateur : 404 sans tentative métier', async () => {
    const k = key(); await send('/vaccinations/subjects', subjectBody, k); const before = await app.prisma.vaccinationSubject.count();
    expect((await verify(k, '/vaccinations/subjects', otherToken)).statusCode).toBe(404);
    expect((await verify(key())).statusCode).toBe(404); expect(await app.prisma.vaccinationSubject.count()).toBe(before);
  });
  it('vérification L4 : session, rôle et propriété courants obligatoires', async () => {
    const k = key(); const result = await send('/vaccinations/subjects', subjectBody, k);
    expect((await verify(k, '/vaccinations/subjects', '')).statusCode).toBe(401);
    await app.prisma.user.update({ where: { id: a }, data: { status: 'SUSPENDED' } });
    try { expect((await verify(k)).statusCode).toBe(401); } finally { await app.prisma.user.update({ where: { id: a }, data: { status: 'ACTIVE' } }); }
    await app.prisma.user.update({ where: { id: a }, data: { role: 'DIASPORA' } });
    try { expect((await verify(k)).statusCode).toBe(403); } finally { await app.prisma.user.update({ where: { id: a }, data: { role: 'PATIENT' } }); }
    await app.prisma.vaccinationSubject.update({ where: { id: result.json().id }, data: { patientId: patientB } });
    expect((await verify(k)).statusCode).toBe(404);
  });
  it('vérification refusée pour clé/méthode/route hors contrat', async () => {
    expect((await verify('invalid')).statusCode).toBe(400);
    expect((await verify(key(), '/payments')).statusCode).toBe(400);
    expect((await verify(key(), '/vaccinations/subjects', token, 'PUT')).statusCode).toBe(422);
  });
  it('reçu expiré : vérification manuelle requise, aucun effet recréé', async () => {
    const k = key(); await send('/vaccinations/subjects', subjectBody, k);
    await app.prisma.mutationReceipt.updateMany({ where: { key: k }, data: { expiresAt: new Date(0) } });
    expect((await verify(k)).statusCode).toBe(404);
  });

});
