import { describe, expect, it } from 'vitest';

import { isFuture, overlaps } from './appointments.rules.js';

const T = (h: number, m = 0) => new Date(2026, 5, 12, h, m).getTime();

describe('overlaps', () => {
  it('détecte un chevauchement', () => {
    expect(overlaps(T(9, 0), 30, T(9, 15), 30)).toBe(true);
  });

  it('créneaux adjacents = pas de chevauchement', () => {
    expect(overlaps(T(9, 0), 30, T(9, 30), 30)).toBe(false);
  });

  it('créneaux disjoints', () => {
    expect(overlaps(T(9, 0), 30, T(11, 0), 30)).toBe(false);
  });
});

describe('isFuture', () => {
  it('vrai dans le futur, faux dans le passé', () => {
    expect(isFuture(T(12), T(10))).toBe(true);
    expect(isFuture(T(8), T(10))).toBe(false);
  });
});
