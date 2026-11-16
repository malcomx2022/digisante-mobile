// ─────────────────────────────────────────────────────────────
// Phrasier médical embarqué — aide à la communication patient↔soignant quand ils
// ne partagent PAS de langue (barrière linguistique, zones reculées). 100% LOCAL
// (offline-first §3) : AUCUNE traduction au runtime, AUCUN appel à un service tiers
// — le contenu du chat est de la donnée santé (§4) et ne doit jamais sortir. Le
// soignant/patient choisit une phrase courante ; elle est insérée dans la langue
// cible. Ce sont des phrases de COMMUNICATION (pas un diagnostic).
// FR + EN complets. FON/YOR repris mot pour mot des retours de relecture native
// (double relecture, réf. privées PHR-FON-2026-11 : FON-R1 + FON-R2 et
// PHR-YOR-2026-11 : YOR-R1 + YOR-R2, le 2026-11-15 ; cf.
// docs/i18n/TRACABILITE_Relectures.md). Contreseing clinique encore attendu.
// Phrases renvoyées aux relecteurs (sens à confirmer), en repli FR jusqu'à
// correction : FON pos.finish ; YOR pos.once_day, sym.vomit_diarrhea.
// Jamais de traduction automatique publiée telle quelle (§6).
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
 * diagnostique. Contreseing d'un professionnel de santé requis avant usage réel
 * (cf. docs/VALIDATION_Clinique.md et docs/i18n/phrasier/README.md).
 */
