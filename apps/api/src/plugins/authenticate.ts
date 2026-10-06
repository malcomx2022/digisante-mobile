// ─────────────────────────────────────────────────────────────
// Décorateur app.authenticate : preHandler vérifiant le JWT d'accès.
// Typage du payload JWT partagé. Le RBAC par rôle est ajouté en P2.3.
// ─────────────────────────────────────────────────────────────
import type { Role } from '@digisante/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { unauthorized } from '@/lib/errors.js';

/** Statut et rôle courants : un JWT signé avant une suspension ne suffit plus. */
export async function currentAccessUser(app: FastifyInstance, userId: string) {
  if (!userId) throw unauthorized("Un token d'accès est requis");
  const user = await app.prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  });
  if (!user || user.status === 'SUSPENDED') {
    throw unauthorized('Session révoquée. Contactez le support.');
  }
  return user;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: Role; typ?: string; jti?: string };
    user: { sub: string; role: Role; typ?: string; jti?: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async (app: FastifyInstance) => {
  app.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      throw unauthorized('Authentification requise (token manquant, invalide ou expiré)');
    }
    // Un refresh token ne doit pas servir à accéder aux ressources protégées.
    if (request.user.typ === 'refresh') {
      throw unauthorized("Un token d'accès est requis");
    }
    const user = await currentAccessUser(app, request.user.sub);
    request.user.role = user.role;
  });
});
