import { describe, expect, it } from 'vitest';

import { computeDispenseStatus } from './pharmacy.rules.js';

describe('computeDispenseStatus', () => {
  it('toutes les lignes délivrées → FULLY_DISPENSED', () => {
    expect(computeDispenseStatus(['DISPENSED', 'DISPENSED'])).toBe('FULLY_DISPENSED');
  });

  it('délivrance partielle → PARTIALLY_DISPENSED', () => {
    expect(computeDispenseStatus(['DISPENSED', 'UNAVAILABLE'])).toBe('PARTIALLY_DISPENSED');
    expect(computeDispenseStatus(['PARTIALLY_DISPENSED', 'PENDING'])).toBe('PARTIALLY_DISPENSED');
  });

  it('rien de délivré → ACTIVE', () => {
    expect(computeDispenseStatus(['PENDING', 'UNAVAILABLE'])).toBe('ACTIVE');
    expect(computeDispenseStatus([])).toBe('ACTIVE');
  });
});
