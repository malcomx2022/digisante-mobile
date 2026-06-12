import { describe, expect, it } from 'vitest';

import { decryptWithKey, deriveKey, encryptWithKey } from './crypto.js';

const key = deriveKey('clé-de-test-aes-256');

describe('crypto AES-256-GCM', () => {
  it('chiffre puis déchiffre (round-trip)', () => {
    const value = { bp: '120/80', notes: 'tension normale', n: 42 };
    const sealed = encryptWithKey(key, value);
    expect(sealed).toMatch(/^[^:]+:[^:]+:[^:]+$/); // iv:tag:cipher
    expect(decryptWithKey(key, sealed)).toEqual(value);
  });

  it('ne laisse pas le clair apparaître dans la charge chiffrée', () => {
    const sealed = encryptWithKey(key, { secret: 'diagnostic confidentiel' });
    expect(sealed).not.toContain('diagnostic');
  });

  it('échoue au déchiffrement avec une mauvaise clé (intégrité GCM)', () => {
    const sealed = encryptWithKey(key, { a: 1 });
    expect(() => decryptWithKey(deriveKey('mauvaise-clé'), sealed)).toThrow();
  });
});
