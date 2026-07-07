// ─────────────────────────────────────────────────────────────
// API admin — gestion des intégrations tierces (CLAUDE.md §3.6, plan Lot B).
// Préfixe /api/v1/admin/integrations. Scope `integrations:read` (vue MASQUÉE) /
// `integrations:write` (saisie/rotation) — de fait SUPER_ADMIN (seul preset qui
// porte ces scopes). INVARIANTS :
//   • aucune réponse ne contient un secret déchiffré (toujours masqué) ;
//   • les écritures sont auditées SANS la valeur (noms de clés uniquement) ;
//   • FedaPay = zone gelée §5 → écritures/test REFUSÉS ici (bascule = Lot E encadré).
// ─────────────────────────────────────────────────────────────
import { type AdminScope } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { writeAudit } from '@/lib/audit.js';
import { badRequest } from '@/lib/errors.js';
import {
  describeAllIntegrations,
  describeIntegration,
  type IntegrationProvider,
  INTEGRATION_PROVIDERS,
  invalidateIntegration,
  isFrozenProvider,
  PROVIDER_SECRET_KEYS,
  setIntegration,
  testIntegration,
} from '@/lib/integrations.js';
import { requireRole, requireScope } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';

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
    if (isFrozenProvider(provider)) {
      throw badRequest('FedaPay est en zone gelée (§5) — bascule réservée au Lot E encadré (revue + re-tests webhooks)');
    }
    const body = zParse(putBody, request.body);

    // Refuse toute clé inconnue pour le provider (surface d'attaque minimale).
    const allowed = PROVIDER_SECRET_KEYS[provider] as readonly string[];
    const unknown = Object.keys(body.secrets).filter((k) => !allowed.includes(k));
    if (unknown.length) throw badRequest(`Clés inconnues pour ${provider} : ${unknown.join(', ')} (attendues : ${allowed.join(', ')})`);

    await setIntegration(app, provider, {
      secrets: body.secrets,
      meta: body.meta ?? null,
      enabled: body.enabled,
      updatedById: request.user.sub,
    });
    // Audit : noms de clés uniquement, JAMAIS les valeurs.
    await writeAudit(app.prisma, {
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
    if (isFrozenProvider(provider)) throw badRequest('FedaPay est en zone gelée (§5) — géré séparément (Lot E)');
    const { enabled } = zParse(patchBody, request.body);
    const existing = await app.prisma.integrationConfig.findUnique({ where: { provider }, select: { id: true } });
    if (!existing) throw badRequest('Aucune configuration en base pour ce provider (enregistrez d’abord des clés)');
    await app.prisma.integrationConfig.update({ where: { provider }, data: { enabled, updatedById: request.user.sub } });
    await invalidateIntegration(app, provider);
    await writeAudit(app.prisma, {
      action: 'INTEGRATION_TOGGLE',
      actorId: request.user.sub,
      ip: request.ip,
      meta: { provider, enabled },
    });
    return describeIntegration(app, provider);
  });

  // Test de complétude (readiness) — n'expose ni n'appelle aucun secret.
  app.post('/integrations/:provider/test', withScope('integrations:write'), async (request) => {
    const { provider } = zParse(providerParams, request.params);
    if (isFrozenProvider(provider)) throw badRequest('FedaPay est en zone gelée (§5) — test via le chemin de paiement (Lot E)');
    const result = await testIntegration(app, provider);
    await writeAudit(app.prisma, {
      action: 'INTEGRATION_TEST',
      actorId: request.user.sub,
      ip: request.ip,
      meta: { provider, ok: result.ok, missing: result.missing },
    });
    return result;
  });
}
