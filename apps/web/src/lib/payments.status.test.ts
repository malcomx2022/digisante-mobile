import { describe, expect, it } from 'vitest';

import { messages } from '@/i18n/messages';
import { paymentStatusView } from './payments';

// Recette L10 C1 : un paiement Portefeuille COMPLETED affichait « Paiement initié ».
describe('paymentStatusView — état du paiement d’un rendez-vous', () => {
  it('COMPLETED (portefeuille ou opérateur) → « Paiement confirmé », jamais « initié »', () => {
    const view = paymentStatusView('COMPLETED');
    expect(view).toEqual({ key: 'subscriptions.payment_completed', tone: 'ok' });
    expect(messages.FR[view!.key]).toBe('Paiement confirmé');
    expect(messages.EN[view!.key]).toBe('Payment confirmed');
  });

  it('débit portefeuille confirmé par la réponse, avant rechargement de la liste → confirmé', () => {
    expect(paymentStatusView(null, true)).toEqual({ key: 'subscriptions.payment_completed', tone: 'ok' });
  });

  it('aucun paiement → null (le rendez-vous reste payable)', () => {
    expect(paymentStatusView(null)).toBeNull();
    expect(paymentStatusView(undefined)).toBeNull();
  });

  it('chaque statut serveur a un libellé FR et EN, et seul COMPLETED est « confirmé »', () => {
    for (const status of ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED', 'MYSTERE']) {
      const view = paymentStatusView(status)!;
      expect(messages.FR[view.key], status).toBeTruthy();
      expect(messages.EN[view.key], status).toBeTruthy();
      if (status !== 'COMPLETED') {
        expect(view.tone, status).not.toBe('ok');
        expect(messages.FR[view.key], status).not.toBe('Paiement confirmé');
      }
    }
    // Un état serveur ultérieur prime sur le débit local (ex. remboursé ensuite).
    expect(paymentStatusView('REFUNDED', true)?.key).toBe('subscriptions.payment_refunded');
  });

  it('aucun statut n’emprunte l’ancien libellé ambigu « Paiement initié »', () => {
    for (const status of ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED']) {
      expect(paymentStatusView(status)!.key).not.toBe('prescriptions.paid');
    }
  });
});
