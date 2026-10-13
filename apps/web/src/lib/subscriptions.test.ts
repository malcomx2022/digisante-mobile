import { describe, expect, it } from 'vitest';
import { isFedapayCheckoutUrl } from '@digisante/shared';
import { subscriptionOutcome } from './subscriptions';

describe('L6 — confirmation et checkout hébergé', () => {
  it('paiement en attente sans URL ne signifie pas confirmé', () => {
    expect(subscriptionOutcome({ revoked: false, paymentUrl: null, payment: { status: 'PENDING' } })).toEqual({ kind: 'pending' });
    expect(subscriptionOutcome({ revoked: false, paymentUrl: null, payment: { status: 'FAILED' } })).toEqual({ kind: 'failed' });
    expect(subscriptionOutcome({ revoked: false, paymentUrl: null, payment: { status: 'CANCELLED' } })).toEqual({ kind: 'cancelled_payment' });
    expect(subscriptionOutcome({ revoked: true, paymentUrl: null, payment: { status: 'REFUNDED' } })).toEqual({ kind: 'refunded' });
  });
  it('débit wallet confirmé : confirmation issue du statut serveur', () => {
    expect(subscriptionOutcome({ revoked: false, paymentUrl: null, payment: { status: 'COMPLETED' } })).toEqual({ kind: 'confirmed' });
  });
  it('commande abandonnée réglée tardivement : aucune annonce de droit actif', () => {
    expect(subscriptionOutcome({ revoked: true, paymentUrl: null, payment: { status: 'COMPLETED' } })).toEqual({ kind: 'abandoned' });
  });
  it('checkout attendu : redirection FedaPay exigée', () => {
    expect(subscriptionOutcome({ revoked: false, paymentUrl: 'https://checkout.fedapay.com/test', payment: { status: 'PENDING' } })).toEqual({ kind: 'redirect', url: 'https://checkout.fedapay.com/test' });
    // B1 : page hébergée réelle (`token.url` des SDK officiels).
    for (const url of ['https://process.fedapay.com/test', 'https://sandbox-process.fedapay.com/test']) {
      expect(subscriptionOutcome({ revoked: false, paymentUrl: url, payment: { status: 'PENDING' } })).toEqual({ kind: 'redirect', url });
    }
  });
  it('domaines ressemblants, HTTP, identifiants, ports et URL invalides refusés', () => {
    for (const url of ['https://fedapay.com.evil.example', 'https://fakefedapay.com', 'http://checkout.fedapay.com', 'https://user:pass@checkout.fedapay.com', 'https://checkout.fedapay.com:8080', 'javascript:alert(1)', 'malformed']) {
      expect(isFedapayCheckoutUrl(url)).toBe(false);
      expect(() => subscriptionOutcome({ revoked: false, paymentUrl: url, payment: { status: 'PENDING' } })).toThrow();
    }
  });
});
