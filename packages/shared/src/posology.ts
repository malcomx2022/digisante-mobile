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
export type PosologyMeal = 'BEFORE' | 'DURING' | 'AFTER' | 'FASTING';

export interface ParsedPosology {
  /** Moments de prise, ordonnés matin→nuit, dédupliqués ; `[]` si inconnu. */
  timings: PosologyTiming[];
  /** Nombre de prises par jour (explicite ou dérivé des moments) ; `null` si inconnu. */
  timesPerDay: number | null;
  /**
   * Nombre d'UNITÉS par prise (ex. 2 comprimés, ½ comprimé = 0,5) ; `null` si
   * inconnu OU ambigu (teneur en mg/mL, quantités variables, plage « 1 à 2 »).
   * Jamais une masse ni un volume.
   */
  doseCount: number | null;
  /** Forme galénique ; `null` si inconnue. */
  form: PosologyForm | null;
  /** Relation au repas ; `null` si non précisé. */
  meal: PosologyMeal | null;
  /** Durée en jours, seulement si exprimée en jours ou semaines entiers ; `null` sinon. */
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

/** Valeur d'un nombre isolé (chiffres ou mot), ou null. */
function wordOrDigit(token: string): number | null {
  if (/^\d+$/.test(token)) return parseInt(token, 10);
  return NUMBER_WORDS[token] ?? null;
}

// Unités COMPTABLES (une prise = N unités). Une masse ou un volume (mg, mL…)
// n'est jamais un nombre d'unités : le confondre était le défaut POS04/POS05.
const COUNT_UNIT = String.raw`(?:comprimes?|cp|gelules?|capsules?|sachets?|gouttes?|bouffees?|suppositoires?|ampoules?|tablets?|drops?|puffs?|caps?)`;
const MASS_OR_VOLUME = /\d\s*(?:mg|g|µg|mcg|ug|ml|cl|l|ui|iu|%)\b/;
const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75 };

/** Quantité (entier, décimal, fraction, mot, « demi ») ou null. */
function quantityValue(raw: string): number | null {
  const q = raw.trim();
  if (FRACTIONS[q] != null) return FRACTIONS[q]!;
  if (/^(?:un |une )?demie?$/.test(q)) return 0.5;
  const frac = q.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const den = parseInt(frac[2]!, 10);
    return den > 0 ? parseInt(frac[1]!, 10) / den : null;
  }
  if (/^\d+[.,]\d+$/.test(q)) return parseFloat(q.replace(',', '.'));
  return wordOrDigit(q);
}

/**
 * Nombre d'unités par prise, SEULEMENT s'il est unique et sans ambiguïté :
 * une seule quantité directement suivie d'une unité comptable, aucune masse
 * ni volume, aucun autre nombre (quantités variables « 1 le matin, 2 le soir »,
 * plages « 1 à 2 »). Sinon null : le texte original fait foi.
 */
function detectDoseCount(doseText: string): number | null {
  if (MASS_OR_VOLUME.test(doseText)) return null;
  const quantity = String.raw`(\d+[.,]\d+|\d+\/\d+|\d+|[½¼¾]|(?:un |une )?demie?|un|une|deux|trois|quatre|cinq|six|one|two|three|four|five)`;
  const re = new RegExp(String.raw`(?:^|[^\w/.,])${quantity}[\s-]*${COUNT_UNIT}\b`, 'g');
  const matches = [...doseText.matchAll(re)];
  if (matches.length !== 1) return null;
  // Un autre nombre ailleurs (chiffre, fraction, mot) rend la quantité variable.
  const rest = doseText.replace(matches[0]![0], ' ');
  if (/\d|[½¼¾]/.test(rest)) return null;
  if (/\b(?:un|une|deux|trois|quatre|cinq|six|one|two|three|four|five|demie?)\b/.test(rest)) return null;
  const value = quantityValue(matches[0]![1]!);
  return value != null && value > 0 ? value : null;
}

const TIMING_ORDER: PosologyTiming[] = ['MORNING', 'NOON', 'EVENING', 'NIGHT'];

function detectTimings(text: string): PosologyTiming[] {
  const set = new Set<PosologyTiming>();
  if (/\bmatin|\bmorning|\bmatinee/.test(text)) set.add('MORNING');
  if (/\bmidi|\bnoon|\bmidday|\bmiddi/.test(text)) set.add('NOON');
  if (/\bsoir|\bevening|\bsoiree/.test(text)) set.add('EVENING');
  if (/\bnuit|\bnight|\bcoucher|\bbedtime/.test(text)) set.add('NIGHT');
  return TIMING_ORDER.filter((t) => set.has(t));
}

