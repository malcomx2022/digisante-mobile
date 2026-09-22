// Tests du compteur de métriques (node:test, aucune I/O réseau).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { check, countCases, countRoutes, measure, stripComments } from './count.mjs';

test('countRoutes : REST vs WebSocket, génériques, commentaires ignorés', () => {
  const src = `
    app.get('/a', async () => 1);
    app.post<{ Body: X }>('/b', { schema }, async () => 1);
    // app.delete('/commentée', h);
    /* app.put('/bloc', h); */
    app.get('/ws', { websocket: true }, (socket) => {});
    app.patch('/c', { preHandler: [auth] }, async (req) => { const u = 'https://x.y/z'; });
    service.get('/pas-une-route');
  `;
  assert.deepEqual(countRoutes(src), { rest: 3, websocket: 1 });
});

test("countRoutes : 'websocket: true' situé dans le handler ne requalifie pas la route", () => {
  const src = `app.post('/x', async (req) => { return { websocket: true }; });`;
  assert.deepEqual(countRoutes(src), { rest: 1, websocket: 0 });
});

test('countCases : it/test en début de ligne, pas les describe ni les mentions', () => {
  const src = `describe('s', () => {\n  it('a', () => {});\n  test('b', () => {});\n  // it('c')\n  const x = 'it(';\n});`;
  assert.equal(countCases(src), 2);
});

test("stripComments préserve les URL dans les chaînes", () => {
  assert.match(stripComments(`const u = 'https://api.fedapay.com/v1'; // note`), /https:\/\/api\.fedapay\.com/);
});

test('mesure du dépôt : 1 seul canal WebSocket et compteurs cohérents', () => {
  const m = measure();
  assert.equal(m.websocket, 1);
  assert.equal(m.unitTests, m.apiTests + m.webTests);
  assert.ok(m.patientPages < m.pages);
});

test('check signale une dérive de la source unique et des documents', () => {
  const measured = { rest: 10, websocket: 1 };
  const docs = [{ file: 'X.md', metric: 'rest', re: /(\d+) endpoints/ }];
  assert.deepEqual(check(measured, measured, docs, () => '10 endpoints'), []);
  assert.equal(check(measured, { rest: 9, websocket: 1 }, docs, () => '10 endpoints').length, 1);
  assert.match(check(measured, measured, docs, () => '12 endpoints')[0], /écrit 12, mesuré 10/);
  assert.match(check(measured, measured, docs, () => 'rien')[0], /motif introuvable/);
});
