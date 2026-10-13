// ─────────────────────────────────────────────────────────────
// Interprétation de la réponse d'un endpoint qui INITIE un paiement
// (`POST /payments`, `POST /wallet/topup`).
//
// ⚠️ RÈGLE UNIQUE, définie ici et nulle part ailleurs. Un paiement par
// opérateur (Mobile Money / carte) n'est PAS acquis au retour de l'appel : il
// l'est sur la page hébergée FedaPay, puis confirmé par webhook. L'appelant
// DOIT donc rediriger vers `paymentUrl` quand elle est présente.
//
// Ne pas le faire produit un défaut silencieux et coûteux : l'interface affiche
// « payé » / « recharge initiée », la transaction reste PENDING, et rien n'est
// jamais réglé ni crédité. Ce défaut a été corrigé au lot 8 sur le paiement de
// consultation, puis retrouvé intact sur la recharge du portefeuille (E1) —
// parce que la règle vivait en double dans deux composants au lieu d'être
// partagée. D'où ce module : un seul endroit à lire, un seul à tester.
//
// §5 : aucune logique de paiement ici. On ne fait qu'INTERPRÉTER une réponse
// serveur déjà produite ; les montants, le débit et la confirmation restent
// entièrement côté API.
//
// B1 (13/10/2026) : la redirection n'a lieu QUE vers un hôte exact de la page
// hébergée FedaPay (`isFedapayCheckoutUrl`, même contrôle que l'API et que
// l'abonnement L6). Toute autre URL — y compris le stub de développement
// `stub.fedapay.com` — lève une erreur : l'appelant l'affiche comme un échec,
// jamais comme un paiement réglé, et le navigateur ne quitte pas l'application.
// ─────────────────────────────────────────────────────────────
import { isFedapayCheckoutUrl } from '@digisante/shared';

/** Réponse d'un endpoint d'initiation de paiement, telle que vue par le client. */
export interface PaymentInitResponse {
  paymentUrl?: string | null;
}

export type PaymentOutcome =
  /** Hors ligne : la mutation est partie en file, rien à ouvrir maintenant. */
  | { kind: 'queued' }
  /** Opérateur : le règlement se fait sur la page hébergée → y aller. */
  | { kind: 'redirect'; url: string }
  /** Terminal côté serveur (portefeuille débité, ou stub sans page hébergée). */
  | { kind: 'settled' };

/**
 * Classe la réponse d'une initiation de paiement.
 *
 * `settled` est le repli volontaire : sans `paymentUrl` il n'y a rien à ouvrir
 * (paiement par portefeuille — débité dans la transaction serveur). On ne
 * fabrique JAMAIS d'URL de repli.
 *
 * @throws Error si `paymentUrl` n'est pas une page hébergée FedaPay autorisée :
 * ni redirection vers un hôte arbitraire, ni annonce d'un paiement réglé.
 */
export function paymentOutcome(res: PaymentInitResponse | { queued: true } | null | undefined): PaymentOutcome {
  if (res && typeof res === 'object' && 'queued' in res) return { kind: 'queued' };
  const url = res?.paymentUrl;
  // `typeof` plutôt qu'un simple truthy : une URL vide n'est pas une URL, et on
  // préfère informer l'utilisateur que le rediriger vers `about:blank`.
  if (typeof url === 'string' && url.length > 0) {
    if (!isFedapayCheckoutUrl(url)) throw new Error('Invalid FedaPay checkout');
    return { kind: 'redirect', url };
  }
  return { kind: 'settled' };
}
