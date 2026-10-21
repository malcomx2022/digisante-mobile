// ─────────────────────────────────────────────────────────────
// Message d'erreur à afficher après un appel API (recette L10, C7 — 20/10/2026).
//
// Le back-office finance remplaçait toute erreur par « Opération indisponible :
// vérifier la connexion, les droits… », y compris un 422 précis (référence de
// preuve au mauvais format). Règle : un refus MÉTIER (4xx structuré `{ code,
// message }`) est affiché tel que l'API le formule ; le message générique ne
// sert qu'au repli — réseau, 5xx, session (401) ou réponse non structurée.
// Les messages d'API ne portent jamais de donnée de santé (§4, `lib/errors`).
// ─────────────────────────────────────────────────────────────
import { ApiRequestError } from './client';

/** Premier champ fautif d'un `VALIDATION_ERROR` et son message (détail zod aplati). */
function firstInvalidField(details: unknown): [string, string] | null {
  const fieldErrors = (details as { fieldErrors?: unknown } | null | undefined)?.fieldErrors;
  if (!fieldErrors || typeof fieldErrors !== 'object') return null;
  for (const [field, messages] of Object.entries(fieldErrors as Record<string, unknown>)) {
    if (Array.isArray(messages) && typeof messages[0] === 'string') return [field, messages[0]];
  }
  return null;
}

/**
 * @param fallback message générique (réseau, 5xx, 401, réponse non structurée).
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiRequestError)) return fallback;
  if (error.status < 400 || error.status >= 500 || error.status === 401) return fallback;
  const { code, message, details } = error.error;
  // Réponse sans corps `{ code, message }` (proxy, page HTML) : rien de métier à montrer.
  if (code === 'HTTP_ERROR' || typeof message !== 'string' || !message.trim()) return fallback;
  if (code === 'VALIDATION_ERROR') {
    // « Données invalides » seul n'aide pas : nommer le champ et la règle enfreinte.
    const field = firstInvalidField(details);
    return field ? `${message} — ${field[0]} : ${field[1]}` : message;
  }
  return message;
}
