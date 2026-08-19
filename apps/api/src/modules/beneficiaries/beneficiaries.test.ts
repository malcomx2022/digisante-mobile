// Test d'intégration des bénéficiaires (carnet de proches DIASPORA). CI uniquement.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290193300001', '+2290193300002', '+2290193300003', '+2290193300004'];

describe.skipIf(!HAS_INFRA)('Bénéficiaires diaspora (intégration)', () => {
  let app: FastifyInstance;
  let diasporaToken: string;
  let otherDiasporaToken: string;
  let patientToken: string;
  let diasporaId: string;
  let relativeId: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });

    const diaspora = await app.prisma.user.create({ data: { phone: PHONES[0], role: 'DIASPORA', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Dia', lastName: 'Spora' } } } });
    const other = await app.prisma.user.create({ data: { phone: PHONES[1], role: 'DIASPORA', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Other', lastName: 'D' } } } });
    const patient = await app.prisma.user.create({ data: { phone: PHONES[2], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Pat', lastName: 'X' } }, patient: { create: {} } } });

    // Le proche inscrit : c'est SON numéro qui rendra la fiche du carnet joignable.
    const relative = await app.prisma.user.create({ data: { phone: PHONES[3], role: 'PATIENT', status: 'ACTIVE', lang: 'EN', profile: { create: { firstName: 'Rel', lastName: 'Ative' } }, patient: { create: {} } } });
    relativeId = relative.id;
    diasporaId = diaspora.id;

    diasporaToken = app.jwt.sign({ sub: diaspora.id, role: 'DIASPORA' }, { expiresIn: '15m' });
    otherDiasporaToken = app.jwt.sign({ sub: other.id, role: 'DIASPORA' }, { expiresIn: '15m' });
    patientToken = app.jwt.sign({ sub: patient.id, role: 'PATIENT' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await app.close();
  });

  it('CRUD complet d’un proche par son propriétaire', async () => {
    const add = await app.inject({
      method: 'POST', url: '/api/v1/beneficiaries', headers: auth(diasporaToken),
      payload: { name: 'Aïcha', relationship: 'Mère', phone: '+2290196000000', languagesSpoken: ['FON'] },
    });
    expect(add.statusCode).toBe(201);
    const id = add.json().id as string;
    expect(add.json().languagesSpoken).toContain('FON');

    const list = await app.inject({ method: 'GET', url: '/api/v1/beneficiaries', headers: auth(diasporaToken) });
    expect(list.json()).toHaveLength(1);

    const patch = await app.inject({ method: 'PATCH', url: `/api/v1/beneficiaries/${id}`, headers: auth(diasporaToken), payload: { name: 'Aïcha B.', relationship: 'Mère' } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().name).toBe('Aïcha B.');

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/beneficiaries/${id}`, headers: auth(diasporaToken) });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/v1/beneficiaries', headers: auth(diasporaToken) });
    expect(after.json()).toHaveLength(0);
  });

  it('isolation : un autre membre ne peut pas modifier/supprimer le proche d’autrui (404)', async () => {
    const add = await app.inject({ method: 'POST', url: '/api/v1/beneficiaries', headers: auth(diasporaToken), payload: { name: 'Koffi' } });
    const id = add.json().id as string;

    const patch = await app.inject({ method: 'PATCH', url: `/api/v1/beneficiaries/${id}`, headers: auth(otherDiasporaToken), payload: { name: 'Hack' } });
    expect(patch.statusCode).toBe(404);
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/beneficiaries/${id}`, headers: auth(otherDiasporaToken) });
    expect(del.statusCode).toBe(404);

    // L'autre membre ne voit pas non plus ce proche dans sa liste.
    const otherList = await app.inject({ method: 'GET', url: '/api/v1/beneficiaries', headers: auth(otherDiasporaToken) });
    expect(otherList.json()).toHaveLength(0);
  });

  it('RBAC : un patient n’accède pas aux bénéficiaires (403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/beneficiaries', headers: auth(patientToken) });
    expect(res.statusCode).toBe(403);
  });

  // ── Écart E3 : envoi d'argent au portefeuille d'un proche ──────────────────
  describe('envoi d’argent à un proche (E3)', () => {
    const addRelative = async (phone: string) => {
      const r = await app.inject({
        method: 'POST', url: '/api/v1/beneficiaries', headers: auth(diasporaToken),
        payload: { name: 'Maman', relationship: 'Mère', phone },
      });
      return r.json().id as string;
    };
    const provision = async (amount: number) => {
      await app.prisma.wallet.upsert({
        where: { userId: diasporaId },
        create: { userId: diasporaId, balance: amount, currency: 'XOF' },
        update: { balance: amount },
      });
    };
    const cleanBeneficiaries = () => app.prisma.beneficiary.deleteMany({ where: { ownerId: diasporaId } });

    it('signale qu’un proche INSCRIT est joignable, et qu’un autre ne l’est pas', async () => {
      await cleanBeneficiaries();
      await addRelative(PHONES[3]);          // a un compte
      await addRelative('+2290196999999');   // n'en a pas
      const list = await app.inject({ method: 'GET', url: '/api/v1/beneficiaries', headers: auth(diasporaToken) });
      const rows = list.json() as { phone: string; canReceive: boolean }[];
      expect(rows.find((r) => r.phone === PHONES[3])?.canReceive).toBe(true);
      expect(rows.find((r) => r.phone === '+2290196999999')?.canReceive).toBe(false);
      // §4 : on expose un booléen, JAMAIS l'identité du compte en face.
      expect(JSON.stringify(rows)).not.toContain(relativeId);
    });

    it('débite l’expéditeur ET crédite le proche dans le même mouvement', async () => {
      await cleanBeneficiaries();
      const id = await addRelative(PHONES[3]);
      await provision(10_000);

      const res = await app.inject({ method: 'POST', url: `/api/v1/beneficiaries/${id}/send`, headers: auth(diasporaToken), payload: { amount: 4000 } });
      expect(res.statusCode).toBe(200);
      expect(Number(res.json().balance)).toBe(6000);

      // L'argent est ARRIVÉ : c'est ce que l'ancienne route /wallet/pay ne faisait pas.
      const received = await app.prisma.wallet.findUniqueOrThrow({ where: { userId: relativeId } });
      expect(Number(received.balance)).toBe(4000);

      // Les deux jambes portent la même référence, avec des types distincts.
      const legs = await app.prisma.walletTransaction.findMany({ where: { reference: res.json().reference }, select: { type: true } });
      expect(legs.map((l) => l.type).sort()).toEqual(['TRANSFER', 'TRANSFER_IN']);
    });

    it('notifie le proche dans SA langue (§4) et n’audite que des métadonnées', async () => {
      await cleanBeneficiaries();
      const id = await addRelative(PHONES[3]);
      await provision(5000);
      await app.prisma.notification.deleteMany({ where: { recipientId: relativeId } });

      const res = await app.inject({ method: 'POST', url: `/api/v1/beneficiaries/${id}/send`, headers: auth(diasporaToken), payload: { amount: 1500 } });
      expect(res.statusCode).toBe(200);

      // Le proche est anglophone (lang EN) → notification en anglais.
      const notif = await app.prisma.notification.findFirstOrThrow({ where: { recipientId: relativeId }, orderBy: { createdAt: 'desc' } });
      expect(notif.title).toBe('Money received');

      const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: 'WALLET_TRANSFER', actorId: diasporaId }, orderBy: { createdAt: 'desc' } });
      // Le nom du proche est du texte saisi par le payeur : il n'a rien à faire
      // dans un registre que l'admin peut lire (§4, même principe que REFERRAL_CREATE).
      expect(JSON.stringify(audit.meta)).not.toContain('Maman');
    });

    it('refuse un solde insuffisant SANS rien créditer', async () => {
      await cleanBeneficiaries();
      const id = await addRelative(PHONES[3]);
      await provision(100);
      const before = Number((await app.prisma.wallet.findUniqueOrThrow({ where: { userId: relativeId } })).balance);

      const res = await app.inject({ method: 'POST', url: `/api/v1/beneficiaries/${id}/send`, headers: auth(diasporaToken), payload: { amount: 9000 } });
      expect(res.statusCode).toBe(400);

      const after = Number((await app.prisma.wallet.findUniqueOrThrow({ where: { userId: relativeId } })).balance);
      expect(after).toBe(before); // aucune jambe orpheline
      expect(Number((await app.prisma.wallet.findUniqueOrThrow({ where: { userId: diasporaId } })).balance)).toBe(100);
    });

    it('refuse un proche sans compte DigiSanté', async () => {
      await cleanBeneficiaries();
      const id = await addRelative('+2290196999999');
      await provision(5000);
      const res = await app.inject({ method: 'POST', url: `/api/v1/beneficiaries/${id}/send`, headers: auth(diasporaToken), payload: { amount: 1000 } });
      expect(res.statusCode).toBe(400);
    });

    it('cloisonnement : on ne peut pas envoyer via le proche d’autrui (404)', async () => {
      await cleanBeneficiaries();
      const id = await addRelative(PHONES[3]);
      const res = await app.inject({ method: 'POST', url: `/api/v1/beneficiaries/${id}/send`, headers: auth(otherDiasporaToken), payload: { amount: 1000 } });
      expect(res.statusCode).toBe(404); // 404 et pas 403 : on ne confirme pas l'existence
    });
  });
});
