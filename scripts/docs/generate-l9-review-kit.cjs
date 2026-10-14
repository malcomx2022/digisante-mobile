// Dossiers vierges de campagne L9. Aucun avis humain ni texte natif n'est généré.
const { spawnSync } = require('node:child_process');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, TableLayoutType, ShadingType, HeadingLevel, Footer, PageNumber,
} = require('docx');

const WIDTH = 9026;
const CLINICAL_SCOPES = ['triage', 'pev', 'maternity', 'phrasebook', 'prescriptions', 'vitals', 'education'];
const SCOPE_LABELS = {
  triage: 'Triage / orientation', pev: 'Calendrier vaccinal PEV',
  maternity: 'CPN / santé maternelle', phrasebook: 'Phrasier clinique',
  prescriptions: 'Ordonnances / prescriptions et posologie',
  vitals: 'Auto-mesures / constantes', education: 'Contenus éducatifs publiés',
};
const LOCALE_LABELS = { fon: 'Fɔ̀ngbè', yor: 'Yorùbá' };
const DECISIONS = '☐ Favorable sur cette portée  ☐ À corriger  ☐ Défavorable  ☐ Hors compétence';

function paragraph(value, options = {}) {
  const { code = false, size = 21, ...paragraphOptions } = options;
  return new Paragraph({
    spacing: { after: 100, line: 270 },
    ...paragraphOptions,
    children: [new TextRun({ text: String(value ?? ''), font: code ? 'Consolas' : 'Calibri', size })],
  });
}

function heading(value, level = HeadingLevel.HEADING_1, options = {}) {
  return paragraph(value, { heading: level, keepNext: true, ...options });
}

function table(rows, options = {}) {
  const count = rows[0].length;
  const widths = options.widths ?? Array.from({ length: count }, (_, index) =>
    Math.floor(WIDTH / count) + (index === count - 1 ? WIDTH % count : 0));
  if (widths.length !== count || widths.reduce((sum, width) => sum + width, 0) !== WIDTH) {
    throw new Error('La grille de tableau doit occuper exactement 9026 twips.');
  }
  return new Table({
    width: { size: WIDTH, type: WidthType.DXA }, layout: TableLayoutType.FIXED, columnWidths: widths,
    rows: rows.map((row, rowIndex) => new TableRow({
      tableHeader: Boolean(options.header && rowIndex === 0), cantSplit: true,
      ...(options.blankForm ? { height: { value: rowIndex >= 4 ? 480 : 380, rule: 'atLeast' } } : {}),
      children: row.map((value, columnIndex) => new TableCell({
        width: { size: widths[columnIndex], type: WidthType.DXA },
        ...(options.header && rowIndex === 0 ? { shading: { type: ShadingType.CLEAR, fill: 'E8EFF3' } } : {}),
        children: [paragraph(value, { size: 19, spacing: { after: 80, line: 240 } })],
      })),
    })),
  });
}

function blankForm(labels) {
  return table(labels.map((label) => [label, '']), { widths: [3400, WIDTH - 3400], blankForm: true });
}

function cleanMarkdown(value) {
  return value
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*/g, '').replace(/`/g, '');
}

function markdownCells(line) {
  const content = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return content.split(/(?<!\\)\|/).map((cell) => cleanMarkdown(cell.trim().replace(/\\\|/g, '|')));
}

function markdownParagraphs(markdown) {
  const children = [];
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  let code = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*```/.test(line)) { code = !code; continue; }
    if (!line.trim()) continue;
    if (code) { children.push(paragraph(line, { code: true, size: 17 })); continue; }
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (index < lines.length && /^\s*\|/.test(lines[index])) {
        if (!/^\s*\|[\s:|\-]+\|?\s*$/.test(lines[index])) rows.push(markdownCells(lines[index]));
        index += 1;
      }
      index -= 1;
      if (rows.length) {
        const count = Math.max(...rows.map((row) => row.length));
        children.push(table(rows.map((row) => [...row, ...Array(count - row.length).fill('')]), { header: true }));
      }
      continue;
    }
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match) {
      const level = match[1].length === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2;
      children.push(heading(cleanMarkdown(match[2]), level));
      continue;
    }
    children.push(paragraph(cleanMarkdown(line.replace(/^\s*>\s?/, ''))));
  }
  return children;
}

function versionBlock(campaign) {
  return [
    paragraph('FORMULAIRE VIERGE — NON SIGNÉ — À RENSEIGNER EN PRIVÉ'),
    paragraph(`source_snapshot : ${campaign.sourceSnapshotSha256}`),
    paragraph(`Commit de base : ${campaign.baseCommitSha}`),
    paragraph('Ces empreintes identifient le contenu à relire. La génération du dossier ne confirme aucune signature, habilitation, décision clinique ou traduction native.'),
    paragraph('Conserver les avis complétés, signatures et coordonnées dans un espace privé contrôlé par le porteur. Ne pas les ajouter au dépôt public.'),
  ];
}

