// ─────────────────────────────────────────────────────────────
// Santé maternelle — calendrier des consultations prénatales (CPN) + helpers PURS.
// À partir de la date des dernières règles (LMP) : terme = LMP + 280 j ; les 8
// contacts CPN (modèle OMS 2016) sont placés à des âges gestationnels fixes.
// Offline-first (embarqué). ⚠️ Calendrier à FAIRE VALIDER par un professionnel
// de santé / le programme national avant usage clinique réel (isolé ici pour ça).
// ─────────────────────────────────────────────────────────────
import { addDays } from './pev.js';

/** Durée d'une grossesse à terme (jours depuis la LMP). */
export const TERM_DAYS = 280; // 40 semaines

/** Un contact CPN : n° d'ordre + âge gestationnel cible (en semaines). */
export interface AncContact {
  contactNumber: number;
  weeks: number;
}

/** Modèle OMS 2016 : 8 contacts (12, 20, 26, 30, 34, 36, 38, 40 SA). */
export const ANC_SCHEDULE: AncContact[] = [
  { contactNumber: 1, weeks: 12 },
  { contactNumber: 2, weeks: 20 },
  { contactNumber: 3, weeks: 26 },
  { contactNumber: 4, weeks: 30 },
  { contactNumber: 5, weeks: 34 },
  { contactNumber: 6, weeks: 36 },
  { contactNumber: 7, weeks: 38 },
  { contactNumber: 8, weeks: 40 },
];

/** Terme prévu (date d'accouchement estimée) = LMP + 280 jours (PUR). */
export function computeDueDate(lmpDate: Date): Date {
  return addDays(lmpDate, TERM_DAYS);
}

export interface GeneratedAncVisit {
  contactNumber: number;
  dueDate: Date;
}

/** Génère les échéances CPN d'une grossesse depuis la LMP (PUR). */
export function buildAntenatalSchedule(lmpDate: Date): GeneratedAncVisit[] {
  return ANC_SCHEDULE.map((c) => ({ contactNumber: c.contactNumber, dueDate: addDays(lmpDate, c.weeks * 7) }));
}

/** Âge gestationnel en semaines révolues à une date donnée (PUR ; borné 0..42). */
export function gestationalWeeks(lmpDate: Date, now: Date): number {
  const days = Math.floor((now.getTime() - lmpDate.getTime()) / 86_400_000);
  const weeks = Math.floor(days / 7);
  return Math.max(0, Math.min(42, weeks));
}
