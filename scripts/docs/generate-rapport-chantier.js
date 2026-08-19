// ─────────────────────────────────────────────────────────────
// Génère le RAPPORT DE CHANTIER (DOCX opposable) pour le reporting NEXT IMPACT.
//
//   export NODE_PATH=$(npm root -g)   # ou un dossier contenant `docx`
//   node scripts/docs/generate-rapport-chantier.js [sortie.docx]
//   python <skill docx>/scripts/office/validate.py <sortie>.docx   # obligatoire (§7)
//
// Exigences NEXT IMPACT (CLAUDE.md §7) : page de garde conventionnée, marqueurs
// « Conforme audit » en pied de page, structure PTF en QUATRE parties.
// Conventions docx-js (§8) : A4 explicite, un Paragraph par ligne (jamais de \n),
// tables columnWidths + width DXA par cellule, ShadingType.CLEAR, puces natives.
//
// ⚠️ Les CHIFFRES de ce rapport sont mesurés sur le dépôt (cf. partie III) et non
// re-saisis à la main ailleurs : toute évolution impose de régénérer le document.
// ─────────────────────────────────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  Footer, Header, PageNumber, PageBreak,
} = require('docx');

const NAVY = '1E2347';
const GREEN = '2E7D46';
const RED = 'B3261E';
const AMBER = 'B07D1E';
const GREY = '6B6155';
const LIGHT = 'F2EEE7';
const CONTENT_W = 9026; // A4 (11906) − marges 1440×2
const FONT = 'Calibri';

// ── Helpers de mise en forme ────────────────────────────────────────────────
function P(text, opts = {}) {
  return new Paragraph({
    alignment: opts.align,
    spacing: { after: opts.after ?? 120 },
    children: [new TextRun({
      text,
      bold: opts.bold,
      italics: opts.italics,
      color: opts.color ?? '000000',
      size: opts.size ?? 21,
      font: FONT,
    })],
  });
}

function H(text, level) {
  return new Paragraph({
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 320 : 220, after: 140 },
    children: [new TextRun({
      text,
      bold: true,
      color: level === HeadingLevel.HEADING_1 ? NAVY : GREEN,
      size: level === HeadingLevel.HEADING_1 ? 28 : 24,
      font: FONT,
    })],
  });
}

function bullet(text, opts = {}) {
  return new Paragraph({
    bullet: { level: opts.level ?? 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, size: 21, font: FONT, color: opts.color ?? '000000', bold: opts.bold })],
  });
}

function cell(text, opts = {}) {
  return new TableCell({
    width: { size: opts.width, type: WidthType.DXA },
    shading: opts.shade ? { type: ShadingType.CLEAR, fill: opts.shade, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      spacing: { after: 0 },
      children: [new TextRun({ text, bold: opts.bold, color: opts.color ?? '000000', size: opts.size ?? 19, font: FONT })],
    })],
  });
}

function table(rows, widths) {
  return new Table({
    columnWidths: widths,
    width: { size: CONTENT_W, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'CCC4B8' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCC4B8' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'CCC4B8' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'CCC4B8' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'DDD6CB' },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'DDD6CB' },
    },
    rows,
  });
}

/** Ligne d'en-tête de tableau (grisée, répétée en cas de saut de page). */
function headRow(labels, widths) {
  return new TableRow({
    tableHeader: true,
    children: labels.map((l, i) => cell(l, { width: widths[i], bold: true, shade: LIGHT, color: NAVY })),
  });
}

function row(values, widths, opts = {}) {
  return new TableRow({
    children: values.map((v, i) => cell(v, { width: widths[i], color: i === 0 ? (opts.firstColor ?? '000000') : '000000', bold: i === 0 && opts.firstBold })),
  });
}

// ── Données du rapport (période 18–19 août 2026) ────────────────────────────
const PERIODE = { debut: '18 août 2026', fin: '19 août 2026', base: '54ade4b', tete: '4b0fa9d' };

const LOTS = [
  ['#135', 'Lot 5', 'Registre d’audit unique ; audit fonctionnel complet du produit', 'C5, D8, D9'],
  ['#136', '—', 'Retrait conservatoire du moyen de paiement « Wallet »', 'D2'],
  ['#137', 'Lot 7', 'Téléconsultation : ouverture et clôture de séance par le médecin', 'D1'],
  ['#138', 'Lot 9', 'File de relecture médicale des contenus de prévention', 'D3'],
  ['#139', 'Lot 10', 'Fiche professionnelle, tri des rendez-vous, clôture d’alerte SOS', 'D4, D5, D6'],
  ['#140', 'Lot 11', 'Suppression d’un module sans consommateur', 'D7'],
  ['#141', 'Lot 8', 'Intégration FedaPay (bac à sable et production) ; paiement par portefeuille', 'D2'],
  ['#142', 'Lot 6', 'Correction de l’infrastructure de déploiement', 'Infrastructure'],
];

