// Contrat L3 commun : ne différer QUE les mutations transactionnelles couvertes.
export const MUTATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MUTATION_RECEIPT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const MUTATION_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const REPLAYABLE_ROUTES = [
  { method: 'POST', path: /^\/chat\/threads\/[^/?#]+\/messages$/ },
  { method: 'POST', path: /^\/chat\/threads\/[^/?#]+\/read$/ },
  { method: 'POST', path: /^\/notifications\/[^/?#]+\/read$/ },
  { method: 'POST', path: /^\/vaccinations\/subjects$/ },
  { method: 'DELETE', path: /^\/vaccinations\/subjects\/[^/?#]+$/ },
  { method: 'POST', path: /^\/vaccinations\/[^/?#]+\/administered$/ },
  { method: 'POST', path: /^\/maternity$/ },
  { method: 'POST', path: /^\/maternity\/visits\/[^/?#]+\/done$/ },
] as const;

export function isReplayableMutation(method: string, path: string): boolean {
  return REPLAYABLE_ROUTES.some((r) => r.method === method && r.path.test(path));
}

/** La date fait partie de la clé : un reçu purgé ne réautorise pas un ancien acte. */
export function mutationKeyTime(key: string): number | null {
  const match = /^v1\.(\d{13})\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.exec(key);
  return match ? Number(match[1]) : null;
}
