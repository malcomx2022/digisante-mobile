// ─────────────────────────────────────────────────────────────
// API admin — gestion des intégrations tierces (CLAUDE.md §3.6, plan Lot B).
// Préfixe /api/v1/admin/integrations. Scope `integrations:read` (vue MASQUÉE) /
// `integrations:write` (saisie/rotation) — de fait SUPER_ADMIN (seul preset qui
// porte ces scopes). INVARIANTS :
//   • aucune réponse ne contient un secret déchiffré (toujours masqué) ;
//   • les écritures sont auditées SANS la valeur (noms de clés uniquement) ;
//   • FedaPay = zone gelée §5 → écritures/test REFUSÉS ici (bascule = Lot E encadré).
// ─────────────────────────────────────────────────────────────
import { paginationSchema, type AdminScope } from '@digisante/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { writeAudit } from '@/lib/audit.js';
import { badRequest } from '@/lib/errors.js';
import { paginate } from '@/lib/http.js';
import {
  describeAllIntegrations,
  describeIntegration,
  type IntegrationProvider,
  INTEGRATION_PROVIDERS,
  isFrozenProvider,
  PROVIDER_SECRET_KEYS,
  setIntegration,
  toggleIntegration,
  supportsWebhooks,
  testIntegration,
  validateSecretsShape,
} from '@/lib/integrations.js';
import { requireRole, requireScope } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';

// Actions d'audit rattachées à un provider (journal d'activité + webhooks entrants).
// WEBHOOK_RECEIVED/REJECTED : émis par les futurs récepteurs (Lot ultérieur) — le
// journal les affichera dès qu'ils existeront (rétro-compatible, aucun stub émis).
const WEBHOOK_JOURNAL_ACTIONS = ['INTEGRATION_UPDATE', 'INTEGRATION_TOGGLE', 'INTEGRATION_TEST', 'WEBHOOK_RECEIVED', 'WEBHOOK_REJECTED'] as const;

const providerParams = z.object({
  provider: z.enum([...INTEGRATION_PROVIDERS] as [IntegrationProvider, ...IntegrationProvider[]]),
});