const MAJEURS = [
  {
    titre: 'Vérification de signature des notifications de paiement inopérante',
    constat:
      'Le contrôle d’authenticité des notifications envoyées par l’opérateur de paiement reposait sur un format de signature erroné : la signature était calculée sur le corps du message seul, alors que l’opérateur signe le couple horodatage + message.',
    consequence:
      'En production, toute notification de paiement authentique aurait été rejetée. Aucun paiement par Mobile Money n’aurait été confirmé et aucune recharge de portefeuille créditée ; seul le rapprochement nocturne aurait régularisé les statuts, avec jusqu’à vingt-quatre heures de retard.',
    detection:
      'Invisible pour la suite de tests : celle-ci fabriquait la signature avec la même formule erronée que celle qu’elle vérifiait. Le test confirmait l’anomalie au lieu de la révéler.',
    correctif:
      'Format aligné sur la spécification de l’opérateur (horodatage, tolérance anti-rejeu, rotation de secret). Le générateur de signature de test est désormais celui du code vérifié, et un test refuse explicitement l’ancien format.',
  },
  {
    titre: 'Le paiement par portefeuille ne débitait aucun solde',
    constat:
      'L’interface proposait le portefeuille comme moyen de paiement d’une consultation. Le traitement l’acheminait vers l’opérateur externe sans jamais débiter le solde : le portefeuille était rechargeable mais non dépensable.',
    consequence:
      'Outre la promesse non tenue, un seul appui créait un paiement en attente qui verrouillait définitivement le rendez-vous : aucun autre moyen de paiement n’était plus accepté pour celui-ci.',
    detection:
      'Écart D2 de l’audit fonctionnel ; le verrouillage du rendez-vous n’a été mesuré qu’au moment du correctif.',
    correctif:
      'Retrait immédiat du moyen de paiement (mesure conservatoire), puis mise en œuvre réelle : débit et enregistrement du paiement validés ou annulés ensemble dans une transaction unique.',
  },
  {
    titre: 'Rappels de vaccination et de suivi de grossesse jamais déclenchés',
    constat:
      'Les générateurs de rappels du Programme élargi de vaccination et des consultations prénatales étaient développés et testés, mais absents de la planification des tâches du serveur.',
    consequence:
      'Aucun rappel de vaccination ni de suivi de grossesse n’aurait été émis, sans aucun signal d’alerte. Deux fonctionnalités destinées aux mères et aux nourrissons auraient été livrées et inertes.',
    detection:
      'Découvert lors de l’audit de l’infrastructure de déploiement (lot 6).',
    correctif:
      'Planification ajoutée. Une règle de développement est consignée : tout nouveau traitement périodique rejoint la planification dans le même lot que sa livraison.',
  },
  {
    titre: 'Pièces jointes du dossier médical non sauvegardées',
    constat:
      'La sauvegarde nocturne chiffrée ne couvrait que la base de données. Les pièces jointes du dossier médical partagé — donc des données de santé — sont stockées hors base et n’étaient pas archivées.',
    consequence:
      'Une restauration aurait produit un dossier médical dont les pièces jointes auraient disparu, sans perte apparente côté base.',
    detection:
      'Audit de l’infrastructure (lot 6). Le point figurait comme case à cocher manuelle dans la procédure, ce qui ne constitue pas une sauvegarde.',
    correctif:
      'Archive chiffrée supplémentaire du magasin de fichiers, même clé et même rétention, avec alerte explicite si le répertoire est introuvable.',
  },
];

