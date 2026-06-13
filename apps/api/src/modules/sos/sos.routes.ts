// ─────────────────────────────────────────────────────────────
// Routes SOS (préfixe /api/v1/sos). Alerte d'urgence géolocalisée du patient.
// Le repli SMS hors-ligne est géré côté frontend (CLAUDE.md §3).
// ─────────────────────────────────────────────────────────────
import { geoPointSchema } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';

import { forbidden } from '@/lib/errors.js';
import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import { triggerSos } from './sos.service.js';

export default async function sosRoutes(app: FastifyInstance) {
  const patient = { preHandler: [app.authenticate, requireRole('PATIENT')] };

  async function patientId(userId: string): Promise<string> {
    const p = await app.prisma.patient.findUnique({ where: { userId }, select: { id: true } });
    if (!p) throw forbidden('Profil patient requis');
    return p.id;
  }

  // Déclenche une alerte SOS géolocalisée (en ligne).
  app.post('/', patient, async (request, reply) => {
    const { latitude, longitude } = zParse(geoPointSchema, request.body);
    // La logique (création + alerte SMS/notification/audit) vit dans le service.
    const alert = await triggerSos(app, {
      patientId: await patientId(request.user.sub),
      latitude,
      longitude,
    });
    return reply.code(201).send(alert);
  });

  // Mes alertes SOS.
  app.get('/', patient, async (request) => {
    return app.prisma.sos.findMany({
      where: { patientId: await patientId(request.user.sub) },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  });
}
