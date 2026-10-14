// Préparation des questions de relecture clinique, sans règle médicale nouvelle,
// approbation, écriture, fournisseur, donnée patient ou connexion à une base.
// Les sorties pures sont exécutées depuis les sources fraîches. Les observations
// UI/API sont explicitement des inspections statiques, pas des recettes exécutées.
import { loadPureContent } from './content.mjs';
import { CLINICAL_SCOPES, contentHash } from './check-l9-gate.mjs';

const PROFILES = {
  triage: 'Médecin habilité compétent en urgences/soins primaires, avec expertise pédiatrie/PCIME et santé maternelle pour les motifs correspondants.',
  pev: 'Professionnel compétent en vaccination et référent du PEV national/structure compétente ; médecin pour les arbitrages cliniques nécessaires.',
  maternity: 'Sage-femme habilitée, obstétricien ou clinicien maternel qualifié pour la portée revue.',
  phrasebook: 'Clinicien habilité en soins primaires ; deux relecteurs natifs distincts par langue pour le phrasier et les écoutes.',
  prescriptions: 'Médecin prescripteur habilité et pharmacien pour fidélité de posologie, unités, formes, allergies, pictogrammes et audio.',
  vitals: 'Clinicien habilité compétent en suivi des maladies chroniques, avec infirmier ou infirmière formé à la mesure.',
  education: 'Clinicien habilité compétent dans chaque thème publié ; relecteurs natifs pour les traductions des articles réels.',
};

const QUESTIONS = {
  triage: [
    'Quel référentiel local daté couvre chaque motif, âge, signe, priorité et délai de recours ?',
    'Comment traiter une réponse manquante, incertaine ou incomprise sans la transformer en NON ?',
    'Les conseils de surveillance et le recours proposé conviennent-ils à tous les publics couverts ?',
    'La compréhension des questions, de la négation, des urgences et des pictogrammes est-elle établie sur les appareils cibles ?',
  ],
  pev: [
    'Quel calendrier national daté et applicable à la cible remplace ou confirme les données embarquées ?',
    'La définition des âges, mois, dates civiles et retards est-elle explicitement confirmée ?',
    'Comment présenter les doses déclarées par le patient, les retards et le besoin de rattrapage par un professionnel ?',
    'Les références MenA, paludisme 2024/2025 et HPV sont-elles applicables à la cible et à la période ? Aucun ajout automatique n’est proposé.',
  ],
  maternity: [
    'Le calendrier des huit contacts et chacun des huit objectifs sont-ils approuvés sur la version exacte ?',
    'Comment traiter DDR incertaine, future, ancienne, présentation tardive ou grossesse nécessitant adaptation clinique ?',
    'Le terme estimé, les semaines révolues et les mentions de retard sont-ils compris sans être présentés comme diagnostic ?',
    'Les signes de danger et les délais de recours sont-ils confirmés par un professionnel compétent ?',
  ],
  phrasebook: [
    'Chaque phrase FR/EN puis FON/YOR conserve-t-elle intention, négation, degré d’urgence et contexte ?',
    'Les consignes générales restent-elles compréhensibles sans induire une instruction de traitement hors contexte ?',
    'La langue effectivement prononcée et la compréhension des écoutes sont-elles vérifiées sur les appareils cibles ?',
  ],
  prescriptions: [
    'Chaque représentation conserve-t-elle exactement quantité, teneur, forme, voie, unité, fréquence, durée, repas et conditions du prescripteur ?',
    'Faut-il retirer les pictogrammes et audio dérivés pour toute entrée ou seulement pour un sous-ensemble explicitement confirmé ?',
    'Comment demander clarification d’une prescription contradictoire ou ambiguë sans choisir son interprétation ?',
    'Comment présenter la limite de recherche textuelle des allergies, l’absence d’alerte et l’override du prescripteur ?',
  ],
  vitals: [
    'Quels champs, unités, paires de mesures, contexte et horodatage doivent être recueillis et affichés ?',
    'Quels contrôles de plausibilité et comportement de correction faut-il fournir explicitement, sans seuil inventé par le développeur ?',
    'Les mesures partielles et décimales sont-elles conservées et comprises sur les appareils cibles ?',
    'L’absence de consigne de recours ou d’alerte automatique correspond-elle à la portée réellement annoncée ?',
  ],
  education: [
    'Quel inventaire privé complet couvre les articles effectivement publiés en base et leurs textes par langue ?',
    'Chaque contenu publié possède-t-il une version, une empreinte et un retour clinique adaptés à son thème ?',
    'Les traductions et écoutes réelles ont-elles été relues, sans considérer le seed ou le statut applicatif comme contreseing ?',
  ],
};

