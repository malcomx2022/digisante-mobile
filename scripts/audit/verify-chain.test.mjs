import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rowHash, verify } from './verify-chain.mjs';

const mk = (prevHash, meta, ts = '2026-09-22T00:00:00.000Z') => {
  const r = { action: 'KYC_APPROVE', actorId: 'a', targetId: 't', ip: null, meta, prevHash, ts };
  return { ...r, hash: rowHash(r) };
};

test('chaîne canonique intègre : aucun défaut, même avec des clés réordonnées par jsonb', () => {
  const a = mk(null, { submissionId: 's', cnom: { verified: true, source: 'X' } });
  const b = mk(a.hash, { b: 1, a: 2 });
  // Restitution jsonb : clés dans un autre ordre, hash identique attendu.
  const bFromDb = { ...b, meta: { a: 2, b: 1 } };
  assert.deepEqual(verify([a, bFromDb]), { rows: 2, brokenLinks: [], badHashes: [] });
});

test('détecte une valeur de meta falsifiée et un chaînage rompu', () => {
  const a = mk(null, { amount: '5000' });
  const b = mk(a.hash, { amount: '10' });
  const tampered = { ...a, meta: { amount: '50000' } };
  const r = verify([tampered, { ...b, prevHash: 'forged' }]);
  assert.deepEqual(r.badHashes, [0, 1]);
  assert.deepEqual(r.brokenLinks, [1]);
});
