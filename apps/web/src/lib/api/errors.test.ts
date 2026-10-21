import { describe, expect, it } from 'vitest';

import { ApiRequestError } from './client';
import { apiErrorMessage } from './errors';

const FALLBACK = 'Opération indisponible';

describe('apiErrorMessage (recette L10 C7)', () => {
  it('422 de validation : message de l’API, champ fautif et règle enfreinte, jamais le générique', () => {
    const error = new ApiRequestError(422, { code: 'VALIDATION_ERROR', message: 'Données invalides', details: { formErrors: [], fieldErrors: { proofRef: ['Référence de preuve : 6 à 120 caractères'] } } });
    expect(apiErrorMessage(error, FALLBACK)).toBe('Données invalides — proofRef : Référence de preuve : 6 à 120 caractères');
  });

  it('422 sans détail exploitable : message de l’API seul', () => {
    expect(apiErrorMessage(new ApiRequestError(422, { code: 'VALIDATION_ERROR', message: 'Données invalides' }), FALLBACK)).toBe('Données invalides');
  });

  it('refus métier 400/403/404/409 : message de l’API tel quel', () => {
    for (const status of [400, 403, 404, 409]) {
      const error = new ApiRequestError(status, { code: 'CONFLICT', message: 'Référence de preuve requise et unique' });
      expect(apiErrorMessage(error, FALLBACK)).toBe('Référence de preuve requise et unique');
    }
  });

  it('repli générique : réseau, 5xx, session expirée, réponse non structurée', () => {
    expect(apiErrorMessage(new TypeError('Failed to fetch'), FALLBACK)).toBe(FALLBACK);
    expect(apiErrorMessage(new ApiRequestError(500, { code: 'INTERNAL_ERROR', message: 'Erreur interne du serveur' }), FALLBACK)).toBe(FALLBACK);
    expect(apiErrorMessage(new ApiRequestError(502, { code: 'BAD_GATEWAY', message: 'Service externe indisponible' }), FALLBACK)).toBe(FALLBACK);
    expect(apiErrorMessage(new ApiRequestError(401, { code: 'UNAUTHORIZED', message: 'Session expirée' }), FALLBACK)).toBe(FALLBACK);
    expect(apiErrorMessage(new ApiRequestError(404, { code: 'HTTP_ERROR', message: 'Not Found' }), FALLBACK)).toBe(FALLBACK);
    expect(apiErrorMessage(new ApiRequestError(400, { code: 'BAD_REQUEST', message: '  ' }), FALLBACK)).toBe(FALLBACK);
  });
});
