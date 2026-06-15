// ─────────────────────────────────────────────────────────────
// Routes Pharmacie (préfixe /api/v1/pharmacy). RBAC : PHARMACIE.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import * as pharmacy from './pharmacy.service.js';

const scanSchema = z.object({ qrCode: z.string().min(16) });
const idParams = z.object({ id: z.string().cuid() });
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
}
