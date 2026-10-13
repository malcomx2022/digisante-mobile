import { z } from 'zod';

// Catalogue pilote approuvé par le porteur le 7 octobre 2026 (lot L6).
// Les montants sont imposés par l'API ; STARTER/CLINIC restent hors catalogue.
export const DOCTOR_SUBSCRIPTION_CATALOG = {
  version: 'doctor-pilot-2026-10-v1',
  currency: 'XOF',
  plans: [
    { plan: 'FREE', amount: 0, periodMonths: 0, rights: { startTeleconsultation: false, revenueStats: false } },
    { plan: 'PRO', amount: 5000, periodMonths: 1, rights: { startTeleconsultation: true, revenueStats: true } },
  ],
} as const;

export interface DoctorSubscription {
  subscriptionPlan: 'FREE' | 'PRO';
  subscriptionStatus: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  autoRenew: false;
  rights: { startTeleconsultation: boolean; revenueStats: boolean };
  pending: { id: string; paymentId: string; status: string; amount: string; currency: string } | null;
}

export type FedapayEnvironment = 'live' | 'sandbox';

/**
 * Hôtes EXACTS de la page de paiement hébergée FedaPay, par environnement
 * (§3.5 — amendement B1 du 13/10/2026, cf. CONTRAT_Securite_L8.md).
 *
 * - `process.fedapay.com` / `sandbox-process.fedapay.com` : application de
 *   paiement hébergée par FedaPay, route `/:token?`, qui vérifie le jeton via
 *   `GET {api}/v1/transactions/verify_token` (bundles servis par ces hôtes,
 *   relevés le 13/10/2026 : `apiDomain:"api.fedapay.com",appEnv:"live"` et
 *   `apiDomain:"sandbox-api.fedapay.com",appEnv:"sandbox"`). Les tests officiels
 *   des SDK `fedapay` (npm 1.2.5, `TransactionTest.ts`) et `fedapay-php`
 *   (`TransactionTest.php`) attendent `token.url = https://process.fedapay.com/<token>`
 *   (réponse simulée). L'hôte bac à sable n'a JAMAIS été observé dans un
 *   `token.url` réel : à confirmer en recette S1 (sinon 502, jamais d'élargissement).
 * - `checkout.fedapay.com` / `sandbox-checkout.fedapay.com` : liste L8 d'origine,
 *   origines officielles du widget `cdn.fedapay.com/checkout.js` (`pk_live` /
 *   `pk_sandbox`). Conservées ; aucune source ne les montre dans `token.url`.
 *
 * Exclus faute de preuve exploitable : `fpay.li` (README fedapay-cli 2020, domaine
 * NXDOMAIN au 13/10/2026), hôtes `dev-*`, tout joker ou suffixe `*.fedapay.com`.
 */
export const FEDAPAY_CHECKOUT_HOSTS: Readonly<Record<FedapayEnvironment, readonly string[]>> = {
  live: ['process.fedapay.com', 'checkout.fedapay.com'],
  sandbox: ['sandbox-process.fedapay.com', 'sandbox-checkout.fedapay.com'],
};

/**
 * Contrôle commun API/client du lien hébergé ; aucun domaine approximatif.
 *
 * Avec `environment` (API : déduit de la clé secrète), seuls les hôtes de cet
 * environnement sont admis — une clé bac à sable ne renvoie jamais le payeur
 * vers la page live, ni l'inverse. Sans (client, qui ignore l'environnement),
 * l'union des deux listes.
 */
export function isFedapayCheckoutUrl(value: unknown, environment?: FedapayEnvironment): value is string {
  if (typeof value !== 'string') return false;
  // zod valide l'URL WHATWG ; antislashs, espaces (dont séparateurs Unicode) et
  // caractères de contrôle sont refusés sur la chaîne BRUTE, avant normalisation.
  if (!z.string().url().safeParse(value).success || /[\\\s]/.test(value) || [...value].some((char) => char.charCodeAt(0) < 32)) return false;
  // Grammaire stricte de l'autorité : `https://` + hôte ASCII, port 443 explicite
  // au plus, puis fin d'autorité. Credentials (`@`), port arbitraire ou `0443`,
  // point final, IDN et pourcent-encodage ne peuvent pas satisfaire ce motif.
  const authority = /^https:\/\/([a-z0-9.-]+)(?::443)?(?:[/?#]|$)/i.exec(value);
  if (!authority) return false;
  const allowed = environment ? FEDAPAY_CHECKOUT_HOSTS[environment] : [...FEDAPAY_CHECKOUT_HOSTS.live, ...FEDAPAY_CHECKOUT_HOSTS.sandbox];
  // Égalité EXACTE de l'hôte, jamais de suffixe.
  return allowed.includes(authority[1]!.toLowerCase());
}