function guideChildren(campaign, guideMarkdown) {
  const children = [
    heading('DigiSanté Mobile — Guide des relecteurs L9'), ...versionBlock(campaign),
    heading('Parcours de relecture en huit étapes'),
  ];
  const steps = [
    '1. Vérifier la version. Comparer source_snapshot, commit de base et empreinte de chaque portée avec les fichiers remis. Conserver une copie privée de travail ; une correction du contenu impose une nouvelle version à relire.',
    '2. Répartir les portées. Confirmer les compétences et habilitations adaptées aux sept domaines cliniques. Pour chaque langue, désigner deux locuteurs natifs distincts ; une même paire peut couvrir UI et phrasier si elle maîtrise les deux contextes.',
    '3. Résoudre les questions FR/EN. Lire source-questions.csv et le glossaire avant de proposer des mots natifs. Documenter les divergences et demander un arbitrage clinique pour toute nuance de soin, d’urgence, de fréquence, de négation ou d’unité.',
    '4. Qualifier les cas cliniques. Lire Dossier_Clinique_L9.docx et clinical-cases.csv, en commençant par les réserves prioritaires. Une sortie observée décrit le code actuel ; elle ne constitue jamais une conduite clinique recommandée. Préciser les corrections exactes et leur justification.',
    '5. Relire tout le corpus natif. Examiner chaque clé UI présente ou manquante et chaque phrase du phrasier. Conserver les variables entre accolades, montants, unités, personnes grammaticales et négations ; toutes les clés critiques nécessitent une double relecture.',
    '6. Tester la compréhension et le rendu. Utiliser les exercices ci-dessous sur les écrans et appareils cibles. Évaluer séparément le texte affiché, la restitution orale et la compréhension de l’action attendue ; consigner les problèmes dans le retour privé.',
    '7. Rendre un avis explicite. Remplir les formulaires par portée, joindre les corrections et les références de cas ou de clés, puis dater et signer uniquement les avis réellement émis. Les deux relecteurs natifs rendent leur avis séparément ; les désaccords restent ouverts jusqu’à arbitrage.',
    '8. Faire vérifier et intégrer les retours. Le porteur contrôle identité, habilitation, portée, version, pièces et réserves. Préparer un diff explicite, tester les corrections, puis recueillir un nouveau contreseing sur le contenu corrigé. Un test vert ou un registre cohérent ne suffit pas à décider l’ouverture.',
  ];
  children.push(...steps.map((step) => paragraph(step)));
  children.push(heading('Exercices de compréhension, oral et affichage'));
  children.push(table([
    ['Exercice', 'Consigne et observation à consigner'],
    ['Compréhension sans aide', 'Présenter une consigne et demander au participant de reformuler l’action attendue avec ses propres mots. Noter la clé, la version, l’action comprise et toute confusion, sans suggérer la réponse. Choisir avec les relecteurs des situations d’urgence, des négations, des unités et des fréquences.'],
    ['Oral / synthèse vocale', 'Écouter chaque consigne retenue sur les appareils et navigateurs cibles, puis demander une reformulation. Noter appareil, navigateur, voix, langue effectivement utilisée, compréhension des chiffres et ton. Le repli vocal actuel fr-FR pour FON/YOR doit être qualifié séparément du texte écrit.'],
    ['Affichage', 'Vérifier les caractères Fɔ̀ngbè/Yorùbá, diacritiques, taille du texte, sauts de ligne, boutons et variables après substitution avec des valeurs synthétiques. Consigner tout texte tronqué et l’écran concerné.'],
    ['Double relecture', 'Le second locuteur relit les propositions en contexte et consigne son propre avis. Identifier les variantes dialectales acceptables et les désaccords ; aucune case ne doit être cochée avant cet avis.'],
  ], { header: true, widths: [2300, WIDTH - 2300] }));
  children.push(paragraph('Aucune donnée de patient réel n’est nécessaire pour ces exercices. La validation écrite ne vaut pas validation de la voix ; ne pas publier une traduction clinique ou critique proposée sans les avis et le contreseing requis.'));
  children.push(heading('Guide de campagne et fichiers remis'));
  children.push(...markdownParagraphs(guideMarkdown));
  return children;
}

