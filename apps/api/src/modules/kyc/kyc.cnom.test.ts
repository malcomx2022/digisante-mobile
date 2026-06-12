import { describe, expect, it } from 'vitest';

import { isPlausibleLicense } from './kyc.cnom.js';

describe('isPlausibleLicense', () => {
  it('accepte un format BJ-XXX-#### valide', () => {
    expect(isPlausibleLicense('BJ-MED-0001')).toBe(true);
    expect(isPlausibleLicense('BJ-PHA-12345')).toBe(true);
  });

  it('rejette les formats invalides', () => {
    expect(isPlausibleLicense('MED-0001')).toBe(false);
    expect(isPlausibleLicense('BJ-med-0001')).toBe(false);
    expect(isPlausibleLicense('BJ-MED-')).toBe(false);
    expect(isPlausibleLicense('')).toBe(false);
  });

  it('tolère les espaces autour', () => {
    expect(isPlausibleLicense('  BJ-MED-0007  ')).toBe(true);
  });
});
