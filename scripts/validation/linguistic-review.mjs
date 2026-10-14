// Feuilles de travail non signées : aucune traduction, approbation ou écriture.
// Les retours importables et le registre de preuves suivent leur circuit L9 séparé.
import { isCritical } from '../i18n/check-coverage.mjs';
import { contentHash } from './check-l9-gate.mjs';

const LOCALES = ['fon', 'yor'];
const P1_NAMESPACES = new Set(['emergency', 'prescription', 'vault', 'offline']);
const P2_NAMESPACES = new Set(['subscriptions', 'wallet', 'beneficiaries', 'referrals', 'labkyc', 'dmpdoc', 'appt', 'teleconsult']);
const QUESTION_DEFINITIONS = [
  {
    id: 'SQ01', keys: ['posology.form.INHALER'],
    issue: 'Le français désigne une inhalation ; l’anglais désigne un inhalateur.',
    reviewQuestion: 'Le libellé doit-il désigner un geste, une forme ou un dispositif ? Faire confirmer le concept clinique avant traduction.',
  },
  {
    id: 'SQ02', keys: ['maternity.weeks_val', 'maternity.lmp'],
    issue: 'Le français utilise SA, l’anglais wks ; les textes natifs actuels conservent SA.',
    reviewQuestion: 'Comment préserver et expliquer l’unité de suivi gestationnel, sa référence aux dernières règles et le nombre interpolé ?',
  },
  {
    id: 'SQ03', keys: ['maternity.objective.2'],
    issue: 'Les abréviations TPI-SP et VAT deviennent IPTp-SP et TT en anglais.',
    reviewQuestion: 'Faire confirmer les concepts et leur formulation compréhensible par le patient ; ne pas développer les abréviations par supposition.',
  },
  {
    id: 'SQ04', keys: ['maternity.objective.4'],
    issue: 'L’anglais précise third-trimester, absent du texte français.',
    reviewQuestion: 'Cette précision fait-elle partie du sens à communiquer ? Demander une décision explicite sur l’équivalence des sources.',
  },
  {
    id: 'SQ05', keys: ['sos.sms', 'offline.sos_active', 'vault.network_only'],
    issue: 'La mention hors ligne pour le SMS peut confondre absence d’Internet et absence de couverture téléphonique.',
    reviewQuestion: 'Le lecteur comprend-il quelles connexions sont nécessaires pour chaque action et quoi faire si elles manquent ?',
  },
  {
    id: 'SQ06', keys: ['sos.sent'],
    issue: 'Le texte annonce un envoi aux secours sans préciser les étapes de livraison ou de prise en charge.',
    reviewQuestion: 'Que croit le lecteur avoir été fait ? Vérifier le sens autorisé par le comportement réel avant de valider la formulation.',
  },
  {
    id: 'SQ07', keys: ['sos.im_ok', 'sos.false_alarm', 'sos.status.RESOLVED', 'sos.status.FALSE_ALARM'],
    issue: 'Des libellés proches désignent une action sur l’alerte ou un état de l’historique.',
    reviewQuestion: 'Le lecteur distingue-t-il le bouton, ses effets et le statut affiché ? La clôture technique ne doit pas être interprétée comme une résolution clinique.',
  },
  {
    id: 'SQ08', keys: ['labo.order'],
    issue: 'Le libellé expose l’identifiant technique orderId.',
    reviewQuestion: 'Le destinataire sait-il de quelle demande il s’agit et où trouver son identifiant ? Confirmer le contexte affiché.',
  },
  {
    id: 'SQ09', keys: ['subscriptions.rights'],
    issue: 'Les sources décrivent l’accès aux revenus comme une livraison future du lot 7.',
    reviewQuestion: 'Faire confirmer les droits réellement disponibles et la formulation produit avant traduction ; conserver les conditions de soins déjà engagés.',
  },
  {
    id: 'SQ10', keys: ['triage.q.diarrhea_sunkeneyes'],
    issue: 'Deux signes sont juxtaposés dans une seule question à réponse Oui ou Non.',
    reviewQuestion: 'Le lecteur pense-t-il devoir observer un signe ou les deux ? Faire arbitrer le sens clinique exact avant toute reformulation.',
  },
  {
    id: 'SQ11', keys: ['triage.q.diarrhea_vomiting'],
    issue: 'Le français précise ce que la personne prend ; l’anglais dit everything.',
    reviewQuestion: 'Vérifier que le sujet et le sens de ce qui est ingéré sont conservés, sans ajouter de consigne médicale.',
  },
  {
    id: 'SQ12', keys: ['labo.check_msg'],
    issue: 'Le message associe limites physiologiques, vérification de saisie et alerte critique irréversible.',
    reviewQuestion: 'Le lecteur distingue-t-il ces notions et l’action demandée ? Tout raccourci clinique nécessite une revue explicite.',
  },
  {
    id: 'SQ13', keys: ['prescribe.dosage', 'prescribe.frequency', 'prescribe.duration'],
    issue: 'Le champ français Posologie correspond au champ anglais Dosage, avec fréquence et durée séparées.',
    reviewQuestion: 'Le champ désigne-t-il la quantité, la dose ou le schéma complet ? Faire confirmer le concept et les unités en contexte.',
  },
];

