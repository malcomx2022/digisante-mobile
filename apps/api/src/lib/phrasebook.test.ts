// Test pur du phrasier médical embarqué (@digisante/shared) — aucune infra.
import { PHRASEBOOK, PHRASE_CATEGORIES, phraseText, phrasesByCategory } from '@digisante/shared';
import { describe, expect, it } from 'vitest';

describe('phrasebook', () => {
  it('chaque phrase a FR + EN et une catégorie connue', () => {
    for (const p of PHRASEBOOK) {
      expect(p.text.FR.length).toBeGreaterThan(0);
      expect(p.text.EN.length).toBeGreaterThan(0);
      expect(PHRASE_CATEGORIES).toContain(p.category);
    }
  });

  it('clés uniques', () => {
    const keys = PHRASEBOOK.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('phraseText : langue demandée, repli FR pour FON/YOR (pas de trou)', () => {
    const p = PHRASEBOOK[0];
    expect(phraseText(p, 'EN')).toBe(p.text.EN);
    expect(phraseText(p, 'FR')).toBe(p.text.FR);
    // FON/YOR non fournis → repli FR (jamais une chaîne vide).
    expect(phraseText(p, 'FON')).toBe(p.text.FR);
    expect(phraseText(p, 'YOR')).toBe(p.text.FR);
  });

  it('phrasesByCategory filtre correctement et couvre toutes les catégories', () => {
    for (const cat of PHRASE_CATEGORIES) {
      const items = phrasesByCategory(cat);
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((p) => p.category === cat)).toBe(true);
    }
  });
});