const PRESERVE_TEXT = 'À discuter avec les signataires : conserver intégralement le texte du prescripteur ; retirer le résumé pictogramme/audio ambigu ; ne pas ajouter horaires, convertir unités ou résoudre des contradictions. Aucune correction appliquée.';
const NO_PROTOCOL = 'À discuter avec le professionnel : fournir un arbitrage explicite et son référentiel/version ; appliquer ensuite seulement le diff confirmé et demander une nouvelle relecture. Aucun protocole, seuil ou dose ajouté.';

function pure(output) {
  return { method: 'EXECUTED_PURE_SOURCE', output };
}

function inspection(sourcePaths, findings) {
  return { method: 'STATIC_SOURCE_INSPECTION', sourcePaths, findings, executedUI: false, executedAPI: false };
}

function reviewCase(caseId, scope, input, observedOutput, risk, question, proposedTechnicalHandling = NO_PROTOCOL, referenceIds = [], priority = 'BLOCKER') {
  return {
    caseId, scope, priority, input, observedOutput, risk, question,
    proposedTechnicalHandling, referenceIds, reviewStatus: 'OPEN',
    decision: '', requiredCorrection: '', evidenceRef: '',
  };
}

/** Données de campagne non signées ; sérialisables et reproductibles. */
export function buildClinicalReview(snapshot, content = loadPureContent()) {
  const cases = [];
  const posologyCases = [
    ['POS01', { dosage: '0,5 comprimé', frequency: 'une fois par jour', duration: '5' }, 'Fraction tronquée ; valeur zéro ensuite omise de la phrase accessible ; horaire et unité de durée ajoutés.', 'Quel repli fidèle au texte exact remplace cette interprétation ?'],
    ['POS02', { dosage: '1/2 comprimé', frequency: 'le soir', duration: '7 jours' }, 'Fraction transformée en entier.', 'Comment préserver la fraction sans la convertir en nombre d’unités entières ?'],
    ['POS03', { dosage: 'un demi comprimé', frequency: 'le soir', duration: '7 jours' }, 'Le mot demi ne participe pas à la quantité reconnue.', 'Comment préserver le texte fractionnaire sans ajouter une instruction ?'],
    ['POS04', { dosage: '500 mg', frequency: 'une fois par jour', duration: '5 jours' }, 'La masse devient doseCount sans unité ; un moment non prescrit est ajouté.', 'Comment distinguer teneur, quantité et unité, ou retirer l’interprétation ?'],
    ['POS05', { dosage: '500 mg (1 comprimé)', frequency: 'une fois par jour', duration: '5 jours' }, 'La première valeur numérique de teneur devient le nombre de comprimés.', 'Le pharmacien confirme-t-il le retrait de toute représentation qui confond teneur et unités ?'],
    ['POS06', { dosage: '2,5 ml de sirop', frequency: '3 fois par jour', duration: '5 jours' }, 'Décimale tronquée ; le rendu de forme ne conserve pas l’unité mL ; horaires ajoutés.', 'Quelle représentation conserve le volume et son unité, sans conversion choisie par le code ?'],
    ['POS07', { dosage: '1 comprimé', frequency: '2 fois par semaine', duration: '1 mois' }, 'La fréquence hebdomadaire est détectée comme nombre de prises par jour.', 'Quel contrôle empêche de transformer par semaine en par jour ?'],
    ['POS08', { dosage: '1 comprimé', frequency: 'toutes les 8 heures', duration: '48 heures' }, 'Intervalle non reconnu ; durée horaire interprétée en jours.', 'Comment préserver heures et intervalle exact sans produire une durée différente ?'],
    ['POS09', { dosage: '1 comprimé', frequency: '3 fois par jour, matin et soir', duration: '5 jours' }, 'Le nombre de prises et les deux moments se contredisent ; le résumé choisit les moments.', 'Comment demander clarification au prescripteur plutôt que choisir une instruction ?'],
    ['POS10', { dosage: '1 comprimé le matin, 2 le soir', duration: '5 jours' }, 'Une quantité unique est associée à plusieurs moments aux quantités distinctes.', 'Faut-il retirer le résumé pour toute posologie variable selon le moment ?'],
    ['POS11', { dosage: '1 comprimé', frequency: 'ne pas prendre le soir', duration: '5 jours' }, 'Le mot soir est reconnu sans tenir compte de sa négation.', 'Comment empêcher qu’une interdiction devienne une consigne positive ?'],
    ['POS12', { dosage: '1 comprimé', frequency: 'pendant le repas', duration: '1,5 semaines' }, 'Pendant le repas est classé AFTER ; fraction de durée tronquée.', 'Les relations repas et les durées doivent-elles rester verbatim dans ce cas ?'],
    ['POS13', { dosage: '1 comprimé', frequency: '8h et 20h', duration: '2 à 3 jours' }, 'Heures non reconnues ; intervalle de durée réduit au premier entier.', 'Comment éviter qu’un résumé partiel soit présenté comme instruction complète ?'],
    ['POS14', { duration: '5 jours' }, 'La durée seule n’active pas recognized ; le bloc illustré et son bouton audio restent conditionnés à recognized.', 'Quel comportement d’affichage est attendu lorsqu’une seule dimension est reconnue ?'],
  ];
  for (const [id, input, risk, question] of posologyCases) {
    const parsed = content.parsePosology(input);
    // Pas de phrase vocale produite ou simulée : ces constats sont statiques.
    cases.push(reviewCase(id, 'prescriptions', input, {
      parsed: pure(parsed),
      rendering: inspection(['apps/web/src/components/patient/PrescriptionPosology.tsx'], {
        originalTextDisplayed: true,
        illustrationsRequireRecognized: true,
        audioAvailableCondition: 'speechSupported() && parsed.recognized',
        quantityInAccessibleFragments: parsed.doseCount === 0 ? 'Le zéro est omis par filter(Boolean).' : 'Quantité issue de doseCount, sans conservation autonome de l’unité d’entrée.',
        actualSpeechNotExecuted: true,
      }),
    }, risk, question, PRESERVE_TEXT, ['REF-MEDICATION'], id === 'POS14' ? 'REVIEW' : 'BLOCKER'));
  }

  for (const flow of content.TRIAGE_FLOWS) {
    const flowInput = { flowId: flow.id, answers: {} };
    cases.push(reviewCase(`TRI01-${flow.id}`, 'triage', flowInput, {
      evaluation: pure(content.evaluateTriage(flow, {})),
      interaction: inspection(['apps/web/src/app/patient/triage/page.tsx'], { resultButtonRequiresCompleteAnswers: false }),
    }, 'Une réponse manquante compte comme NON ; un questionnaire vide permet une orientation de surveillance.', 'Quel traitement d’incomplétude doit précéder une orientation, tout en conservant l’accès à l’aide immédiate ?', 'À discuter : distinguer manquant et NON, ne pas afficher une surveillance issue d’un entretien incomplet ; accès à l’aide à faire confirmer. Aucune règle de priorité modifiée.'));

    const falseAnswers = Object.fromEntries(flow.questions.map((question) => [question.key, false]));
    cases.push(reviewCase(`TRI04-${flow.id}`, 'triage', { flowId: flow.id, answers: falseAnswers }, pure({
      outcome: content.evaluateTriage(flow, falseAnswers),
      currentHomeAdvice: { FR: snapshot.messages.fr['triage.outcome.HOME.advice'], EN: snapshot.messages.en['triage.outcome.HOME.advice'] },
    }), 'Le conseil commun de surveillance s’applique au motif choisi sans adaptation explicite à l’âge ou aux comorbidités.', 'La portée et les conseils de surveillance sont-ils adéquats pour chaque public couvert ?'));

    cases.push(reviewCase(`TRI05-${flow.id}`, 'triage', { flowId: flow.id, scenario: 'Chaque signe positif isolément ; autres réponses absentes.' }, pure(flow.questions.map((question) => ({
      questionKey: question.key, configuredSeverity: question.severity,
      outcome: content.evaluateTriage(flow, { [question.key]: true }),
    }))), 'Le fonctionnement de la table ne prouve pas la pertinence clinique de la priorité ni du délai.', 'Chaque signe, formulation, degré d’urgence et délai est-il confirmé par le référentiel applicable ?', NO_PROTOCOL, [], 'REVIEW'));
  }
  for (const [caseId, flowId, key, risk, references, populationLimit] of [
    ['TRI02', 'FEVER', 'fever_infant', 'La question bébé de moins de trois mois avec fièvre est configurée AMBER ; délai et recours doivent être arbitrés.', ['REF-INFANT-2019', 'REF-INFANT-2024'], 'Les références concernent le jeune nourrisson jusqu’à deux mois et les infections bactériennes graves à 0–59 jours ; elles ne couvrent pas automatiquement tous les moins de trois mois de cette question.'],
    ['TRI03', 'DIARRHEA', 'diarrhea_vomiting', 'La question vomit tout est configurée AMBER ; priorité et délai chez l’enfant doivent être arbitrés.', ['REF-IMCI-2014'], 'Le livret PCIME 2014 concerne ici l’enfant de deux mois à moins de cinq ans ; son usage professionnel ne se transpose pas automatiquement à tous les patients ou à une interface grand public.'],
  ]) {
    const flow = content.TRIAGE_FLOWS.find((entry) => entry.id === flowId);
    cases.push(reviewCase(caseId, 'triage', { flowId, answers: { [key]: true } }, pure({ outcome: content.evaluateTriage(flow, { [key]: true }), questionFR: snapshot.messages.fr[`triage.q.${key}`] }), `${risk} ${populationLimit}`, 'Quel degré de priorité, délai exact et périmètre de population le professionnel confirme-t-il ? Aucun changement AMBER/RED n’est appliqué.', NO_PROTOCOL, references));
  }

  const birthDate = '2026-01-31T00:00:00.000Z';
  cases.push(reviewCase('PEV01', 'pev', { birthDate, doseCodes: ['RR1', 'RR2'] }, pure(content.buildVaccinationSchedule(new Date(birthDate)).filter((entry) => ['RR1', 'RR2'].includes(entry.vaccineCode)).map((entry) => ({ ...entry, dueDate: entry.dueDate.toISOString() }))), 'Les âges annoncés en mois utilisent une constante de trente jours par mois.', 'Le programme applicable confirme-t-il ces âges et cette méthode de calcul, ou demande-t-il un autre diff explicite ?'));
  const dueDate = '2026-10-14T00:00:00.000Z';
  const now = '2026-10-14T12:00:00.000Z';
  cases.push(reviewCase('PEV02', 'pev', { status: 'SCHEDULED', dueDate, now }, pure(content.vaccinationDisplayStatus({ status: 'SCHEDULED', dueDate: new Date(dueDate) }, new Date(now))), 'Une échéance à minuit est dite en retard dès midi le même jour ; le même helper sert aux CPN.', 'La notion de retard doit-elle se baser sur une date civile et quel fuseau cible ?'));
  cases.push(reviewCase('PEV03', 'pev', { scenario: 'Dose marquée faite par le patient ; calendrier ancien sans rattrapage calculé.' }, {
    status: pure(content.vaccinationDisplayStatus({ status: 'DONE', dueDate: new Date(dueDate) }, new Date(now))),
    interaction: inspection(['apps/web/src/app/patient/vaccinations/page.tsx', 'apps/api/src/modules/vaccinations/vaccinations.routes.ts'], { patientCanDeclareDone: true, clinicalCatchUpProtocolNotEstablishedHere: true }),
  }, 'Un statut autodéclaré peut être confondu avec administration attestée ; aucune stratégie de rattrapage n’est validée.', 'Comment distinguer déclaration et attestation et orienter un carnet incertain vers un professionnel ?'));

  for (const [caseId, referenceId, topic] of [
    ['PEV04', 'REF-MENA', 'vaccination contre le méningocoque A'],
    ['PEV05', 'REF-MALARIA-2024', 'vaccination contre le paludisme, référence 2024'],
    ['PEV06', 'REF-MALARIA-2025', 'vaccination contre le paludisme, référence 2025'],
    ['PEV07', 'REF-HPV', 'vaccination HPV'],
  ]) {
    cases.push(reviewCase(caseId, 'pev', { externalReferenceId: referenceId, topic }, pure({ embeddedSchedule: content.PEV_SCHEDULE }), 'Le schéma embarqué doit être confronté à une référence nationale actuelle ; l’applicabilité et la population cible ne sont pas déterminées par cet outil.', `Le référent PEV confirme-t-il l’applicabilité de la référence sur ${topic}, le schéma exact, la cible et sa date d’effet ?`, 'À discuter : obtenir un protocole national explicite, confronter le calendrier et les cohortes couvertes ; aucun vaccin, âge ou dose ajouté automatiquement.', [referenceId]));
  }

  cases.push(reviewCase('CPN01', 'maternity', { lmpDate: '2026-01-01T00:00:00.000Z' }, pure({
    termDays: content.TERM_DAYS,
    contacts: content.ANC_SCHEDULE,
    objectives: snapshot.maternity.contacts.map((entry) => entry.objective),
    dueDate: content.computeDueDate(new Date('2026-01-01T00:00:00.000Z')).toISOString(),
    visits: content.buildAntenatalSchedule(new Date('2026-01-01T00:00:00.000Z')).map((entry) => ({ ...entry, dueDate: entry.dueDate.toISOString() })),
  }), 'La mention historique calendrier VALIDÉ ne constitue pas un contreseing ; la première échéance est fixée à douze semaines. L’actualisation 2022 citée est spécifique à l’échographie, pas une validation globale de nos objectifs.', 'Le calendrier, la notion de premier contact au plus tard à douze semaines et chacun des objectifs sont-ils confirmés sur cette version ?', NO_PROTOCOL, ['REF-ANC-2016', 'REF-ANC-CONTACTS', 'REF-ANC-2022']));
  const cpnNow = '2026-10-14T00:00:00.000Z';
  const lmpDates = ['2026-10-15T00:00:00.000Z', '2025-10-14T00:00:00.000Z'];
  cases.push(reviewCase('CPN02', 'maternity', { now: cpnNow, lmpDates }, {
    gestationalWeeks: pure(lmpDates.map((lmpDate) => ({ lmpDate, weeks: content.gestationalWeeks(new Date(lmpDate), new Date(cpnNow)) }))),
    validation: inspection(['apps/api/src/modules/maternity/maternity.routes.ts', 'apps/web/src/app/patient/maternity/page.tsx'], { apiDateSchema: 'z.coerce.date(), sans bornes temporelles', uiMaxToday: true }),
  }, 'Une DDR incohérente peut être masquée par le bornage des semaines à zéro ou quarante-deux.', 'Quel contrôle et quelle confirmation clinique faut-il pour DDR future, ancienne ou incertaine, sans créer un seuil médical ?'));

  cases.push(reviewCase('VIT01', 'vitals', { scenario: 'Valeurs négatives, zéro, très grandes ou décimales ; unité et contexte de mesure.' }, inspection(['apps/web/src/app/patient/vitals/page.tsx', 'apps/api/src/modules/dmp/dmp.routes.ts'], {
    inputAttributes: 'type=number, inputMode=decimal, aucun min/max/step explicite',
    saveCondition: 'Au moins une valeur non null et non NaN après Number() ; aucune borne chiffrée.',
    apiDataSchema: 'z.unknown()',
  }), 'Aucune borne clinique chiffrée ni contrôle par unité n’est établi dans cette portée ; les décimales dépendent aussi de la saisie sur appareil. La référence sur les tensiomètres concerne dispositif et méthode, pas des bornes de saisie pour toutes nos constantes.', 'Quels champs, unités, plausibilité et comportements de correction le clinicien fournit-il explicitement ?', NO_PROTOCOL, ['REF-BP']));
  cases.push(reviewCase('VIT02', 'vitals', { systolic: 120, diastolic: null, pulse: null, glucose: null, weight: null }, inspection(['apps/web/src/app/patient/vitals/page.tsx'], {
    admissionByCodeInspection: 'La systolique seule satisfait hasValue.',
    summaryByCodeInspection: 'La tension ne figure que si systolique ET diastolique présentes ; le résumé retombe sur vitals.empty.',
  }), 'Une valeur enregistrable peut devenir invisible dans le résumé et être présentée comme absence de mesure.', 'Les valeurs partielles doivent-elles être acceptées et comment les afficher ou les faire corriger ?'));
  cases.push(reviewCase('VIT03', 'vitals', { scenario: 'Mesure réelle antérieure à la saisie ou création de l’entrée.' }, inspection(['apps/web/src/app/patient/vitals/page.tsx'], {
    measuredAtOnSave: 'new Date().toISOString()',
    displayedAndFilteredTimestamp: 'record.createdAt',
  }), 'Le temps de création est affiché dans un historique de mesures ; aucune saisie du temps réel de mesure n’est prévue ici.', 'Quelle date et quel contexte doivent être recueillis et montrés sans confondre mesure et saisie ?'));

  // Résultats par inspection de la règle textuelle ; pas d’exécution du module
  // de prescriptions, qui ne fait pas partie du chargeur pur autorisé L9.
  cases.push(reviewCase('ALL01', 'prescriptions', { pairs: [
    { medicationName: 'Pénicilline', allergy: 'penicilline' },
    { medicationName: 'Paracétamol', allergy: 'Paracetamol' },
  ] }, inspection(['apps/api/src/modules/prescriptions/prescriptions.rules.ts'], {
    algorithm: 'trim + toLowerCase, correspondance par inclusion dans un sens ou l’autre, sans normalisation d’accents.',
    conflictsByCodeInspection: [[], []],
  }), 'Une différence d’accent empêche la correspondance textuelle ; absence d’alerte ne signifie pas absence de risque.', 'Quel nommage contrôlé et quelle présentation de cette limite les signataires demandent-ils ?', NO_PROTOCOL, ['REF-MEDICATION']));
  cases.push(reviewCase('ALL02', 'prescriptions', { medicationName: 'Amoxicilline', allergy: 'pénicilline' }, inspection(['apps/api/src/modules/prescriptions/prescriptions.rules.ts', 'apps/api/src/modules/prescriptions/prescriptions.service.ts'], {
    conflictsByCodeInspection: [],
    classOrInteractionOntology: false,
    explicitOverrideOfDetectedConflictExists: true,
  }), 'La sous-chaîne ne modélise pas les classes, synonymes ou croisements ; le sens clinique doit être examiné par médecin et pharmacien.', 'La limite et l’absence d’alerte sont-elles présentées correctement ? Quelle évolution explicitement référencée est demandée ?', NO_PROTOCOL, ['REF-MEDICATION']));

  cases.push(reviewCase('PHRASE01', 'phrasebook', { scenario: 'Consignes et urgences embarquées, puis traductions natives.' }, pure({
    total: content.PHRASEBOOK.length,
    instructionAndPosologyPhrases: content.PHRASEBOOK.filter((entry) => ['INSTRUCTION', 'POSOLOGY', 'EMERGENCY'].includes(entry.category)),
    nativePresence: ['FON', 'YOR'].map((locale) => ({ locale, present: content.PHRASEBOOK.filter((entry) => typeof entry.text[locale] === 'string' && entry.text[locale].trim()).length })),
  }), 'Une consigne générale peut être prise comme instruction applicable hors contexte ; présence d’une traduction ne vaut pas validation.', 'Chaque phrase clinique, généralité et urgence conserve-t-elle le sens et le contexte après double relecture native ?'));
  cases.push(reviewCase('AUDIO01', 'phrasebook', { locales: ['FON', 'YOR'], scenario: 'Texte natif présent dans question, consigne de posologie ou article.' }, inspection(['apps/web/src/lib/speech.ts', 'apps/web/src/components/patient/PrescriptionPosology.tsx', 'apps/web/src/app/patient/triage/page.tsx', 'apps/web/src/app/patient/education/page.tsx'], {
    FON: 'utterance.lang = fr-FR', YOR: 'utterance.lang = fr-FR',
    textReplacedByFrenchInSpeechHelper: false,
    actualSpeechNotExecuted: true,
    alsoConcernsScopes: ['triage', 'prescriptions', 'education'],
  }), 'Le texte natif est transmis avec un paramètre de voix française ; l’intelligibilité et la prononciation native ne sont pas établies.', 'Quelle langue est réellement prononcée et comprise sur les appareils cibles, avec validation par deux natifs ?', 'À discuter : vérifier voix disponibles et écoutes réelles ; indiquer un repli dans la langue réellement parlée ou retirer l’audio non établi. Ne pas annoncer une voix native avec un simple paramètre fr-FR.'));

  cases.push(reviewCase('EDU01', 'education', { scenario: 'Corpus réellement publié en base ; inventaire non fourni.' }, inspection(['apps/api/src/modules/education/education.service.ts', 'apps/api/src/modules/education/education.rules.ts', 'apps/web/src/app/patient/education/page.tsx', 'apps/api/prisma/seed.ts'], {
    productionDatabaseRead: false,
    actualPublishedCorpus: 'UNKNOWN',
    seedIsNotRuntimeInventory: true,
    requiredInventory: ['Identifiant/version d’article', 'Texte publié exact par langue', 'Statut de publication', 'Empreinte par version/langue', 'Référence privée du retour clinique et linguistique'],
    appWorkflowIsNotIndependentClinicalCounterSignature: true,
  }), 'Le seed et le statut applicatif ne prouvent pas les textes actuellement servis aux patients ; une validation globale de ce corpus serait sans objet connu.', 'Quel inventaire exact et quelles pièces de relecture couvrent chaque article publié et sa traduction ?', 'À discuter : obtenir un export autorisé hors données patient, figer l’inventaire/version/empreintes puis faire relire le corpus réel. Aucune connexion de production ni validation de seed comme corpus réel.'));

  const reserves = [
    ['RES-POSOLOGIE', 'prescriptions', 'Fractions, unités, négation, fréquence, durée et doses variables produisent des interprétations divergentes ; arbitrage et correction explicites requis.'],
    ['RES-TRIAGE', 'triage', 'Questionnaire incomplet assimilé à réponses négatives ; priorités et délais par public à confirmer.'],
    ['RES-PEV', 'pev', 'Référentiel national courant, vaccins concernés, âges/dates, retards et rattrapage non contre-signés.'],
    ['RES-CPN', 'maternity', 'Huit contacts/objectifs, estimation et limites de DDR restent à faire contre-signer.'],
    ['RES-VITALS', 'vitals', 'Unités, plausibilité, données partielles et horodatage restent à définir et à relire.'],
    ['RES-ALLERGIES', 'prescriptions', 'Recherche textuelle limitée ; aucun moteur de classe ou absence de risque clinique ne peut être déduit.'],
    ['RES-PHRASIER', 'phrasebook', 'Phrases cliniques et traductions natives à relire ; aucune signature fournie par cette préparation.'],
    ['RES-AUDIO', 'phrasebook', 'FON/YOR transmis avec fr-FR ; écoute/compréhension sur appareils cibles non établie.'],
    ['RES-EDUCATION', 'education', 'Inventaire des articles réellement publiés inconnu ; seed distinct du corpus de production.'],
  ].map(([id, scope, summary]) => ({ id, scope, priority: 'BLOCKER', summary }));

  // Normalise les objets issus du VM et conserve les colonnes humaines vierges.
  // BLOCKER désigne une réserve de relecture ouverte : ni décision de GO, ni
  // approbation/règle clinique produite par l’outil.
  return JSON.parse(JSON.stringify({
    scopes: CLINICAL_SCOPES.map((scope) => ({ scope, contentSha256: contentHash(snapshot, scope), professionalProfile: PROFILES[scope], reviewQuestions: QUESTIONS[scope] })),
    reserves,
    cases,
  }));
}
