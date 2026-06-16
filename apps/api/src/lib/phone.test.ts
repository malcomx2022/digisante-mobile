import { describe, expect, it } from 'vitest';

import { formatBeninPhone, isCanonicalBeninPhone, normalizeBeninPhone } from '@digisante/shared';

describe('normalizeBeninPhone', () => {
  it('préfixe « 01 » à un national à 8 chiffres', () => {
    expect(normalizeBeninPhone('96466777')).toBe('+2290196466777');
  });

  it('convertit un ancien +229 à 8 chiffres en 10 chiffres (legacy)', () => {
    expect(normalizeBeninPhone('+22996466777')).toBe('+2290196466777');
  });

  it('est idempotent sur un numéro déjà canonique', () => {
    expect(normalizeBeninPhone('+2290196466777')).toBe('+2290196466777');
  });

  it('gère le national à 10 chiffres sans indicatif', () => {
    expect(normalizeBeninPhone('0196466777')).toBe('+2290196466777');
  });

  it('nettoie séparateurs et préfixe international 00229', () => {
    expect(normalizeBeninPhone('00229 01 96 46 67 77')).toBe('+2290196466777');
  });

  it('laisse un numéro diaspora (autre indicatif) inchangé', () => {
    expect(normalizeBeninPhone('+33612345678')).toBe('+33612345678');
  });
});

describe('formatBeninPhone', () => {
  it('formate un numéro canonique pour l’affichage', () => {
    expect(formatBeninPhone('+2290196466777')).toBe('+229 01 96 46 67 77');
  });
});

describe('isCanonicalBeninPhone', () => {
  it('vrai pour un canonique +229 + 10 chiffres', () => {
    expect(isCanonicalBeninPhone('+2290196466777')).toBe(true);
  });

  it('faux pour un ancien +229 + 8 chiffres', () => {
    expect(isCanonicalBeninPhone('+22996466777')).toBe(false);
  });
});
