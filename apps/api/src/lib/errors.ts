// ─────────────────────────────────────────────────────────────
// Erreurs applicatives normalisées (CLAUDE.md §6 : { code, message }).
// Les services/contrôleurs lèvent une AppError ; le gestionnaire global
// (plugins/error-handler) la transforme en réponse HTTP cohérente.
// ─────────────────────────────────────────────────────────────

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: string, message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

// ── Fabriques d'erreurs courantes ──
export const badRequest = (message = 'Requête invalide', details?: unknown) =>
  new AppError('BAD_REQUEST', message, 400, details);

export const unauthorized = (message = 'Authentification requise') =>
  new AppError('UNAUTHORIZED', message, 401);

export const forbidden = (message = 'Accès refusé') => new AppError('FORBIDDEN', message, 403);

export const notFound = (message = 'Ressource introuvable') => new AppError('NOT_FOUND', message, 404);

export const conflict = (message = 'Conflit', details?: unknown) =>
  new AppError('CONFLICT', message, 409, details);

export const validationError = (details?: unknown, message = 'Données invalides') =>
  new AppError('VALIDATION_ERROR', message, 422, details);

export const tooManyRequests = (message = 'Trop de requêtes') =>
  new AppError('TOO_MANY_REQUESTS', message, 429);

export const internal = (message = 'Erreur interne du serveur') =>
  new AppError('INTERNAL_ERROR', message, 500);

/** Échec d'un service externe en amont (ex. prestataire de paiement). */
export const badGateway = (message = 'Service externe indisponible') =>
  new AppError('BAD_GATEWAY', message, 502);
