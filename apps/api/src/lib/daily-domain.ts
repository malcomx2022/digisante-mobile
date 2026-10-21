/**
 * Sous-domaine Daily normalisé (`digisante` ou `digisante.daily.co` → `digisante`),
 * ou `null` si la valeur n'en est pas un (URL `https://…`, chemin, espace…).
 * Règle UNIQUE, partagée par la saisie admin (`validateSecretsShape`) et le service
 * Daily : une valeur acceptée à l'enregistrement est une valeur utilisable.
 */
export function normalizeDailyDomain(raw: string): string | null {
  const domain = raw.replace(/\.daily\.co$/i, '').toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(domain) ? domain : null;
}
