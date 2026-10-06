// ─────────────────────────────────────────────────────────────
// Service Wallet (portefeuille diaspora) : solde, recharge (créditée au webhook),
// débit (paiement d'un soin, via `payments.initiate` méthode WALLET).
// Devise : FCFA (XOF).
// ─────────────────────────────────────────────────────────────
import { randomUUID } from 'node:crypto';

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
  await app.prisma.$transaction((tx) => creditWithin(tx, wallet.id, amount, reference, description));
}

/**
 * Crédit DANS la transaction de l'appelant : permet de lier le crédit à la
 * transition de statut du paiement (tout ou rien — pas de paiement COMPLETED sans
 * crédit, ni de crédit sans transition gagnée).
 */
export async function creditWithin(
  tx: Prisma.TransactionClient,
  walletId: string,
  amount: number,
  reference: string,
  description?: string,
  type: 'TOPUP' | 'REFUND_IN' = 'TOPUP',
) {
  await tx.walletTransaction.create({
    data: { walletId, type, amount: new Prisma.Decimal(amount), reference, description },
  });
  await tx.wallet.update({ where: { id: walletId }, data: { balance: { increment: amount } } });
}

/**
 * Reverse un crédit (remboursement interne d'une recharge). Atomique.
 * Décrémente le solde du montant remboursé et trace une transaction REFUND.
 * Autorité admin : pas de garde « solde insuffisant » (un solde négatif signale
 * des fonds déjà dépensés et bloquera les débits ultérieurs, ce qui est voulu).
 */
export async function refund(app: FastifyInstance, userId: string, amount: number, reference: string, description?: string) {
  const wallet = await getOrCreateWallet(app, userId);
  await app.prisma.$transaction((tx) => refundWithin(tx, wallet.id, amount, reference, description));
}

/** Reversal DANS la transaction de l'appelant (même raison que `creditWithin`). */
export async function refundWithin(
  tx: Prisma.TransactionClient,
  walletId: string,
  amount: number,
  reference: string,
  description?: string,
) {
  await tx.walletTransaction.create({
    data: { walletId, type: 'REFUND', amount: new Prisma.Decimal(amount), reference, description },
  });
  await tx.wallet.update({ where: { id: walletId }, data: { balance: { decrement: amount } } });
}

interface DebitInput {
  amount: number;
  description?: string;
}

/**
 * Cœur du débit — CONDITIONNÉ au solde suffisant, dans la même transaction que
 * l'écriture au registre. Empêche la double-dépense (TOCTOU) où deux débits
 * concurrents (cluster PM2 ×2) liraient le même solde avant d'écrire : le second
 * `updateMany` ne matche plus si le premier a déjà débité.
 *
 * ⚠️ Une SEULE définition de cette garde dans tout le produit. Ne jamais la
 * recopier ailleurs (ni revenir à `findUnique` + `update` non gardé).
 */
async function debitWithin(
  client: Prisma.TransactionClient,
  walletId: string,
  input: DebitInput,
  reference: string,
  // Nature du mouvement sortant. DEBIT = paiement d'un soin (`payments.initiate`
  // méthode WALLET) ; TRANSFER = envoi à un proche (`transfer`). Paramétré plutôt
  // que dupliqué : la garde de solde ci-dessous doit rester définie UNE SEULE FOIS.
  type: 'DEBIT' | 'TRANSFER' = 'DEBIT',
) {
  const guarded = await client.wallet.updateMany({
    where: { id: walletId, balance: { gte: input.amount } },
    data: { balance: { decrement: input.amount } },
  });
  if (guarded.count === 0) throw badRequest('Solde insuffisant');
  await client.walletTransaction.create({
    data: {
      walletId,
      type,
      amount: new Prisma.Decimal(input.amount),
      reference,
      description: input.description,
    },
  });
  const updated = await client.wallet.findUniqueOrThrow({ where: { id: walletId }, select: { balance: true } });
  return updated.balance;
}

/**
 * Débite le portefeuille (paiement d'un soin, éventuellement pour un proche).
 *
 * `tx` permet de PARTICIPER à une transaction ouverte par l'appelant — utilisé par
 * le paiement par portefeuille (`payments.initiate`, méthode WALLET) pour que le
 * débit et l'enregistrement du `Payment` soient validés ou annulés ENSEMBLE.
 * Sans ça, un échec entre les deux laisserait soit de l'argent débité sans trace
 * de paiement, soit un paiement enregistré sans débit.
 */
export async function debit(
  app: FastifyInstance,
  userId: string,
  input: DebitInput,
  tx?: Prisma.TransactionClient,
) {
  if (input.amount <= 0) throw badRequest('Montant invalide');
  const client = tx ?? app.prisma;
  const wallet = await client.wallet.findUnique({ where: { userId }, select: { id: true } });
  if (!wallet) throw notFound('Portefeuille introuvable');

  // Référence unique et non collisionnable (Date.now() pouvait doublonner sous
  // charge concurrente).
  const reference = `pay_${randomUUID()}`;

  const balance = tx
    ? await debitWithin(tx, wallet.id, input, reference)
    : await app.prisma.$transaction((c) => debitWithin(c, wallet.id, input, reference));
  return { balance, reference };
}

/**
 * Envoie de l'argent à un proche : débit de l'expéditeur ET crédit du
 * destinataire dans **UNE SEULE transaction**. C'est ce qui distingue ce
 * transfert de l'ancienne route `POST /wallet/pay` (retirée, écart E2), qui
 * débitait sans jamais créditer personne : ici l'argent arrive quelque part,
 * ou rien ne se passe.
 *
 * La garde de solde anti-TOCTOU est celle de `debitWithin` — pas une copie.
 *
 * ⚠️ §5 non concerné : mouvement **interne** au registre, aucun appel FedaPay,
 * aucun `Payment` créé. Même nature que `refund`.
 */
export async function transfer(
  app: FastifyInstance,
  fromUserId: string,
  toUserId: string,
  amount: number,
  description?: string,
) {
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('Montant invalide');
  // Un transfert vers soi-même serait un no-op qui gonfle le registre de deux
  // lignes contradictoires sur le MÊME portefeuille.
  if (fromUserId === toUserId) throw badRequest('Transfert vers soi-même impossible');

  const sender = await app.prisma.wallet.findUnique({ where: { userId: fromUserId }, select: { id: true } });
  if (!sender) throw notFound('Portefeuille introuvable');
  // Le destinataire peut n'avoir jamais ouvert son portefeuille : on le crée
  // plutôt que de refuser l'envoi.
  const receiver = await getOrCreateWallet(app, toUserId);

  const reference = `trf_${randomUUID()}`;
  const balance = await app.prisma.$transaction(async (tx) => {
    const remaining = await debitWithin(tx, sender.id, { amount, description }, reference, 'TRANSFER');
    await tx.walletTransaction.create({
      data: { walletId: receiver.id, type: 'TRANSFER_IN', amount: new Prisma.Decimal(amount), reference, description },
    });
    await tx.wallet.update({ where: { id: receiver.id }, data: { balance: { increment: amount } } });
    return remaining;
  });
  return { balance, reference };
}
