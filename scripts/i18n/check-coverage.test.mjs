import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { MESSAGES, extractLocale, isCritical } from './check-coverage.mjs';

const fr = extractLocale(readFileSync(MESSAGES, 'utf8'), 'fr');

// Textes d'argent vus par le patient, le proche diaspora et le médecin payeur
// (décision du porteur du 11/11/2026) : une erreur de traduction y est dangereuse.
const MONEY_KEYS = [
  'appt.pay', 'appt.pay_error',
  'prescriptions.pay', 'prescriptions.pay_wallet', 'prescriptions.paid', 'prescriptions.payment_queued',
  'subscriptions.payment_completed', 'subscriptions.payment_refunded',
  'wallet.balance', 'wallet.topup', 'wallet.tx.DEBIT', 'wallet.tx.TRANSFER_IN',
  'beneficiaries.send_money', 'beneficiaries.send_confirm', 'beneficiaries.sent',
  'beneficiaries.amount_xof', 'beneficiaries.no_account',
];

test('les textes de paiement réels sont critiques (le préfixe payments. seul ne couvrait aucune clé)', () => {
  for (const key of MONEY_KEYS) {
    assert.ok(Object.hasOwn(fr, key), `${key} absent du FR : liste du test à mettre à jour`);
    assert.ok(isCritical(key), `${key} doit exiger la double validation`);
  }
  assert.ok(Object.keys(fr).some((key) => key.startsWith('wallet.') || key.startsWith('appt.pay')));
});

test('urgence et laboratoire restent critiques', () => {
  assert.ok(isCritical('sos.im_ok'));
  assert.ok(isCritical('labo.critical'));
});

test('hors périmètre : gestion du carnet de proches et écrans opérateurs', () => {
  for (const key of ['beneficiaries.name', 'beneficiaries.add', 'subscriptions.history', 'finance.refund', 'finance_ops.confirm', 'revenue.gross', 'appt.title']) {
    assert.ok(Object.hasOwn(fr, key), `${key} absent du FR : liste du test à mettre à jour`);
    assert.equal(isCritical(key), false, `${key} ne doit pas être critique`);
  }
});
