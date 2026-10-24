// Fixture de test : période PRO payée et CONFIRMÉE PAR LE FOURNISSEUR (L6), sans appel FedaPay.
// A8 (revue GO du 22/10/2026) : le portefeuille ne règle plus l'abonnement médecin ; les tests
// qui avaient besoin d'un médecin PRO passaient par lui. On reproduit l'état laissé par un
// webhook signé : Payment SUBSCRIPTION COMPLETED + commande liée, activée par `activateWithin`
// (le code de la confirmation réelle) — jamais une colonne Doctor posée à la main.
import { randomUUID } from 'node:crypto';

import { DOCTOR_SUBSCRIPTION_CATALOG } from '@digisante/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { activateWithin } from '@/modules/subscriptions/subscriptions.effects.js';

const PRO = DOCTOR_SUBSCRIPTION_CATALOG.plans.find((p) => p.plan === 'PRO')!;

export async function grantPro(app: FastifyInstance, doctorUserId: string) {
  return app.prisma.$transaction(async (tx) => {
    const doctor = await tx.doctor.findUniqueOrThrow({ where: { userId: doctorUserId }, select: { id: true } });
    const amount = new Prisma.Decimal(PRO.amount);
    const payment = await tx.payment.create({
      data: { userId: doctorUserId, type: 'SUBSCRIPTION', method: 'MTN_MOMO', amount, currency: 'XOF', status: 'COMPLETED', fedapayId: `test-pro-${randomUUID()}` },
    });
    const order = await tx.subscriptionOrder.create({
      data: {
        doctorId: doctor.id, requestId: randomUUID(), paymentId: payment.id, plan: 'PRO',
        catalogVersion: DOCTOR_SUBSCRIPTION_CATALOG.version, amount, currency: 'XOF', periodMonths: PRO.periodMonths,
      },
    });
    await activateWithin(tx, payment.id);
    return tx.subscriptionOrder.findUniqueOrThrow({ where: { id: order.id }, include: { payment: true } });
  });
}
