import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyToSource, parseCsv, plan, validateReview } from './import-validated.mjs';

const fr = { 'sos.im_ok': 'Je vais bien', 'home.hello': 'Bonjour {name}', 'x.bold': 'Voir <b>ici</b>', 'x.done': 'Fait' };
const csv = (rows) => parseCsv(['key,critical,fr,en,fon', ...rows].join('\n'));
// Valeurs de TEST : des marqueurs, jamais des traductions (aucune traduction n'est inventée).
const T = (s) => `[FON-TEST] ${s}`;

test('parseCsv : guillemets doublés, virgules et BOM', () => {
  const rows = parseCsv('﻿key,fr\n"a.b","Oui, ""bien"""\n');
  assert.deepEqual(rows, [['key', 'fr'], ['a.b', 'Oui, "bien"']]);
});

test('critique refusée sans double validation, acceptée avec', () => {
  const rows = csv([`sos.im_ok,CRITIQUE,Je vais bien,I am fine,${T('ok')}`]);
  assert.equal(plan({ rows, locale: 'fon', fr, existing: {}, doubleValidated: false }).rejected[0].reason, 'CRITIQUE sans double validation tracée');
  assert.equal(plan({ rows, locale: 'fon', fr, existing: {}, doubleValidated: true }).accepted.length, 1);
});

test('variables et balises doivent être identiques au FR', () => {
  const rows = csv([
    `home.hello,,Bonjour {name},Hello {name},${T('sans variable')}`,
    `x.bold,,Voir <b>ici</b>,See <b>here</b>,${T('<i>ici</i>')}`,
    `x.done,,Fait,Done,${T('{name}')}`,
  ]);
  const r = plan({ rows, locale: 'fon', fr, existing: {}, doubleValidated: true });
  assert.equal(r.accepted.length, 0);
  assert.match(r.rejected[0].reason, /variables/);
  assert.match(r.rejected[1].reason, /balises/);
  assert.match(r.rejected[2].reason, /variables/);
});

test('cases vides, identiques au FR, mal encodées, fr modifié, clé inconnue, déjà traduite', () => {
  const rows = csv([
    'x.done,,Fait,Done,',
    'x.done,,Fait,Done,Fait',
    `x.done,,Fait,Done,${T('�')}`,
    `x.done,,Fait !,Done,${T('a')}`,
    `nope.key,,Rien,Nothing,${T('a')}`,
    `home.hello,,Bonjour {name},Hello {name},${T('{name}')}`,
  ]);
  const r = { accepted: [], rejected: [] };
  for (const row of rows.slice(1)) {
    const result = plan({ rows: [rows[0], row], locale: 'fon', fr, existing: { 'home.hello': 'déjà' }, doubleValidated: true });
    r.accepted.push(...result.accepted); r.rejected.push(...result.rejected);
  }
  assert.equal(r.accepted.length, 0);
  assert.deepEqual(r.rejected.map((x) => x.reason.split(' ')[0]), ['case', 'identique', 'encodage', 'colonne', 'clé', 'déjà']);
});

test('CSV ambigu : quotes non fermées, suffixe, colonnes/clés dupliquées et taille refusés', () => {
  for (const input of ['a,b\n"non fermé', 'a,b\n"x"suffix,y', 'a,b\nx"y,z']) assert.throws(() => parseCsv(input), /CSV invalide/);
  for (const input of ['key,fr,fon,fon\na,A,x,y', 'key,fr,fon\na,A', 'key,fr,fon\na,A,x\na,A,y']) {
    assert.throws(() => plan({ rows: parseCsv(input), locale: 'fon', fr: { a: 'A' }, existing: {}, doubleValidated: true }));
  }
  assert.throws(() => plan({ rows: [], locale: 'fon', fr, existing: {} }), /CSV vide/);
});

test('source FR/EN vérifiée ; propriétés héritées ne sont pas des clés', () => {
  const r = plan({ rows: csv(['x.done,,Fait,Ancienne version,marqueur', 'constructor,,x,x,marqueur']), locale: 'fon', fr, en: { 'x.done': 'Done' }, existing: {}, doubleValidated: true });
  assert.equal(r.accepted.length, 0); assert.match(r.rejected[0].reason, /colonne en/); assert.match(r.rejected[1].reason, /inconnue/);
});

test('édition conserve les métacaractères de remplacement JS comme texte, sans toucher FR/YOR', () => {
  const src = "const fr: Messages = {\n  'a': 'A',\n};\nconst fon: Messages = {\n  'a': 'old',\n};\nconst yor: Messages = {\n  'a': 'Y',\n};\n";
  const value = "TEST $& $' $` $$ $2";
  const out = applyToSource(src, 'fon', [{ key: 'a', value }]);
  assert.ok(out.includes(`'a': ${JSON.stringify(value)},`));
  assert.ok(out.startsWith("const fr: Messages = {\n  'a': 'A',\n};"));
  assert.ok(out.endsWith("const yor: Messages = {\n  'a': 'Y',\n};\n"));
});

test('relecteurs distincts normalisés, dates réelles et non futures, pas de ligne Markdown injectée', () => {
  const base = { reviewer: 'Relecteur TEST', date: '2026-10-01', today: '2026-10-08' };
  assert.equal(validateReview(base), false);
  assert.equal(validateReview({ ...base, second: 'Autre TEST', secondDate: '2026-10-02' }), true);
  for (const extra of [{date:'2026-02-30'}, {date:'2026-10-09'}, {reviewer:' '}, {reviewer:'TEST|Fake'}, {second:' RELECTEUR  test ',secondDate:'2026-10-02'}, {second:'Autre TEST', secondDate:'2026-09-30'}, {second:'Autre TEST',secondDate:'2026-10-09'}]) {
    assert.throws(() => validateReview({ ...base, ...extra }));
  }
});

test('applyToSource : ajoute dans le bon bloc, remplace une clé existante, source valide', () => {
  const src = "const fr: Messages = {\n  'a': 'A',\n};\n\nconst fon: Messages = {\n  'a': 'old',\n};\n";
  const out = applyToSource(src, 'fon', [{ key: 'a', value: 'new' }, { key: 'b.c', value: 'x "q"' }]);
  assert.match(out, /const fon: Messages = \{\n  'a': "new",/);
  assert.match(out, /  'b\.c': "x \\"q\\"",\n\};/);
  assert.match(out, /const fr: Messages = \{\n  'a': 'A',\n\};/);
});
