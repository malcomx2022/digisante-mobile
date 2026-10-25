// Revue L6 : une période remboursée ne prolonge pas l'accès affiché à travers un trou.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as payments from '@/modules/payments/payments.service.js';
import { grantPro } from '@/test/pro-fixture.js';
import { requireProWithin } from './subscriptions.effects.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONE = '+2290195491001';

describe.skipIf(!HAS_INFRA)('Revue L6 — échéance de couverture continue', () => {
  let app: FastifyInstance;
  let userId: string;
  const auth = () => ({ authorization: `Bearer ${app.jwt.sign({ sub: userId, role: 'MEDECIN' }, { expiresIn: '15m' })}` });
  const current = () => app.inject({ method: 'GET', url: '/api/v1/subscriptions/me', headers: auth() });
  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: PHONE } });
    userId = (await app.prisma.user.create({ data: {
      phone: PHONE, role: 'MEDECIN', status: 'ACTIVE',
      doctor: { create: { speciality: 'G', licenseNumber: randomUUID(), verifiedAt: new Date(), consultFee: 3000 } },
    } })).id;
  });
  afterAll(async () => {
    if (app) {
      await app.prisma.user.deleteMany({ where: { phone: PHONE } });
      await app.close();
    }
  });

  it('garde les renouvellements contigus mais arrête l’échéance au premier intervalle non payé', async () => {
    const now = Date.now();
    const day = 86_400_000;
    const orders: { id: string; paymentId: string; endsAt: Date }[] = [];
    for (let index = 0; index < 3; index++) {
      const bought = await grantPro(app, userId);
      const order = await app.prisma.subscriptionOrder.update({ where: { id: bought.id },
        data: { startsAt: new Date(now + (index === 0 ? -2 : index * 2) * day), endsAt: new Date(now + (index + 1) * 2 * day) },
        select: { id: true, paymentId: true, endsAt: true } });
      if (!order.endsAt) throw new Error('Période synthétique sans échéance');
      orders.push({ ...order, endsAt: order.endsAt });
    }
    // Les trois périodes se touchent : la dernière échéance est encore correcte.
    expect((await current()).json().currentPeriodEnd).toBe(orders[2]!.endsAt.toISOString());
    await payments.refund(app, orders[1]!.paymentId, { actorId: userId });
    expect((await current()).json()).toMatchObject({ subscriptionPlan: 'PRO', currentPeriodEnd: orders[0]!.endsAt.toISOString() });
    await expect(app.prisma.$transaction((tx) => requireProWithin(tx, userId, new Date(now + 3 * day)))).rejects.toMatchObject({ statusCode: 403 });
    await app.prisma.$transaction((tx) => requireProWithin(tx, userId, new Date(now + 5 * day)));
    // Une commande future conserve ses dates, sans accorder PRO dans l'intervalle.
    expect((await app.prisma.subscriptionOrder.findUniqueOrThrow({ where: { id: orders[2]!.id } })).endsAt).toEqual(orders[2]!.endsAt);
    await payments.refund(app, orders[0]!.paymentId, { actorId: userId });
    expect((await current()).json()).toMatchObject({ subscriptionPlan: 'FREE', currentPeriodEnd: null });
  });
});
