// ─────────────────────────────────────────────────────────────
// Page de retour du payeur après la page hébergée FedaPay (`callback_url`).
//
// Recette L10, C5 (20/10/2026) : le retour valait `/patient/appointments` pour
// TOUS les types — une recharge diaspora retombait sur une page patient, que
// la garde de rôle refuse. Le retour dépend désormais du type de paiement.
//
// §5 : simple adresse de navigation du navigateur. Elle ne prouve rien et ne
// déclenche rien : la confirmation reste le webhook signé ou la réconciliation.
// ─────────────────────────────────────────────────────────────
import type { PaymentType } from '@digisante/shared';

import { env } from './env.js';

/** Page de l'application où revient le payeur, par type de paiement. */
export const PAYMENT_RETURN_PATHS = {
  CONSULTATION: '/patient/appointments',
  WALLET_TOPUP: '/diaspora/wallet',
  SUBSCRIPTION: '/pro/stats',
  LAB_TEST: '/patient/results',
  PHARMACY: '/patient/prescriptions',
} as const satisfies Record<PaymentType, string>;

/**
 * URL absolue de retour : première origine de `CORS_ORIGIN` (même origine que le
 * web, Nginx) + page du type. `null` sans origine configurée (aucun repli inventé).
 */
export function paymentCallbackUrl(type: PaymentType, origins: string | undefined = env.CORS_ORIGIN): string | null {
  const origin = origins?.split(',')[0]?.trim().replace(/\/+$/, '');
  return origin ? `${origin}${PAYMENT_RETURN_PATHS[type]}` : null;
}
