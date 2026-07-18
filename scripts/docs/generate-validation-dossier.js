// ─────────────────────────────────────────────────────────────
// Génère le DOSSIER DE VALIDATION CLINIQUE (DOCX) à soumettre à un professionnel
// de santé pour relecture + signature (jalon « validation clinique », §3.4/§7).
//
//   export NODE_PATH=$(npm root -g)   # ou un dossier contenant `docx`
//   node scripts/docs/generate-validation-dossier.js [sortie.docx]
//   python <skill docx>/scripts/office/validate.py <sortie>.docx   # obligatoire
//
// La STRUCTURE (flux de triage, calendrier PEV, phrasier) est importée de
// @digisante/shared (source de vérité, jamais de re-saisie) ; seuls les LIBELLÉS
// cliniques lisibles (transcrits des i18n FR/EN) sont locaux à ce script.
// Conventions docx-js (CLAUDE.md §8) : A4, un Paragraph par ligne (jamais de \n),
// tables columnWidths + width DXA par cellule, ShadingType.CLEAR, puces natives.
// ─────────────────────────────────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
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

// ── Libellés cliniques (transcrits des i18n FR/EN — cf. apps/web/src/i18n) ──
const FLOW_LABELS = {
  FEVER: { fr: 'Fièvre / suspicion de paludisme', en: 'Fever / suspected malaria' },
  DIARRHEA: { fr: 'Diarrhée / déshydratation', en: 'Diarrhea / dehydration' },
  BREATHING: { fr: 'Toux / respiration', en: 'Cough / breathing' },
  PREGNANCY: { fr: 'Grossesse — signes de danger', en: 'Pregnancy — danger signs' },
};
const Q_LABELS = {
  fever_convulsion: { fr: 'A-t-il/elle eu des convulsions (crises) ?', en: 'Have they had convulsions (fits)?' },
  fever_unconscious: { fr: 'Est-il/elle inconscient(e) ou très somnolent(e) ?', en: 'Are they unconscious or very drowsy?' },
  fever_notdrink: { fr: 'N’arrive pas à boire ou à téter ?', en: 'Unable to drink or breastfeed?' },
  fever_breathing: { fr: 'A du mal à respirer ?', en: 'Difficulty breathing?' },
  fever_stiffneck: { fr: 'A la nuque raide ?', en: 'Stiff neck?' },
  fever_infant: { fr: 'Bébé de moins de 3 mois avec de la fièvre ?', en: 'Baby under 3 months with fever?' },
  fever_3days: { fr: 'Fièvre depuis plus de 3 jours ?', en: 'Fever for more than 3 days?' },
  diarrhea_lethargic: { fr: 'Très somnolent(e) ou inconscient(e) ?', en: 'Very drowsy or unconscious?' },
  diarrhea_sunkeneyes: { fr: 'Yeux enfoncés, pleure sans larmes ?', en: 'Sunken eyes, crying without tears?' },
  diarrhea_notdrink: { fr: 'N’arrive pas à boire ?', en: 'Unable to drink?' },
  diarrhea_blood: { fr: 'Du sang dans les selles ?', en: 'Blood in the stool?' },
  diarrhea_vomiting: { fr: 'Vomit tout ce qu’il/elle prend ?', en: 'Vomiting everything?' },
  diarrhea_3days: { fr: 'Diarrhée depuis plus de 3 jours ?', en: 'Diarrhea for more than 3 days?' },
  breathing_severe: { fr: 'A beaucoup de mal à respirer ?', en: 'Severe difficulty breathing?' },
  breathing_blue: { fr: 'Lèvres ou ongles bleus ?', en: 'Blue lips or nails?' },
  breathing_indrawing: { fr: 'La poitrine se creuse quand il/elle respire ?', en: 'Chest pulling in when breathing?' },
  breathing_nospeak: { fr: 'Trop essoufflé(e) pour parler ?', en: 'Too breathless to speak?' },
  breathing_fast: { fr: 'Respire très vite ?', en: 'Breathing very fast?' },
  breathing_cough2w: { fr: 'Toux depuis plus de 2 semaines ?', en: 'Cough for more than 2 weeks?' },
  preg_bleeding: { fr: 'Saignement vaginal ?', en: 'Vaginal bleeding?' },
  preg_headache: { fr: 'Mal de tête fort ou vue trouble ?', en: 'Severe headache or blurred vision?' },
  preg_convulsion: { fr: 'Convulsions (crises) ?', en: 'Convulsions (fits)?' },
  preg_abdopain: { fr: 'Douleur forte au ventre ?', en: 'Severe belly pain?' },
  preg_nomovement: { fr: 'Le bébé ne bouge plus ?', en: 'Baby no longer moving?' },
  preg_fever: { fr: 'De la fièvre ?', en: 'Fever?' },
  preg_swelling: { fr: 'Visage ou mains gonflés ?', en: 'Swollen face or hands?' },
};
const VACCINE_LABELS = {
  BCG: 'BCG (tuberculose)', POLIO_ORAL: 'Polio (oral)', POLIO_INJ: 'Polio (injectable)',
  HEPB: 'Hépatite B', PENTA: 'Pentavalent', PNEUMO: 'Pneumocoque', ROTA: 'Rotavirus',
  ROUGEOLE_RUBEOLE: 'Rougeole-Rubéole', FIEVRE_JAUNE: 'Fièvre jaune',
};
const CAT_LABELS = {
  GREETING: 'Accueil', SYMPTOM: 'Symptômes', INSTRUCTION: 'Consignes',
  POSOLOGY: 'Posologie', FOLLOWUP: 'Suivi', EMERGENCY: 'Urgence',
};

