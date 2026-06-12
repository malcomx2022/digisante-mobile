import { describe, expect, it } from 'vitest';

import { detectCriticalValues } from './laboratory.rules.js';

describe('detectCriticalValues', () => {
  it('détecte une hypoglycémie (LOW)', () => {
    const f = detectCriticalValues({ glucose: 0.3 });
    expect(f).toEqual([{ key: 'glucose', value: 0.3, reason: 'LOW' }]);
  });

  it('détecte une hyperkaliémie (HIGH)', () => {
    const f = detectCriticalValues({ potassium: 7.2 });
    expect(f[0]).toMatchObject({ key: 'potassium', reason: 'HIGH' });
  });

  it('valeurs normales → aucune alerte', () => {
    expect(detectCriticalValues({ glucose: 1, potassium: 4.2, spo2: 98 })).toEqual([]);
  });

  it('ignore les valeurs non numériques ou inconnues', () => {
    expect(detectCriticalValues({ glucose: 'NA', commentaire: 'RAS' })).toEqual([]);
  });
});
