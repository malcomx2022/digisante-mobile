// Contenus locaux du dépôt : compilation fraîche, jamais un dist potentiellement périmé.
// Aucun CSV/retour humain n'est exécuté ; seuls cinq modules purs du projet sont chargés.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractLocale, isCritical, localeIssues } from '../i18n/check-coverage.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const SCOPE_FILES = {
  triage: ['packages/shared/src/triage.ts', 'apps/web/src/app/patient/triage/page.tsx'],
  pev: ['packages/shared/src/pev.ts', 'apps/api/src/modules/vaccinations/vaccinations.service.ts', 'apps/api/src/modules/vaccinations/vaccinations.routes.ts', 'apps/web/src/app/patient/vaccinations/page.tsx'],
  maternity: ['packages/shared/src/maternity.ts', 'apps/api/src/modules/maternity/maternity.service.ts', 'apps/api/src/modules/maternity/maternity.routes.ts', 'apps/web/src/app/patient/maternity/page.tsx'],
  phrasebook: ['packages/shared/src/phrasebook.ts', 'apps/web/src/components/chat/ChatRoom.tsx'],
  prescriptions: ['packages/shared/src/posology.ts', 'apps/api/src/modules/prescriptions/prescriptions.rules.ts', 'apps/api/src/modules/prescriptions/prescriptions.service.ts', 'apps/api/src/modules/prescriptions/prescriptions.routes.ts', 'apps/web/src/app/pro/prescribe/page.tsx', 'apps/web/src/app/patient/prescriptions/page.tsx', 'apps/web/src/components/patient/PrescriptionPosology.tsx'],
  vitals: ['apps/web/src/app/patient/vitals/page.tsx', 'apps/api/src/modules/dmp/dmp.routes.ts', 'apps/api/src/modules/dmp/dmp.service.ts'],
  education: ['apps/api/src/modules/education/education.service.ts', 'apps/api/src/modules/education/education.rules.ts', 'apps/web/src/app/patient/education/page.tsx', 'apps/api/prisma/seed.ts'],
};
export const SOURCE_FILES = ['apps/web/src/i18n/messages.ts', ...new Set(Object.values(SCOPE_FILES).flat())];

export function loadPureContent(root = ROOT) {
  const require = createRequire(resolve(root, 'apps/api/package.json'));
  const ts = require('typescript'); // dépendance de développement existante, aucun ajout
  const cache = new Map();
  const load = (name) => {
    if (!['triage', 'pev', 'maternity', 'phrasebook', 'posology'].includes(name)) throw new Error('Module de dossier non autorisé');
    if (cache.has(name)) return cache.get(name);
    const source = readFileSync(resolve(root, `packages/shared/src/${name}.ts`), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    runInNewContext(compiled, { exports: module.exports, require: (id) => {
      if (name === 'maternity' && id === './pev.js') return load('pev');
      throw new Error(`Import inattendu dans module clinique pur : ${id}`);
    } }, { timeout: 1000 });
    cache.set(name, module.exports);
    return module.exports;
  };
  return { ...load('triage'), ...load('pev'), ...load('maternity'), ...load('phrasebook'), ...load('posology') };
}

export function buildSnapshot(root = ROOT) {
  const sources = SOURCE_FILES.map((path) => ({ path, sha256: sha256(readFileSync(resolve(root, path))) }));
  const messagesSource = readFileSync(resolve(root, SOURCE_FILES[0]), 'utf8');
  const messages = Object.fromEntries(['fr', 'en', 'fon', 'yor'].map((locale) => [locale, extractLocale(messagesSource, locale)]));
  const content = loadPureContent(root);
  const label = (key) => {
    if (!messages.fr[key]?.trim() || !messages.en[key]?.trim()) throw new Error(`Libellé clinique FR/EN absent : ${key}`);
    return { key, fr: messages.fr[key], en: messages.en[key] };
  };
  const clinicalPrefixes = ['triage.', 'maternity.', 'vaccine.', 'vitals.', 'prescribe.', 'prescriptions.', 'posology.', 'vaccinations.', 'education.', 'edureview.'];
  const snapshot = {
    schemaVersion: 1,
    sourceSnapshotSha256: sha256(JSON.stringify(sources)),
    sources,
    // Aucune signature inventée : état de préparation, pas une validation humaine.
    evidenceStatus: 'AWAITING_REFERENCES_AND_SIGNED_RETURNS',
    messages,
    coverage: Object.fromEntries(['en', 'fon', 'yor'].map((locale) => [locale, localeIssues(messages.fr, messages[locale])])),
    criticalKeys: Object.keys(messages.fr).filter(isCritical),
    clinicalTexts: Object.keys(messages.fr).filter((key) => clinicalPrefixes.some((prefix) => key.startsWith(prefix))).map(label),
    triage: content.TRIAGE_FLOWS.map((flow) => ({ id: flow.id, label: label(`triage.flow.${flow.id}`), questions: flow.questions.map((q) => ({ ...q, label: label(`triage.q.${q.key}`) })) })),
    pev: content.PEV_SCHEDULE.map((dose) => ({ ...dose, label: label(`vaccine.${dose.vaccineKey}`) })),
    maternity: { termDays: content.TERM_DAYS, contacts: content.ANC_SCHEDULE.map((visit) => ({ ...visit, objective: label(`maternity.objective.${visit.contactNumber}`) })) },
    phrasebook: content.PHRASEBOOK,
    // Cas synthétiques de rendu à qualifier ; aucune dose recommandée.
    posologyExamples: [
      { dosage: '0,5 comprimé', frequency: 'une fois par jour', duration: '5' },
      { dosage: '500 mg', frequency: 'une fois par jour', duration: '5 jours' },
      { dosage: '1 comprimé', frequency: '3 fois par jour', duration: '1 mois' },
    ].map((input) => ({ input, parsed: content.parsePosology(input) })),
  };
  // Conversion des objets VM en données JSON ordinaires, reproductibles sans date de génération.
  return JSON.parse(JSON.stringify(snapshot));
}
