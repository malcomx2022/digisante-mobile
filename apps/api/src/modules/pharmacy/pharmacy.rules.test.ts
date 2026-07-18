import { describe, expect, it } from 'vitest';

import { computeDispenseStatus } from './pharmacy.rules.js';
import { normalizeMed } from './pharmacy.stock.js';

describe('normalizeMed', () => {
  it('minuscule, retire les accents et espaces de bord', () => {
    expect(normalizeMed('  Paracétamol ')).toBe('paracetamol');
  });

  it('sécurité : retire les jokers LIKE %/_/\\ (anti-dump de l’inventaire)', () => {
    expect(normalizeMed('%')).toBe('');
    expect(normalizeMed('_')).toBe('');
    expect(normalizeMed('parac%')).toBe('parac');
    expect(normalizeMed('a_b\\c')).toBe('abc');
  });
});

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
