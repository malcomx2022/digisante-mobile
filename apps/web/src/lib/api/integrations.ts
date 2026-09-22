// Admin : gestion des intégrations tierces (§3.6) — clés d'API + webhooks.
// Les secrets ne sont JAMAIS reçus en clair (affichage masqué `••••1234`).
import { get, patch, post, put } from './client';

export type IntegrationProvider = 'FEDAPAY' | 'TWILIO' | 'DAILY' | 'FIREBASE' | 'RESEND';

export interface IntegrationView {
  provider: IntegrationProvider;
  configured: boolean;
  enabled: boolean;
  source: 'db' | 'env';
  frozen: boolean;
  unreadable?: boolean; // ligne en base indéchiffrable → ressaisie requise
  secrets: Record<string, string>; // MASQUÉ (`••••1234` / `—`)
  meta: Record<string, unknown> | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  updatedAt: string | null;
  updatedById: string | null;
}

export interface WebhookJournalEntry {
  id: string;
  action: string;
  kind: 'config' | 'webhook';
  ip: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}
interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const integrationsApi = {
  list: () => get<{ items: IntegrationView[] }>('/admin/integrations'),
  detail: (p: IntegrationProvider) => get<IntegrationView>(`/admin/integrations/${p}`),
  save: (p: IntegrationProvider, body: { secrets: Record<string, string>; meta?: Record<string, unknown>; enabled?: boolean }) =>
    put<IntegrationView>(`/admin/integrations/${p}`, body),
  toggle: (p: IntegrationProvider, enabled: boolean) => patch<IntegrationView>(`/admin/integrations/${p}`, { enabled }),
  test: (p: IntegrationProvider) => post<{ ok: boolean; missing: string[] }>(`/admin/integrations/${p}/test`),
  webhooks: (p: IntegrationProvider, page = 1, pageSize = 20) =>
    get<Paginated<WebhookJournalEntry>>(`/admin/integrations/${p}/webhooks?page=${page}&pageSize=${pageSize}`),
};

// Métadonnées de FORMULAIRE (miroir de PROVIDER_SECRET_KEYS côté API) : quels champs
// saisir par provider. `required` = obligatoire pour l'état « configuré ». Les
// providers gelés (FedaPay §5) sont en LECTURE SEULE ici — pas de formulaire.
export interface ProviderMeta {
  fields: { key: string; required: boolean }[];
  supportsWebhooks: boolean;
  frozen: boolean;
}
export const PROVIDER_META: Record<IntegrationProvider, ProviderMeta> = {
  FEDAPAY: {
    fields: [
      { key: 'secretKey', required: true },
      { key: 'publicKey', required: true },
      { key: 'webhookSecret', required: false },
    ],
    supportsWebhooks: false, // journal des webhooks sous /admin/finance/webhooks (§5)
    frozen: false, // Lot E : clés gérables via l'admin (logique paiement §5 inchangée)
  },
  TWILIO: {
    fields: [
      { key: 'accountSid', required: true },
      { key: 'authToken', required: true },
      { key: 'fromNumber', required: true },
      { key: 'webhookSecret', required: false },
    ],
    supportsWebhooks: true,
    frozen: false,
  },
  DAILY: {
    fields: [
      { key: 'apiKey', required: true },
      { key: 'domain', required: true },
      { key: 'webhookSecret', required: false },
    ],
    supportsWebhooks: true,
    frozen: false,
  },
  FIREBASE: {
    fields: [
      { key: 'projectId', required: true },
      { key: 'clientEmail', required: true },
      { key: 'privateKey', required: true },
    ],
    supportsWebhooks: false, // push sortant — pas de webhook entrant
    frozen: false,
  },
  RESEND: {
    fields: [
      { key: 'apiKey', required: true },
      { key: 'fromEmail', required: false },
      { key: 'webhookSecret', required: false },
    ],
    supportsWebhooks: true,
    frozen: false,
  },
};

export const PROVIDER_ORDER: IntegrationProvider[] = ['TWILIO', 'DAILY', 'FIREBASE', 'RESEND', 'FEDAPAY'];