function clinicalChildren(campaign) {
  const children = [
    heading('DigiSanté Mobile — Avis clinique L9'), ...versionBlock(campaign),
    paragraph('Cet avis porte uniquement sur les domaines explicitement renseignés ci-dessous. Le professionnel indique sa capacité, les populations couvertes, ses références et toute limite de compétence. Une personne compétente peut relire plusieurs domaines ; aucune décision globale n’est préremplie.'),
    paragraph(`Support de relecture : Dossier_Clinique_L9.docx ; clinical-cases.csv (${campaign.clinicalCases} cas synthétiques) ; références et réserves de campaign.json.`),
  ];
  for (const item of campaign.scopes) {
    children.push(heading(`${SCOPE_LABELS[item.scope]} — portée ${item.scope}`, HeadingLevel.HEADING_1, { pageBreakBefore: true }));
    children.push(paragraph(`Empreinte de portée : ${item.contentSha256}`));
    children.push(paragraph(`Profil de relecture proposé : ${item.professionalProfile}`));
    for (const reserve of (campaign.reserves ?? []).filter((entry) => entry.scope === item.scope)) {
      children.push(paragraph(`Réserve ${reserve.id} : ${reserve.summary}`));
    }
    if (item.scope === 'education') children.push(paragraph('Joindre un inventaire des contenus effectivement publiés sur la cible : identifiants, versions, langues et empreintes. Le seed ne prouve pas ce corpus. Renseigner runtimeInventoryRef et la version de l’inventaire relu.'));
    children.push(paragraph('Décision à cocher par le professionnel uniquement :'));
    children.push(paragraph(DECISIONS));
    children.push(blankForm([
      'Nom et prénom du professionnel', 'Qualité / capacité professionnelle',
      'Établissement / référence d’habilitation', 'Populations, périmètre et limites de compétence',
      'Décision explicite et motifs', 'Cas / clés / réserves examinés',
      'Corrections exactes demandées', 'Références cliniques utilisées et version',
      ...(item.scope === 'education' ? ['runtimeInventoryRef / version de l’inventaire publié'] : []),
      'Référence privée de la pièce / annexes', 'Date de l’avis (AAAA-MM-JJ)',
      'Signature manuscrite ou signature vérifiable',
    ]));
    children.push(paragraph('Toute correction requiert une nouvelle empreinte et une nouvelle relecture. Un avis limité, une réserve ouverte ou une absence de pièce ne doit pas être transformé en approbation de la portée entière.'));
  }
  return children;
}

function linguisticChildren(campaign, locale) {
  const language = LOCALE_LABELS[locale];
  const children = [
    heading(`DigiSanté Mobile — Avis linguistique ${language} (${locale}) L9`), ...versionBlock(campaign),
    paragraph(`Langue examinée : ${language} ; code de langue : ${locale}. Corpus UI et phrasier natif à examiner séparément.`),
    paragraph('Deux locuteurs natifs distincts rendent chacun un avis par portée. Les identités, variétés dialectales, dates et signatures sont vérifiées par le porteur sur les pièces privées. Une variante ou un mot identique au français doit être examiné en contexte ; aucune proposition native n’est préremplie.'),
    paragraph('Compléter les feuilles UI et phrasier pour l’ensemble du corpus, y compris les textes déjà présents. Pour une consigne clinique, l’avis des locuteurs complète le contreseing clinique ; il ne le remplace pas.'),
  ];
  for (const item of campaign.nativeScopes.filter((entry) => entry.locale === locale)) {
    const label = item.scope === 'ui' ? 'Interface utilisateur complète (UI)' : 'Phrasier natif complet';
    children.push(heading(`${label} — portée ${item.scope}`, HeadingLevel.HEADING_1, { pageBreakBefore: true }));
    children.push(paragraph(`Langue / portée : ${locale} / ${item.scope}`));
    children.push(paragraph(`Empreinte de portée : ${item.contentSha256}`));
    for (const number of [1, 2]) {
      children.push(heading(`Avis indépendant du relecteur ${number}`, HeadingLevel.HEADING_2, { pageBreakBefore: number === 2 }));
      if (number === 2) {
        children.push(paragraph(`Langue / portée : ${locale} / ${item.scope}`));
        children.push(paragraph(`Empreinte de portée : ${item.contentSha256}`));
      }
      children.push(paragraph('Décision à cocher par ce relecteur uniquement :'));
      children.push(paragraph(DECISIONS));
      children.push(blankForm([
        `Nom et prénom du relecteur ${number}`, 'Langue maternelle / variété dialectale',
        'Expérience linguistique / contexte de relecture', 'Décision explicite et motifs',
        'Clés / phrases examinées et limites de couverture', 'Corrections exactes demandées / annexe CSV',
        'Compréhension : exercices, observations, réserves', 'Oral : appareils, voix, observations, réserves',
        'Affichage : caractères, variables, observations, réserves',
        'Référence privée de la pièce / annexes', 'Date de l’avis (AAAA-MM-JJ)',
        'Signature manuscrite ou signature vérifiable',
      ]));
    }
    children.push(heading('Désaccords et arbitrage', HeadingLevel.HEADING_2));
    children.push(blankForm(['Clés / phrases en désaccord', 'Arbitrage motivé et personnes consultées', 'Questions cliniques à transmettre', 'Nouvelle version / empreinte après correction']));
  }
  return children;
}

