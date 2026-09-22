import { describe, expect, it } from 'vitest';

import { computeAuditHash } from './audit.js';

const entry = { action: 'DMP_ACCESS', actorId: 'u1', targetId: 'p1', ip: '127.0.0.1' };
const ts = '2026-06-12T00:00:00.000Z';

describe('computeAuditHash', () => {
  it('est déterministe', () => {
    expect(computeAuditHash(null, entry, ts)).toBe(computeAuditHash(null, entry, ts));
  });

  it('produit un SHA-256 hex (64 caractères)', () => {
    expect(computeAuditHash(null, entry, ts)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('chaîne : le hash dépend du hash précédent', () => {
    const h1 = computeAuditHash(null, entry, ts);
    const h2 = computeAuditHash(h1, entry, ts);
    expect(h2).not.toBe(h1);
  });

  it('dépend du contenu de l’entrée', () => {
    const base = computeAuditHash(null, entry, ts);
    const altered = computeAuditHash(null, { ...entry, action: 'AUTH_FAIL' }, ts);
    expect(altered).not.toBe(base);
  });

  it('RE-CALCULABLE depuis jsonb : l’ordre des clés de meta (même imbriquées) est indifférent', () => {
    const inserted = { ...entry, meta: { submissionId: 's1', decision: 'APPROVED', cnom: { verified: true, source: 'X', checkedAt: ts } } };
    // Ordre tel que PostgreSQL jsonb le restitue (longueur puis octets).
    const fromJsonb = { ...entry, meta: { cnom: { source: 'X', verified: true, checkedAt: ts }, decision: 'APPROVED', submissionId: 's1' } };
    expect(computeAuditHash(null, fromJsonb, ts)).toBe(computeAuditHash(null, inserted, ts));
  });

  it('une valeur de meta altérée change le hash (détection de falsification)', () => {
    const a = computeAuditHash(null, { ...entry, meta: { amount: '5000' } }, ts);
    expect(computeAuditHash(null, { ...entry, meta: { amount: '50000' } }, ts)).not.toBe(a);
  });

  it('clés undefined ignorées et Date sérialisée comme en base', () => {
    const d = new Date(ts);
    expect(computeAuditHash(null, { ...entry, meta: { a: 1, b: undefined, at: d } }, ts))
      .toBe(computeAuditHash(null, { ...entry, meta: { at: ts, a: 1 } }, ts));
  });
});
