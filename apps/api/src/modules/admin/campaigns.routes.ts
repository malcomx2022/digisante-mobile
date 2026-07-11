// ─────────────────────────────────────────────────────────────
// Routes Diffusion / veille sanitaire (préfixe /api/v1/admin/campaigns).
// RBAC : ADMIN + scope `campaigns:write`. Broadcast ciblé (rôle/langue) réutilisant
// le pipeline Notification. NON médical (santé publique) — jamais de contenu DMP (§4).
// ─────────────────────────────────────────────────────────────
import { CONTENT_CATEGORIES, LANGS, ROLES } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireRole, requireScope } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import * as campaigns from './campaigns.service.js';

const idParams = z.object({ id: z.string().cuid() });

const textSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
});

// FR obligatoire (source de vérité) ; les autres langues sont facultatives.
const translationsSchema = z
  .object({
    FR: textSchema,
    EN: textSchema.optional(),
    FON: textSchema.optional(),
    YOR: textSchema.optional(),
  })
  .strict();

const campaignSchema = z.object({
  category: z.enum(CONTENT_CATEGORIES),
  translations: translationsSchema,
  audienceRole: z.enum(ROLES).nullish(),
  audienceLang: z.enum(LANGS).nullish(),
  channel: z.enum(['IN_APP', 'SMS_TWILIO', 'PUSH_FCM']).default('IN_APP'),
});

const previewQuery = z.object({
  audienceRole: z.enum(ROLES).optional(),
  audienceLang: z.enum(LANGS).optional(),
});

export default async function adminCampaignsRoutes(app: FastifyInstance) {
  const withScope = {
    preHandler: [app.authenticate, requireRole('ADMIN'), requireScope('campaigns:write')],
  };

  app.get('/campaigns', withScope, async () => campaigns.listCampaigns(app));

  // Aperçu de la portée (nombre de destinataires) avant diffusion.
  app.get('/campaigns/audience', withScope, async (request) => {
    const q = zParse(previewQuery, request.query);
    return campaigns.previewAudience(app, q.audienceRole ?? null, q.audienceLang ?? null);
  });

  app.get('/campaigns/:id', withScope, async (request) => {
    const { id } = zParse(idParams, request.params);
    return campaigns.getCampaign(app, id);
  });

  app.post('/campaigns', withScope, async (request, reply) => {
    const input = zParse(campaignSchema, request.body);
    return reply.code(201).send(await campaigns.createCampaign(app, request.user.sub, input));
  });

  app.put('/campaigns/:id', withScope, async (request) => {
    const { id } = zParse(idParams, request.params);
    const input = zParse(campaignSchema, request.body);
    return campaigns.updateCampaign(app, id, input);
  });

  app.delete('/campaigns/:id', withScope, async (request) => {
    const { id } = zParse(idParams, request.params);
    return campaigns.deleteCampaign(app, id);
  });

  // Diffusion (fan-out des Notification, campagne figée en SENT).
  app.post('/campaigns/:id/send', withScope, async (request) => {
    const { id } = zParse(idParams, request.params);
    return campaigns.sendCampaign(app, id, { id: request.user.sub, ip: request.ip });
  });
}
