/** Sens d'un mouvement du registre : REFUND annule une recharge (sortant). */
export function isWalletCredit(type: string): boolean {
  return type === 'TOPUP' || type === 'TRANSFER_IN' || type === 'REFUND_IN';
}
