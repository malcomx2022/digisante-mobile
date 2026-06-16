import { describe, expect, it } from 'vitest';

import { generateOtp, hashOtp, OTP_LENGTH, safeEqualHex } from './auth.otp.js';

describe('generateOtp', () => {
  it('génère un code numérique de 6 chiffres', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOtp();
      expect(code).toHaveLength(OTP_LENGTH);
      expect(code).toMatch(/^\d{6}$/);
    }
  });
});

describe('hashOtp', () => {
  it('est déterministe pour un même (phone, code)', () => {
    expect(hashOtp('+2290197000000', '123456')).toBe(hashOtp('+2290197000000', '123456'));
  });

  it('diffère si le téléphone ou le code change', () => {
    expect(hashOtp('+2290197000000', '123456')).not.toBe(hashOtp('+2290197000001', '123456'));
    expect(hashOtp('+2290197000000', '123456')).not.toBe(hashOtp('+2290197000000', '654321'));
  });

  it('ne contient jamais le code en clair', () => {
    expect(hashOtp('+2290197000000', '123456')).not.toContain('123456');
  });
});

describe('safeEqualHex', () => {
  it('vrai pour deux hex identiques', () => {
    const h = hashOtp('+229', '000000');
    expect(safeEqualHex(h, h)).toBe(true);
  });

  it('faux pour des hex différents ou de longueurs différentes', () => {
    expect(safeEqualHex(hashOtp('+229', '000000'), hashOtp('+229', '111111'))).toBe(false);
    expect(safeEqualHex('abcd', 'abcdef')).toBe(false);
  });
});
