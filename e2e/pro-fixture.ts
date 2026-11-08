import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../apps/api/node_modules/@prisma/client';

// Période PRO « confirmée par le fournisseur » pour les e2e (A8, revue GO du 22/10/2026) :
// le portefeuille ne règle plus l'abonnement médecin et l'e2e n'appelle aucun fournisseur.
// État écrit = celui que laisse un webhook FedaPay signé (Payment SUBSCRIPTION COMPLETED +
// commande liée et datée), pendant de `apps/api/src/test/pro-fixture.ts` qui passe, lui,
// par `activateWithin`. Catalogue approuvé L6 : `doctor-pilot-2026-10-v1`, PRO 5 000 XOF / 1 mois.
export async function grantProDb(prisma: PrismaClient, doctorUserId: string) {
  const doctor = await prisma.doctor.findUniqueOrThrow({ where: { userId: doctorUserId }, select: { id: true } });
  const startsAt = new Date();
  const endsAt = new Date(startsAt);
  endsAt.setUTCMonth(endsAt.getUTCMonth() + 1);
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: { userId: doctorUserId, type: 'SUBSCRIPTION', method: 'MTN_MOMO', amount: 5000, currency: 'XOF', status: 'COMPLETED', fedapayId: `e2e-pro-${randomUUID()}` },
    });
    await tx.doctor.update({ where: { id: doctor.id }, data: { subscriptionPlan: 'PRO', subscriptionStatus: 'ACTIVE', subscriptionCancelledAt: null } });
    return tx.subscriptionOrder.create({
      data: {
        doctorId: doctor.id, requestId: randomUUID(), paymentId: payment.id, plan: 'PRO', catalogVersion: 'doctor-pilot-2026-10-v1',
        amount: 5000, currency: 'XOF', periodMonths: 1, startsAt, endsAt,
      },
    });
  });
}
