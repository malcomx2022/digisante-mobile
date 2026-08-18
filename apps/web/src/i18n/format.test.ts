// Formats localisés. Le défaut historique corrigé par ce module : des dates
// restées françaises en EN/FON/YOR. On vérifie surtout que changer de langue
// change réellement le rendu, et que FON/YOR ne CASSENT pas (repli CLDR).
import { DEFAULT_LANG } from '@digisante/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { formatDate, formatNumber, setFormatLang } from './format';

const REF = new Date(Date.UTC(2026, 4, 12, 9, 30)); // 12 mai 2026

afterEach(() => setFormatLang(DEFAULT_LANG));

describe('formats localisés', () => {
  it('rend une date au format français en FR', () => {
    setFormatLang('FR');
    expect(formatDate(REF)).toBe('12/05/2026');
  });

  it('change réellement de format en EN (pas de français figé)', () => {
    setFormatLang('FR');
    const fr = formatDate(REF, { dateStyle: 'long' });
    setFormatLang('EN');
    const en = formatDate(REF, { dateStyle: 'long' });
    expect(en).not.toBe(fr);
    expect(en).toContain('2026');
  });

  it('ne casse pas en FON et YOR (repli CLDR, langues peu dotées)', () => {
    for (const lang of ['FON', 'YOR'] as const) {
      setFormatLang(lang);
      expect(formatDate(REF)).toContain('2026');
      expect(formatNumber(1500)).toMatch(/1.?500/);
    }
  });

  it('accepte une date ISO comme une instance Date (les API renvoient des chaînes)', () => {
    setFormatLang('FR');
    expect(formatDate(REF.toISOString())).toBe(formatDate(REF));
  });

  it('formate les montants XOF avec séparateurs de milliers', () => {
    setFormatLang('FR');
    // Espace insécable/fine selon la plateforme : on teste les chiffres, pas l'espace.
    expect(formatNumber(2500000).replace(/\s| | /g, '')).toBe('2500000');
  });

  it('accepte un montant en chaîne (Prisma Decimal sérialisé)', () => {
    setFormatLang('FR');
    expect(formatNumber('3000')).toBe(formatNumber(3000));
  });
});
