import { describe, expect, it } from 'vitest';

import { printableFields } from './dmp-print';

describe('printableFields (export PDF du DMP)', () => {
  it('rien à imprimer pour une entrée sans contenu', () => {
    expect(printableFields(null)).toEqual([]);
    expect(printableFields(undefined)).toEqual([]);
    expect(printableFields({})).toEqual([]);
  });

  it('conserve les champs dans l’ordre et omet les vides', () => {
    expect(printableFields({ diagnosis: 'Paludisme simple', notes: '  ', dose: 2, fasting: false, extra: null })).toEqual([
      ['diagnosis', 'Paludisme simple'],
      ['dose', '2'],
      ['fasting', 'false'],
    ]);
  });

  it('rend une liste ou un objet imbriqué sans rien perdre', () => {
    expect(printableFields({ items: ['A', '', 'B'], vitals: { systolic: 120 } })).toEqual([
      ['items', 'A, B'],
      ['vitals', '{"systolic":120}'],
    ]);
  });

  it('une valeur simple est imprimée sans libellé', () => {
    expect(printableFields('Compte rendu')).toEqual([['', 'Compte rendu']]);
  });
});