const ECARTS = [
  ['D1', 'Téléconsultation sans interface médecin : aucune séance ne pouvait être ouverte', 'Majeur', 'Lot 7'],
  ['D2', 'Paiement par portefeuille sans débit du solde', 'Majeur', 'Lots 8 et #136'],
  ['D3', 'Chaîne éditoriale bloquée : aucun contenu de prévention publiable', 'Majeur', 'Lot 9'],
  ['D4', 'Tarif de consultation non modifiable par le médecin', 'Moyen', 'Lot 10'],
  ['D5', 'Tri des demandes de rendez-vous sans interface', 'Moyen', 'Lot 10'],
  ['D6', 'Alerte d’urgence sans clôture possible', 'Moyen', 'Lot 10'],
  ['D7', 'Module sans consommateur ni persistance', 'Faible', 'Lot 11'],
  ['D8', 'Modèle de configuration périmé empêchant le démarrage sur poste neuf', 'Faible', 'Lot 5'],
  ['D9', 'Indicateurs de documentation désynchronisés', 'Faible', 'Lot 5'],
  ['D10', 'Six libellés d’urgence non traduits en fɔ̀ngbè et yorùbá', 'Moyen', 'Repli accepté'],
  ['C5', 'Second journal d’audit sans chaînage cryptographique', 'Faible', 'Lot 5'],
];

const INDICATEURS = [
  ['Tests automatisés au vert', '337', '350', '+13'],
  ['dont tests de l’interface', '32', '32', '='],
  ['Scénarios de bout en bout', '8', '8', '='],
  ['Points d’entrée de l’API', '163', '163', '='],
  ['Écrans de l’application', '64', '66', '+2'],
  ['Modules fonctionnels', '28', '27', '−1'],
  ['Modèles de données', '49', '48', '−1'],
  ['Dépendances externes ajoutées', '—', '0', '0'],
];

