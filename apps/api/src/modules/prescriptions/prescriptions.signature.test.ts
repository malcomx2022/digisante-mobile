import { describe, expect, it } from 'vitest';

import { computeSignature } from './prescriptions.service.js';

describe('computeSignature', () => {
  it('est déterministe pour les mêmes entrées', () => {
    expect(computeSignature('presc1', 'BJ-MED-0001', 'secret')).toBe(
      computeSignature('presc1', 'BJ-MED-0001', 'secret'),
    );
  });

  it('change si l’ordonnance, le N° d’Ordre ou le secret changent', () => {
    const base = computeSignature('presc1', 'BJ-MED-0001', 'secret');
    expect(computeSignature('presc2', 'BJ-MED-0001', 'secret')).not.toBe(base);
    expect(computeSignature('presc1', 'BJ-MED-9999', 'secret')).not.toBe(base);
    expect(computeSignature('presc1', 'BJ-MED-0001', 'autre')).not.toBe(base);
  });

  it('produit un SHA-256 hex', () => {
    expect(computeSignature('a', 'b', 'c')).toMatch(/^[0-9a-f]{64}$/);
  });
});
