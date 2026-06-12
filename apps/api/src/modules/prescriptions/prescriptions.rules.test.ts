import { describe, expect, it } from 'vitest';

import { findAllergyConflicts } from './prescriptions.rules.js';

describe('findAllergyConflicts', () => {
  it('détecte un médicament correspondant à une allergie', () => {
    const items = [{ medicationName: 'Amoxicilline' }, { medicationName: 'Paracétamol' }];
    expect(findAllergyConflicts(items, ['amoxicilline'])).toEqual(['Amoxicilline']);
  });

  it('insensible à la casse et aux espaces', () => {
    expect(findAllergyConflicts([{ medicationName: 'Pénicilline' }], ['  PÉNICILLINE '])).toEqual(['Pénicilline']);
  });

  it('aucune allergie connue → aucun conflit', () => {
    expect(findAllergyConflicts([{ medicationName: 'Ibuprofène' }], [])).toEqual([]);
  });

  it('ignore les correspondances absentes', () => {
    expect(findAllergyConflicts([{ medicationName: 'Doliprane' }], ['aspirine'])).toEqual([]);
  });
});
