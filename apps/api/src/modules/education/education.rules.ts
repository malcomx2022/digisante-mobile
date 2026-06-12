// ─────────────────────────────────────────────────────────────
// Workflow éditorial des contenus de santé (pur, testable).
// DRAFT → MEDICAL_REVIEW → TRANSLATION → PUBLISHED (avec retours possibles).
// ─────────────────────────────────────────────────────────────
export const CONTENT_STATUSES = ['DRAFT', 'MEDICAL_REVIEW', 'TRANSLATION', 'PUBLISHED'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

const FLOW: Record<ContentStatus, ContentStatus[]> = {
  DRAFT: ['MEDICAL_REVIEW'],
  MEDICAL_REVIEW: ['TRANSLATION', 'DRAFT'], // approuvé → traduction ; rejeté → brouillon
  TRANSLATION: ['PUBLISHED', 'MEDICAL_REVIEW'],
  PUBLISHED: [],
};

/** Transition autorisée dans le workflow éditorial ? */
export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return FLOW[from]?.includes(to) ?? false;
}
