// Génère le DOCX du plan actif depuis son Markdown : une seule source de contenu.
// Usage : node scripts/docs/generate-implementation-plan.js [sortie.docx]
// Validation : ZIP/XML OOXML, relations, styles, dimensions, tableaux et contenu.
// Le contrôle structurel ne vaut ni validation humaine ni contrôle du rendu Word.
const fs = require('node:fs');
const path = require('node:path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, TableLayoutType,
  Footer, PageNumber, PageBreak,
} = require('docx');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = path.join(ROOT, 'docs/PLAN_Implementations_Restantes_2026-10.md');
const OUTPUT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'docs/Plan_Implementations_Restantes_2026-10.docx');
const CONTENT_WIDTH = 9026;
const clean = (text) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*|`/g, '');

function paragraph(text, options = {}) {
  return new Paragraph({
    spacing: { after: 110 },
    ...options,
    children: [new TextRun({ text: clean(text), font: 'Calibri', size: 21 })],
  });
}

function table(lines) {
  const cells = lines
    .filter((line) => !/^\|[\s:|\-]+\|$/.test(line))
    .map((line) => line.slice(1, -1).split('|').map((cell) => cell.trim()));
  const count = cells[0].length;
  const widths = Array.from({ length: count }, (_, index) =>
    Math.floor(CONTENT_WIDTH / count) + (index === count - 1 ? CONTENT_WIDTH % count : 0));
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    rows: cells.map((row, index) => new TableRow({
      tableHeader: index === 0,
      cantSplit: true,
      children: row.map((text, column) => new TableCell({
        width: { size: widths[column], type: WidthType.DXA },
        shading: index === 0 ? { type: ShadingType.CLEAR, fill: 'E8E5DF' } : undefined,
        margins: { top: 80, bottom: 80, left: 90, right: 90 },
        children: [new Paragraph({
          spacing: { after: 30 },
          children: [new TextRun({ text: clean(text), font: 'Calibri', size: 18, bold: index === 0 })],
        })],
      })),
    })),
  });
}

function body(markdown) {
  const lines = markdown.split(/\r?\n/);
  const children = [];
  let code = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith('```')) { code = !code; continue; }
    if (code) {
      children.push(new Paragraph({
        spacing: { after: 35 },
        children: [new TextRun({ text: line, font: 'Consolas', size: 17 })],
      }));
      continue;
    }
    if (!line.trim()) continue;
    if (line.startsWith('# ')) continue; // Titre déjà sur la page de garde.
    if (line.startsWith('|')) {
      const rows = [];
      while (index < lines.length && lines[index].startsWith('|')) rows.push(lines[index++]);
      index--;
      children.push(table(rows));
    } else if (line.startsWith('## ')) {
      children.push(paragraph(line.slice(3), { heading: HeadingLevel.HEADING_1, keepNext: true }));
    } else if (line.startsWith('### ')) {
      children.push(paragraph(line.slice(4), { heading: HeadingLevel.HEADING_2, keepNext: true }));
    } else if (line.startsWith('- ')) {
      children.push(paragraph(line.slice(2), { bullet: { level: 0 } }));
    } else {
      children.push(paragraph(line.replace(/^> ?/, '')));
    }
  }
  return children;
}

async function main() {
  const markdown = fs.readFileSync(SOURCE, 'utf8');
  const status = markdown.match(/^> Statut : (.+)$/m)?.[1];
  if (!status) throw new Error('Statut du plan absent de la source Markdown');
  const document = new Document({
    title: 'Plan d’implémentation et de finalisation — DigiSanté Mobile',
    creator: 'DigiSanté Mobile',
    description: 'Plan du 6 octobre 2026 — lots L0–L11 ; ne constitue pas une preuve de livraison.',
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{
      properties: { page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
      } },
      footers: { default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'Conforme audit — plan à exécuter ; validations non attestées · ', size: 16 }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16 }),
        ],
      })] }) },
      children: [
        paragraph('DigiSanté Mobile', { heading: HeadingLevel.TITLE }),
        paragraph('Plan d’implémentation et de finalisation', { heading: HeadingLevel.SUBTITLE }),
        paragraph('Programme NEXT IMPACT — FP2E / Sèmè City / Banque Mondiale'),
        paragraph('Convention FP2E/NI/IDÉ/2025'),
        paragraph('6 octobre 2026 · Lots L0–L11'),
        paragraph(`Statut : ${status}`),
        paragraph('Code initial : Claude Code. Plan et corrections de revue : Codex, à la demande du porteur.'),
        paragraph('Source de contenu : docs/PLAN_Implementations_Restantes_2026-10.md'),
        new Paragraph({ children: [new PageBreak()] }),
        ...body(markdown),
      ],
    }],
  });
  const buffer = await Packer.toBuffer(document);
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, buffer);
  console.log(`DOCX généré : ${path.relative(ROOT, OUTPUT)} (${buffer.length} octets)`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
