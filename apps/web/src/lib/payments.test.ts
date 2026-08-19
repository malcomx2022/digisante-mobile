// ─────────────────────────────────────────────────────────────
// Non-régression E1 — la réponse d'une initiation de paiement doit être
// classée de façon à ce que l'appelant NE PUISSE PAS « oublier » la
// redirection vers la page hébergée.
//
// Le défaut d'origine (recharge du portefeuille diaspora) était invisible pour
// 350 tests verts : le composant appelait l'API, ignorait `paymentUrl` et
// affichait un succès. Aucune assertion ne portait sur la valeur jetée.
// ─────────────────────────────────────────────────────────────
import { describe, expect, it } from 'vitest';

import { paymentOutcome } from './payments';

describe('paymentOutcome', () => {
  it('exige une redirection quand le serveur renvoie une page de paiement', () => {
    expect(paymentOutcome({ paymentUrl: 'https://checkout.fedapay.com/abc' })).toEqual({
      kind: 'redirect',
      url: 'https://checkout.fedapay.com/abc',
    });
  });

  it('conclut le paiement sans redirection quand il n’y a pas d’URL (portefeuille)', () => {
    // Méthode WALLET : débitée dans la transaction serveur, terminale.
    expect(paymentOutcome({ paymentUrl: null })).toEqual({ kind: 'settled' });
    expect(paymentOutcome({})).toEqual({ kind: 'settled' });
  });

  it('traite la mise en file hors-ligne à part — rien à ouvrir', () => {
    expect(paymentOutcome({ queued: true })).toEqual({ kind: 'queued' });
  });

  it('ne redirige pas vers une URL vide', () => {
    // Un truthy naïf enverrait l’utilisateur sur `about:blank` plutôt que de
    // l’informer.
    expect(paymentOutcome({ paymentUrl: '' })).toEqual({ kind: 'settled' });
  });

  it('tolère une réponse absente sans jamais inventer d’URL', () => {
    expect(paymentOutcome(null)).toEqual({ kind: 'settled' });
    expect(paymentOutcome(undefined)).toEqual({ kind: 'settled' });
  });
});
