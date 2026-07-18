// Test unitaire de la distance Haversine (@digisante/shared).
import { haversineKm } from '@digisante/shared';
import { describe, expect, it } from 'vitest';

describe('haversineKm', () => {
  it('distance nulle pour le même point', () => {
    expect(haversineKm(6.37, 2.42, 6.37, 2.42)).toBe(0);
  });

  it('Cotonou → Porto-Novo ≈ 35 km (±5)', () => {
    // Cotonou (6.3703, 2.3912) → Porto-Novo (6.4969, 2.6283)
    const d = haversineKm(6.3703, 2.3912, 6.4969, 2.6283);
    expect(d).toBeGreaterThan(25);
    expect(d).toBeLessThan(40);
  });

  it('symétrique', () => {
    expect(haversineKm(6.3, 2.3, 9.3, 2.6)).toBeCloseTo(haversineKm(9.3, 2.6, 6.3, 2.3), 6);
  });
});
