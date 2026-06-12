// ─────────────────────────────────────────────────────────────
// Routes Traductions (préfixe /api/v1/translations) — gouvernance i18n.
// Persistance des chaînes d'UI = côté frontend (P5.2) ; ici on expose la
// cartographie des namespaces et la règle de double validation (clés critiques).
// ─────────────────────────────────────────────────────────────
import { CRITICAL_NAMESPACES, LANGUAGE_LIST, NAMESPACES } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { zParse } from '@/lib/validation.js';
import { isTranslationApproved, requiredValidations } from './translations.rules.js';

const validateSchema = z.object({
  namespace: z.string().min(1),
  validators: z.array(z.string()).default([]),
});

export default async function translationsRoutes(app: FastifyInstance) {
  const authed = { preHandler: [app.authenticate] };

  // Cartographie i18n : namespaces, critiques, langues.
  app.get('/namespaces', authed, async () => ({
    namespaces: NAMESPACES,
    critical: CRITICAL_NAMESPACES,
    languages: LANGUAGE_LIST,
  }));

  // Vérifie qu'un jeu de validations satisfait la règle (double validation si critique).
  app.post('/validate', authed, async (request) => {
    const { namespace, validators } = zParse(validateSchema, request.body);
    return {
      namespace,
      required: requiredValidations(namespace),
      approved: isTranslationApproved(namespace, validators),
    };
  });
}
