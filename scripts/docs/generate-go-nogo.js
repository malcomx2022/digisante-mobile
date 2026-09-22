// ─────────────────────────────────────────────────────────────
// Génère le PROCÈS-VERBAL GO/NO-GO d'ouverture pilote (prompt 20) :
//   • docs/PV_GO_NOGO_2026-09-22.docx  — PV opposable (NEXT IMPACT)
//   • docs/GO_NOGO_2026-09-22.md       — même matrice, lisible dans le dépôt
//
//   export NODE_PATH=$(npm root -g)   # ou un dossier contenant `docx`
//   node scripts/docs/generate-go-nogo.js
//   python <skill docx>/scripts/office/validate.py docs/PV_GO_NOGO_2026-09-22.docx   # obligatoire (§7)
//
// RÈGLE : une case vaut GO UNIQUEMENT si elle cite une preuve DATÉE et vérifiable
// (commande exécutée, run CI, fiche signée). Une déclaration, un plan ou un script
// prêt ne sont PAS des preuves d'exécution. Case sans preuve ⇒ NO-GO.
// Les deux sorties sont produites depuis les MÊMES données (pas de divergence).
// Conventions docx-js (CLAUDE.md §8) : A4 explicite, un Paragraph par ligne,
// tables columnWidths + width DXA par cellule, ShadingType.CLEAR, puces natives.
// ─────────────────────────────────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  Footer, Header, PageNumber, PageBreak,
} = require('docx');

const DATE = '22 septembre 2026';
const DATE_ISO = '2026-09-22';
const REVISION = 'e3dde34'; // tête de main évaluée (merge PR #175)

const NAVY = '1E2347';
const GREEN = '2E7D46';
const RED = 'B3261E';
const GREY = '6B6155';
const LIGHT = 'F2EEE7';
const RED_BG = 'FBE9E7';
const GREEN_BG = 'E8F3EC';
const CONTENT_W = 9026; // A4 (11906) − marges 1440×2
const FONT = 'Calibri';

