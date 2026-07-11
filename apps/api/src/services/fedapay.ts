// ─────────────────────────────────────────────────────────────
// Service FedaPay — Mobile Money (MTN, Moov, Wave), cartes internationales.
// ⚠️ CLAUDE.md §5 : la logique de paiement validée est GELÉE. Vérification HMAC
// AVANT tout traitement de webhook ; idempotence obligatoire (un même événement
// peut arriver plusieurs fois). STUB si FedaPay non configuré.
//
// Lot E (§3.6) : la CLÉ SECRÈTE est désormais RÉSOLUE par l'appelant (base chiffrée
// → `.env`, via `resolveConfiguredSecrets`) et passée en paramètre — ce module reste
// SANS dépendance à `app` (testable). AUCUNE modification de la logique de paiement :
// stub si pas de clé (`secretKey` absent), sinon appels HTTP v1 identiques.
// ─────────────────────────────────────────────────────────────
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import { badGateway, isAppError } from '@/lib/errors.js';

const FEDAPAY_BASE = 'https://api.fedapay.com/v1';

function fedapayHeaders(secretKey: string): Record<string, string> {
  return { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' };
}

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

/**
 * Crée une transaction FedaPay et son lien de paiement.
 * STUB si non configuré (dev/CI). Sinon : POST /v1/transactions puis
 * POST /v1/transactions/{id}/token (API HTTP v1). Lève BAD_GATEWAY en cas
 * d'échec amont (ne crée pas de paiement local avec un lien factice).
 */
export async function createTransaction(opts: {
  amount: number;
  method: string;
  description: string;
  log: FastifyBaseLogger;
  /** Clé secrète résolue (base → `.env`). Absente ⇒ STUB (comportement inchangé). */
  secretKey?: string | null;
}): Promise<FedapayTransaction> {
  if (!opts.secretKey) {
    const fedapayId = `fdp_${randomBytes(12).toString('hex')}`;
    opts.log.warn({ amount: opts.amount, method: opts.method }, '[STUB FedaPay] transaction simulée');
    return { fedapayId, paymentUrl: `https://stub.fedapay.com/checkout/${fedapayId}` };
  }

  try {
    // 1) Création de la transaction (montant en XOF entier).
    const txRes = await fetch(`${FEDAPAY_BASE}/transactions`, {
      method: 'POST',
      headers: fedapayHeaders(opts.secretKey),
      body: JSON.stringify({ description: opts.description, amount: opts.amount, currency: { iso: 'XOF' } }),
    });
    if (!txRes.ok) {
      const detail = await txRes.text().catch(() => '');
      opts.log.error({ status: txRes.status, detail }, '[FedaPay] création transaction en échec');
      throw badGateway('Échec de la création de la transaction de paiement');
    }
    const txJson = (await txRes.json()) as { 'v1/transaction'?: { id?: number | string }; id?: number | string };
    const id = txJson['v1/transaction']?.id ?? txJson.id;
    if (!id) throw badGateway('Réponse FedaPay inattendue (transaction sans id)');

    // 2) Génération du token → URL de paiement hébergée.
    const tokRes = await fetch(`${FEDAPAY_BASE}/transactions/${id}/token`, {
      method: 'POST',
      headers: fedapayHeaders(opts.secretKey),
    });
    if (!tokRes.ok) {
      const detail = await tokRes.text().catch(() => '');
      opts.log.error({ status: tokRes.status, detail }, '[FedaPay] génération token en échec');
      throw badGateway('Échec de génération du lien de paiement');
    }
    const tokJson = (await tokRes.json()) as { url?: string };
    if (!tokJson.url) throw badGateway('Réponse FedaPay inattendue (token sans url)');

    opts.log.info({ fedapayId: id, amount: opts.amount }, 'transaction FedaPay créée');
    return { fedapayId: String(id), paymentUrl: tokJson.url };
  } catch (err) {
    if (isAppError(err)) throw err;
    opts.log.error({ err }, '[FedaPay] erreur réseau création transaction');
    throw badGateway('Service de paiement indisponible');
  }
}

/**
 * Lit le statut d'une transaction FedaPay (réconciliation). Renvoie le statut
 * brut (à mapper) ou null si non configuré / introuvable / erreur (jamais throw,
 * la réconciliation ne doit pas casser).
 */
export async function getTransactionStatus(
  fedapayId: string,
  log: FastifyBaseLogger,
  secretKey?: string | null,
): Promise<string | null> {
  if (!secretKey) return null;
  try {
    const res = await fetch(`${FEDAPAY_BASE}/transactions/${encodeURIComponent(fedapayId)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!res.ok) {
      log.error({ status: res.status, fedapayId }, '[FedaPay] lecture transaction en échec');
      return null;
    }
    const json = (await res.json()) as { 'v1/transaction'?: { status?: string }; status?: string };
    return json['v1/transaction']?.status ?? json.status ?? null;
  } catch (err) {
    log.error({ err, fedapayId }, '[FedaPay] erreur réseau lecture transaction');
    return null;
  }
}
