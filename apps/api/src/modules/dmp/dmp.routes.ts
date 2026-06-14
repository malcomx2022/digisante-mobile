// ─────────────────────────────────────────────────────────────
// Routes DMP (préfixe /api/v1/dmp). Accès consenti (P2.3) + audit.
// Les soignants présentent un jeton de partage via l'en-tête x-share-token.
// ─────────────────────────────────────────────────────────────
import { MEDICAL_RECORD_TYPES, SHARE_TYPES } from '@digisante/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { zParse } from '@/lib/validation.js';
import * as dmp from './dmp.service.js';

const createSchema = z.object({
  patientId: z.string().cuid().optional(),
  type: z.enum(MEDICAL_RECORD_TYPES),
  title: z.string().trim().min(1).max(200),
  data: z.unknown(),
});
const listSchema = z.object({ patientId: z.string().cuid().optional() });
const idParams = z.object({ id: z.string().cuid() });
const shareSchema = z.object({
  shareType: z.enum(SHARE_TYPES).default('QR_CODE'),
  ttlHours: z.number().int().min(1).max(720).default(72),
});
const exportSchema = z.object({ patientId: z.string().cuid().optional() });

/** Jeton de partage présenté par un soignant (en-tête dédié). */
const shareToken = (req: FastifyRequest): string | undefined => {
  const h = req.headers['x-share-token'];
  return typeof h === 'string' && h.length > 0 ? h : undefined;
};

export default async function dmpRoutes(app: FastifyInstance) {
  const authed = { preHandler: [app.authenticate] };

  app.post('/records', authed, async (request, reply) => {
    const input = zParse(createSchema, request.body);
    const rec = await dmp.createRecord(app, request.user, { ...input, shareToken: shareToken(request) }, request.ip);
    return reply.code(201).send(rec);
  });

  app.get('/records', authed, async (request) => {
    const q = zParse(listSchema, request.query);
    return dmp.listRecords(app, request.user, { patientId: q.patientId, shareToken: shareToken(request) }, request.ip);
  });

  app.get('/records/:id', authed, async (request) => {
    const { id } = zParse(idParams, request.params);
    return dmp.getRecord(app, request.user, id, shareToken(request), request.ip);
  });

  app.post('/records/:id/share', authed, async (request) => {
    const { id } = zParse(idParams, request.params);
    const input = zParse(shareSchema, request.body);
    return dmp.shareRecord(app, request.user.sub, id, input, request.ip);
  });

  app.delete('/records/:id/share', authed, async (request) => {
    const { id } = zParse(idParams, request.params);
    return dmp.revokeShare(app, request.user.sub, id);
  });

  // Consentement par soignant : le patient liste qui a accès à son dossier.
  app.get('/consents', authed, async (request) => {
    return dmp.listConsents(app, request.user.sub);
  });

  // Le patient révoque l'accès d'un soignant précis (révocation persistante).
  app.delete('/consents/:granteeId', authed, async (request) => {
    const { granteeId } = zParse(z.object({ granteeId: z.string().cuid() }), request.params);
    return dmp.revokeConsent(app, request.user.sub, granteeId, request.ip);
  });

  // Portabilité : export FHIR (Bundle JSON).
  app.get('/export', authed, async (request) => {
    const q = zParse(exportSchema, request.query);
    return dmp.exportFhir(app, request.user, q.patientId, request.ip);
  });
}
