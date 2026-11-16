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

  it('phraseText : langue demandée, sinon repli FR (pas de trou)', () => {
    const p = PHRASEBOOK[0];
    expect(phraseText(p, 'EN')).toBe(p.text.EN);
    expect(phraseText(p, 'FR')).toBe(p.text.FR);
    expect(phraseText(p, 'FON')).toBe(p.text.FON);
    expect(phraseText(p, 'YOR')).toBe(p.text.YOR);
    // Une phrase sans texte relu dans une langue retombe sur le FR.
    const finish = PHRASEBOOK.find((x) => x.key === 'pos.finish')!;
    expect(finish.text.FON).toBeUndefined();
    expect(phraseText(finish, 'FON')).toBe(finish.text.FR);
  });

  it('textes FON/YOR présents : non vides et différents du FR', () => {
    for (const p of PHRASEBOOK) {
      for (const lang of ['FON', 'YOR'] as const) {
        const t = p.text[lang];
        if (t === undefined) continue;
        expect(t.trim().length).toBeGreaterThan(0);
        expect(t).not.toBe(p.text.FR);
      }
    }
  });

  it('phrases au sens à confirmer : laissées en repli FR', () => {
    const pending: Array<[string, 'FON' | 'YOR']> = [
      ['pos.finish', 'FON'],
      ['pos.once_day', 'YOR'],
      ['sym.vomit_diarrhea', 'YOR'],
    ];
    for (const [key, lang] of pending) {
      expect(PHRASEBOOK.find((p) => p.key === key)!.text[lang]).toBeUndefined();
    }
  });

  it('« SOS » conservé tel quel dans em.sos', () => {
    const sos = PHRASEBOOK.find((p) => p.key === 'em.sos')!;
    for (const lang of ['FR', 'EN', 'FON', 'YOR'] as const) expect(sos.text[lang]).toContain('SOS');
  });

  it('phrasesByCategory filtre correctement et couvre toutes les catégories', () => {
    for (const cat of PHRASE_CATEGORIES) {
      const items = phrasesByCategory(cat);
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((p) => p.category === cat)).toBe(true);
    }
  });
});
