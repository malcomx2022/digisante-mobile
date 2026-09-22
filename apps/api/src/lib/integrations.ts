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

/** Liste ordonnée des providers gérables (source unique pour l'API/UI admin). */
export const INTEGRATION_PROVIDERS = ['FEDAPAY', 'TWILIO', 'DAILY', 'FIREBASE', 'RESEND'] as const satisfies readonly IntegrationProvider[];

/**
 * Clés de secret acceptées par provider (validation write-only de l'API admin).
 * `webhookSecret` = secret de signature des webhooks ENTRANTS (émis par le provider ;
 * la rotation se fait chez le provider PUIS via `PUT` ici — jamais généré/renvoyé,
 * invariant §3.6 ②). Firebase FCM est sortant-seul → pas de `webhookSecret`.
 */
export const PROVIDER_SECRET_KEYS = {
  FEDAPAY: ['secretKey', 'publicKey', 'webhookSecret'],
  TWILIO: ['accountSid', 'authToken', 'fromNumber', 'webhookSecret'],
  DAILY: ['apiKey', 'domain', 'webhookSecret'],
  FIREBASE: ['projectId', 'clientEmail', 'privateKey'],
  RESEND: ['apiKey', 'fromEmail', 'webhookSecret'],
} satisfies Record<IntegrationProvider, readonly string[]>;

/**
 * Providers dont on gère les webhooks ENTRANTS depuis l'admin (URL + secret + journal).
 * FedaPay en est exclu (zone gelée §5 → Lot E) ; Firebase aussi (push sortant, aucun
 * webhook entrant). Les récepteurs/vérification de signature de ces providers ne sont
 * pas encore branchés — Lot D fournit la SURFACE DE GESTION (config + journal d'activité).
 */
export const WEBHOOK_PROVIDERS = ['TWILIO', 'DAILY', 'RESEND'] as const satisfies readonly IntegrationProvider[];
export function supportsWebhooks(p: IntegrationProvider): boolean {
  return (WEBHOOK_PROVIDERS as readonly IntegrationProvider[]).includes(p);
}

/**
 * Clés OBLIGATOIRES pour qu'un provider soit « prêt » (test de complétude ET
 * bascule stub→réel des services). Aligné sur les anciens `isXxxConfigured`.
 */
export const REQUIRED_SECRET_KEYS = {
  FEDAPAY: ['secretKey', 'publicKey'],
  TWILIO: ['accountSid', 'authToken', 'fromNumber'],
  DAILY: ['apiKey', 'domain'],
  FIREBASE: ['projectId', 'clientEmail', 'privateKey'],
  RESEND: ['apiKey'],
} satisfies Record<IntegrationProvider, readonly string[]>;

/**
 * Providers dont l'API admin refuse les écritures (`PUT`/`PATCH`/`test`).
 * VIDE depuis le Lot E : FedaPay est désormais gérable via l'admin (clés + secret
 * webhook résolus par le resolver). ⚠️ Sa LOGIQUE de paiement reste gelée §5 —
 * seule la SOURCE des secrets a changé (re-tests webhooks HMAC/idempotence effectués).
 * Le mécanisme est conservé pour un éventuel gel futur d'un autre provider.
 */
export const FROZEN_PROVIDERS = [] as const satisfies readonly IntegrationProvider[];
export function isFrozenProvider(p: IntegrationProvider): boolean {
  return (FROZEN_PROVIDERS as readonly IntegrationProvider[]).includes(p);
}

export interface ResolvedIntegration {
  provider: IntegrationProvider;
  enabled: boolean;
  source: 'db' | 'env';
  secrets: Secrets;
  meta: Record<string, unknown> | null;
  /** Ligne en base illisible (blob altéré, clé changée, ou clair alors que le chiffrement est actif). */
  unreadable?: boolean;
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
    try {
      return { provider, enabled: desc.enabled, source: 'db', secrets: openSecret(desc.secretsEnc) as Secrets, meta: desc.meta };
    } catch {
      // Ligne illisible : le provider est traité comme NON configuré (services en stub)
      // plutôt que de lever une 500 à chaque appel, et SANS repli `.env` — la base
      // prime (§3.6 ③) ; retomber sur l'env masquerait l'anomalie. L'admin la voit
      // (`unreadable`) et ressaisit les clés. Aucun contenu du blob n'est journalisé.
      app.log.warn({ provider }, 'Configuration d’intégration illisible — ressaisie requise');
      return { provider, enabled: false, source: 'db', secrets: {}, meta: desc.meta, unreadable: true };
    }
  }
  const secrets = ENV_FALLBACK[provider]();
  return { provider, enabled: Object.values(secrets).some(Boolean), source: 'env', secrets, meta: null };
}

/** Vrai si le provider est utilisable (activé + au moins un secret présent). */
export async function isConfigured(app: FastifyInstance, provider: IntegrationProvider): Promise<boolean> {
  const r = await getIntegration(app, provider);
  return r.enabled && Object.values(r.secrets).some(Boolean);
}

/**
 * Résout les secrets d'un provider SI il est PLEINEMENT configuré (activé + toutes
 * les clés obligatoires présentes) ; sinon `null` → le service bascule en stub.
 * Remplace les booléens statiques `isXxxConfigured` par une résolution DYNAMIQUE
 * (base déchiffrée puis `.env`). Réservé aux services NON gelés (§5 : pas FedaPay).
 */