// Écriture write-only : jeu de secrets (au moins un), meta non-secret, activation.
const putBody = z.object({
  secrets: z.record(z.string(), z.string().trim().min(1).max(8192)),
  meta: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

const patchBody = z.object({ enabled: z.boolean() });

export default async function adminIntegrationsRoutes(app: FastifyInstance) {
  const withScope = (...scopes: AdminScope[]) => ({
    preHandler: [app.authenticate, requireRole('ADMIN'), requireScope(...scopes)],
  });

  // Liste MASQUÉE de tous les providers (statut, 4 derniers car., meta, dernier test).
  app.get('/integrations', withScope('integrations:read'), async () => {
    return { items: await describeAllIntegrations(app) };
  });

  // Détail MASQUÉ d'un provider.
  app.get('/integrations/:provider', withScope('integrations:read'), async (request) => {
    const { provider } = zParse(providerParams, request.params);
    return describeIntegration(app, provider);
  });

  // Enregistre / ROTE les clés (write-only). Audit INTEGRATION_UPDATE SANS valeur.
  app.put('/integrations/:provider', withScope('integrations:write'), async (request) => {
    const { provider } = zParse(providerParams, request.params);
    // Garde-fou générique (FROZEN_PROVIDERS est vide depuis le Lot E : FedaPay géré ici).
    if (isFrozenProvider(provider)) throw badRequest(`Le provider ${provider} n'est pas modifiable via l'admin`);
    const body = zParse(putBody, request.body);

    // Refuse toute clé inconnue pour le provider (surface d'attaque minimale).
    const allowed = PROVIDER_SECRET_KEYS[provider] as readonly string[];
    const unknown = Object.keys(body.secrets).filter((k) => !allowed.includes(k));
    if (unknown.length) throw badRequest(`Clés inconnues pour ${provider} : ${unknown.join(', ')} (attendues : ${allowed.join(', ')})`);

    // Forme des secrets (copier-coller erroné) — messages SANS la valeur saisie.
    const shapeErrors = validateSecretsShape(provider, body.secrets);
    if (shapeErrors.length) throw badRequest(`Configuration ${provider} invalide : ${shapeErrors.join(' ; ')}`);

    // `meta.webhookUrl` (non-secret) : si fourni, doit être une URL HTTPS valide.
    const webhookUrl = body.meta?.webhookUrl;
    if (webhookUrl !== undefined && webhookUrl !== null && webhookUrl !== '') {
      const ok = typeof webhookUrl === 'string' && /^https:\/\/.+/.test(webhookUrl) && URL.canParse(webhookUrl);
      if (!ok) throw badRequest('meta.webhookUrl doit être une URL HTTPS valide');
    }

    // Écriture + relecture (I2) + audit dans UNE transaction (R1) : une écriture non
    // retrouvée telle quelle échoue (500) et n'est pas conservée. Audit : noms de
    // clés uniquement, JAMAIS les valeurs.
    await setIntegration(app, provider, {
      secrets: body.secrets,
      meta: body.meta ?? null,
      enabled: body.enabled,
      updatedById: request.user.sub,
    }, {
      action: 'INTEGRATION_UPDATE',
      actorId: request.user.sub,
      ip: request.ip,
      meta: { provider, keys: Object.keys(body.secrets).sort(), enabled: body.enabled ?? true },
    });
    return describeIntegration(app, provider);
  });

  // Active / désactive sans effacer les clés. Audit INTEGRATION_TOGGLE.
  app.patch('/integrations/:provider', withScope('integrations:write'), async (request) => {
    const { provider } = zParse(providerParams, request.params);
    if (isFrozenProvider(provider)) throw badRequest(`Le provider ${provider} n'est pas modifiable via l'admin`);
    const { enabled } = zParse(patchBody, request.body);
    // Mise à jour + audit dans UNE transaction (R1) : jamais d'activation sans trace.
    const updated = await toggleIntegration(app, provider, enabled, request.user.sub, {
      action: 'INTEGRATION_TOGGLE',
      actorId: request.user.sub,
      ip: request.ip,
      meta: { provider, enabled },
    });
    if (!updated) throw badRequest('Aucune configuration en base pour ce provider (enregistrez d’abord des clés)');
    return describeIntegration(app, provider);
  });

  // Test de complétude (readiness) — n'expose ni n'appelle aucun secret.
  app.post('/integrations/:provider/test', withScope('integrations:write'), async (request) => {
    const { provider } = zParse(providerParams, request.params);
    if (isFrozenProvider(provider)) throw badRequest(`Le provider ${provider} n'est pas testable via l'admin`);
    const result = await testIntegration(app, provider);
    await writeAudit(app.prisma, {
      action: 'INTEGRATION_TEST',
      actorId: request.user.sub,
      ip: request.ip,
      meta: { provider, ok: result.ok, missing: result.missing },
    });
    return result;
  });

  // ── Webhooks (Lot D) — providers NON gelés (Twilio/Daily/Resend) ──
  // Journal d'activité + webhooks ENTRANTS d'un provider, DÉRIVÉ de l'audit immuable
  // (aucune table dédiée). Aujourd'hui : évènements de config (INTEGRATION_*) ; les
  // évènements de réception (WEBHOOK_RECEIVED/REJECTED) apparaîtront quand les
  // récepteurs seront branchés. FedaPay est exclu (§5) : son journal reste sous
  // /admin/finance/webhooks. La ROTATION du secret webhook se fait via `PUT`
  // (clé `webhookSecret`, émise par le provider) — jamais générée/renvoyée (§3.6 ②).
  app.get('/integrations/:provider/webhooks', withScope('integrations:read'), async (request) => {
    const { provider } = zParse(providerParams, request.params);
    if (!supportsWebhooks(provider)) {
      throw badRequest(
        provider === 'FEDAPAY'
          ? 'FedaPay : journal des webhooks sous /admin/finance/webhooks (§5)'
          : `${provider} n’expose pas de webhooks entrants gérés ici`,
      );
    }
    const q = zParse(paginationSchema, request.query);
    const where: Prisma.AuditLogWhereInput = {
      action: { in: [...WEBHOOK_JOURNAL_ACTIONS] },
      meta: { path: ['provider'], equals: provider },
    };
    const [rows, total] = await Promise.all([
      app.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { id: true, action: true, ip: true, meta: true, createdAt: true },
      }),
      app.prisma.auditLog.count({ where }),
    ]);
    const items = rows.map((r) => ({
      id: r.id,
      action: r.action,
      kind: r.action.startsWith('WEBHOOK_') ? ('webhook' as const) : ('config' as const),
      ip: r.ip,
      // meta ne contient jamais de secret (audit émis avec des noms de clés seulement).
      meta: (r.meta ?? null) as Record<string, unknown> | null,
      createdAt: r.createdAt,
    }));
    return paginate(items, total, q.page, q.pageSize);
  });
}
