// ─────────────────────────────────────────────────────────────
// Service Wallet (portefeuille diaspora) : solde, recharge (créditée au webhook),
// paiement (débit, ex. soins de la famille). Devise : FCFA (XOF).
// ─────────────────────────────────────────────────────────────
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { badRequest, notFound } from '@/lib/errors.js';

/** Récupère (ou crée) le portefeuille de l'utilisateur. */
export async function getOrCreateWallet(app: FastifyInstance, userId: string) {
  const existing = await app.prisma.wallet.findUnique({ where: { userId } });
  if (existing) return existing;
  return app.prisma.wallet.create({ data: { userId, balance: 0, currency: 'XOF' } });
}

/** Solde + dernières transactions. */
export async function summary(app: FastifyInstance, userId: string) {
  const wallet = await getOrCreateWallet(app, userId);
  const transactions = await app.prisma.walletTransaction.findMany({
    where: { walletId: wallet.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return { balance: wallet.balance, currency: wallet.currency, transactions };
}

/** Crédite le portefeuille (appelé à la confirmation d'une recharge). Atomique. */
export async function credit(app: FastifyInstance, userId: string, amount: number, reference: string, description?: string) {
  const wallet = await getOrCreateWallet(app, userId);
  await app.prisma.$transaction([
    app.prisma.walletTransaction.create({
      data: { walletId: wallet.id, type: 'TOPUP', amount: new Prisma.Decimal(amount), reference, description },
    }),
    app.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amount } } }),
  ]);
}

/**
 * Reverse un crédit (remboursement interne d'une recharge). Atomique.
 * Décrémente le solde du montant remboursé et trace une transaction REFUND.
 * Autorité admin : pas de garde « solde insuffisant » (un solde négatif signale
 * des fonds déjà dépensés et bloquera les débits ultérieurs, ce qui est voulu).
 */
export async function refund(app: FastifyInstance, userId: string, amount: number, reference: string, description?: string) {
  const wallet = await getOrCreateWallet(app, userId);
  await app.prisma.$transaction([
    app.prisma.walletTransaction.create({
      data: { walletId: wallet.id, type: 'REFUND', amount: new Prisma.Decimal(amount), reference, description },
    }),
    app.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: amount } } }),
  ]);
}

/** Débite le portefeuille (paiement d'un soin, éventuellement pour un proche). */
export async function debit(
  app: FastifyInstance,
  userId: string,
  input: { amount: number; description?: string; beneficiaryUserId?: string },
) {
  if (input.amount <= 0) throw badRequest('Montant invalide');
  const wallet = await app.prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) throw notFound('Portefeuille introuvable');
  if (wallet.balance.lessThan(input.amount)) throw badRequest('Solde insuffisant');

  const reference = `pay_${Date.now()}`;
  const [, updated] = await app.prisma.$transaction([
    app.prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: input.beneficiaryUserId ? 'TRANSFER' : 'DEBIT',
        amount: new Prisma.Decimal(input.amount),
        reference,
        description: input.description,
      },
    }),
    app.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: input.amount } } }),
  ]);
  return { balance: updated.balance, reference };
}