// ── Matrice : critère exigé → preuve datée → verdict ─────────────────────────
// `go` ne passe à true que sur une preuve d'EXÉCUTION datée.
const MATRIX = [
  {
    id: 'C1', critere: 'CI complète au vert sur la révision candidate',
    preuve: 'Run CI n° 381 sur main @ e3dde34, 22/09/2026 23:37 UTC : échec en 4 s, aucun job n’a reçu d’exécuteur (blocage au niveau du compte GitHub). Même échec sur le run n° 379 (main @ d2862bf, 22/09/2026 23:18 UTC).',
    go: false, bloqueur: 'Rétablir l’exécution GitHub Actions (facturation / quota du compte), puis obtenir un run complet vert (lint, typecheck, tests, e2e, build).', owner: 'Porteur (propriétaire du compte GitHub)',
  },
  {
    id: 'C2', critere: 'Build reproductible',
    preuve: 'Build web local vert le 22/09/2026, polices locales (build hermétique, prompt 2), lockfile gelé. Aucune reproduction indépendante : la CI n’a pas tourné.',
    go: false, bloqueur: 'Build reproduit par la CI (ou un second environnement) sur la même révision.', owner: 'Porteur',
  },
  {
    id: 'C3', critere: 'VPS en service : santé, crons, sauvegardes',
    preuve: 'SUIVI_B3 §2 : VPS, domaine, clés SSH et secrets non fournis (cases non cochées au 22/09/2026). Préflight statique seulement (PREFLIGHT_VPS_2026-09).',
    go: false, bloqueur: 'Fournir VPS + domaine + DNS + secrets ; exécuter provision → deploy ; relever /health, /ready, crontab et première sauvegarde.', owner: 'Porteur / hébergeur Infomaniak',
  },
  {
    id: 'C4', critere: 'Cinq fournisseurs configurés et vérifiés (FedaPay, Twilio, Daily, Firebase, Resend)',
    preuve: 'SUIVI_B4 : aucun compte ouvert, aucune clé, aucune vérification métier (tableau intégralement ☐ au 22/09/2026). Tout tourne en stub.',
    go: false, bloqueur: 'Ouvrir les comptes, saisir les clés via /admin/integrations, exécuter les fiches RECETTE_*.', owner: 'Porteur',
  },
  {
    id: 'C5', critere: 'Webhook FedaPay validé en bac à sable',
    preuve: 'PLAN_Bascule_FedaPay_Live §0, porte P1 : ❌ non exécutée (aucune clé sandbox). Patch d’idempotence atomique §5 appliqué le 22/09/2026 sur accord du porteur (re-tests webhooks verts) ; contrôle S7 non rejoué faute de clé sandbox.',
    go: false, bloqueur: 'Dérouler RECETTE_FedaPay_Sandbox S1→S7 signée (S7 = rejeu des livraisons simultanées).', owner: 'Porteur + FedaPay (KYC marchand)',
  },
  {
    id: 'C6', critere: 'Webhook FedaPay validé en production (live)',
    preuve: 'PLAN_Bascule_FedaPay_Live : NO-GO au 22/09/2026 (P1, P3, P5 ❌).',
    go: false, bloqueur: 'Bascule quatre yeux après C3 et C5.', owner: 'Porteur + FedaPay',
  },
  {
    id: 'C7', critere: 'Restauration réalisée par un tiers sur archives de production',
    preuve: 'SUIVI_B5 : répétition à blanc exécutée le 02/09/2026 sur pile de test par l’assistant (tables identiques). Ni archives de production, ni opérateur tiers.',
    go: false, bloqueur: 'Restauration des deux archives (base + fichiers) par une personne autre que l’auteur, sur un hôte distinct, avec verify_restore.sh.', owner: 'Porteur + opérateur tiers',
  },
  {
    id: 'C8', critere: 'Clés i18n critiques validées (FON/YOR)',
    preuve: 'check-coverage exécuté le 22/09/2026 : FON 92 %, YOR 92 %, 6 clés CRITIQUES sos.* manquantes dans chaque langue.',
    go: false, bloqueur: 'Relecture et double validation par locuteurs natifs, import via import-validated.mjs.', owner: 'Locuteurs natifs fɔ̀ngbè et yorùbá',
  },
  {
    id: 'C9', critere: 'Contreseing clinique (triage, PEV, phrasier, CNOM)',
    preuve: 'VALIDATION_Clinique, suivi B2 au 22/09/2026 : contreseing NON reçu. La décision du porteur du 19/08 n’est pas une signature de professionnel de santé.',
    go: false, bloqueur: 'Signature du Dossier_Validation_Clinique.docx (version du 2026-09-01) par un professionnel habilité.', owner: 'Professionnel de santé habilité',
  },
  {
    id: 'C10', critere: 'Recette appareils × opérateurs × sept rôles',
    preuve: 'RECETTE_7_Roles_PV : protocole préparé le 22/09/2026, état ⛔ NON EXÉCUTÉE (aucun environnement distant).',
    go: false, bloqueur: 'Exécuter le PV sur appareils réels (Android bas de gamme, iPhone) et opérateurs MTN/Moov, après C3 et C4.', owner: 'Porteur + testeurs',
  },
  {
    id: 'C11', critere: 'Rollback répété',
    preuve: 'Mécanisme scripté (deploy.sh, DEPLOY_REF=<sha>) ; jamais exécuté sur un serveur.',
    go: false, bloqueur: 'Répétition : déployer N, puis N−1 via DEPLOY_REF, relever /ready et la chaîne d’audit.', owner: 'Porteur',
  },
  {
    id: 'C12', critere: 'Audit de sécurité de release',
    preuve: 'AUDIT_Securite_Release_2026-09 (22/09/2026) : 13 correctifs appliqués et testés ; 15 résiduels ; patch §5 d’idempotence appliqué le 22/09/2026 (378 API + 48 web verts localement) ; aucun test d’intrusion externe.',
    go: false, bloqueur: 'Test d’intrusion externe avant ouverture publique ; journalisation des corps d’erreur FedaPay bruts (§5) à revoir.', owner: 'Porteur + prestataire de test d’intrusion',
  },
  {
    id: 'C13', critere: 'Tests automatisés (non-régression)',
    preuve: 'Exécutés localement le 22/09/2026 sur PostgreSQL 16 + Redis réels : 378 tests API + 48 tests web verts ; typecheck, lint, metrics:check verts.',
    go: true, bloqueur: '', owner: '',
  },
];

