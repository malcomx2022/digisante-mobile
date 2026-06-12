// ─────────────────────────────────────────────────────────────
// Contre-vérification du N° d'Ordre (CNOM — Conseil National de l'Ordre des
// Médecins). STUB : l'intégration externe réelle sera branchée ultérieurement.
// Pour l'instant, heuristique de format (BJ-XXX-#####) en attendant l'API CNOM.
// ─────────────────────────────────────────────────────────────

/** Décision pure : le numéro a-t-il un format plausible d'Ordre béninois ? */
export function isPlausibleLicense(licenseNumber: string): boolean {
  return /^BJ-[A-Z]{3}-\d{3,}$/.test(licenseNumber.trim());
}

export interface CnomResult {
  verified: boolean;
  source: string;
  checkedAt: string;
}

/** Vérifie un numéro d'Ordre auprès du CNOM (stub). */
export async function verifyOrderNumber(licenseNumber: string): Promise<CnomResult> {
  // TODO : appel réel à l'API CNOM. En attendant, validation de format.
  return {
    verified: isPlausibleLicense(licenseNumber),
    source: 'CNOM_STUB',
    checkedAt: new Date().toISOString(),
  };
}
