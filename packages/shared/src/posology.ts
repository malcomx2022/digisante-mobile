// ─────────────────────────────────────────────────────────────
// Analyse de posologie — transforme la posologie en TEXTE LIBRE d'une ligne
// d'ordonnance (`dosage` / `frequency` / `duration`) en tokens STRUCTURÉS, pour
// un rendu en PICTOGRAMMES indépendants de la langue (accès faible-littératie /
// barrière linguistique FON·YOR, CLAUDE.md §1/§5). Fonction PURE et testable ;
// reconnaît les tournures FR (primaire) et EN. Ne devine JAMAIS : renvoie `null`
// / `[]` quand une dimension n'est pas reconnue (le texte original reste la
// source de vérité affichée à côté des pictogrammes).
// ─────────────────────────────────────────────────────────────

export type PosologyTiming = 'MORNING' | 'NOON' | 'EVENING' | 'NIGHT';
export type PosologyForm =
  | 'TABLET'
  | 'CAPSULE'
  | 'SYRUP'
  | 'DROPS'
  | 'INJECTION'
  | 'SACHET'
  | 'INHALER'
  | 'CREAM'
  | 'SUPPOSITORY';
export type PosologyMeal = 'BEFORE' | 'AFTER' | 'FASTING';

export interface ParsedPosology {
  /** Moments de prise, ordonnés matin→nuit, dédupliqués ; `[]` si inconnu. */
  timings: PosologyTiming[];
  /** Nombre de prises par jour (explicite ou dérivé des moments) ; `null` si inconnu. */
  timesPerDay: number | null;
  /** Quantité par prise (ex. 2 comprimés) ; `null` si inconnu. */
  doseCount: number | null;
  /** Forme galénique ; `null` si inconnue. */
  form: PosologyForm | null;
  /** Relation au repas ; `null` si non précisé. */
  meal: PosologyMeal | null;
  /** Durée du traitement en jours ; `null` si inconnu. */
  days: number | null;
  /** Vrai si AU MOINS une dimension exploitable a été reconnue. */
  recognized: boolean;
}

/** Minuscule + suppression des accents (robustesse de correspondance). */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, one: 1,
  deux: 2, two: 2,
  trois: 3, three: 3,
  quatre: 4, four: 4,
  cinq: 5, five: 5,
  six: 6,
};

/** Premier entier trouvé (chiffres ou mots), ou null. */
function findNumber(text: string): number | null {
  const digit = text.match(/\d+/);
  if (digit) return parseInt(digit[0], 10);
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  }
  return null;
}

const TIMING_ORDER: PosologyTiming[] = ['MORNING', 'NOON', 'EVENING', 'NIGHT'];

// Distribution par défaut quand seul le nombre de prises/jour est connu.
const DEFAULT_TIMINGS: Record<number, PosologyTiming[]> = {
  1: ['MORNING'],
  2: ['MORNING', 'EVENING'],
  3: ['MORNING', 'NOON', 'EVENING'],
  4: ['MORNING', 'NOON', 'EVENING', 'NIGHT'],
};

function detectTimings(text: string): PosologyTiming[] {
  const set = new Set<PosologyTiming>();
  if (/\bmatin|\bmorning|\bmatinee/.test(text)) set.add('MORNING');
  if (/\bmidi|\bnoon|\bmidday|\bmiddi/.test(text)) set.add('NOON');
  if (/\bsoir|\bevening|\bsoiree/.test(text)) set.add('EVENING');
  if (/\bnuit|\bnight|\bcoucher|\bbedtime/.test(text)) set.add('NIGHT');
  return TIMING_ORDER.filter((t) => set.has(t));
}

function detectTimesPerDay(text: string): number | null {
  // « 3 fois par jour », « 3 fois/jour », « 3x/j », « 3 times a day », « twice a day ».
  if (/\b(deux fois|twice)\b/.test(text)) return 2;
  const m = text.match(/(\d+|un|une|deux|trois|quatre|cinq|six|one|two|three|four|five)\s*(fois|x|times)\b/);
  if (m) return findNumber(m[1]);
  return null;
}

function detectForm(text: string): PosologyForm | null {
  if (/comprim|\bcp\b|tablet/.test(text)) return 'TABLET';
  if (/gelule|capsule/.test(text)) return 'CAPSULE';
  if (/sirop|syrup|cuiller|cuillere|solution buvable|\bml\b|spoon/.test(text)) return 'SYRUP';
  if (/goutte|drop/.test(text)) return 'DROPS';
  if (/injection|ampoule|piqure|\bim\b|\biv\b|sous-cutan|subcut|syringe/.test(text)) return 'INJECTION';
  if (/sachet|poudre|powder/.test(text)) return 'SACHET';
  if (/inhal|bouffee|spray|puff/.test(text)) return 'INHALER';
  if (/pommade|creme|\bgel\b|cream|ointment/.test(text)) return 'CREAM';
  if (/suppositoire|suppository/.test(text)) return 'SUPPOSITORY';
  return null;
}

function detectMeal(text: string): PosologyMeal | null {
  if (/a jeun|empty stomach|fasting/.test(text)) return 'FASTING';
  if (/avant (le )?(repas|manger)|before (the )?(meal|food|eating)/.test(text)) return 'BEFORE';
  if (/apres (le )?(repas|manger)|pendant (le )?repas|au repas|after (the )?(meal|food)|with food|with meal/.test(text)) return 'AFTER';
  return null;
}

function detectDays(duration: string): number | null {
  const text = normalize(duration);
  const n = findNumber(text);
  if (n == null) {
    if (/semaine|week/.test(text)) return 7;
    if (/mois|month/.test(text)) return 30;
    return null;
  }
  if (/semaine|week/.test(text)) return n * 7;
  if (/mois|month/.test(text)) return n * 30;
  if (/jour|day/.test(text)) return n;
  // Nombre seul sans unité claire : on suppose des jours (durée d'ordonnance).
  return n;
}

/** Analyse une ligne d'ordonnance en tokens structurés (fonction pure). */
export function parsePosology(input: { dosage?: string; frequency?: string; duration?: string }): ParsedPosology {
  const freqText = normalize(`${input.frequency ?? ''} ${input.dosage ?? ''}`);
  const doseText = normalize(input.dosage ?? '');

  let timings = detectTimings(freqText);
  let timesPerDay = detectTimesPerDay(freqText);

  if (timings.length === 0 && timesPerDay != null && DEFAULT_TIMINGS[timesPerDay]) {
    timings = DEFAULT_TIMINGS[timesPerDay];
  }
  if (timesPerDay == null && timings.length > 0) {
    timesPerDay = timings.length;
  }

  const doseCount = findNumber(doseText);
  const form = detectForm(`${doseText} ${normalize(input.frequency ?? '')}`);
  const meal = detectMeal(freqText);
  const days = detectDays(input.duration ?? '');

  const recognized = timings.length > 0 || timesPerDay != null || doseCount != null || form != null || meal != null;

  return { timings, timesPerDay, doseCount, form, meal, days, recognized };
}
