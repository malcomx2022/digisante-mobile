// ─────────────────────────────────────────────────────────────
// Suggestion de générique (stub) — table minimale marque → DCI.
// À remplacer par une base médicament réelle (ANSM/DCI) ultérieurement.
// ─────────────────────────────────────────────────────────────
const BRAND_TO_DCI: Record<string, string> = {
  doliprane: 'Paracétamol',
  efferalgan: 'Paracétamol',
  advil: 'Ibuprofène',
  nurofen: 'Ibuprofène',
  augmentin: 'Amoxicilline + acide clavulanique',
  clamoxyl: 'Amoxicilline',
};

/** Renvoie la DCI suggérée pour une marque, ou null si déjà en DCI / inconnue. */
export function suggestGeneric(medicationName: string): string | null {
  return BRAND_TO_DCI[medicationName.trim().toLowerCase()] ?? null;
}
