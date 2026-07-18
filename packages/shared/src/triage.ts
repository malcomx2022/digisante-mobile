// ─────────────────────────────────────────────────────────────
// Triage / orientation HORS-LIGNE — aide à décider quoi faire face à un symptôme
// quand on est loin d'un centre de santé (zones reculées, réseau faible). 100%
// embarqué (aucun appel réseau), multilingue via i18n côté client, pictogrammes.
// Fondé sur les SIGNES DE DANGER OMS / PCIME (IMCI) avec un biais CONSERVATEUR :
//   • un seul signe ROUGE  → URGENCE (chercher de l'aide immédiatement / SOS)
//   • sinon un signe ORANGE → CONSULTER rapidement
//   • sinon                 → SURVEILLANCE À DOMICILE (+ « en cas de doute, consulter »)
// ⚠️ CECI N'EST PAS UN DIAGNOSTIC. Contenu à FAIRE VALIDER par un professionnel
// de santé / le programme national avant usage clinique réel (isolé ici pour ça).
// ─────────────────────────────────────────────────────────────

export type TriageOutcome = 'EMERGENCY' | 'CONSULT' | 'HOME';
export type TriageSeverity = 'RED' | 'AMBER';

export interface TriageQuestion {
  /** Clé i18n de la question (`triage.q.<key>`). */
  key: string;
  severity: TriageSeverity;
}
export interface TriageFlow {
  /** Identifiant du motif (i18n `triage.flow.<id>`). */
  id: string;
  /** Icône (clé de pictogramme côté client). */
  icon: string;
  questions: TriageQuestion[];
}

/**
 * Motifs couverts (priorisés sur la charge de morbidité au Bénin : paludisme,
 * déshydratation de l'enfant, détresse respiratoire, signes de danger en
 * grossesse). Les questions ROUGE sont des signes de danger OMS/PCIME.
 */
export const TRIAGE_FLOWS: TriageFlow[] = [
  {
    id: 'FEVER',
    icon: 'thermometer',
    questions: [
      { key: 'fever_convulsion', severity: 'RED' },
      { key: 'fever_unconscious', severity: 'RED' },
      { key: 'fever_notdrink', severity: 'RED' },
      { key: 'fever_breathing', severity: 'RED' },
      { key: 'fever_stiffneck', severity: 'RED' },
      { key: 'fever_infant', severity: 'AMBER' },
      { key: 'fever_3days', severity: 'AMBER' },
    ],
  },
  {
    id: 'DIARRHEA',
    icon: 'drop',
    questions: [
      { key: 'diarrhea_lethargic', severity: 'RED' },
      { key: 'diarrhea_sunkeneyes', severity: 'RED' },
      { key: 'diarrhea_notdrink', severity: 'RED' },
      { key: 'diarrhea_blood', severity: 'RED' },
      { key: 'diarrhea_vomiting', severity: 'AMBER' },
      { key: 'diarrhea_3days', severity: 'AMBER' },
    ],
  },
  {
    id: 'BREATHING',
    icon: 'lungs',
    questions: [
      { key: 'breathing_severe', severity: 'RED' },
      { key: 'breathing_blue', severity: 'RED' },
      { key: 'breathing_indrawing', severity: 'RED' },
      { key: 'breathing_nospeak', severity: 'RED' },
      { key: 'breathing_fast', severity: 'AMBER' },
      { key: 'breathing_cough2w', severity: 'AMBER' },
    ],
  },
  {
    id: 'PREGNANCY',
    icon: 'pregnant',
    questions: [
      { key: 'preg_bleeding', severity: 'RED' },
      { key: 'preg_headache', severity: 'RED' },
      { key: 'preg_convulsion', severity: 'RED' },
      { key: 'preg_abdopain', severity: 'RED' },
      { key: 'preg_nomovement', severity: 'RED' },
      { key: 'preg_fever', severity: 'AMBER' },
      { key: 'preg_swelling', severity: 'AMBER' },
    ],
  },
];

export const TRIAGE_BY_ID: Record<string, TriageFlow> = Object.fromEntries(TRIAGE_FLOWS.map((f) => [f.id, f]));

/**
 * Évalue les réponses (clé question → vrai/faux) et renvoie l'orientation (PUR).
 * Biais conservateur : au moindre ROUGE → URGENCE ; sinon un ORANGE → CONSULTER ;
 * sinon SURVEILLANCE À DOMICILE. Les questions sans réponse comptent comme « non ».
 */
export function evaluateTriage(flow: TriageFlow, answers: Record<string, boolean>): TriageOutcome {
  let amber = false;
  for (const q of flow.questions) {
    if (!answers[q.key]) continue;
    if (q.severity === 'RED') return 'EMERGENCY';
    amber = true;
  }
  return amber ? 'CONSULT' : 'HOME';
}
