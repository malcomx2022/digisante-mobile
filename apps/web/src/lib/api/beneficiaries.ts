// Diaspora : carnet des proches au Bénin + envoi d'argent vers leur portefeuille
// (écart E3). L'envoi est un mouvement INTERNE au registre : §5 non touché.
import { del, get, patch, post } from './client';

export interface Beneficiary {
  id: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  languagesSpoken: string[];
  notes: string | null;
  createdAt: string;
  /**
   * Le proche a un compte DigiSanté ACTIF au numéro enregistré, donc on peut
   * lui envoyer de l'argent. Booléen SEUL : le serveur ne dit jamais QUI est
   * le compte en face (§4, minimisation).
   */
  canReceive: boolean;
}

export interface SendMoneyResult {
  sent: boolean;
  /** Solde restant de l'expéditeur, après débit. */
  balance: string | number;
  reference: string;
}

export interface BeneficiaryInput {
  name: string;
  relationship?: string;
  phone?: string;
  languagesSpoken?: string[];
  notes?: string;
}

function online<T>(result: T | { queued: true }): T {
  if (result && typeof result === 'object' && 'queued' in result) {
    throw new Error('Connexion réseau requise pour cette action');
  }
  return result as T;
}

export const beneficiariesApi = {
  list: () => get<Beneficiary[]>('/beneficiaries'),
  add: (body: BeneficiaryInput) => post<Beneficiary>('/beneficiaries', body).then(online),
  update: (id: string, body: BeneficiaryInput) => patch<Beneficiary>(`/beneficiaries/${id}`, body).then(online),
  remove: (id: string) => del<{ id: string; deleted: boolean }>(`/beneficiaries/${id}`).then(online),
  // Envoi d'argent : `online` car un transfert ne doit PAS partir en file
  // hors-ligne — le solde serait débité plus tard, sans que l'utilisateur
  // sache si l'envoi a eu lieu.
  send: (id: string, amount: number) => post<SendMoneyResult>(`/beneficiaries/${id}/send`, { amount }).then(online),
};