export const PHRASEBOOK: Phrase[] = [
  // Salutations / mise en relation
  { key: 'greet.hello', category: 'GREETING', text: { FR: 'Bonjour, je suis là pour vous aider.', EN: 'Hello, I am here to help you.', FON: 'Kudo le hwenu‚ un ɖo fi bo na do alɔ nu we.', YOR: 'Ẹ n lẹ o, mo wa nibi lati ran yin lọwọ.' } },
  { key: 'greet.how_feel', category: 'GREETING', text: { FR: 'Comment vous sentez-vous aujourd’hui ?', EN: 'How are you feeling today?', FON: 'Nε mi ɖe gbɔn egbe ?', YOR: 'Báwo ni ara rẹ ṣe rí lónìí?' } },
  { key: 'greet.understand', category: 'GREETING', text: { FR: 'Est-ce que vous me comprenez ?', EN: 'Do you understand me?', FON: 'A mɔ nu jɛ mɛ à ?', YOR: 'Ṣe Ọrọ mi ye ọ?' } },
  { key: 'greet.no_understand', category: 'GREETING', text: { FR: 'Je ne comprends pas, pouvez-vous répéter ?', EN: 'I do not understand, can you repeat?', FON: 'Un mɔ nu jɛ mɛ a, a sixu lɛ vɔ ɖɔ à ?', YOR: 'Mi o ye mi, se o le tun se?' } },
  { key: 'greet.take_time', category: 'GREETING', text: { FR: 'Prenez votre temps.', EN: 'Take your time.', FON: 'Sɔ́ hwenu towe.', YOR: 'Lo akoko rẹ.' } },

  // Symptômes (questions/réponses)
  { key: 'sym.where_pain', category: 'SYMPTOM', text: { FR: 'Où avez-vous mal ?', EN: 'Where does it hurt?', FON: 'Fitɛ e nɔ vε wu ɖe ?', YOR: 'Ibo lo ti ndun e?' } },
  { key: 'sym.pain_here', category: 'SYMPTOM', text: { FR: 'J’ai mal ici.', EN: 'I have pain here.', FON: 'Un ɖo wuvɛ se wɛ ɖo fi.', YOR: 'Mo ní ìrora níbí.' } },
  { key: 'sym.since_when', category: 'SYMPTOM', text: { FR: 'Depuis combien de temps ?', EN: 'For how long?', FON: 'Táan nabi?', YOR: 'Fún ìgbà wo ni?' } },
  { key: 'sym.fever', category: 'SYMPTOM', text: { FR: 'Avez-vous de la fièvre ?', EN: 'Do you have a fever?', FON: 'A ɖo zozo a ?', YOR: 'Ṣé ibà ń ṣe ọ́?' } },
  { key: 'sym.cough', category: 'SYMPTOM', text: { FR: 'Avez-vous de la toux ?', EN: 'Do you have a cough?', FON: 'A ɖo kɔ xú wɛ à ?', YOR: 'Ṣé o ní ikọ́?' } },
  { key: 'sym.vomit_diarrhea', category: 'SYMPTOM', text: { FR: 'Avez-vous des vomissements ou la diarrhée ?', EN: 'Do you have vomiting or diarrhea?', FON: 'A nɔ vìvì alǒ nɔ ɖò xomɛslá wɛ à ?' } },
  { key: 'sym.pregnant', category: 'SYMPTOM', text: { FR: 'Êtes-vous enceinte ?', EN: 'Are you pregnant?', FON: 'A ɖo xo wɛ a ?', YOR: 'Ṣé o lóyún?' } },
  { key: 'sym.allergy', category: 'SYMPTOM', text: { FR: 'Avez-vous des allergies à des médicaments ?', EN: 'Are you allergic to any medicine?', FON: 'Atínkɛ́n ɖebǔ ka nɔ gbɛ́ nú we à?', YOR: 'Ṣé o ní àléjì sí oògùn èyíkéyìí?' } },

  // Consignes
  { key: 'ins.rest_water', category: 'INSTRUCTION', text: { FR: 'Reposez-vous et buvez beaucoup d’eau.', EN: 'Rest and drink plenty of water.', FON: 'Gbɔjɛ bo nu sìn sukpɔ.', YOR: 'Sinmi ki o si mu omi pupọ.' } },
  { key: 'ins.take_med', category: 'INSTRUCTION', text: { FR: 'Prenez ce médicament comme indiqué.', EN: 'Take this medicine as directed.', FON: 'Mi nu atínkɛ́n élɔ́ lě e è ɖɔ gbɔn é.', YOR: 'Mu oogun yii bi a ti paṣẹ fun ọ.' } },
  { key: 'ins.pharmacy', category: 'INSTRUCTION', text: { FR: 'Allez à la pharmacie avec cette ordonnance.', EN: 'Go to the pharmacy with this prescription.', FON: 'Yi atínkɛnxɔsa ɔ kpodo wema elɔ kpo.', YOR: 'Lọ sí ilé ìtajà oògùn pẹ̀lú ìwé àṣẹ yìí.' } },
  { key: 'ins.lab_test', category: 'INSTRUCTION', text: { FR: 'Vous devez faire un examen de laboratoire.', EN: 'You need a laboratory test.', FON: 'A ɖo na bló tɛnkpɔn laboratoire tɔn.', YOR: 'O nilo idanwo yàrá.' } },

  // Posologie
  { key: 'pos.once_day', category: 'POSOLOGY', text: { FR: 'Une fois par jour.', EN: 'Once a day.', FON: 'Azɔn ɖokpo ɖò kéze ɖokpo mɛ.' } },
  { key: 'pos.twice_day', category: 'POSOLOGY', text: { FR: 'Deux fois par jour.', EN: 'Twice a day.', FON: 'Azɔn wè ɖò kéze ɖokpo mɛ.', YOR: 'Lẹ́ẹ̀mejì lójúmọ́.' } },
  { key: 'pos.three_day', category: 'POSOLOGY', text: { FR: 'Trois fois par jour.', EN: 'Three times a day.', FON: 'Azɔn atɔn ɖò kéze ɖokpo mɛ.', YOR: 'Ni igba mẹta lojojumọ.' } },
  { key: 'pos.after_meal', category: 'POSOLOGY', text: { FR: 'Après le repas.', EN: 'After a meal.', FON: 'Enyi è ɖu nǔ gudo ɔ.', YOR: 'Lẹ́yìn oúnjẹ.' } },
  { key: 'pos.finish', category: 'POSOLOGY', text: { FR: 'Terminez tout le traitement.', EN: 'Finish the whole treatment.', YOR: 'Pari gbogbo itọju naa.' } },

  // Suivi
  { key: 'fu.come_back', category: 'FOLLOWUP', text: { FR: 'Revenez si cela ne s’améliore pas.', EN: 'Come back if it does not improve.', FON: 'Enyi é ma kpɔ́n te ǎ ɔ, lɛkɔ wá.', YOR: 'Pada wa ti ko ba dara si.' } },
  { key: 'fu.appointment', category: 'FOLLOWUP', text: { FR: 'Prenons un rendez-vous de suivi.', EN: 'Let’s schedule a follow-up appointment.', FON: 'Mi nú mǐ ni bló tuto bo na wá kpɔ́n mǐɖée.', YOR: 'Ẹ jẹ́ kí a ṣètò ìpàdé tí yóò tẹ̀lé e.' } },
  { key: 'fu.better', category: 'FOLLOWUP', text: { FR: 'Est-ce que cela va mieux ?', EN: 'Is it getting better?', FON: 'É ka ɖò ɖagbe hugǎn wɛ à?', YOR: 'Ṣé ó ń dára síi?' } },

  // Urgence
  { key: 'em.hospital', category: 'EMERGENCY', text: { FR: 'C’est urgent, allez à l’hôpital immédiatement.', EN: 'This is urgent, go to the hospital immediately.', FON: 'Enɛ ɖò dandan, yì dotóoxwé tlolo.', YOR: 'Èyí jẹ́ kíákíá, ẹ lọ sí ilé ìwòsàn lẹ́sẹ̀kẹsẹ̀.' } },
  { key: 'em.sos', category: 'EMERGENCY', text: { FR: 'Appelez les secours (SOS).', EN: 'Call emergency services (SOS).', FON: 'Ylɔ azɔ̌xwé e nɔ kpé nukún dó ajijimɛ sín nǔ lɛ wu lɛ é (SOS).', YOR: 'Pe awọn iṣẹ pajawiri (SOS).' } },
];

/** Texte d'une phrase dans une langue (repli FR — jamais de trou). */
export function phraseText(phrase: Phrase, lang: Lang): string {
  return phrase.text[lang] ?? phrase.text.FR;
}

/** Phrases d'une catégorie. */
export function phrasesByCategory(category: PhraseCategory): Phrase[] {
  return PHRASEBOOK.filter((p) => p.category === category);
}
