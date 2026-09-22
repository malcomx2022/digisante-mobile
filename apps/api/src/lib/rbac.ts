// ─────────────────────────────────────────────────────────────
// RBAC — contrôle d'accès par rôle, réutilisable par tous les modules.
// À utiliser APRÈS app.authenticate (qui peuple request.user) :
//   { preHandler: [app.authenticate, requireRole('MEDECIN', 'ADMIN')] }
// ─────────────────────────────────────────────────────────────
import { type AdminScope, hasScope, type Role } from '@digisante/shared';
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';

import { forbidden } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Scopes admin résolus (mémoïsés par requête au 1er `requireScope`). */
    adminScopes?: readonly string[];
    adminSuspended?: boolean;
  }
}

/** Décision pure : le rôle fait-il partie des rôles autorisés ? (testable) */
export function isRoleAllowed(role: Role | undefined, allowed: readonly Role[]): boolean {
  return role !== undefined && allowed.includes(role);
}

/** Fabrique de preHandler exigeant l'un des rôles donnés (sinon 403 FORBIDDEN). */
export function requireRole(...allowed: Role[]): preHandlerHookHandler {
  return async (request) => {
    if (!isRoleAllowed(request.user?.role, allowed)) {
      throw forbidden('Rôle non autorisé pour cette ressource');
    }
  };
}

/** Charge (et mémoïse) les scopes du profil admin de l'appelant. */
export async function loadAdminScopes(request: FastifyRequest): Promise<{ scopes: readonly string[]; suspended: boolean }> {
  if (request.adminScopes === undefined) {
    const profile = request.user?.sub
      ? await request.server.prisma.adminProfile.findUnique({
          where: { userId: request.user.sub },
          select: { scopes: true, suspendedAt: true },
        })
      : null;
    request.adminScopes = profile?.scopes ?? [];
    request.adminSuspended = Boolean(profile?.suspendedAt);
  }
  return { scopes: request.adminScopes, suspended: request.adminSuspended ?? false };
}

/**
 * preHandler exigeant TOUS les scopes admin donnés (sinon 403). À composer
 * APRÈS `requireRole('ADMIN')`. Un profil suspendu est refusé en bloc.
 */
export function requireScope(...needed: AdminScope[]): preHandlerHookHandler {
  return async (request) => {
    const { scopes, suspended } = await loadAdminScopes(request);
    if (suspended) throw forbidden('Compte administrateur suspendu');
    if (!needed.every((s) => hasScope(scopes, s))) {
      throw forbidden('Permission administrateur insuffisante');
    }
  };
}

/**
 * preHandler pour les routes admin SANS scope dédié (ex. tableau de bord) : exige
 * un profil admin ACTIF portant au moins un scope. Sans lui, un admin suspendu ou
 * sans profil lisait les agrégats de la plateforme (« admin sans profil = aucun droit »).
 */
export function requireActiveAdminProfile(): preHandlerHookHandler {
  return async (request) => {
    const { scopes, suspended } = await loadAdminScopes(request);
    if (suspended) throw forbidden('Compte administrateur suspendu');
    if (scopes.length === 0) throw forbidden('Aucun droit administrateur');
  };
}
