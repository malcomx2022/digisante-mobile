// ─────────────────────────────────────────────────────────────
// Règles pures des prescriptions (testables) : détection de conflits d'allergies.
// ─────────────────────────────────────────────────────────────

/** Renvoie les médicaments en conflit avec les allergies connues du patient. */
export function findAllergyConflicts(
  items: { medicationName: string }[],
  allergies: string[],
): string[] {
  const known = allergies.map((a) => a.trim().toLowerCase()).filter(Boolean);
  const conflicts = new Set<string>();
  for (const item of items) {
    const med = item.medicationName.trim().toLowerCase();
    if (known.some((a) => med.includes(a) || a.includes(med))) {
      conflicts.add(item.medicationName);
    }
  }
  return [...conflicts];
}
