// ─────────────────────────────────────────────────────────────
// Pipeline de validation zod — réutilise les schémas de @digisante/shared.
// Usage dans un handler : const body = zParse(verifyOtpSchema, request.body);
// Une erreur lève une AppError VALIDATION_ERROR (422) avec le détail aplati.
// ─────────────────────────────────────────────────────────────
import type { ZodSchema } from 'zod';

import { validationError } from './errors.js';

/** Valide `data` contre `schema` et renvoie la valeur typée, ou lève VALIDATION_ERROR. */
export function zParse<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw validationError(result.error.flatten());
  }
  return result.data;
}
