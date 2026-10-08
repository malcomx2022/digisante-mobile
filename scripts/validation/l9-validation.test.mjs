import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSnapshot, loadPureContent, ROOT, sha256 } from './content.mjs';
import { reviewArtifacts } from './prepare-l9.mjs';
import { CLINICAL_SCOPES, contentHash, gateIssues } from './check-l9-gate.mjs';
import { localeIssues } from '../i18n/check-coverage.mjs';
import { parseCsv } from '../i18n/import-validated.mjs';

const snapshot = buildSnapshot();
test('dossier extrait les vrais textes et huit contacts CPN, pas un dist ou un libellé recopié', () => {
  const content = loadPureContent();
  assert.equal(snapshot.triage.length, content.TRIAGE_FLOWS.length);
  assert.equal(snapshot.pev.length, content.PEV_SCHEDULE.length);
  assert.equal(snapshot.maternity.contacts.length, 8);
  for (const flow of snapshot.triage) for (const q of flow.questions) assert.equal(q.label.fr, snapshot.messages.fr[`triage.q.${q.key}`]);
  for (const s of snapshot.sources) assert.equal(s.sha256, sha256(readFileSync(resolve(ROOT,s.path))));
});

test('exports couvrent toutes les clés UI et tout le phrasier, textes courants séparés des retours vides', () => {
  const artifacts = reviewArtifacts(snapshot);
  for (const locale of ['fon','yor']) {
    const rows = parseCsv(artifacts[`messages.${locale}.csv`]);
    assert.equal(rows.length-1,Object.keys(snapshot.messages.fr).length);
    assert.ok(rows.slice(1).every((r)=>r[5]===''));
    assert.equal(rows.slice(1).filter((r)=>r[1]==='CRITIQUE').length,snapshot.criticalKeys.length);
    const phrases = parseCsv(artifacts[`phrasebook.${locale}.csv`]);
    assert.equal(phrases.length-1,snapshot.phrasebook.length);
    assert.ok(phrases.slice(1).every((r)=>r[1]==='CLINIQUE_DOUBLE_RELECTURE' && r[6]===''));
  }
});

test('clé vide, variable manquante, caractère de remplacement et clé hors FR ne prouvent pas la couverture', () => {
  const report=localeIssues({a:'Bonjour {name}',b:'B',c:'C'}, {a:'TEST',b:' ',c:'\uFFFD',extra:'TEST'});
  assert.deepEqual(report,{missing:['b'],invalid:['a','c'],unknown:['extra']});
});

test('sans retours, le gate L9 reste ouvert même si les instantanés techniques sont valides', () => {
  const issues=gateIssues(snapshot,{schemaVersion:1,native:[],clinical:[]});
  assert.ok(issues.includes('fon: phrasier incomplet'));
  assert.ok(issues.some((s)=>s.includes('contreseing')));
  assert.ok(issues.some((s)=>s.includes('preuve absente')));
});

function fixture() {
  const s=structuredClone(snapshot);
  // MARQUEURS SYNTHÉTIQUES, pas des traductions ; seulement dans la mémoire du test.
  for (const locale of ['fon','yor']) {
    s.messages[locale]=Object.fromEntries(Object.entries(s.messages.fr).map(([k,v])=>[k,`TEST ${v}`]));
    s.coverage[locale]=localeIssues(s.messages.fr,s.messages[locale]);
    for(const p of s.phrasebook) p.text[locale.toUpperCase()]=`TEST ${p.text.FR}`;
  }
  const e={schemaVersion:1,native:[],clinical:[]};
  for (const locale of ['fon','yor']) for(const scope of ['ui','phrasebook-native']) e.native.push({locale,scope,contentSha256:contentHash(s,scope,locale),evidenceRef:'SYNTHETIC TEST ONLY',decision:'APPROVED',reviewer:'TEST ONE',date:'2026-10-01',secondReviewer:'TEST TWO',secondDate:'2026-10-02'});
  for(const scope of CLINICAL_SCOPES) e.clinical.push({scope,contentSha256:contentHash(s,scope),evidenceRef:'SYNTHETIC TEST ONLY',decision:'APPROVED',reviewer:'TEST HEALTH',date:'2026-10-01',professionalCapacity:'TEST ONLY',runtimeInventoryRef:scope==='education'?'TEST INVENTORY':undefined});
  return {s,e};
}

test('preuves déclarées cohérentes puis changement de contenu invalide les références ; aucune identité authentifiée', () => {
  const {s,e}=fixture();assert.deepEqual(gateIssues(s,e,'2026-10-08'),[]);
  s.phrasebook[0].text.FR+=' MODIFIED';
  assert.ok(gateIssues(s,e,'2026-10-08').some((i)=>i.includes('phrasebook-native')));
  assert.ok(gateIssues(s,e,'2026-10-08').some((i)=>i.startsWith('phrasebook:')));
});

test('preuve refusée si doublon, date future, relecteurs identiques, rejet clinique ou inventaire DB absent', () => {
  const {s,e}=fixture();
  e.native.push({...e.native[0]});e.native[1].secondReviewer=' test one ';e.native[2].secondDate='2026-10-09';
  e.clinical[0].decision='REJECTED';e.clinical.at(-1).runtimeInventoryRef=undefined;
  const issues=gateIssues(s,e,'2026-10-08');
  assert.ok(issues.some((i)=>i.includes('ambiguë')));assert.ok(issues.some((i)=>i.includes('double relecture')));
  assert.ok(issues.some((i)=>i.startsWith('triage:')));assert.ok(issues.some((i)=>i.includes('inventaire')));
});

test('instantané périmé/altéré refusé sans le réécrire', () => {
  const dir=mkdtempSync(join(tmpdir(),'digisante-l9-pack-'));
  const run=(args)=>spawnSync(process.execPath,['scripts/validation/prepare-l9.mjs','--output-dir',dir,...args],{cwd:ROOT,encoding:'utf8'});
  try {
    assert.equal(run([]).status,0);assert.equal(run(['--check']).status,0);
    const file=join(dir,'messages.fon.csv');writeFileSync(file,'ALTERED TEST');
    assert.notEqual(run(['--check']).status,0);assert.equal(readFileSync(file,'utf8'),'ALTERED TEST');
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('traduction machine des clés critiques interdite avant accès au modèle ou écriture', () => {
  const r=spawnSync(process.execPath,['scripts/i18n/translate-draft.mjs','--dry','--include-critical'],{cwd:ROOT,encoding:'utf8'});
  assert.notEqual(r.status,0);assert.match(r.stderr,/include-critical interdit/);
});
