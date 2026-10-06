import { describe, expect, it } from 'vitest';

import { isWalletCredit } from './wallet';

describe('Sens des mouvements du portefeuille', () => {
  it('affiche les remboursements de paiement et les autres entrées en crédit', () => {
    for (const type of ['REFUND_IN', 'TOPUP', 'TRANSFER_IN']) expect(isWalletCredit(type)).toBe(true);
  });

  it('conserve les reversals de recharge et les autres sorties en débit', () => {
    for (const type of ['REFUND', 'DEBIT', 'TRANSFER']) expect(isWalletCredit(type)).toBe(false);
  });
});
