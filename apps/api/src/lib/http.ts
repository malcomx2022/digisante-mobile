// ─────────────────────────────────────────────────────────────
// Mapping d'erreur → réponse HTTP + helpers de réponse cohérents.
// `mapError` est PUR (testable sans Fastify) : il est appelé par le
// gestionnaire d'erreurs global. Convention de réponse :
//   - succès    : la ressource/donnée est renvoyée directement (idiomatique) ;
//                 les listes utilisent l'enveloppe Paginated<T> (helper `paginate`).
//   - erreur    : toujours { code, message, details? } (CLAUDE.md §6).
// ─────────────────────────────────────────────────────────────
import type { ApiError, Paginated } from '@digisante/shared';
import { ZodError } from 'zod';

import { isAppError } from './errors.js';

export interface MappedError {
  statusCode: number;
  body: ApiError;
}

/** Transforme n'importe quelle erreur en couple { statusCode, body normalisé }. */
export function mapError(err: unknown): MappedError {
  if (isAppError(err)) {
    return {
      statusCode: err.statusCode,
      body: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    };
  }

  if (err instanceof ZodError) {
    return {
      statusCode: 422,
      body: { code: 'VALIDATION_ERROR', message: 'Données invalides', details: err.flatten() },
    };
  }

  const e = err as { statusCode?: number; code?: string; message?: string; validation?: unknown };

  // Erreurs de validation natives Fastify (JSON schema).
  if (e?.validation) {
    return {
      statusCode: typeof e.statusCode === 'number' ? e.statusCode : 400,
      body: { code: 'VALIDATION_ERROR', message: e.message ?? 'Requête invalide', details: e.validation },
    };
  }

  // Autres erreurs client connues (4xx) — ex. JWT, rate-limit.
  if (typeof e?.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500) {
    return {
      statusCode: e.statusCode,
      body: { code: e.code ?? 'CLIENT_ERROR', message: e.message ?? 'Erreur de requête' },
    };
  }

  // Fallback : ne jamais divulguer le détail interne au client.
  return { statusCode: 500, body: { code: 'INTERNAL_ERROR', message: 'Erreur interne du serveur' } };
}

/** Construit une enveloppe de liste paginée standard. */
export function paginate<T>(data: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
