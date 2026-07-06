// ─────────────────────────────────────────────────────────────
// Resolver des intégrations tierces (CLAUDE.md §3.6). Ordre de résolution :
//   1) base (secrets CHIFFRÉS) — cache Redis du blob ENCORE CHIFFRÉ + invalidation
//      à l'update (jamais de secret en clair dans Redis) ;
//   2) fallback `.env` tant qu'aucune ligne n'existe pour le provider.
// Les secrets déchiffrés ne circulent qu'EN PROCESS (services métier) — ils ne
// sont JAMAIS renvoyés au client (l'admin ne voit qu'un statut masqué).
// Les secrets d'INFRA (DB/Redis/JWT/HEALTH_ENCRYPTION_KEY/RECONCILE_TOKEN) ne
// passent JAMAIS par ce mécanisme (dépendance circulaire — §3.6).
// ─────────────────────────────────────────────────────────────
import { Prisma, type IntegrationProvider } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { openSecret, sealSecret } from './crypto.js';
import { env } from './env.js';

export type { IntegrationProvider };
export type Secrets = Record<string, string | undefined>;

/** Repli `.env` par provider (utilisé tant qu'aucune config n'est en base). */
const ENV_FALLBACK: Record<IntegrationProvider, () => Secrets> = {
  FEDAPAY: () => ({ secretKey: env.FEDAPAY_SECRET_KEY, publicKey: env.FEDAPAY_PUBLIC_KEY, webhookSecret: env.FEDAPAY_WEBHOOK_SECRET }),
  TWILIO: () => ({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, fromNumber: env.TWILIO_FROM_NUMBER }),
  DAILY: () => ({ apiKey: env.DAILY_API_KEY, domain: env.DAILY_DOMAIN }),
  FIREBASE: () => ({ projectId: env.FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY }),
  RESEND: () => ({ apiKey: env.RESEND_API_KEY, fromEmail: env.RESEND_FROM_EMAIL }),
};

const CACHE_TTL_SECONDS = 300;
const cacheKey = (p: IntegrationProvider) => `integration:${p}`;

export interface ResolvedIntegration {
  provider: IntegrationProvider;
  enabled: boolean;
  source: 'db' | 'env';
  secrets: Secrets;
  meta: Record<string, unknown> | null;
}

// Descripteur mis en cache : les secrets restent CHIFFRÉS (aucun clair en Redis).
interface CachedDescriptor {
  enabled: boolean;
  source: 'db' | 'env';
  secretsEnc: string | null; // null si source 'env' (résolue à la volée)
  meta: Record<string, unknown> | null;
}

async function loadDescriptor(app: FastifyInstance, provider: IntegrationProvider): Promise<CachedDescriptor> {
  const cached = await app.redis.get(cacheKey(provider));
  if (cached) return JSON.parse(cached) as CachedDescriptor;

  const row = await app.prisma.integrationConfig.findUnique({ where: { provider } });
  const desc: CachedDescriptor = row
    ? { enabled: row.enabled, source: 'db', secretsEnc: row.secretsEnc, meta: (row.meta as Record<string, unknown> | null) ?? null }
    : { enabled: false, source: 'env', secretsEnc: null, meta: null };
  await app.redis.set(cacheKey(provider), JSON.stringify(desc), 'EX', CACHE_TTL_SECONDS);
  return desc;
}

/** Résout la config d'un provider : base (déchiffrée) puis fallback `.env`. */
export async function getIntegration(app: FastifyInstance, provider: IntegrationProvider): Promise<ResolvedIntegration> {
  const desc = await loadDescriptor(app, provider);
  if (desc.source === 'db' && desc.secretsEnc) {
    return { provider, enabled: desc.enabled, source: 'db', secrets: openSecret(desc.secretsEnc) as Secrets, meta: desc.meta };
  }
  const secrets = ENV_FALLBACK[provider]();
  return { provider, enabled: Object.values(secrets).some(Boolean), source: 'env', secrets, meta: null };
}

/** Vrai si le provider est utilisable (activé + au moins un secret présent). */
export async function isConfigured(app: FastifyInstance, provider: IntegrationProvider): Promise<boolean> {
  const r = await getIntegration(app, provider);
  return r.enabled && Object.values(r.secrets).some(Boolean);
}

/** Invalide le cache Redis d'un provider (à appeler après toute écriture). */
export async function invalidateIntegration(app: FastifyInstance, provider: IntegrationProvider): Promise<void> {
  await app.redis.del(cacheKey(provider));
}

/**
 * Enregistre/rote les secrets d'un provider (CHIFFRÉS) puis invalide le cache.
 * Appelé par l'API admin (Lot B). Ne renvoie jamais les secrets.
 */
export async function setIntegration(
  app: FastifyInstance,
  provider: IntegrationProvider,
  input: { secrets: Secrets; meta?: Record<string, unknown> | null; enabled?: boolean; updatedById?: string },
): Promise<void> {
  const secretsEnc = sealSecret(input.secrets);
  const meta = input.meta == null ? undefined : (input.meta as Prisma.InputJsonValue);
  await app.prisma.integrationConfig.upsert({
    where: { provider },
    create: { provider, secretsEnc, meta, enabled: input.enabled ?? true, updatedById: input.updatedById },
    update: { secretsEnc, ...(meta === undefined ? {} : { meta }), ...(input.enabled === undefined ? {} : { enabled: input.enabled }), updatedById: input.updatedById },
  });
  await invalidateIntegration(app, provider);
}

/** Masque un jeu de secrets pour l'affichage admin : `••••` + 4 derniers caractères. */
export function maskSecrets(secrets: Secrets): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(secrets)) {
    out[k] = !v ? '—' : v.length <= 4 ? '••••' : `••••${v.slice(-4)}`;
  }
  return out;
}
