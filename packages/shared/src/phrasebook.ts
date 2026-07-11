// ─────────────────────────────────────────────────────────────
// Phrasier médical embarqué — aide à la communication patient↔soignant quand ils
// ne partagent PAS de langue (barrière linguistique, zones reculées). 100% LOCAL
// (offline-first §3) : AUCUNE traduction au runtime, AUCUN appel à un service tiers
// — le contenu du chat est de la donnée santé (§4) et ne doit jamais sortir. Le
// soignant/patient choisit une phrase courante ; elle est insérée dans la langue
// cible. Ce sont des phrases de COMMUNICATION (pas un diagnostic).
// FR + EN complets ; FON/YOR ajoutés après relecture par locuteurs natifs (§6) —
// en attendant, repli FR (jamais de MT publiée telle quelle).
// ─────────────────────────────────────────────────────────────
import type { Lang } from './enums.js';

export const PHRASE_CATEGORIES = ['GREETING', 'SYMPTOM', 'INSTRUCTION', 'POSOLOGY', 'FOLLOWUP', 'EMERGENCY'] as const;
export type PhraseCategory = (typeof PHRASE_CATEGORIES)[number];

export interface Phrase {
  /** Clé stable (i18n de libellé non requise — le texte EST le contenu). */
  key: string;
  category: PhraseCategory;
  /** Traductions ; FR obligatoire (source de vérité). */
  text: { FR: string; EN: string } & Partial<Record<Lang, string>>;
}

/**
 * Phrasier : phrases de communication clinique courantes. Conservateur, non
 * diagnostique. À faire relire par un pro de santé + des locuteurs FON/YOR avant
 * d'ajouter ces langues (cf. docs/VALIDATION_Clinique.md).
 */
export const PHRASEBOOK: Phrase[] = [
  // Salutations / mise en relation
  { key: 'greet.hello', category: 'GREETING', text: { FR: 'Bonjour, je suis là pour vous aider.', EN: 'Hello, I am here to help you.' } },
  { key: 'greet.how_feel', category: 'GREETING', text: { FR: 'Comment vous sentez-vous aujourd’hui ?', EN: 'How are you feeling today?' } },
  { key: 'greet.understand', category: 'GREETING', text: { FR: 'Est-ce que vous me comprenez ?', EN: 'Do you understand me?' } },
  { key: 'greet.no_understand', category: 'GREETING', text: { FR: 'Je ne comprends pas, pouvez-vous répéter ?', EN: 'I do not understand, can you repeat?' } },
  { key: 'greet.take_time', category: 'GREETING', text: { FR: 'Prenez votre temps.', EN: 'Take your time.' } },

  // Symptômes (questions/réponses)
  { key: 'sym.where_pain', category: 'SYMPTOM', text: { FR: 'Où avez-vous mal ?', EN: 'Where does it hurt?' } },
  { key: 'sym.pain_here', category: 'SYMPTOM', text: { FR: 'J’ai mal ici.', EN: 'I have pain here.' } },
  { key: 'sym.since_when', category: 'SYMPTOM', text: { FR: 'Depuis combien de temps ?', EN: 'For how long?' } },
  { key: 'sym.fever', category: 'SYMPTOM', text: { FR: 'Avez-vous de la fièvre ?', EN: 'Do you have a fever?' } },
  { key: 'sym.cough', category: 'SYMPTOM', text: { FR: 'Avez-vous de la toux ?', EN: 'Do you have a cough?' } },
  { key: 'sym.vomit_diarrhea', category: 'SYMPTOM', text: { FR: 'Avez-vous des vomissements ou la diarrhée ?', EN: 'Do you have vomiting or diarrhea?' } },
  { key: 'sym.pregnant', category: 'SYMPTOM', text: { FR: 'Êtes-vous enceinte ?', EN: 'Are you pregnant?' } },
  { key: 'sym.allergy', category: 'SYMPTOM', text: { FR: 'Avez-vous des allergies à des médicaments ?', EN: 'Are you allergic to any medicine?' } },

  // Consignes
  { key: 'ins.rest_water', category: 'INSTRUCTION', text: { FR: 'Reposez-vous et buvez beaucoup d’eau.', EN: 'Rest and drink plenty of water.' } },
  { key: 'ins.take_med', category: 'INSTRUCTION', text: { FR: 'Prenez ce médicament comme indiqué.', EN: 'Take this medicine as directed.' } },
  { key: 'ins.pharmacy', category: 'INSTRUCTION', text: { FR: 'Allez à la pharmacie avec cette ordonnance.', EN: 'Go to the pharmacy with this prescription.' } },
  { key: 'ins.lab_test', category: 'INSTRUCTION', text: { FR: 'Vous devez faire un examen de laboratoire.', EN: 'You need a laboratory test.' } },

  // Posologie
  { key: 'pos.once_day', category: 'POSOLOGY', text: { FR: 'Une fois par jour.', EN: 'Once a day.' } },
  { key: 'pos.twice_day', category: 'POSOLOGY', text: { FR: 'Deux fois par jour.', EN: 'Twice a day.' } },
  { key: 'pos.three_day', category: 'POSOLOGY', text: { FR: 'Trois fois par jour.', EN: 'Three times a day.' } },
  { key: 'pos.after_meal', category: 'POSOLOGY', text: { FR: 'Après le repas.', EN: 'After a meal.' } },
  { key: 'pos.finish', category: 'POSOLOGY', text: { FR: 'Terminez tout le traitement.', EN: 'Finish the whole treatment.' } },

  // Suivi
  { key: 'fu.come_back', category: 'FOLLOWUP', text: { FR: 'Revenez si cela ne s’améliore pas.', EN: 'Come back if it does not improve.' } },
  { key: 'fu.appointment', category: 'FOLLOWUP', text: { FR: 'Prenons un rendez-vous de suivi.', EN: 'Let’s schedule a follow-up appointment.' } },
  { key: 'fu.better', category: 'FOLLOWUP', text: { FR: 'Est-ce que cela va mieux ?', EN: 'Is it getting better?' } },

  // Urgence
  { key: 'em.hospital', category: 'EMERGENCY', text: { FR: 'C’est urgent, allez à l’hôpital immédiatement.', EN: 'This is urgent, go to the hospital immediately.' } },
  { key: 'em.sos', category: 'EMERGENCY', text: { FR: 'Appelez les secours (SOS).', EN: 'Call emergency services (SOS).' } },
];

/** Texte d'une phrase dans une langue (repli FR — jamais de trou). */
export function phraseText(phrase: Phrase, lang: Lang): string {
  return phrase.text[lang] ?? phrase.text.FR;
}

/** Phrases d'une catégorie. */
export function phrasesByCategory(category: PhraseCategory): Phrase[] {
  return PHRASEBOOK.filter((p) => p.category === category);
}
