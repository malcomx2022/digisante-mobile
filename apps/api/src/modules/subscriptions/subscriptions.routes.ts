// ─────────────────────────────────────────────────────────────
// Routes Abonnements professionnels (préfixe /api/v1/subscriptions).
// Un médecin souscrit un plan (FREE/STARTER/PRO/CLINIC). Le paiement éventuel
// passe par /payments (type SUBSCRIPTION).
// ─────────────────────────────────────────────────────────────
import { SUBSCRIPTION_PLANS } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { forbidden } from '@/lib/errors.js';
import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';

const subscribeSchema = z.object({ plan: z.enum(SUBSCRIPTION_PLANS) });

export default async function subscriptionsRoutes(app: FastifyInstance) {
  const doctorOnly = { preHandler: [app.authenticate, requireRole('MEDECIN')] };

  // Plan courant.
  app.get('/me', doctorOnly, async (request) => {
    const doctor = await app.prisma.doctor.findUnique({
      where: { userId: request.user.sub },
      select: { subscriptionPlan: true, subscriptionStatus: true },
    });
    if (!doctor) throw forbidden('Profil médecin requis');
    return doctor;
  });

  // Souscription / changement de plan.
  app.post('/', doctorOnly, async (request) => {
    const { plan } = zParse(subscribeSchema, request.body);
    const doctor = await app.prisma.doctor.findUnique({ where: { userId: request.user.sub }, select: { id: true } });
    if (!doctor) throw forbidden('Profil médecin requis');
    return app.prisma.doctor.update({
      where: { id: doctor.id },
      data: { subscriptionPlan: plan, subscriptionStatus: 'ACTIVE' },
      select: { subscriptionPlan: true, subscriptionStatus: true },
    });
  });
}
