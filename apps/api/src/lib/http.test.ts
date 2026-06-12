import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { badRequest, forbidden, validationError } from './errors.js';
import { mapError, paginate } from './http.js';

describe('mapError', () => {
  it('mappe une AppError sur son code/statut', () => {
    const { statusCode, body } = mapError(forbidden('Pas de consentement'));
    expect(statusCode).toBe(403);
    expect(body).toEqual({ code: 'FORBIDDEN', message: 'Pas de consentement' });
  });

  it('inclut les détails quand présents', () => {
    const { statusCode, body } = mapError(validationError({ champ: 'requis' }));
    expect(statusCode).toBe(422);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details).toEqual({ champ: 'requis' });
  });

  it('mappe une ZodError sur 422 VALIDATION_ERROR', () => {
    const result = z.object({ age: z.number() }).safeParse({ age: 'x' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const { statusCode, body } = mapError(result.error);
      expect(statusCode).toBe(422);
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.details).toBeDefined();
    }
  });

  it('mappe une erreur de validation Fastify (4xx)', () => {
    const { statusCode, body } = mapError({ statusCode: 400, validation: [{ message: 'bad' }], message: 'invalide' });
    expect(statusCode).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('ne divulgue pas le détail des erreurs 500', () => {
    const { statusCode, body } = mapError(new Error('stack secrète'));
    expect(statusCode).toBe(500);
    expect(body).toEqual({ code: 'INTERNAL_ERROR', message: 'Erreur interne du serveur' });
  });

  it('respecte le statut 400 des fabriques', () => {
    expect(mapError(badRequest()).statusCode).toBe(400);
  });
});

describe('paginate', () => {
  it('calcule le nombre de pages', () => {
    expect(paginate([1, 2], 25, 1, 10)).toEqual({
      data: [1, 2],
      total: 25,
      page: 1,
      pageSize: 10,
      totalPages: 3,
    });
  });

  it('renvoie au minimum 1 page même vide', () => {
    expect(paginate([], 0, 1, 20).totalPages).toBe(1);
  });
});