const GLOSSARY_DEFINITIONS = [
  ['G01', 'sos.title', ['sos.title', 'sos.samu', 'sos.sent', 'sos.fallback'], 'Urgence, secours et transmission de l’alerte.', 'Distinguer envoi, livraison, prise en charge et couverture téléphonique.'],
  ['G02', 'sos.status.RESOLVED', ['sos.im_ok', 'sos.false_alarm', 'sos.status.RESOLVED', 'sos.status.FALSE_ALARM'], 'Action sur une alerte et état de l’historique.', 'Ne pas confondre clôture de l’alerte et situation clinique.'],
  ['G03', 'triage.disclaimer', ['triage.disclaimer', 'vault.triage', 'referrals.title', 'referrals.reason'], 'Orientation locale et orientation vers un confrère.', 'Distinguer orientation, conseil et diagnostic ; préserver les réserves.'],
  ['G04', 'triage.q.fever_convulsion', ['triage.q.fever_convulsion', 'triage.q.fever_unconscious', 'triage.q.breathing_nospeak', 'triage.q.diarrhea_blood'], 'Signes interrogés dans les parcours de triage.', 'Préserver acteur, négation, gravité et temporalité ; pas de nouveau seuil clinique.'],
  ['G05', 'prescriptions.title', ['prescriptions.title', 'prescriptions.valid_until', 'prescription.status.EXPIRED', 'prescription.status.CANCELLED', 'vault.prescription_notice'], 'Ordonnance, statut courant et copie locale datée.', 'Une copie locale ne prouve ni la validité actuelle ni l’autorisation de délivrance.'],
  ['G06', 'prescribe.dosage', ['prescribe.dosage', 'prescribe.frequency', 'prescribe.duration', 'posology.per_day', 'posology.duration'], 'Dose, fréquence et durée dans les champs et fragments affichés.', 'Préserver quantité, unité et variables ; ne pas déduire une prescription.'],
  ['G07', 'posology.timing.MORNING', ['posology.timing.MORNING', 'posology.timing.NOON', 'posology.timing.EVENING', 'posology.timing.NIGHT', 'posology.form.INHALER'], 'Moments de prise, formes et dispositifs.', 'Distinguer moment, geste et objet ; examiner aussi les pictogrammes.'],
  ['G08', 'posology.meal.FASTING', ['posology.meal.FASTING', 'posology.meal.BEFORE', 'posology.meal.AFTER'], 'Relation entre prise et repas.', 'Vérifier compréhension orale de la relation temporelle sans inventer de délai.'],
  ['G09', 'emergency.allergies', ['emergency.allergies', 'emergency.chronic', 'emergency.none'], 'Fiche d’urgence : allergies, maladies chroniques et donnée absente.', 'Non renseigné ne signifie pas absence d’allergie ou de maladie.'],
  ['G10', 'maternity.weeks_val', ['maternity.weeks_val', 'maternity.lmp', 'maternity.visits', 'maternity.visit_n', 'maternity.due', 'maternity.objective.2'], 'SA, CPN et abréviations du suivi de grossesse.', 'Préserver unité et origine de datation ; développer les termes uniquement après confirmation.'],
  ['G11', 'vaccinations.title', ['vaccinations.title', 'vaccinations.born', 'vaccinations.done_count', 'vaccinations.overdue_count', 'vaccine.PENTA'], 'Vaccins, calendrier, réalisation et retard.', 'Distinguer dose prévue, effectuée et en retard ; préserver âge et compteurs.'],
  ['G12', 'vitals.glucose', ['vitals.glucose', 'vitals.systolic', 'vitals.diastolic', 'vitals.pulse', 'vitals.weight'], 'Mesures et unités : glycémie, tension, pouls, poids.', 'Conserver g/L, bpm, kg et valeurs ; ne pas convertir les unités par traduction.'],
  ['G13', 'labo.critical', ['labo.critical', 'labo.check_msg', 'labo.status.SAMPLE_COLLECTED', 'labo.status.PROCESSING', 'labo.published'], 'Résultats, étapes de laboratoire et alerte au prescripteur.', 'Distinguer prélèvement, analyse, publication et caractère critique.'],
  ['G14', 'offline.title', ['offline.title', 'offline.banner', 'offline.sos_active', 'vault.locked', 'vault.review_warning', 'vault.network_only'], 'Hors ligne, coffre, reprise et vérification des actions.', 'Une action différée ou incertaine ne doit pas être comprise comme confirmée.'],
  ['G15', 'common.fcfa', ['common.fcfa', 'subscriptions.payment_pending', 'subscriptions.payment_completed', 'subscriptions.payment_refunded', 'beneficiaries.send_confirm', 'prescriptions.paid'], 'FCFA/XOF, débit et états du paiement.', 'Préserver montant, bénéficiaire et distinction initié, confirmé, remboursé.'],
];