function ageLabel(days) {
  if (days === 0) return 'Naissance';
  if (days < 150) return `${Math.round(days / 7)} semaines`;
  return `${Math.round(days / 30)} mois`;
}

// ── Helpers de mise en forme ──
const P = (text, opts = {}) =>
  new Paragraph({ spacing: { after: opts.after ?? 80 }, alignment: opts.align, children: [new TextRun({ text, bold: opts.bold, italics: opts.italics, size: opts.size ?? 20, color: opts.color, font: 'Calibri' })] });

const H = (text, level) => new Paragraph({ heading: level, spacing: { before: 240, after: 120 }, children: [new TextRun({ text, font: 'Calibri', color: NAVY })] });

function cell(text, { width, bold, color, shade, align } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: shade ? { type: ShadingType.CLEAR, color: 'auto', fill: shade } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({ alignment: align, children: [new TextRun({ text, bold, color, size: 18, font: 'Calibri' })] })],
  });
}

function table(rows) {
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, rows });
}

const sevBadge = (s) => (s === 'RED' ? { text: 'ROUGE', color: RED } : { text: 'ORANGE', color: AMBER });

// Bloc « Décision du relecteur » réutilisable (case à cocher texte + observations).
function decisionBlock() {
  const W = [3000, 6026];
  return [
    new Paragraph({ spacing: { before: 120, after: 40 }, children: [new TextRun({ text: 'Décision du relecteur', bold: true, size: 18, color: NAVY, font: 'Calibri' })] }),
    table([
      new TableRow({ children: [cell('Statut', { width: W[0], bold: true, shade: LIGHT }), cell('☐ Validé          ☐ À corriger          ☐ Rejeté', { width: W[1] })] }),
      new TableRow({ children: [cell('Observations', { width: W[0], bold: true, shade: LIGHT }), cell(' ', { width: W[1] })] }),
      new TableRow({ children: [cell('Corrections', { width: W[0], bold: true, shade: LIGHT }), cell(' ', { width: W[1] })] }),
    ]),
    new Paragraph({ spacing: { after: 160 }, children: [] }),
  ];
}