/** Nombre de prises PAR JOUR, seulement si l'unité « jour » est explicite. */
function detectTimesPerDay(text: string): number | null {
  // « 3 fois par jour », « 3 fois/jour », « 3x/j », « 3 times a day », « twice daily ».
  // « 2 fois par semaine » ou « toutes les 8 heures » ne sont PAS des prises/jour (POS07/POS08).
  const perDay = String.raw`\s*(?:par|/|a|per|each)?\s*(?:jour|j|day|24\s?h)\b`;
  if (new RegExp(String.raw`\b(?:deux fois|twice)${perDay}`).test(text) || /\btwice daily\b/.test(text)) return 2;
  if (new RegExp(String.raw`\b(?:une fois|once)${perDay}`).test(text) || /\bonce daily\b/.test(text)) return 1;
  const m = text.match(new RegExp(String.raw`\b(\d+|un|une|deux|trois|quatre|cinq|six|one|two|three|four|five)\s*(?:fois|x|times)${perDay}`));
  return m ? wordOrDigit(m[1]!) : null;
}

/** Négation / exclusion : une interdiction ne doit jamais devenir une consigne (POS11). */
function hasNegation(text: string): boolean {
  return /\b(?:ne|n|pas|jamais|sauf|eviter|evitez|not|never|avoid|except|without|sans)\b/.test(text);
}

/** Horaires ou intervalles (« 8h », « toutes les 8 heures ») : non représentés (POS08/POS13). */
function hasClockOrInterval(text: string): boolean {
  return /\b\d{1,2}\s*h(?:\d{2})?\b|\b\d{1,2}:\d{2}\b|toutes les|every|heures?\b|hours?\b/.test(text);
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
  if (/avant (le |les )?(repas|manger)|before (the )?(meal|food|eating)/.test(text)) return 'BEFORE';
  // « Pendant / au repas » n'est PAS « après » (défaut POS12).
  if (/pendant (le |les )?repas|au (cours du )?repas|aux repas|during (the )?meals?|with (food|meals?)/.test(text)) return 'DURING';
  if (/apres (le |les )?(repas|manger)|after (the )?(meal|food|eating)/.test(text)) return 'AFTER';
  return null;
}

/**
 * Durée en jours, seulement si elle est exacte : entier explicite suivi de
 * « jour(s) » ou « semaine(s) ». Sans unité (POS01), en heures (POS08), en mois
 * (28–31 j), décimale (POS12) ou en plage (POS13) → null.
 */
function detectDays(duration: string): number | null {
  const text = normalize(duration).trim();
  if (!text) return null;
  const m = text.match(/^(?:pendant |during |for )?(\d+|un|une|deux|trois|quatre|cinq|six|one|two|three|four|five)\s*(jours?|j|days?|semaines?|weeks?)$/);
  if (!m) return null;
  const n = wordOrDigit(m[1]!);
  if (n == null || n <= 0) return null;
  return /^(semaine|week)/.test(m[2]!) ? n * 7 : n;
}

/**
 * Analyse une ligne d'ordonnance en tokens structurés (fonction pure).
 * Principe : une dimension n'est renseignée que si elle est SANS ambiguïté ;
 * sinon `null` / `[]` et le texte original du prescripteur fait foi. Aucun
 * horaire n'est ajouté (plus de répartition « par défaut » matin/soir).
 */
export function parsePosology(input: { dosage?: string; frequency?: string; duration?: string }): ParsedPosology {
  const freqText = normalize(`${input.frequency ?? ''} ${input.dosage ?? ''}`);
  const doseText = normalize(input.dosage ?? '');

  // Négation ou horaires/intervalles : la fréquence n'est pas représentable en
  // pictogrammes sans risque de contresens.
  const frequencyUsable = !hasNegation(freqText) && !hasClockOrInterval(freqText);
  let timings = frequencyUsable ? detectTimings(freqText) : [];
  let timesPerDay = frequencyUsable ? detectTimesPerDay(freqText) : null;
  // Contradiction « 3 fois par jour, matin et soir » : ne pas choisir (POS09).
  if (timings.length > 0 && timesPerDay != null && timings.length !== timesPerDay) {
    timings = [];
    timesPerDay = null;
  }
  if (timesPerDay == null && timings.length > 0) timesPerDay = timings.length;

  const doseCount = detectDoseCount(doseText);
  const form = detectForm(`${doseText} ${normalize(input.frequency ?? '')}`);
  const meal = frequencyUsable ? detectMeal(freqText) : null;
  const days = detectDays(input.duration ?? '');

  const recognized = timings.length > 0 || timesPerDay != null || doseCount != null || form != null || meal != null || days != null;

  return { timings, timesPerDay, doseCount, form, meal, days, recognized };
}

/** Quantité lisible (fractions usuelles conservées : ½, ¼, ¾, 1½…). */
export function formatDoseCount(n: number): string {
  const whole = Math.floor(n);
  const rest = Math.round((n - whole) * 100) / 100;
  const glyph = rest === 0.5 ? '½' : rest === 0.25 ? '¼' : rest === 0.75 ? '¾' : null;
  if (rest === 0) return String(whole);
  if (glyph) return whole > 0 ? `${whole}${glyph}` : glyph;
  return String(n).replace('.', ',');
}
