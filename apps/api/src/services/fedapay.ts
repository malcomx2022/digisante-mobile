// ─────────────────────────────────────────────────────────────
// Service FedaPay — Mobile Money (MTN, Moov, Wave), cartes internationales.
// ⚠️ CLAUDE.md §5 : la logique de paiement validée est GELÉE. Vérification HMAC
// AVANT tout traitement de webhook ; idempotence obligatoire (un même événement
// peut arriver plusieurs fois). STUB si FedaPay non configuré.
// ─────────────────────────────────────────────────────────────
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import { env, isFedapayConfigured } from '@/lib/env.js';

/** Commission plateforme : 3 % (CLAUDE.md / DocTech). */
export const COMMISSION_RATE = 0.03;
/** Taux de conversion fixe EUR → XOF (FCFA arrimé à l'euro). */
export const EUR_XOF_RATE = 655.957;

/** Calcule commission (3 %) et montant net (entiers FCFA). */
export function computeCommission(amount: number): { commission: number; net: number } {
  const commission = Math.round(amount * COMMISSION_RATE);
  return { commission, net: amount - commission };
}

/** Convertit un montant en euros vers des FCFA (entier). */
export function convertEurToXof(eur: number): number {
  return Math.round(eur * EUR_XOF_RATE);
}

/**
 * Vérifie la signature HMAC-SHA256 d'un webhook FedaPay (comparaison à temps
 * constant). Renvoie false si secret/signature absents ou invalides.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | undefined, secret: string | undefined): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Mappe un statut FedaPay vers notre PaymentStatus. */
export function mapFedapayStatus(status: string): 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'PROCESSING' | null {
  switch (status) {
    case 'approved':
    case 'transferred':
    case 'COMPLETED':
      return 'COMPLETED';
    case 'declined':
    case 'failed':
    case 'FAILED':
      return 'FAILED';
    case 'canceled':
    case 'CANCELLED':
      return 'CANCELLED';
    case 'pending':
    case 'PROCESSING':
      return 'PROCESSING';
    default:
      return null;
  }
}

export interface FedapayTransaction {
  fedapayId: string;
  paymentUrl: string;
}

/** Crée une transaction FedaPay (stub si non configuré). */
export async function createTransaction(opts: {
  amount: number;
  method: string;
  description: string;
  log: FastifyBaseLogger;
}): Promise<FedapayTransaction> {
  const fedapayId = `fdp_${randomBytes(12).toString('hex')}`;
  if (!isFedapayConfigured) {
    opts.log.warn({ amount: opts.amount, method: opts.method }, '[STUB FedaPay] transaction simulée');
    return { fedapayId, paymentUrl: `https://stub.fedapay.com/checkout/${fedapayId}` };
  }
  // TODO : POST https://api.fedapay.com/v1/transactions + génération du token de paiement.
  void env.FEDAPAY_SECRET_KEY;
  return { fedapayId, paymentUrl: `https://checkout.fedapay.com/${fedapayId}` };
}