async function main() {
  const sharedUrl = pathToFileURL(path.resolve(__dirname, '../../packages/shared/dist/index.js')).href;
  const { TRIAGE_FLOWS, PEV_SCHEDULE, PHRASEBOOK, PHRASE_CATEGORIES, phraseText } = await import(sharedUrl);

  const today = new Date().toISOString().slice(0, 10);
  const children = [];

  // ── Page de garde ──
  children.push(
    new Paragraph({ spacing: { before: 1400, after: 120 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'DigiSanté Mobile', bold: true, size: 40, color: NAVY, font: 'Calibri' })] }),
    new Paragraph({ spacing: { after: 400 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Dossier de validation clinique', size: 32, color: GREEN, font: 'Calibri' })] }),
    P('Programme NEXT IMPACT — FP2E / Sèmè City / Banque Mondiale', { align: AlignmentType.CENTER, color: GREY, size: 20 }),
    P('Convention FP2E/NI/IDÉ/2025', { align: AlignmentType.CENTER, color: GREY, size: 20 }),
    P(`Version du ${today}`, { align: AlignmentType.CENTER, color: GREY, size: 20, after: 400 }),
    P('Document destiné à la relecture et à la validation par un professionnel de santé habilité (ou le programme national concerné) AVANT tout usage clinique réel.', { align: AlignmentType.CENTER, italics: true, size: 20 }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ── Introduction ──
  children.push(
    H('1. Objet et mode d’emploi', HeadingLevel.HEADING_1),
    P('Ce dossier rassemble, extraits du code applicatif, les contenus à portée clinique qui reposent sur une hypothèse d’implémentation et doivent être validés par un professionnel de santé.'),
    P('Pour chaque contenu : relire, puis renseigner le bloc « Décision du relecteur » (Validé / À corriger / Rejeté) et les corrections éventuelles. La signature finale (dernière page) atteste la revue.'),
    P('Nature : aides à l’orientation / au suivi, à biais conservateur — ce ne sont PAS des diagnostics. Le calendrier CPN (santé maternelle) est déjà validé et n’est donc pas re-soumis ici.'),
    P('Sources (source de vérité) : triage → packages/shared/src/triage.ts · PEV → packages/shared/src/pev.ts · phrasier → packages/shared/src/phrasebook.ts. Instantané généré le ' + today + '.', { italics: true, color: GREY }),
  );

  // ── Section Triage ──
  children.push(H('2. Triage / orientation hors-ligne (OMS / PCIME)', HeadingLevel.HEADING_1));
  children.push(P('Règle de décision (biais conservateur) : un seul signe ROUGE → URGENCE (SOS) ; sinon un signe ORANGE → CONSULTER rapidement ; sinon SURVEILLANCE À DOMICILE. À valider : pertinence des motifs, exactitude des questions et de leur sévérité, acceptabilité du seuil.', { bold: false }));
  for (const flow of TRIAGE_FLOWS) {
    const lbl = FLOW_LABELS[flow.id] || { fr: flow.id, en: '' };
    children.push(H(`2.${TRIAGE_FLOWS.indexOf(flow) + 1} ${lbl.fr}`, HeadingLevel.HEADING_2));
    const W = [5800, 1600, 1626];
    const rows = [new TableRow({ tableHeader: true, children: [
      cell('Question (FR) / (EN)', { width: W[0], bold: true, shade: NAVY, color: 'FFFFFF' }),
      cell('Sévérité', { width: W[1], bold: true, shade: NAVY, color: 'FFFFFF', align: AlignmentType.CENTER }),
      cell('Correct ?', { width: W[2], bold: true, shade: NAVY, color: 'FFFFFF', align: AlignmentType.CENTER }),
    ] })];
    for (const q of flow.questions) {
      const ql = Q_LABELS[q.key] || { fr: q.key, en: '' };
      const sev = sevBadge(q.severity);
      rows.push(new TableRow({ children: [
        new TableCell({ width: { size: W[0], type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 80, right: 80 }, children: [
          new Paragraph({ children: [new TextRun({ text: ql.fr, size: 18, font: 'Calibri' })] }),
          new Paragraph({ children: [new TextRun({ text: ql.en, size: 16, italics: true, color: GREY, font: 'Calibri' })] }),
        ] }),
        cell(sev.text, { width: W[1], bold: true, color: sev.color, align: AlignmentType.CENTER }),
        cell('☐ oui  ☐ non', { width: W[2], align: AlignmentType.CENTER }),
      ] }));
    }
    children.push(table(rows));
    children.push(...decisionBlock());
  }

  // ── Section PEV ──
  children.push(new Paragraph({ children: [new PageBreak()] }), H('3. Calendrier vaccinal PEV (naissance → 15 mois)', HeadingLevel.HEADING_1));
  children.push(P('À valider : âges cibles, liste des antigènes et nombre de doses conformes au calendrier PEV en vigueur au Bénin.'));
  {
    const W = [2400, 4626, 2000];
    const rows = [new TableRow({ tableHeader: true, children: [
      cell('Âge', { width: W[0], bold: true, shade: NAVY, color: 'FFFFFF' }),
      cell('Vaccin', { width: W[1], bold: true, shade: NAVY, color: 'FFFFFF' }),
      cell('Dose', { width: W[2], bold: true, shade: NAVY, color: 'FFFFFF', align: AlignmentType.CENTER }),
    ] })];
    for (const d of PEV_SCHEDULE) {
      rows.push(new TableRow({ children: [
        cell(ageLabel(d.ageOffsetDays), { width: W[0] }),
        cell(VACCINE_LABELS[d.vaccineKey] || d.vaccineKey, { width: W[1] }),
        cell(d.doseLabel ? `dose ${d.doseLabel}` : 'dose unique', { width: W[2], align: AlignmentType.CENTER }),
      ] }));
    }
    children.push(table(rows));
    children.push(...decisionBlock());
  }

  // ── Section Phrasier ──
  children.push(new Paragraph({ children: [new PageBreak()] }), H('4. Phrasier médical (messagerie)', HeadingLevel.HEADING_1));
  children.push(P('Phrases de COMMUNICATION insérées dans la langue cible (100 % local, aucune traduction automatique). À valider : exactitude et non-ambiguïté des phrases cliniques (consignes/posologie/urgence). FON/YOR à traduire ensuite par des locuteurs natifs.'));
  {
    const W = [1800, 3613, 3613];
    const rows = [new TableRow({ tableHeader: true, children: [
      cell('Catégorie', { width: W[0], bold: true, shade: NAVY, color: 'FFFFFF' }),
      cell('Français', { width: W[1], bold: true, shade: NAVY, color: 'FFFFFF' }),
      cell('English', { width: W[2], bold: true, shade: NAVY, color: 'FFFFFF' }),
    ] })];
    for (const cat of PHRASE_CATEGORIES) {
      for (const ph of PHRASEBOOK.filter((p) => p.category === cat)) {
        rows.push(new TableRow({ children: [
          cell(CAT_LABELS[cat] || cat, { width: W[0] }),
          cell(phraseText(ph, 'FR'), { width: W[1] }),
          cell(phraseText(ph, 'EN'), { width: W[2] }),
        ] }));
      }
    }
    children.push(table(rows));
    children.push(...decisionBlock());
  }

  // ── Signature ──
  children.push(new Paragraph({ children: [new PageBreak()] }), H('5. Attestation de validation', HeadingLevel.HEADING_1));
  children.push(P('Je soussigné(e), professionnel(le) de santé, atteste avoir relu les contenus ci-dessus et consigné mes décisions section par section.'));
  {
    const W = [3000, 6026];
    const line = (k, v) => new TableRow({ children: [cell(k, { width: W[0], bold: true, shade: LIGHT }), cell(v, { width: W[1] })] });
    children.push(table([
      line('Nom et prénom', ' '), line('Fonction / spécialité', ' '),
      line('N° d’ordre (ONMB)', ' '), line('Établissement', ' '),
      line('Date', ' '), line('Signature', ' '),
    ]));
  }
  children.push(P('Une fois signé, la validation est tracée dans docs/VALIDATION_Clinique.md (colonne « État » → ✅) et dans l’en-tête du fichier source concerné.', { italics: true, color: GREY }));

  const doc = new Document({
    creator: 'DigiSanté Mobile',
    title: 'Dossier de validation clinique',
    sections: [{
      properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'DigiSanté Mobile — Validation clinique', size: 16, color: GREY, font: 'Calibri' })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Conforme audit — Confidentiel   ·   page ', size: 16, color: GREY, font: 'Calibri' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY, font: 'Calibri' })] })] }) },
      children,
    }],
  });

  const out = process.argv[2] || path.resolve(__dirname, '../../docs/Dossier_Validation_Clinique.docx');
  fs.writeFileSync(out, await Packer.toBuffer(doc));
  console.log('Écrit :', out);
}

main().catch((e) => { console.error(e); process.exit(1); });
