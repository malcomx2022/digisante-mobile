// ─────────────────────────────────────────────────────────────
// Routes DMP (préfixe /api/v1/dmp). Accès consenti (P2.3) + audit.
// Les soignants présentent un jeton de partage via l'en-tête x-share-token.
// ─────────────────────────────────────────────────────────────
import { MEDICAL_RECORD_TYPES, SHARE_TYPES } from '@digisante/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { UPLOAD_MIME_TYPES } from '@/lib/upload.js';
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

// Pièce jointe : contenu en base64, ≤ 5 Mo, images et PDF uniquement (le MIME
// déclaré est recoupé avec les magic bytes côté service).
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const documentSchema = z.object({
  mimeType: z.enum(UPLOAD_MIME_TYPES),
  filename: z.string().trim().min(1).max(120),
  // 5 Mo binaires ≈ 6,9 Mo en base64.
  dataBase64: z.string().min(1).max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 4),
});

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

  // ── Pièces jointes d'une entrée (compte-rendu scanné, radio, ordonnance papier) ──
  // Même contrôle d'accès que l'entrée porteuse (portée par-entrée §4).
  // bodyLimit relevé : 5 Mo binaires + surcoût base64 + enveloppe JSON.
  app.post('/records/:id/documents', { ...authed, bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    const { id } = zParse(idParams, request.params);
    const input = zParse(documentSchema, request.body);
    const doc = await dmp.addDocument(app, request.user, id, { ...input, maxBytes: MAX_FILE_BYTES, shareToken: shareToken(request) }, request.ip);
    return reply.code(201).send(doc);
  });

  // Téléchargement d'une pièce (déchiffrée à la volée). Jamais d'URL publique (§4).
  app.get('/documents/:id/file', authed, async (request, reply) => {
    const { id } = zParse(idParams, request.params);
    const { content, mimeType, filename } = await dmp.readDocumentFile(app, request.user, id, shareToken(request), request.ip);
    reply.header('Cache-Control', 'no-store');
    // Un PDF peut embarquer du contenu actif : téléchargement forcé, jamais de
    // rendu dans l'onglet (même règle que les pièces KYC).
    const disposition = mimeType === 'application/pdf' ? 'attachment' : 'inline';
    reply.header('Content-Disposition', `${disposition}; filename="${filename.replace(/[^\w.\- ]/g, '_')}"`);
    return reply.type(mimeType).send(content);
  });

  app.delete('/documents/:id', authed, async (request) => {
    const { id } = zParse(idParams, request.params);
    return dmp.removeDocument(app, request.user.sub, id, request.ip);
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

  // Le patient ré-autorise un soignant précédemment révoqué (action délibérée).
  app.post('/consents/:granteeId/regrant', authed, async (request) => {
    const { granteeId } = zParse(z.object({ granteeId: z.string().cuid() }), request.params);
    const { ttlHours } = zParse(z.object({ ttlHours: z.number().int().min(1).max(720).default(72) }), request.body ?? {});
    return dmp.regrantConsent(app, request.user.sub, granteeId, ttlHours, request.ip);
  });

  // Portabilité : export FHIR (Bundle JSON).
  app.get('/export', authed, async (request) => {
    const q = zParse(exportSchema, request.query);
    return dmp.exportFhir(app, request.user, q.patientId, request.ip);
  });
}
