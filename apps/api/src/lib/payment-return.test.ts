import { describe, expect, it } from 'vitest';

import { PAYMENT_RETURN_PATHS, paymentCallbackUrl } from './payment-return.js';

describe('paymentCallbackUrl (retour FedaPay par type — recette L10 C5)', () => {
  const origin = 'https://preprod.digisantemobile.app';

  it('recharge diaspora → portefeuille diaspora, jamais une page patient', () => {
    expect(paymentCallbackUrl('WALLET_TOPUP', origin)).toBe(`${origin}/diaspora/wallet`);
  });

  it('consultation → rendez-vous patient ; abonnement → page abonnement médecin', () => {
    expect(paymentCallbackUrl('CONSULTATION', origin)).toBe(`${origin}/patient/appointments`);
    expect(paymentCallbackUrl('SUBSCRIPTION', origin)).toBe(`${origin}/pro/stats`);
  });

  it('première origine de la liste CORS, sans barre finale doublée', () => {
    expect(paymentCallbackUrl('WALLET_TOPUP', `${origin}/, https://autre.example`)).toBe(`${origin}/diaspora/wallet`);
  });

  it('sans origine configurée : aucun retour inventé', () => {
    expect(paymentCallbackUrl('CONSULTATION', '')).toBeNull();
  });

  it('chaque type de paiement a une page de retour distincte de la page patient par défaut', () => {
    const others = Object.entries(PAYMENT_RETURN_PATHS).filter(([type]) => type !== 'CONSULTATION');
    for (const [, path] of others) expect(path).not.toBe(PAYMENT_RETURN_PATHS.CONSULTATION);
  });
});