const goCount = MATRIX.filter((m) => m.go).length;
const VERDICT = goCount === MATRIX.length ? 'GO' : 'NO-GO';

// ── Markdown ────────────────────────────────────────────────────────────────
function toMarkdown() {
  const esc = (s) => s.replace(/\|/g, '\\|');
  const lines = [
    `# Décision GO/NO-GO — ouverture pilote (${DATE})`,
    '',
    `> Généré par \`scripts/docs/generate-go-nogo.js\` (même source que \`docs/PV_GO_NOGO_${DATE_ISO}.docx\`).`,
    `> Révision évaluée : \`main\` @ \`${REVISION}\`. Règle : **une case sans preuve d’exécution datée vaut NO-GO** ;`,
    '> une déclaration, un plan ou un script prêt ne sont pas des preuves.',
    '',
    `## Verdict : **${VERDICT}** — ${goCount}/${MATRIX.length} critères prouvés`,
    '',
    '## Matrice',
    '',
    '| # | Critère exigé | Preuve datée | Verdict |',
    '|---|---|---|---|',
    ...MATRIX.map((m) => `| ${m.id} | ${esc(m.critere)} | ${esc(m.preuve)} | ${m.go ? '✅ GO' : '⛔ NO-GO'} |`),
    '',
    '## Bloqueurs et propriétaires',
    '',
    '| # | Bloqueur | Propriétaire |',
    '|---|---|---|',
    ...MATRIX.filter((m) => !m.go).map((m) => `| ${m.id} | ${esc(m.bloqueur)} | ${esc(m.owner)} |`),
    '',
    '## Conséquence',
    '',
    'Aucune ouverture pilote n’est préparée : la procédure d’ouverture (sauvegarde pré-ouverture, responsables,',
    'monitoring, revues J+1/J+7) ne s’engage qu’après un verdict GO établi par une nouvelle exécution de ce',
    'générateur, sur preuves. Ordre conseillé : C1 → C3 → C4/C5 → C7/C11 → C10 → C6 ; C8 et C9 en parallèle.',
    '',
  ];
  return lines.join('\n');
}

// ── DOCX helpers ────────────────────────────────────────────────────────────
function P(text, opts = {}) {
  return new Paragraph({
    alignment: opts.align,
    spacing: { after: opts.after ?? 120 },
    children: [new TextRun({ text, bold: opts.bold, italics: opts.italics, color: opts.color ?? '000000', size: opts.size ?? 21, font: FONT })],
  });
}
function H(text, level) {
  return new Paragraph({
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 320 : 220, after: 140 },
    children: [new TextRun({ text, bold: true, color: level === HeadingLevel.HEADING_1 ? NAVY : GREEN, size: level === HeadingLevel.HEADING_1 ? 28 : 24, font: FONT })],
  });
}
function bullet(text) {
  return new Paragraph({ bullet: { level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text, size: 21, font: FONT })] });
}
function cell(text, opts = {}) {
  return new TableCell({
    width: { size: opts.width, type: WidthType.DXA },
    shading: opts.shade ? { type: ShadingType.CLEAR, fill: opts.shade, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text, bold: opts.bold, color: opts.color ?? '000000', size: opts.size ?? 18, font: FONT })] })],
  });
}
function table(rows, widths) {
  const b = (size, color) => ({ style: BorderStyle.SINGLE, size, color });
  return new Table({
    columnWidths: widths,
    width: { size: CONTENT_W, type: WidthType.DXA },
    borders: { top: b(4, 'CCC4B8'), bottom: b(4, 'CCC4B8'), left: b(4, 'CCC4B8'), right: b(4, 'CCC4B8'), insideHorizontal: b(2, 'DDD6CB'), insideVertical: b(2, 'DDD6CB') },
    rows,
  });
}
function headRow(labels, widths) {
  return new TableRow({ tableHeader: true, children: labels.map((l, i) => cell(l, { width: widths[i], bold: true, shade: LIGHT, color: NAVY })) });
}

