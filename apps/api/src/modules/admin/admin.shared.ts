// ─────────────────────────────────────────────────────────────
// Éléments partagés par les sous-modules de routes admin (préfixe /api/v1/admin).
// Le découpage est PUREMENT organisationnel : chemins, RBAC et audit inchangés
// (cf. admin.routes.ts qui agrège tout sous le même préfixe).
// ─────────────────────────────────────────────────────────────
import type { AdminScope } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireActiveAdminProfile, requireRole, requireScope } from '@/lib/rbac.js';

/** Paramètre d'URL `:id` (cuid) — partagé par les routes users/admins/support/finance. */
export const idParams = z.object({ id: z.string().cuid() });

/**
 * Gardes RBAC admin, dérivées de l'instance Fastify (préHandlers).
 * `admin` = ADMIN authentifié avec un profil actif (≥ 1 scope, non suspendu) ;
 * `withScope(...)` = ADMIN + scope(s) requis.
 */
export function adminGuards(app: FastifyInstance) {
  const admin = { preHandler: [app.authenticate, requireRole('ADMIN'), requireActiveAdminProfile()] };
  const withScope = (...scopes: AdminScope[]) => ({
    preHandler: [app.authenticate, requireRole('ADMIN'), requireScope(...scopes)],
  });
  return { admin, withScope };
}
