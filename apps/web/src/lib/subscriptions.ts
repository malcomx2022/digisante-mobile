import { isFedapayCheckoutUrl } from '@digisante/shared';

export interface SubscriptionCheckout {
  paymentUrl: string | null;
  revoked: boolean;
  payment: { status: string };
}

/** Un retour fournisseur ou une absence de lien ne prouve jamais le paiement. */
export function subscriptionOutcome(result: SubscriptionCheckout) {
  if (result.payment.status === 'REFUNDED') return { kind: 'refunded' } as const;
  if (result.revoked) return { kind: 'abandoned' } as const;
  if (result.payment.status === 'COMPLETED') return { kind: 'confirmed' } as const;
  if (result.payment.status === 'FAILED') return { kind: 'failed' } as const;
  if (result.payment.status === 'CANCELLED') return { kind: 'cancelled_payment' } as const;
  if (result.paymentUrl) {
    if (!isFedapayCheckoutUrl(result.paymentUrl)) throw new Error('Invalid FedaPay checkout');
    return { kind: 'redirect', url: result.paymentUrl } as const;
  }
  return { kind: 'pending' } as const;
}
