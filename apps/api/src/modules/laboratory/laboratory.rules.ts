// ─────────────────────────────────────────────────────────────
// Détection de VALEURS CRITIQUES (pure, testable). Une valeur critique
// déclenche une alerte prioritaire au prescripteur (LAB_CRITICAL).
// Seuils indicatifs — à affiner avec un référentiel biologique validé.
// ─────────────────────────────────────────────────────────────
export interface CriticalRange {
  min: number;
  max: number;
  unit: string;
}

export const CRITICAL_RANGES: Record<string, CriticalRange> = {
  glucose: { min: 0.5, max: 4, unit: 'g/L' },
  potassium: { min: 3.0, max: 6.0, unit: 'mmol/L' },
  sodium: { min: 120, max: 160, unit: 'mmol/L' },
  hemoglobin: { min: 7, max: 20, unit: 'g/dL' },
  spo2: { min: 90, max: 100, unit: '%' },
  creatinine: { min: 0, max: 30, unit: 'mg/L' },
};

export interface CriticalFinding {
  key: string;
  value: number;
  reason: 'LOW' | 'HIGH';
}

/** Renvoie les analyses hors plage critique parmi les valeurs numériques fournies. */
export function detectCriticalValues(values: Record<string, unknown>): CriticalFinding[] {
  const findings: CriticalFinding[] = [];
  for (const [key, range] of Object.entries(CRITICAL_RANGES)) {
    const raw = values[key];
    if (typeof raw !== 'number' || Number.isNaN(raw)) continue;
    if (raw < range.min) findings.push({ key, value: raw, reason: 'LOW' });
    else if (raw > range.max) findings.push({ key, value: raw, reason: 'HIGH' });
  }
  return findings;
}