export async function resolveConfiguredSecrets(app: FastifyInstance, provider: IntegrationProvider): Promise<Secrets | null> {
  const r = await getIntegration(app, provider);
  if (!r.enabled) return null;
  const complete = REQUIRED_SECRET_KEYS[provider].every((k) => r.secrets[k]);
  return complete ? r.secrets : null;
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

/**
 * Contrôles de FORME des secrets saisis (erreurs de copier-coller les plus probables),
 * avant tout enregistrement. Renvoie des messages SANS la valeur. Volontairement
 * limité aux providers dont un format erroné échoue en silence plus tard :
 * Firebase (signature JWT impossible au 1er push). FedaPay n'est pas concerné (§5).
 */
export function validateSecretsShape(provider: IntegrationProvider, secrets: Secrets): string[] {
  const errors: string[] = [];
  if (provider === 'FIREBASE') {
    const { clientEmail, privateKey, projectId } = secrets;
    if (clientEmail !== undefined && !/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(clientEmail)) {
      errors.push('clientEmail : adresse de compte de service attendue (…@<projet>.iam.gserviceaccount.com)');
    }
    if (privateKey !== undefined && !/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(privateKey.replace(/\\n/g, '\n'))) {
      errors.push('privateKey : clé PEM attendue (-----BEGIN PRIVATE KEY----- … -----END PRIVATE KEY-----), \\n littéraux acceptés');
    }
    if (projectId !== undefined && !/^[a-z][a-z0-9-]{4,29}$/.test(projectId)) {
      errors.push('projectId : identifiant de projet Firebase attendu (minuscules, chiffres, tirets)');
    }
  }
  return errors;
}

/** Masque un jeu de secrets pour l'affichage admin : `••••` + 4 derniers caractères. */
export function maskSecrets(secrets: Secrets): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(secrets)) {
    out[k] = !v ? '—' : v.length <= 4 ? '••••' : `••••${v.slice(-4)}`;
  }
  return out;
}

/** Vue SÛRE d'une intégration pour le client admin (secrets MASQUÉS, jamais en clair). */
export interface IntegrationView {
  provider: IntegrationProvider;
  configured: boolean;
  enabled: boolean;
  source: 'db' | 'env';
  frozen: boolean; // §5 : géré séparément (FedaPay)
  unreadable: boolean; // ligne en base indéchiffrable → ressaisie requise
  secrets: Record<string, string>; // masqués (`••••1234` / `—`)
  meta: Record<string, unknown> | null;
  lastTestAt: Date | null;
  lastTestOk: boolean | null;
  updatedAt: Date | null;
  updatedById: string | null;
}

/** Construit la vue masquée d'un provider (aucun secret déchiffré ne sort). */
export async function describeIntegration(app: FastifyInstance, provider: IntegrationProvider): Promise<IntegrationView> {
  const resolved = await getIntegration(app, provider);
  const row = await app.prisma.integrationConfig.findUnique({
    where: { provider },
    select: { lastTestAt: true, lastTestOk: true, updatedAt: true, updatedById: true },
  });
  return {
    provider,
    configured: resolved.enabled && Object.values(resolved.secrets).some(Boolean),
    enabled: resolved.enabled,
    source: resolved.source,
    frozen: isFrozenProvider(provider),
    unreadable: resolved.unreadable ?? false,
    secrets: maskSecrets(resolved.secrets),
    meta: resolved.meta,
    lastTestAt: row?.lastTestAt ?? null,
    lastTestOk: row?.lastTestOk ?? null,
    updatedAt: row?.updatedAt ?? null,
    updatedById: row?.updatedById ?? null,
  };
}

/** Vue masquée de TOUS les providers (page admin). */
export async function describeAllIntegrations(app: FastifyInstance): Promise<IntegrationView[]> {
  return Promise.all(INTEGRATION_PROVIDERS.map((p) => describeIntegration(app, p)));
}

export interface ReadinessResult {
  ok: boolean;
  missing: string[]; // clés obligatoires absentes (jamais de valeur)
}

/**
 * Test de complétude (« readiness ») d'un provider : les clés OBLIGATOIRES sont-elles
 * toutes résolues (base ou `.env`) ? N'expose ni n'appelle aucun secret. Les sondes
 * réseau réelles arrivent avec la bascule des services (Lot C).
 */
export async function testIntegration(app: FastifyInstance, provider: IntegrationProvider): Promise<ReadinessResult> {
  const resolved = await getIntegration(app, provider);
  const missing = REQUIRED_SECRET_KEYS[provider].filter((k) => !resolved.secrets[k]);
  const ok = missing.length === 0;
  // Persiste le résultat UNIQUEMENT si une ligne DB existe (ne pas matérialiser
  // une config à partir du `.env` — les secrets d'env ne doivent pas entrer en base).
  await app.prisma.integrationConfig
    .update({ where: { provider }, data: { lastTestAt: new Date(), lastTestOk: ok } })
    .catch(() => undefined); // pas de ligne (source env) → on ne persiste rien
  return { ok, missing };
}
