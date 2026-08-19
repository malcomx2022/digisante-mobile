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

// Bases officielles du SDK FedaPay (fedapay-node, `Requestor.ts`) — la version
// d'API `v1` est suffixée comme dans le SDK (`${base}/${apiVersion}${path}`).
const FEDAPAY_SANDBOX_BASE = 'https://sandbox-api.fedapay.com/v1';
const FEDAPAY_LIVE_BASE = 'https://api.fedapay.com/v1';

/**
 * Environnement DÉDUIT DE LA CLÉ, jamais configuré à part.
 *
 * Les clés FedaPay sont auto-descriptives (`sk_sandbox_…` / `sk_live_…`). Déduire
 * la base de la clé rend structurellement impossible la pire erreur d'exploitation
 * du domaine : pointer une clé de test vers la production, ou l'inverse. Un réglage
 * séparé aurait pu diverger de la clé ; ici il ne peut pas.
 *
 * Repli **sandbox** sur préfixe inconnu (fail-safe) : au pire les paiements ne
 * passent pas — visible immédiatement —, alors qu'un repli « live » enverrait de
 * vraies transactions avec une clé de test.
 */
export function fedapayEnvironment(secretKey: string): 'sandbox' | 'live' {
  return /^sk_live_/i.test(secretKey.trim()) ? 'live' : 'sandbox';
}

/** Base d'API correspondant à la clé fournie. */
export function fedapayApiBase(secretKey: string): string {
  return fedapayEnvironment(secretKey) === 'live' ? FEDAPAY_LIVE_BASE : FEDAPAY_SANDBOX_BASE;
}

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

/** Schéma de signature attendu dans l'en-tête (SDK fedapay-node : `EXPECTED_SCHEME = 's'`). */
const SIGNATURE_SCHEME = 's';
/** Tolérance d'horodatage, en secondes (SDK : `Webhook.DEFAULT_TOLERANCE = 300`). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** Calcule la signature d'une charge utile (HMAC-SHA256 hexadécimal). */
function computeSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/** Comparaison à temps constant, tolérante aux longueurs différentes. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Vérifie la signature d'un webhook FedaPay.
 *
 * ⚠️ CORRIGÉ en août 2026 (lot 8). L'implémentation précédente comparait
 * `HMAC(rawBody)` à l'en-tête ENTIER. Or FedaPay envoie un en-tête composite
 * horodaté, calqué sur Stripe :
 *
 *     X-FEDAPAY-SIGNATURE: t=<unix_seconds>,s=<hmac_sha256_hex>
 *
 * où la signature porte sur `` `${timestamp}.${rawBody}` `` — PAS sur le corps
 * seul. Aucun webhook réel n'aurait donc jamais été accepté : tous auraient été
 * rejetés en 401. Les tests ne le voyaient pas parce qu'ils fabriquaient la
 * signature avec la même formule erronée que le code vérifiait.
 * Référence : `fedapay-node`, `src/Webhook.ts` (`WebhookSignature.verifyHeader`).
 *
 * L'horodatage borne le rejeu : au-delà de la tolérance, l'événement est refusé
 * (une capture d'un webhook valide ne peut pas être rejouée des jours plus tard).
 * Plusieurs signatures du même schéma peuvent coexister (rotation de secret) :
 * il suffit qu'UNE corresponde.
 */
export function verifyWebhookSignature(
  rawBody: string,
  header: string | undefined,
  secret: string | undefined,
  opts?: { toleranceSeconds?: number; nowSeconds?: number },
): boolean {
  if (!secret || !header) return false;

  let timestamp = -1;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 't') timestamp = Number.parseInt(value, 10);
    else if (key === SIGNATURE_SCHEME) signatures.push(value);
  }
  if (!Number.isFinite(timestamp) || timestamp < 0 || signatures.length === 0) return false;

  const expected = computeSignature(`${timestamp}.${rawBody}`, secret);
  if (!signatures.some((candidate) => safeEqual(candidate, expected))) return false;

  // Anti-rejeu : on refuse un horodatage trop ANCIEN (comme le SDK). Un
  // horodatage futur n'est pas rejeté — une horloge de serveur légèrement en
  // retard ne doit pas faire perdre des paiements.
  const tolerance = opts?.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  const now = opts?.nowSeconds ?? Math.floor(Date.now() / 1000);
  return !(tolerance > 0 && now - timestamp > tolerance);
}

