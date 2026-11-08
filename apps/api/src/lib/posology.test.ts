// Tests unitaires de l'analyse de posologie (fonction pure, @digisante/shared).
// Alimente le rendu en pictogrammes de l'ordonnance (accès faible-littératie).
import { formatDoseCount, parsePosology } from '@digisante/shared';
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

  it('« N fois par jour » donne le nombre de prises SANS inventer d’horaires', () => {
    const p = parsePosology({ frequency: '3 fois par jour' });
    expect(p.timesPerDay).toBe(3);
    expect(p.timings).toEqual([]);
    expect(parsePosology({ frequency: '1 fois par jour' }).timings).toEqual([]);
    expect(parsePosology({ frequency: 'deux fois par jour' }).timesPerDay).toBe(2);
    expect(parsePosology({ frequency: 'une fois par jour' }).timesPerDay).toBe(1);
    expect(parsePosology({ frequency: '3x/j' }).timesPerDay).toBe(3);
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
    // Un mois n'a pas de durée exacte en jours : pas de conversion choisie par le code.
    expect(parsePosology({ duration: '1 mois' }).days).toBeNull();
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

  // Cas à risque de la campagne clinique L9 (scripts/validation/clinical-review.mjs).
  describe('cas à risque POS01–POS14 : jamais de contresens, le texte fait foi', () => {
    it('POS01–POS03 : fractions conservées, jamais tronquées', () => {
      const p1 = parsePosology({ dosage: '0,5 comprimé', frequency: 'une fois par jour', duration: '5' });
      expect(p1.doseCount).toBe(0.5);
      expect(p1.timings).toEqual([]); // aucun horaire ajouté
      expect(p1.days).toBeNull(); // durée sans unité : pas de « jours » supposés
      expect(parsePosology({ dosage: '1/2 comprimé', frequency: 'le soir' }).doseCount).toBe(0.5);
      expect(parsePosology({ dosage: 'un demi comprimé', frequency: 'le soir' }).doseCount).toBe(0.5);
      expect(parsePosology({ dosage: '½ comprimé' }).doseCount).toBe(0.5);
    });

    it('POS04–POS06 : une teneur ou un volume n’est jamais un nombre d’unités', () => {
      expect(parsePosology({ dosage: '500 mg', frequency: 'une fois par jour' }).doseCount).toBeNull();
      expect(parsePosology({ dosage: '500 mg (1 comprimé)' }).doseCount).toBeNull();
      const syrup = parsePosology({ dosage: '2,5 ml de sirop', frequency: '3 fois par jour', duration: '5 jours' });
      expect(syrup.doseCount).toBeNull();
      expect(syrup.form).toBe('SYRUP');
      expect(syrup.timings).toEqual([]);
    });

    it('POS07–POS08 : par semaine, intervalles et heures ne deviennent pas des prises/jour', () => {
      const weekly = parsePosology({ dosage: '1 comprimé', frequency: '2 fois par semaine', duration: '1 mois' });
      expect(weekly.timesPerDay).toBeNull();
      expect(weekly.days).toBeNull();
      const interval = parsePosology({ dosage: '1 comprimé', frequency: 'toutes les 8 heures', duration: '48 heures' });
      expect(interval.timesPerDay).toBeNull();
      expect(interval.timings).toEqual([]);
      expect(interval.days).toBeNull();
    });

    it('POS09 : nombre de prises et moments contradictoires → aucun des deux', () => {
      const p = parsePosology({ dosage: '1 comprimé', frequency: '3 fois par jour, matin et soir' });
      expect(p.timings).toEqual([]);
      expect(p.timesPerDay).toBeNull();
    });

    it('POS10 : quantités variables selon le moment → pas de quantité unique', () => {
      expect(parsePosology({ dosage: '1 comprimé le matin, 2 le soir' }).doseCount).toBeNull();
      expect(parsePosology({ dosage: '1 à 2 comprimés' }).doseCount).toBeNull();
    });

    it('POS11 : une interdiction ne devient jamais une consigne positive', () => {
      const p = parsePosology({ dosage: '1 comprimé', frequency: 'ne pas prendre le soir' });
      expect(p.timings).toEqual([]);
      expect(p.timesPerDay).toBeNull();
      expect(p.meal).toBeNull();
    });

    it('POS12 : pendant le repas n’est pas « après » ; durée décimale non tronquée', () => {
      const p = parsePosology({ dosage: '1 comprimé', frequency: 'pendant le repas', duration: '1,5 semaines' });
      expect(p.meal).toBe('DURING');
      expect(p.days).toBeNull();
      expect(parsePosology({ frequency: 'au repas' }).meal).toBe('DURING');
    });

    it('POS13 : horaires et plages de durée non résumés partiellement', () => {
      const p = parsePosology({ dosage: '1 comprimé', frequency: '8h et 20h', duration: '2 à 3 jours' });
      expect(p.timings).toEqual([]);
      expect(p.timesPerDay).toBeNull();
      expect(p.days).toBeNull();
    });

    it('POS14 : une durée exacte seule est une dimension reconnue', () => {
      const p = parsePosology({ duration: '5 jours' });
      expect(p.days).toBe(5);
      expect(p.recognized).toBe(true);
    });
  });

  it('formatDoseCount conserve les fractions usuelles', () => {
    expect(formatDoseCount(0.5)).toBe('½');
    expect(formatDoseCount(1.5)).toBe('1½');
    expect(formatDoseCount(0.25)).toBe('¼');
    expect(formatDoseCount(2)).toBe('2');
  });
});
