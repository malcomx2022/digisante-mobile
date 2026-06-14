// ─────────────────────────────────────────────────────────────
// Contrôle du N° d'Ordre des médecins (ONMB — Ordre National des Médecins du
// Bénin, « CNOM »).
//
// ⚠️ Aucune API publique de vérification n'existe (investigué, juin 2026) :
// l'ONMB (ordremedecinsbenin.bj) a numérisé ses services (espace membre
// monespace.ordremedecinsbenin.bj, inscription/cotisation en ligne) mais
// n'expose NI annuaire public NI endpoint de vérification. Le contrôle effectif
// repose donc sur deux niveaux, par conception (et non en attendant une API) :
//   1) heuristique de FORMAT ici (pré-contrôle) ;
//   2) REVUE MANUELLE des pièces par l'admin dans le workflow KYC (diplôme,
//      autorisation d'exercice, carte d'Ordre).
// Évolution possible : convention avec l'ONMB (cf. partenariat DomiCares) pour
// un accès dédié — démarche organisationnelle, pas un chantier de code.
//
// NB : le motif BJ-XXX-##### ci-dessous est une hypothèse de format à CONFIRMER
// auprès de l'ONMB (le format réel n'a pas pu être vérifié publiquement).
// (Ne jamais référencer l'ancien domaine ordremedecinsbenin.org — compromis.)
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

/**
 * Pré-contrôle du N° d'Ordre par heuristique de format. La vérification réelle
 * de l'inscription au tableau de l'Ordre est faite par la REVUE MANUELLE des
 * pièces (workflow KYC) — il n'existe pas d'API ONMB/CNOM publique à interroger.
 */
export async function verifyOrderNumber(licenseNumber: string): Promise<CnomResult> {
  return {
    verified: isPlausibleLicense(licenseNumber),
    source: 'FORMAT_HEURISTIC',
    checkedAt: new Date().toISOString(),
  };
}