function requireSourceKey(snapshot, key) {
  for (const locale of ['fr', 'en']) {
    if (typeof snapshot.messages[locale][key] !== 'string' || !snapshot.messages[locale][key].trim()) {
      throw new Error(`Source ${locale} absente ou vide pour la campagne : ${key}`);
    }
  }
}

function uiPriority(key, clinicalKeys) {
  if (isCritical(key)) return 'P0';
  const namespace = key.split('.')[0];
  if (clinicalKeys.has(key) || P1_NAMESPACES.has(namespace)) return 'P1';
  if (P2_NAMESPACES.has(namespace)) return 'P2';
  return 'P3';
}

function phrasePriority(category) {
  if (category === 'EMERGENCY') return 'Q0';
  if (['SYMPTOM', 'INSTRUCTION', 'POSOLOGY'].includes(category)) return 'Q1';
  if (['GREETING', 'FOLLOWUP'].includes(category)) return 'Q2';
  throw new Error(`Catégorie du phrasier à prioriser : ${category}`);
}

function blankReviewFields() {
  return {
    contextRoute: '', contextDescription: '', proposedNative: '',
    primaryStatus: 'OPEN', primaryNotes: '', secondaryStatus: 'OPEN', secondaryNotes: '',
    comprehensionStatus: 'NOT_RUN', oralStatus: 'NOT_RUN', displayStatus: 'NOT_RUN',
    clinicalStatus: 'OPEN', issueRef: '', reviewStatus: 'OPEN',
  };
}

function reviewRow({ snapshot, locale, scope, key, category, priority, fr, en, native, questionIds, contentSha256 }) {
  const currentNative = typeof native === 'string' ? native : '';
  const missing = !currentNative.trim();
  return {
    scope, locale, priority, key, critical: scope === 'ui' ? isCritical(key) : true,
    category, fr, en, currentNative, missing, sameAsFrench: !missing && currentNative === fr,
    placeholders: [...fr.matchAll(/\{[\w.]+\}|<\/?[a-z][^>]*>/gi)].map((match) => match[0]).sort().join(' | '),
    sourceQuestionIds: questionIds.join(' | '),
    ...blankReviewFields(),
    sourceSnapshotSha256: snapshot.sourceSnapshotSha256,
    contentSha256,
  };
}

