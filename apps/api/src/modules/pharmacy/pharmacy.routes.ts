// ─────────────────────────────────────────────────────────────
// Routes Pharmacie (préfixe /api/v1/pharmacy). RBAC : PHARMACIE.
// ─────────────────────────────────────────────────────────────
import { STOCK_STATUSES } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import * as pharmacy from './pharmacy.service.js';
import * as stock from './pharmacy.stock.js';

const scanSchema = z.object({ qrCode: z.string().min(16) });
const idParams = z.object({ id: z.string().cuid() });

const stockSchema = z.object({
  displayName: z.string().trim().min(1).max(160),
  status: z.enum(STOCK_STATUSES).optional(),
  price: z.number().int().min(0).max(10_000_000).nullable().optional(),
});
const availabilityQuery = z.object({
  q: z.string().trim().min(2).max(160),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});
const dispenseSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().cuid(),
        status: z.enum(['DISPENSED', 'PARTIALLY_DISPENSED', 'UNAVAILABLE']),
      }),
    )
    .min(1),
});

export default async function pharmacyRoutes(app: FastifyInstance) {
  const pharmacist = { preHandler: [app.authenticate, requireRole('PHARMACIE')] };

  app.post('/scan', pharmacist, async (request) => {
    const { qrCode } = zParse(scanSchema, request.body);
    return pharmacy.scan(app, qrCode);
  });

  app.post('/prescriptions/:id/dispense', pharmacist, async (request) => {
    const { id } = zParse(idParams, request.params);
    const { items } = zParse(dispenseSchema, request.body);
    const pharmacyId = await pharmacy.pharmacyIdOf(app, request.user.sub);
    return pharmacy.dispense(app, pharmacyId, id, items);
  });

  // Journal des délivrances de la pharmacie courante (historique privacy-safe).
  app.get('/dispensations', pharmacist, async (request) => {
    const pharmacyId = await pharmacy.pharmacyIdOf(app, request.user.sub);
    return pharmacy.listDispensations(app, pharmacyId);
  });

  // ── Stock / disponibilité des médicaments ──
  // Gestion du stock (pharmacie propriétaire uniquement).
  app.get('/stock', pharmacist, async (request) => {
    const pharmacyId = await pharmacy.pharmacyIdOf(app, request.user.sub);
    return stock.listStock(app, pharmacyId);
  });

  app.post('/stock', pharmacist, async (request, reply) => {
    const input = zParse(stockSchema, request.body);
    const pharmacyId = await pharmacy.pharmacyIdOf(app, request.user.sub);
    return reply.code(201).send(await stock.upsertStock(app, pharmacyId, input));
  });

  app.delete('/stock/:id', pharmacist, async (request) => {
    const { id } = zParse(idParams, request.params);
    const pharmacyId = await pharmacy.pharmacyIdOf(app, request.user.sub);
    return stock.removeStock(app, pharmacyId, id);
  });

  // Recherche « médicament près de moi » (tout utilisateur authentifié).
  app.get('/availability', { preHandler: [app.authenticate] }, async (request) => {
    const q = zParse(availabilityQuery, request.query);
    return stock.searchAvailability(app, q);
  });
}
