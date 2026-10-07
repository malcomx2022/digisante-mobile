// Vérification d'un reçu existant : aucun nouvel effet métier ni contenu clinique.
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { forbidden, notFound } from '@/lib/errors.js';
import { inspectReceipt } from '@/lib/idempotency.js';
import { mutationPatient, mutationSubject, mutationVaccination, mutationVisit } from '@/lib/mutation-access.js';
import { authorizeThread } from '@/modules/chat/chat.service.js';

export function verifyMutationReceipt(app: FastifyInstance, request: FastifyRequest, scope: { key: string; method?: string; route?: string }) {
  return inspectReceipt(app, request, scope, async (tx, receipt) => {
      const { route, resourceId } = receipt;
      const userId = request.user.sub;
      const parts = route.split('/');
      if (parts[1] === 'notifications') {
        if (!await tx.notification.findFirst({ where: { id: parts[2], recipientId: userId }, select: { id: true } })) throw notFound('Notification introuvable');
      } else if (parts[1] === 'chat') {
        if (!['PATIENT', 'MEDECIN'].includes(request.user.role)) throw forbidden('Rôle courant non autorisé');
        await authorizeThread(app, request.user, parts[3], tx);
      } else {
        if (request.user.role !== 'PATIENT') throw forbidden('Profil patient requis');
        const patientId = await mutationPatient(tx, userId);
        if (route === '/vaccinations/subjects') {
          if (!resourceId) throw notFound('Sujet introuvable');
          await mutationSubject(tx, userId, resourceId, false);
        } else if (parts[1] === 'vaccinations' && parts[2] === 'subjects') {
          // Suppression déjà committée : reçu de CE compte, aucun contenu clinique.
        } else if (parts[1] === 'vaccinations') await mutationVaccination(tx, userId, parts[2]);
        else if (route === '/maternity') {
          if (!resourceId || !await tx.pregnancy.findFirst({ where: { id: resourceId, patientId }, select: { id: true } })) throw notFound('Grossesse introuvable');
        } else await mutationVisit(tx, userId, parts[3]);
      }
    });
}
