// Tests unitaires de l'analyse de posologie (fonction pure, @digisante/shared).
// Alimente le rendu en pictogrammes de l'ordonnance (accès faible-littératie).
import { parsePosology } from '@digisante/shared';
import { describe, expect, it } from 'vitest';

describe('parsePosology', () => {
  it('reconnaît les moments explicites (matin, midi, soir, nuit)', () => {
    const p = parsePosology({ dosage: '1 comprimé', frequency: 'matin et soir', duration: '7 jours' });
    expect(p.timings).toEqual(['MORNING', 'EVENING']);
    expect(p.timesPerDay).toBe(2);
    expect(p.doseCount).toBe(1);
    expect(p.form).toBe('TABLET');
    expect(p.days).toBe(7);
    expect(p.recognized).toBe(true);
  });

  it('dérive les moments depuis « N fois par jour »', () => {
    expect(parsePosology({ frequency: '3 fois par jour' }).timings).toEqual(['MORNING', 'NOON', 'EVENING']);
    expect(parsePosology({ frequency: '1 fois par jour' }).timings).toEqual(['MORNING']);
    expect(parsePosology({ frequency: 'deux fois par jour' }).timesPerDay).toBe(2);
  });

  it('détecte la forme galénique et la quantité', () => {
    expect(parsePosology({ dosage: '2 comprimés' }).doseCount).toBe(2);
    expect(parsePosology({ dosage: '1 gélule' }).form).toBe('CAPSULE');
    expect(parsePosology({ dosage: '5 ml de sirop' }).form).toBe('SYRUP');
    expect(parsePosology({ dosage: '2 gouttes' }).form).toBe('DROPS');
    expect(parsePosology({ dosage: '1 ampoule en injection' }).form).toBe('INJECTION');
    expect(parsePosology({ dosage: '1 sachet' }).form).toBe('SACHET');
  });

  it('détecte la relation au repas', () => {
    expect(parsePosology({ frequency: 'avant le repas' }).meal).toBe('BEFORE');
    expect(parsePosology({ frequency: 'après le repas' }).meal).toBe('AFTER');
    expect(parsePosology({ frequency: 'à jeun' }).meal).toBe('FASTING');
  });

  it('convertit les durées (jours, semaines, mois)', () => {
    expect(parsePosology({ duration: '10 jours' }).days).toBe(10);
    expect(parsePosology({ duration: '2 semaines' }).days).toBe(14);
    expect(parsePosology({ duration: '1 mois' }).days).toBe(30);
  });

  it('reconnaît aussi l’anglais (fallback)', () => {
    const p = parsePosology({ dosage: '1 tablet', frequency: 'morning and evening', duration: '5 days' });
    expect(p.timings).toEqual(['MORNING', 'EVENING']);
    expect(p.form).toBe('TABLET');
    expect(p.days).toBe(5);
  });

  it('ne devine jamais : posologie non reconnue → recognized false', () => {
    const p = parsePosology({ dosage: 'selon avis médical', frequency: 'usage externe', duration: '' });
    expect(p.timings).toEqual([]);
    expect(p.timesPerDay).toBeNull();
    expect(p.form).toBeNull();
    expect(p.recognized).toBe(false);
  });

  it('robuste aux accents et à la casse', () => {
    // « MATIN » et « Matinée » doivent être reconnus comme MORNING.
    expect(parsePosology({ frequency: 'MATIN' }).timings).toEqual(['MORNING']);
    expect(parsePosology({ frequency: 'Matinée' }).timings).toEqual(['MORNING']);
  });
});
