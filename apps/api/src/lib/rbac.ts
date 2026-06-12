// ─────────────────────────────────────────────────────────────
// RBAC — contrôle d'accès par rôle, réutilisable par tous les modules.
// À utiliser APRÈS app.authenticate (qui peuple request.user) :
//   { preHandler: [app.authenticate, requireRole('MEDECIN', 'ADMIN')] }
// ─────────────────────────────────────────────────────────────
import type { Role } from '@digisante/shared';
import type { preHandlerHookHandler } from 'fastify';

import { forbidden } from './errors.js';

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