/**
 * Fabrique un en-tête `X-FEDAPAY-SIGNATURE` valide.
 *
 * Utilisé par les tests et par un éventuel rejeu manuel ; le SDK officiel expose
 * l'équivalent (`Webhook.generateTestHeaderString`). Le garder ICI, à côté de la
 * vérification, évite qu'un test réimplémente la formule et « valide » à nouveau
 * une signature que la production refuserait — c'est précisément ce qui a masqué
 * le défaut corrigé ci-dessus.
 */
export function buildWebhookSignatureHeader(
  rawBody: string,
  secret: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
): string {
  const signature = computeSignature(`${timestampSeconds}.${rawBody}`, secret);
  return `t=${timestampSeconds},${SIGNATURE_SCHEME}=${signature}`;
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
export interface FedapayCustomer {
  firstname?: string;
  lastname?: string;
  email?: string;
  /** Numéro au format international (`+229…`). */
  phone?: string;
}

export async function createTransaction(opts: {
  amount: number;
  method: string;
  description: string;
  log: FastifyBaseLogger;
  /** Clé secrète résolue (base → `.env`). Absente ⇒ STUB (comportement inchangé). */
  secretKey?: string | null;
  /** URL de retour après paiement sur la page hébergée FedaPay. */
  callbackUrl?: string | null;
  /** Référence marchand = notre identifiant de paiement (rapprochement comptable). */
  merchantReference?: string | null;
  /** Payeur — préremplit la page de paiement. Aucune donnée de santé (§4). */
  customer?: FedapayCustomer | null;
}): Promise<FedapayTransaction> {
  if (!opts.secretKey) {
    const fedapayId = `fdp_${randomBytes(12).toString('hex')}`;
    opts.log.warn({ amount: opts.amount, method: opts.method }, '[STUB FedaPay] transaction simulée');
    return { fedapayId, paymentUrl: `https://stub.fedapay.com/checkout/${fedapayId}` };
  }

  const base = fedapayApiBase(opts.secretKey);

  try {
    // 1) Création de la transaction (montant en XOF entier).
    //    `customer` préremplit la page hébergée : sans lui, le payeur ressaisit
    //    son numéro, ce qui fait chuter la conversion en Mobile Money.
    //    `merchant_reference` porte NOTRE id de paiement — indispensable au
    //    rapprochement comptable côté tableau de bord FedaPay.
    const customer = opts.customer
      ? {
          firstname: opts.customer.firstname,
          lastname: opts.customer.lastname,
          email: opts.customer.email,
          ...(opts.customer.phone
            ? { phone_number: { number: opts.customer.phone, country: 'bj' } }
            : {}),
        }
      : undefined;

    const txRes = await fetch(`${base}/transactions`, {
      method: 'POST',
      headers: fedapayHeaders(opts.secretKey),
      body: JSON.stringify({
        description: opts.description,
        amount: opts.amount,
        currency: { iso: 'XOF' },
        ...(opts.callbackUrl ? { callback_url: opts.callbackUrl } : {}),
        ...(opts.merchantReference ? { merchant_reference: opts.merchantReference } : {}),
        ...(customer ? { customer } : {}),
      }),
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
    const tokRes = await fetch(`${base}/transactions/${id}/token`, {
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

    opts.log.info(
      { fedapayId: id, amount: opts.amount, environment: fedapayEnvironment(opts.secretKey) },
      'transaction FedaPay créée',
    );
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
    const res = await fetch(`${fedapayApiBase(secretKey)}/transactions/${encodeURIComponent(fedapayId)}`, {
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