function makeDocument(title, children) {
  return new Document({
    creator: 'DigiSanté Mobile — préparation technique', title,
    description: 'Formulaire vierge non signé. Dates de métadonnées normalisées techniquement ; elles ne datent aucun avis humain.',
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      footers: { default: new Footer({ children: [new Paragraph({ children: [
        new TextRun({ text: 'L9 — NON SIGNÉ — version à vérifier — page ', size: 18 }),
        new TextRun({ children: [PageNumber.CURRENT] }),
      ] })] }) },
      children,
    }],
  });
}

// docx ajoute des horodatages volatils : seules les métadonnées techniques sont
// normalisées. Aucun champ d'avis, de décision ou de date de signature n'est rempli.
function normalizeArchive(buffer) {
  const script = [
    'import io, sys, zipfile, re',
    'source = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))',
    'out = io.BytesIO()',
    'with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as target:',
    ' for name in sorted(source.namelist()):',
    '  content = source.read(name)',
    '  if name == "docProps/core.xml":',
    '   content = re.sub(rb"(<dcterms:(?:created|modified)\\b[^>]*>)[^<]*(</dcterms:(?:created|modified)>)", rb"\\g<1>2000-01-01T00:00:00Z\\g<2>", content)',
    '  info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))',
    '  info.compress_type = zipfile.ZIP_DEFLATED',
    '  info.create_system = 0',
    '  info.external_attr = 0o600 << 16',
    '  target.writestr(info, content, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)',
    'sys.stdout.buffer.write(out.getvalue())',
  ].join('\n');
  const result = spawnSync('python3', ['-c', script], { input: buffer, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Normalisation DOCX impossible : ${result.error?.message ?? result.stderr.toString('utf8')}`);
  return result.stdout;
}

function assertCampaign(campaign) {
  if (campaign.schemaVersion !== 1 || campaign.status !== 'PREPARED_FOR_REVIEW') throw new Error('Campagne attendue : version 1, PREPARED_FOR_REVIEW.');
  if (!/^[a-f0-9]{64}$/.test(campaign.sourceSnapshotSha256) || !/^[a-f0-9]{40}$/.test(campaign.baseCommitSha)) throw new Error('Empreintes de campagne invalides.');
  if (!Array.isArray(campaign.scopes) || campaign.scopes.length !== CLINICAL_SCOPES.length || new Set(campaign.scopes.map((item) => item.scope)).size !== CLINICAL_SCOPES.length) throw new Error('Sept portées cliniques distinctes requises.');
  for (const scope of CLINICAL_SCOPES) {
    const item = campaign.scopes.find((entry) => entry.scope === scope);
    if (!item || !/^[a-f0-9]{64}$/.test(item.contentSha256) || !item.professionalProfile) throw new Error(`Portée clinique invalide : ${scope}`);
  }
  if (!Array.isArray(campaign.nativeScopes) || campaign.nativeScopes.length !== 4) throw new Error('Quatre portées natives requises.');
  for (const locale of Object.keys(LOCALE_LABELS)) for (const scope of ['ui', 'phrasebook-native']) {
    const items = campaign.nativeScopes.filter((entry) => entry.locale === locale && entry.scope === scope);
    if (items.length !== 1 || !/^[a-f0-9]{64}$/.test(items[0].contentSha256)) throw new Error(`Portée native invalide : ${locale}/${scope}`);
  }
  if (!Number.isInteger(campaign.clinicalCases) || campaign.clinicalCases < 1) throw new Error('Le nombre de cas cliniques doit être explicite.');
}

async function buildDocuments(campaign, guideMarkdown) {
  assertCampaign(campaign);
  if (typeof guideMarkdown !== 'string' || !guideMarkdown.trim()) throw new Error('Guide de campagne vide.');
  const specifications = [
    ['Guide_Relecteurs_L9.docx', 'Guide des relecteurs L9 non signé', guideChildren(campaign, guideMarkdown)],
    ['Avis_Clinique_L9.docx', 'Avis clinique L9 vierge non signé', clinicalChildren(campaign)],
    ['Avis_Linguistique_FON_L9.docx', 'Avis linguistique Fɔ̀ngbè L9 vierge non signé', linguisticChildren(campaign, 'fon')],
    ['Avis_Linguistique_YOR_L9.docx', 'Avis linguistique Yorùbá L9 vierge non signé', linguisticChildren(campaign, 'yor')],
  ];
  const buffers = await Promise.all(specifications.map(async ([name, title, children]) => [name, normalizeArchive(await Packer.toBuffer(makeDocument(title, children)))]));
  return Object.fromEntries(buffers);
}

module.exports = { buildDocuments };