async function main() {
  const children = [];

  // ── Page de garde conventionnée ──
  children.push(
    P(' ', { after: 1200 }),
    P('PROGRAMME NEXT IMPACT', { align: AlignmentType.CENTER, bold: true, color: NAVY, size: 26 }),
    P('FP2E · Sèmè City · Banque mondiale', { align: AlignmentType.CENTER, color: GREY }),
    P('Convention FP2E/NI/IDÉ/2025', { align: AlignmentType.CENTER, color: GREY, after: 600 }),
    P('DigiSanté Mobile', { align: AlignmentType.CENTER, bold: true, color: NAVY, size: 40 }),
    P('Procès-verbal de décision GO/NO-GO', { align: AlignmentType.CENTER, bold: true, size: 30 }),
    P('Ouverture pilote', { align: AlignmentType.CENTER, size: 26, after: 600 }),
    P(`Verdict : ${VERDICT}`, { align: AlignmentType.CENTER, bold: true, color: VERDICT === 'GO' ? GREEN : RED, size: 36 }),
    P(`${goCount} critère(s) prouvé(s) sur ${MATRIX.length}`, { align: AlignmentType.CENTER, color: GREY, after: 800 }),
    P(`Établi le ${DATE}`, { align: AlignmentType.CENTER }),
    P('Porteur : SEGLA E. Ulrich Gislain', { align: AlignmentType.CENTER }),
    P(`Révision évaluée : main @ ${REVISION}`, { align: AlignmentType.CENTER, color: GREY, size: 18 }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ══ PARTIE I — Contexte et méthode ══
  children.push(
    H('Partie I — Contexte et méthode', HeadingLevel.HEADING_1),
    P('Ce procès-verbal statue sur l’ouverture d’un pilote de DigiSanté Mobile auprès de premiers usagers réels. Il clôt la série de finalisation (vingt étapes) engagée en septembre 2026.'),
    P('Règle de décision appliquée sans exception :', { bold: true }),
    bullet('chaque critère exigé doit être étayé par une preuve d’exécution datée et vérifiable : commande exécutée, exécution d’intégration continue, fiche de recette signée ;'),
    bullet('une déclaration, un plan, une procédure rédigée ou un script prêt à l’emploi ne constituent pas une preuve d’exécution ;'),
    bullet('un seul critère sans preuve suffit à prononcer un NO-GO.'),
    P('Sources consultées : suivis des chantiers B1 à B5, rapports de tests, protocole de recette des sept rôles, audit de sécurité de release, plan de bascule du paiement et historique d’intégration continue.'),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ══ PARTIE II — Matrice ══
  children.push(H('Partie II — Matrice de décision', HeadingLevel.HEADING_1));
  {
    const W = [600, 2300, 4926, 1200];
    const rows = [headRow(['#', 'Critère exigé', 'Preuve datée', 'Verdict'], W)];
    for (const m of MATRIX) {
      rows.push(new TableRow({ children: [
        cell(m.id, { width: W[0], bold: true, color: NAVY }),
        cell(m.critere, { width: W[1], bold: true }),
        cell(m.preuve, { width: W[2] }),
        cell(m.go ? 'GO' : 'NO-GO', { width: W[3], bold: true, color: m.go ? GREEN : RED, shade: m.go ? GREEN_BG : RED_BG }),
      ] }));
    }
    children.push(table(rows, W));
  }
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ══ PARTIE III — Bloqueurs ══
  children.push(
    H('Partie III — Bloqueurs et propriétaires', HeadingLevel.HEADING_1),
    P('Le verdict étant NO-GO, seuls les bloqueurs et leur propriétaire sont listés. Aucune procédure d’ouverture n’est engagée.'),
  );
  {
    const W = [600, 5626, 2800];
    const rows = [headRow(['#', 'Action requise pour lever le bloqueur', 'Propriétaire'], W)];
    for (const m of MATRIX.filter((x) => !x.go)) {
      rows.push(new TableRow({ children: [
        cell(m.id, { width: W[0], bold: true, color: NAVY }),
        cell(m.bloqueur, { width: W[1] }),
        cell(m.owner, { width: W[2] }),
      ] }));
    }
    children.push(table(rows, W));
  }
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ══ PARTIE IV — Suites ══
  children.push(
    H('Partie IV — Suites et conditions de réexamen', HeadingLevel.HEADING_1),
    H('IV.1 Ordre de levée conseillé', HeadingLevel.HEADING_2),
    bullet('Rétablir l’intégration continue (C1, C2) : prérequis de toute preuve reproductible.'),
    bullet('Mettre en service le serveur (C3), puis ouvrir les comptes fournisseurs (C4) et dérouler la recette du paiement en bac à sable (C5) ; le correctif d’idempotence est appliqué depuis le 22/09/2026.'),
    bullet('Répéter la restauration par un tiers et le retour arrière (C7, C11).'),
    bullet('Exécuter la recette sur appareils et opérateurs réels (C10), puis basculer le paiement en production (C6).'),
    bullet('En parallèle, dès J0 : relecture native des libellés d’urgence (C8) et contreseing clinique (C9).'),
    H('IV.2 Réexamen', HeadingLevel.HEADING_2),
    P('La décision est réexaminée en régénérant ce procès-verbal lorsque chaque bloqueur est levé par une preuve versionnée dans le dépôt. En cas de GO, l’ouverture pilote comprendra : sauvegarde pré-ouverture vérifiée, désignation nominative des responsables d’astreinte, surveillance active (sondes et alertes du runbook), cohorte limitée et revues à J+1 et J+7.'),
    H('IV.3 Ce que ce procès-verbal n’atteste pas', HeadingLevel.HEADING_2),
    bullet('Aucune vérification n’a été conduite sur un serveur, un fournisseur ou un appareil réel.'),
    bullet('Aucune validation humaine n’est présumée : traductions, contreseing clinique et recettes restent à obtenir.'),
  );

  // ── Attestation ──
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(
    H('Attestation', HeadingLevel.HEADING_1),
    P(`Je soussigné, porteur du projet DigiSanté Mobile, prends acte du verdict ${VERDICT} établi le ${DATE} sur la base des preuves listées, et de la liste des bloqueurs à lever avant toute ouverture à des usagers réels.`),
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

  const doc = new Document({
    creator: 'DigiSanté Mobile',
    title: 'Procès-verbal GO/NO-GO — ouverture pilote',
    description: `Décision d’ouverture pilote du ${DATE}.`,
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      headers: {
        default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'DigiSanté Mobile — PV GO/NO-GO — NEXT IMPACT', size: 16, color: GREY, font: FONT })] })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
          new TextRun({ text: 'Conforme audit — Confidentiel   ·   Convention FP2E/NI/IDÉ/2025   ·   page ', size: 16, color: GREY, font: FONT }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY, font: FONT }),
          new TextRun({ text: ' / ', size: 16, color: GREY, font: FONT }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: GREY, font: FONT }),
        ] })] }),
      },
      children,
    }],
  });

  const docsDir = path.resolve(__dirname, '../../docs');
  const outDocx = process.argv[2] || path.join(docsDir, `PV_GO_NOGO_${DATE_ISO}.docx`);
  fs.writeFileSync(outDocx, await Packer.toBuffer(doc));
  fs.writeFileSync(path.join(docsDir, `GO_NOGO_${DATE_ISO}.md`), toMarkdown());
  console.log(`Verdict ${VERDICT} (${goCount}/${MATRIX.length}) — écrit : ${outDocx} + GO_NOGO_${DATE_ISO}.md`);
}

main().catch((e) => { console.error(e); process.exit(1); });