// ── Document ────────────────────────────────────────────────────────────────
async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const children = [];

  // ── Page de garde conventionnée ──
  children.push(
    new Paragraph({
      spacing: { before: 1200, after: 120 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'DigiSanté Mobile', bold: true, size: 40, color: NAVY, font: FONT })],
    }),
    new Paragraph({
      spacing: { after: 80 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Rapport de chantier', size: 32, color: GREEN, font: FONT })],
    }),
    P(`Période du ${PERIODE.debut} au ${PERIODE.fin}`, { align: AlignmentType.CENTER, color: GREY, size: 22, after: 400 }),
    P('Programme NEXT IMPACT — FP2E / Sèmè City / Banque Mondiale', { align: AlignmentType.CENTER, color: GREY, size: 20, after: 60 }),
    P('Convention FP2E/NI/IDÉ/2025', { align: AlignmentType.CENTER, color: GREY, size: 20, after: 60 }),
    P('Bénéficiaire : SEGLA E. Ulrich Gislain — porteur du projet', { align: AlignmentType.CENTER, color: GREY, size: 20, after: 400 }),
    P('Audit fonctionnel de la plateforme et correction de la totalité des écarts identifiés.', { align: AlignmentType.CENTER, italics: true, size: 21, after: 120 }),
    P(`Document établi le ${today}. Rapport technique de suivi — ne constitue pas une pièce fiduciaire.`, { align: AlignmentType.CENTER, italics: true, color: GREY, size: 18 }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ── Sommaire des quatre parties (structure PTF) ──
  children.push(
    H('Sommaire', HeadingLevel.HEADING_1),
    P('Le présent rapport suit la structure en quatre parties attendue par les partenaires techniques et financiers.'),
    bullet('Partie I — Contexte, objet et méthode'),
    bullet('Partie II — Travaux réalisés sur la période'),
    bullet('Partie III — Résultats et indicateurs vérifiables'),
    bullet('Partie IV — Risques, points ouverts et suites'),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ══ PARTIE I ══
  children.push(
    H('Partie I — Contexte, objet et méthode', HeadingLevel.HEADING_1),
    H('I.1 Contexte', HeadingLevel.HEADING_2),
    P('DigiSanté Mobile est une application web progressive de santé numérique destinée au Bénin, conçue pour fonctionner hors connexion et en quatre langues (français, anglais, fɔ̀ngbè, yorùbá). Elle répond aux difficultés d’accès aux soins en zone rurale : dossiers médicaux perdus, faible couverture réseau, éloignement des professionnels de santé.'),
    P('À l’ouverture de la période, la plateforme était fonctionnellement complète et sa phase annoncée était la mise en production. Les travaux rapportés ici portent sur la vérification de cette complétude, et non sur l’ajout de nouvelles fonctions.'),

    H('I.2 Objet de la période', HeadingLevel.HEADING_2),
    P('L’objet n’était pas de vérifier la qualité du code, mais de répondre à une question d’usage : l’utilisateur peut-il réellement faire ce que le produit lui promet ?'),

    H('I.3 Méthode', HeadingLevel.HEADING_2),
    P('Chaque point d’entrée du serveur a été confronté aux appels réellement émis par l’interface, par appariement automatique des adresses. Chaque point d’entrée sans appelant a ensuite été vérifié manuellement, afin d’écarter les faux positifs et de qualifier la conséquence pour l’utilisateur.'),
    P('L’ensemble des indicateurs de la partie III est mesuré par exécution sur le dépôt, et non repris de la documentation. Les commandes de contrôle sont reproductibles à l’identique.'),
    P('Chaque correction a fait l’objet d’une demande d’intégration distincte, passée en intégration continue (contrôles de typage, d’style, tests unitaires, tests de bout en bout) avant fusion sur la branche de production.'),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ══ PARTIE II ══
  children.push(
    H('Partie II — Travaux réalisés sur la période', HeadingLevel.HEADING_1),
    H('II.1 Livraisons', HeadingLevel.HEADING_2),
    P('Huit demandes d’intégration ont été livrées et fusionnées, sans ajout d’aucune dépendance externe.'),
  );
  {
    const W = [1100, 1000, 4926, 2000];
    children.push(table([
      headRow(['Référence', 'Lot', 'Objet', 'Écarts traités'], W),
      ...LOTS.map((l) => row(l, W, { firstBold: true, firstColor: NAVY })),
    ], W));
    children.push(P(' ', { after: 160 }));
  }

  children.push(
    H('II.2 Anomalies majeures corrigées', HeadingLevel.HEADING_2),
    P('Quatre anomalies auraient atteint les usagers en production. Aucune n’était détectable par la suite de tests telle qu’elle existait au début de la période. Elles sont exposées ci-après avec leur conséquence, leur mode de détection et le correctif apporté.'),
  );
  MAJEURS.forEach((m, i) => {
    const W = [2200, 6826];
    children.push(H(`II.2.${i + 1} ${m.titre}`, HeadingLevel.HEADING_2));
    children.push(table([
      new TableRow({ children: [cell('Constat', { width: W[0], bold: true, shade: LIGHT, color: NAVY }), cell(m.constat, { width: W[1] })] }),
      new TableRow({ children: [cell('Conséquence évitée', { width: W[0], bold: true, shade: LIGHT, color: NAVY }), cell(m.consequence, { width: W[1], color: RED })] }),
      new TableRow({ children: [cell('Détection', { width: W[0], bold: true, shade: LIGHT, color: NAVY }), cell(m.detection, { width: W[1] })] }),
      new TableRow({ children: [cell('Correctif', { width: W[0], bold: true, shade: LIGHT, color: NAVY }), cell(m.correctif, { width: W[1], color: GREEN })] }),
    ], W));
    children.push(P(' ', { after: 160 }));
  });

  children.push(H('II.3 Ensemble des écarts identifiés et traités', HeadingLevel.HEADING_2));
  {
    const W = [900, 5126, 1400, 1600];
    children.push(table([
      headRow(['Réf.', 'Constat', 'Gravité', 'Traitement'], W),
      ...ECARTS.map((e) => new TableRow({
        children: [
          cell(e[0], { width: W[0], bold: true, color: NAVY }),
          cell(e[1], { width: W[1] }),
          cell(e[2], { width: W[2], color: e[2] === 'Majeur' ? RED : e[2] === 'Moyen' ? AMBER : GREY, bold: true }),
          cell(e[3], { width: W[3] }),
        ],
      })),
    ], W));
    children.push(P(' ', { after: 160 }));
  }

  children.push(
    H('II.4 Validation des contenus cliniques', HeadingLevel.HEADING_2),
    P('Les contenus à portée clinique embarqués dans l’application — arbre d’orientation fondé sur les signes de danger de l’Organisation mondiale de la santé, calendrier vaccinal, calendrier de consultations prénatales, phrasier médical, format de matricule professionnel — ont été retenus en l’état par décision du porteur du projet du 19 août 2026, afin de lever le blocage de mise en service.'),
    P('Cette validation est celle du porteur en sa qualité de responsable de la mise en œuvre. Elle ne constitue pas la signature d’un professionnel de santé habilité : à cette date, ni médecin ni programme national n’a contresigné. La recommandation de faire contresigner l’arbre d’orientation et le calendrier vaccinal est maintenue, et le dossier prévu à cet effet demeure disponible et prêt à signer.', { bold: true }),
    P('Ces écrans restent des aides à l’orientation et au suivi, à biais conservateur — en cas de doute, l’usager est invité à consulter. Ils ne constituent en aucun cas un diagnostic, et les libellés affichés le rappellent. Cette qualification n’est pas modifiée par la décision ci-dessus.'),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ══ PARTIE III ══
  children.push(
    H('Partie III — Résultats et indicateurs vérifiables', HeadingLevel.HEADING_1),
    H('III.1 Indicateurs de la période', HeadingLevel.HEADING_2),
    P(`Périmètre mesuré : de la révision ${PERIODE.base} à la révision ${PERIODE.tete} de la branche de production.`),
  );
  {
    const W = [4026, 1600, 1600, 1800];
    children.push(table([
      headRow(['Indicateur', 'Début', 'Fin', 'Variation'], W),
      ...INDICATEURS.map((i) => new TableRow({
        children: [
          cell(i[0], { width: W[0], bold: true, color: NAVY }),
          cell(i[1], { width: W[1] }),
          cell(i[2], { width: W[2] }),
          cell(i[3], { width: W[3], color: i[3].startsWith('+') ? GREEN : i[3] === '=' || i[3] === '0' ? GREY : AMBER, bold: true }),
        ],
      })),
    ], W));
    children.push(P(' ', { after: 160 }));
  }
  children.push(
    P('La stabilité du nombre de points d’entrée traduit un solde : deux ajoutés au titre des nouvelles fonctions médecin, deux retirés avec le module supprimé. Le volume de code ajouté sur la période s’élève à 53 fichiers modifiés, 2 542 lignes ajoutées et 481 supprimées.'),

    H('III.2 Contrôles exécutés', HeadingLevel.HEADING_2),
    P('Les contrôles suivants sont au vert sur la révision finale et rejoués automatiquement à chaque intégration :'),
    bullet('contrôle de typage sur les trois projets du dépôt ;'),
    bullet('contrôle de style, sans avertissement ;'),
    bullet('350 tests automatisés (318 côté serveur, 32 côté interface) ;'),
    bullet('8 scénarios de bout en bout sur la pile réelle, navigateur compris ;'),
    bullet('compilation des deux applications ;'),
    bullet('couverture linguistique : anglais complet ; fɔ̀ngbè et yorùbá à 93 %.'),

    H('III.3 Conformité et protection des données', HeadingLevel.HEADING_2),
    P('Les travaux de la période renforcent la conformité au regard de la loi n° 2017-20 et du règlement général sur la protection des données :'),
    bullet('journal d’audit désormais unique et intégralement chaîné par empreinte cryptographique, levant l’ambiguïté d’un second registre non protégé ;'),
    bullet('sauvegarde chiffrée étendue aux pièces jointes du dossier médical, jusque-là non archivées ;'),
    bullet('suppression des jetons de session des journaux du serveur mandataire, où ils étaient inscrits en clair ;'),
    bullet('cloisonnement vérifié sur les nouvelles fonctions : clôture d’alerte limitée à son auteur, relecture des contenus médicaux refusée à l’administrateur.'),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ══ PARTIE IV ══
  children.push(
    H('Partie IV — Risques, points ouverts et suites', HeadingLevel.HEADING_1),
    H('IV.1 Points ouverts', HeadingLevel.HEADING_2),
    P('À la clôture de la période, aucun écart fonctionnel n’est ouvert. Deux points subsistent, de nature non technique.'),
  );
  {
    const W = [2600, 4426, 2000];
    children.push(table([
      headRow(['Point', 'Nature', 'Responsable'], W),
      new TableRow({ children: [
        cell('Libellés d’urgence non traduits', { width: W[0], bold: true, color: NAVY }),
        cell('Six libellés de clôture d’alerte restent en français et en anglais. Le repli en français est accepté à titre transitoire par décision du porteur ; un locuteur fɔ̀ngbè ou yorùbá verra donc du français sur cet écran. Les libellés sont extraits et prêts pour une relecture par des locuteurs natifs.', { width: W[1] }),
        cell('Porteur / traducteurs natifs', { width: W[2] }),
      ] }),
      new TableRow({ children: [
        cell('Mise en service sur serveur', { width: W[0], bold: true, color: NAVY }),
        cell('Les scripts d’installation, de sauvegarde et de déploiement continu sont prêts et corrigés. L’exécution requiert un serveur, un nom de domaine et les secrets de production, qui ne figurent pas dans le dépôt.', { width: W[1] }),
        cell('Porteur / hébergeur', { width: W[2] }),
      ] }),
    ], W));
    children.push(P(' ', { after: 160 }));
  }

  children.push(
    H('IV.2 Risques résiduels', HeadingLevel.HEADING_2),
    P('Deux risques sont assumés et tracés :'),
    bullet('Contenus cliniques retenus sans contreseing d’un professionnel de santé. Risque atténué par le biais conservateur des arbres d’orientation, par les avertissements affichés à l’usager et par la nature non diagnostique des écrans. Levée recommandée dès qu’un interlocuteur médical est disponible.'),
    bullet('Affichage en français des libellés d’urgence pour les locuteurs fɔ̀ngbè et yorùbá. Risque atténué par la présence de pictogrammes et par le caractère limité du périmètre concerné, mais à lever avant tout déploiement à grande échelle.'),

    H('IV.3 Enseignements pour la suite', HeadingLevel.HEADING_2),
    P('Deux constats structurants ressortent de la période et ont été inscrits dans les règles de développement du projet :'),
    bullet('Un module développé et testé mais qu’aucun écran n’appelle constitue un travail achevé à quatre-vingt-dix pour cent, dont les dix pour cent manquants sont les seuls que l’usager perçoit. La quasi-totalité des écarts identifiés relève de ce schéma.'),
    bullet('Une suite de tests au vert mesure la cohérence du logiciel avec lui-même, non sa conformité au monde extérieur. Les contrats externes — format de signature d’un partenaire de paiement, planification des tâches, contenu des sauvegardes — se vérifient contre leur source et non contre les hypothèses du projet.'),

    H('IV.4 Prochaines étapes', HeadingLevel.HEADING_2),
    bullet('Ouverture du compte auprès de l’opérateur de paiement et saisie des clés ; la bascule du mode simulé au mode réel s’opère sans nouvelle livraison.'),
    bullet('Mise en service sur le serveur, selon la procédure de déploiement à jour.'),
    bullet('Relecture des six libellés d’urgence par des locuteurs natifs.'),
    bullet('Contreseing médical des contenus cliniques dès qu’un interlocuteur est disponible.'),
  );

  // ── Attestation ──
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(
    H('Attestation', HeadingLevel.HEADING_1),
    P('Je soussigné, porteur du projet DigiSanté Mobile, atteste de l’exactitude des travaux et des indicateurs présentés dans ce rapport pour la période du 18 au 19 août 2026, et de la traçabilité des corrections dans le dépôt de code du projet.'),
    P('J’atteste également avoir retenu en l’état les contenus à portée clinique de l’application, en connaissance de l’absence de contreseing d’un professionnel de santé à cette date, et de la recommandation maintenue de l’obtenir.'),
    P(' ', { after: 240 }),
  );
  {
    const W = [3000, 6026];
    const line = (l, v) => new TableRow({ children: [cell(l, { width: W[0], bold: true, shade: LIGHT, color: NAVY }), cell(v, { width: W[1] })] });
    children.push(table([
      line('Nom et qualité', 'SEGLA E. Ulrich Gislain — porteur du projet'),
      line('Programme', 'NEXT IMPACT — convention FP2E/NI/IDÉ/2025'),
      line('Date', ' '),
      line('Signature', ' '),
    ], W));
  }
  children.push(P(' ', { after: 200 }));
  children.push(P('Pièces de référence conservées au dépôt : rapport d’audit fonctionnel détaillé, registre des décisions de validation clinique, procédure de mise en service, et historique complet des demandes d’intégration.', { italics: true, color: GREY, size: 19 }));

  const doc = new Document({
    creator: 'DigiSanté Mobile',
    title: 'Rapport de chantier — NEXT IMPACT',
    description: 'Audit fonctionnel et correction des écarts, période du 18 au 19 août 2026.',
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4 explicite (§8)
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: 'DigiSanté Mobile — Rapport de chantier — NEXT IMPACT', size: 16, color: GREY, font: FONT })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Conforme audit — Confidentiel   ·   Convention FP2E/NI/IDÉ/2025   ·   page ', size: 16, color: GREY, font: FONT }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY, font: FONT }),
              new TextRun({ text: ' / ', size: 16, color: GREY, font: FONT }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: GREY, font: FONT }),
            ],
          })],
        }),
      },
      children,
    }],
  });

  const out = process.argv[2] || path.resolve(__dirname, '../../docs/Rapport_Chantier_NEXT_IMPACT.docx');
  fs.writeFileSync(out, await Packer.toBuffer(doc));
  console.log('Écrit :', out);
}

main().catch((e) => { console.error(e); process.exit(1); });
