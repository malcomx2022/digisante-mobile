// ─────────────────────────────────────────────────────────────
// Calendrier vaccinal PEV Bénin (Programme Élargi de Vaccination) + helpers PURS
// pour générer les échéances d'un sujet et calculer le statut d'affichage.
// Données de référence embarquées (offline-first) ; les libellés de vaccins sont
// traduits côté client via `vaccine.<key>` (FR/EN ; FON/YOR en repli FR — les
// pictogrammes / dates portent le sens indépendamment de la langue).
// ⚠️ À faire valider par un professionnel de santé avant usage clinique réel.
// ─────────────────────────────────────────────────────────────

/** Une dose du calendrier PEV. `ageOffsetDays` = délai depuis la naissance. */
export interface PevDose {
  /** Code unique de la dose (BCG, PENTA1, VPO0…). */
  code: string;
  /** Clé i18n du vaccin (`vaccine.<vaccineKey>`). */
  vaccineKey: string;
  /** Libellé de dose affiché (« 0 », « 1 », « rappel »… ; vide si dose unique). */
  doseLabel: string;
  /** Âge cible en jours depuis la naissance. */
  ageOffsetDays: number;
}

const WEEK = 7;
const MONTH = 30;

/**
 * Calendrier PEV Bénin (naissance → 15 mois). Source : schéma PEV usuel
 * (BCG/VPO/HepB à la naissance ; Penta/Pneumo/Rota à 6-10-14 sem ; VPI à 14 sem ;
 * RR + fièvre jaune à 9 mois ; RR2 à 15 mois). Ordonné par âge croissant.
 */
export const PEV_SCHEDULE: PevDose[] = [
  // Naissance
  { code: 'BCG', vaccineKey: 'BCG', doseLabel: '', ageOffsetDays: 0 },
  { code: 'VPO0', vaccineKey: 'POLIO_ORAL', doseLabel: '0', ageOffsetDays: 0 },
  { code: 'HEPB0', vaccineKey: 'HEPB', doseLabel: '0', ageOffsetDays: 0 },
  // 6 semaines
  { code: 'PENTA1', vaccineKey: 'PENTA', doseLabel: '1', ageOffsetDays: 6 * WEEK },
  { code: 'VPO1', vaccineKey: 'POLIO_ORAL', doseLabel: '1', ageOffsetDays: 6 * WEEK },
  { code: 'PCV1', vaccineKey: 'PNEUMO', doseLabel: '1', ageOffsetDays: 6 * WEEK },
  { code: 'ROTA1', vaccineKey: 'ROTA', doseLabel: '1', ageOffsetDays: 6 * WEEK },
  // 10 semaines
  { code: 'PENTA2', vaccineKey: 'PENTA', doseLabel: '2', ageOffsetDays: 10 * WEEK },
  { code: 'VPO2', vaccineKey: 'POLIO_ORAL', doseLabel: '2', ageOffsetDays: 10 * WEEK },
  { code: 'PCV2', vaccineKey: 'PNEUMO', doseLabel: '2', ageOffsetDays: 10 * WEEK },
  { code: 'ROTA2', vaccineKey: 'ROTA', doseLabel: '2', ageOffsetDays: 10 * WEEK },
  // 14 semaines
  { code: 'PENTA3', vaccineKey: 'PENTA', doseLabel: '3', ageOffsetDays: 14 * WEEK },
  { code: 'VPO3', vaccineKey: 'POLIO_ORAL', doseLabel: '3', ageOffsetDays: 14 * WEEK },
  { code: 'PCV3', vaccineKey: 'PNEUMO', doseLabel: '3', ageOffsetDays: 14 * WEEK },
  { code: 'VPI', vaccineKey: 'POLIO_INJ', doseLabel: '', ageOffsetDays: 14 * WEEK },
  // 9 mois
  { code: 'RR1', vaccineKey: 'ROUGEOLE_RUBEOLE', doseLabel: '1', ageOffsetDays: 9 * MONTH },
  { code: 'VAA', vaccineKey: 'FIEVRE_JAUNE', doseLabel: '', ageOffsetDays: 9 * MONTH },
  // 15 mois
  { code: 'RR2', vaccineKey: 'ROUGEOLE_RUBEOLE', doseLabel: '2', ageOffsetDays: 15 * MONTH },
];

/** Map code → dose (recherche du libellé de vaccin à l'affichage). */
export const PEV_BY_CODE: Record<string, PevDose> = Object.fromEntries(PEV_SCHEDULE.map((d) => [d.code, d]));

/** Ajoute `days` jours à une date (nouvelle instance, minuit non forcé). */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export interface GeneratedDose {
  vaccineCode: string;
  vaccineKey: string;
  doseLabel: string;
  dueDate: Date;
}

/** Génère les échéances d'un sujet à partir de sa date de naissance (PUR). */
export function buildVaccinationSchedule(birthDate: Date): GeneratedDose[] {
  return PEV_SCHEDULE.map((dose) => ({
    vaccineCode: dose.code,
    vaccineKey: dose.vaccineKey,
    doseLabel: dose.doseLabel,
    dueDate: addDays(birthDate, dose.ageOffsetDays),
  }));
}

export type VaccinationDisplayStatus = 'DONE' | 'OVERDUE' | 'DUE_SOON' | 'UPCOMING';

/** Fenêtre « bientôt dû » (jours avant l'échéance). */
export const DUE_SOON_DAYS = 7;

/**
 * Statut d'affichage d'une vaccination (PUR). DONE si administrée ; sinon selon
 * l'échéance vs `now` : OVERDUE (dépassée), DUE_SOON (≤ 7 j), UPCOMING (au-delà).
 */
export function vaccinationDisplayStatus(
  v: { status: 'SCHEDULED' | 'DONE'; dueDate: Date },
  now: Date,
): VaccinationDisplayStatus {
  if (v.status === 'DONE') return 'DONE';
  const soon = addDays(now, DUE_SOON_DAYS);
  if (v.dueDate < now) return 'OVERDUE';
  if (v.dueDate <= soon) return 'DUE_SOON';
  return 'UPCOMING';
}
