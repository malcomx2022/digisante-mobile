// ─────────────────────────────────────────────────────────────
// Routes Paiements (préfixe /api/v1/payments). ⚠️ GELÉ une fois validé (§5).
// Le webhook capture le corps BRUT (rawBody) pour la vérification HMAC.
// ─────────────────────────────────────────────────────────────
import { PAYMENT_METHODS, PAYMENT_TYPES } from '@digisante/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { env } from '@/lib/env.js';
import { unauthorized } from '@/lib/errors.js';
import { zParse } from '@/lib/validation.js';
import * as payments from './payments.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const initiateSchema = z.object({
  type: z.enum(PAYMENT_TYPES),
  method: z.enum(PAYMENT_METHODS),
  // Montant optionnel : pour une CONSULTATION il est IGNORÉ et imposé côté serveur
  // (tarif du médecin du RDV, §5). Requis pour les autres types (ex. recharge wallet).
  amount: z.number().int().positive().optional(),
  appointmentId: z.string().cuid().optional(),
});

export default async function paymentsRoutes(app: FastifyInstance) {
  // Parser encapsulé : conserve le corps brut pour le HMAC du webhook.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as FastifyRequest).rawBody = typeof body === 'string' ? body : body.toString('utf8');
    try {
      done(null, body && (body as string).length ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error);
    }
  });

  // Initiation d'un paiement (utilisateur authentifié).
  app.post('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const input = zParse(initiateSchema, request.body);
    const result = await payments.initiate(app, request.user.sub, input);
    return reply.code(201).send(result);
  });

  // Webhook FedaPay (PUBLIC — sécurisé par HMAC, pas de JWT).
  app.post('/webhook', async (request) => {
    const signature = request.headers['x-fedapay-signature'];
    return payments.handleWebhook(
      app,
      request.rawBody ?? '',
      typeof signature === 'string' ? signature : undefined,
      env.FEDAPAY_WEBHOOK_SECRET,
      request.ip,
    );
  });

  // Réconciliation (cron interne) — protégée par jeton de service.
  app.post('/reconcile', async (request) => {
    const token = request.headers['x-service-token'];
    if (!env.RECONCILE_TOKEN || token !== env.RECONCILE_TOKEN) {
      throw unauthorized('Jeton de service invalide');
    }
    return payments.reconcile(app);
  });
}
