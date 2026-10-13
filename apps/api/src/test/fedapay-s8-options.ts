// Recette S8 (B1) : options de la sonde liées au contrôle de PRODUCTION, définies UNE seule
// fois pour la recette réelle (fedapay-s8.smoke.test.ts, hors CI) ET pour le test CI
// (fedapay-s8.test.ts) : une erreur de câblage casse la CI au lieu de passer en recette.
import { FEDAPAY_CHECKOUT_HOSTS, isFedapayCheckoutUrl } from '@digisante/shared';

import { parseFedapayTransactionId } from '../services/fedapay.js';

export function productionS8Options() {
  return {
    parseId: parseFedapayTransactionId,
    // Lié au BAC À SABLE : l'union live + sandbox (sans environnement) ferait d'un hôte
    // live renvoyé pour une clé bac à sable un PASS au lieu de HOTE_LIVE.
    isAllowedSandbox: (url: unknown) => isFedapayCheckoutUrl(url, 'sandbox'),
    hosts: FEDAPAY_CHECKOUT_HOSTS,
  };
}