/** Fonction pure : sources conservées, décisions ouvertes et aucun texte candidat. */
export function buildLinguisticReview(snapshot) {
  if (!snapshot?.messages?.fr || !snapshot.messages.en || !snapshot.messages.fon || !snapshot.messages.yor
      || !Array.isArray(snapshot.phrasebook) || !Array.isArray(snapshot.clinicalTexts)
      || !/^[a-f0-9]{64}$/.test(snapshot.sourceSnapshotSha256 ?? '')) {
    throw new Error('Instantané linguistique incomplet ou empreinte source invalide');
  }
  const keys = Object.keys(snapshot.messages.fr);
  keys.forEach((key) => requireSourceKey(snapshot, key));
  const clinicalKeys = new Set(snapshot.clinicalTexts.map((text) => text.key));
  for (const key of clinicalKeys) requireSourceKey(snapshot, key);
  const questions = QUESTION_DEFINITIONS.map((question) => {
    question.keys.forEach((key) => requireSourceKey(snapshot, key));
    return { ...question, keys: [...question.keys] };
  });
  const questionIdsFor = (key) => questions.filter((question) => question.keys.includes(key)).map((question) => question.id);
  const glossary = GLOSSARY_DEFINITIONS.map(([id, sourceKey, exampleKeys, context, pitfalls]) => {
    exampleKeys.forEach((key) => requireSourceKey(snapshot, key));
    return {
      id, sourceKey, sourceTerm: snapshot.messages.fr[sourceKey], exampleKeys: [...exampleKeys], context, pitfalls,
      nativeTerm: '', nativeDefinition: '', primaryNotes: '', secondaryNotes: '', reviewStatus: 'OPEN',
    };
  });
  if (new Set(snapshot.phrasebook.map((phrase) => phrase.key)).size !== snapshot.phrasebook.length) {
    throw new Error('Clés du phrasier dupliquées dans l’instantané');
  }
  for (const phrase of snapshot.phrasebook) {
    if (typeof phrase.key !== 'string' || !phrase.key.trim()
        || typeof phrase.text?.FR !== 'string' || !phrase.text.FR.trim()
        || typeof phrase.text?.EN !== 'string' || !phrase.text.EN.trim()) {
      throw new Error('Phrase FR/EN absente ou invalide dans l’instantané');
    }
    phrasePriority(phrase.category);
  }

  const uiSheets = {};
  const phrasebookSheets = {};
  const localeStats = {};
  for (const locale of LOCALES) {
    const uiHash = contentHash(snapshot, 'ui', locale);
    const phrasebookHash = contentHash(snapshot, 'phrasebook-native', locale);
    uiSheets[locale] = keys.map((key) => reviewRow({
      snapshot, locale, scope: 'ui', key, category: '', priority: uiPriority(key, clinicalKeys),
      fr: snapshot.messages.fr[key], en: snapshot.messages.en[key], native: snapshot.messages[locale][key],
      questionIds: questionIdsFor(key), contentSha256: uiHash,
    }));
    phrasebookSheets[locale] = snapshot.phrasebook.map((phrase) => reviewRow({
      snapshot, locale, scope: 'phrasebook-native', key: phrase.key, category: phrase.category,
      priority: phrasePriority(phrase.category), fr: phrase.text.FR, en: phrase.text.EN,
      native: phrase.text[locale.toUpperCase()], questionIds: [], contentSha256: phrasebookHash,
    }));
    const rows = uiSheets[locale];
    const priorities = Object.fromEntries(['P0', 'P1', 'P2', 'P3'].map((priority) => {
      const selected = rows.filter((row) => row.priority === priority);
      return [priority, { total: selected.length, present: selected.filter((row) => !row.missing).length, missing: selected.filter((row) => row.missing).length }];
    }));
    localeStats[locale] = {
      present: rows.filter((row) => !row.missing).length, missing: rows.filter((row) => row.missing).length,
      missingCritical: rows.filter((row) => row.missing && row.critical).length,
      sameAsFrench: rows.filter((row) => row.sameAsFrench).length,
      phrasebookMissing: phrasebookSheets[locale].filter((row) => row.missing).length,
      priorities,
    };
  }
  const referenceRows = uiSheets.fon;
  return {
    stats: {
      ui: {
        total: keys.length, critical: referenceRows.filter((row) => row.critical).length,
        placeholderKeys: referenceRows.filter((row) => row.placeholders).length, clinicalKeys: clinicalKeys.size,
        priorities: Object.fromEntries(['P0', 'P1', 'P2', 'P3'].map((priority) => [priority, referenceRows.filter((row) => row.priority === priority).length])),
      },
      locales: localeStats,
      phrasebook: {
        total: snapshot.phrasebook.length,
        priorities: Object.fromEntries(['Q0', 'Q1', 'Q2'].map((priority) => [priority, phrasebookSheets.fon.filter((row) => row.priority === priority).length])),
      },
    },
    questions, glossary, uiSheets, phrasebookSheets,
  };
}
