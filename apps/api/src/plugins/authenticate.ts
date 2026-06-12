// ─────────────────────────────────────────────────────────────
// Décorateur app.authenticate : preHandler vérifiant le JWT d'accès.
// Typage du payload JWT partagé. Le RBAC par rôle est ajouté en P2.3.
// ─────────────────────────────────────────────────────────────
import type { Role } from '@digisante/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { unauthorized } from '@/lib/errors.js';

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
  });
});
