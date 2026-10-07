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

/** Contrôle commun API/client du lien hébergé ; aucun domaine approximatif. */
export function isFedapayCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  // zod valide l'URL WHATWG ; la grammaire de l'autorité interdit credentials,
  // ports arbitraires, antislashs, espaces et suffixes trompeurs.
  return z.string().url().safeParse(value).success && /^https:\/\/(?:checkout|sandbox-checkout)\.fedapay\.com(?::443)?(?:[/?#]|$)/i.test(value) && !/[\\\s]/.test(value) && ![...value].some((char) => char.charCodeAt(0) < 32);
}
