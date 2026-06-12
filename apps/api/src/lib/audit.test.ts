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
});
