// Scellement des secrets d'intégration (§3.6 ②) avec le chiffrement ACTIF.
// Le module lit HEALTH_ENCRYPTION_KEY à l'import : on le recharge avec une clé.
import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = 'test-only-health-encryption-key-0123456789abcdef';

async function loadWithKey() {
  vi.resetModules();
  vi.stubEnv('HEALTH_ENCRYPTION_KEY', KEY);
  return import('./crypto.js');
}

describe('sealSecret / openSecret — chiffrement actif', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('le blob scellé ne contient aucun secret en clair et se rouvre à l’identique', async () => {
    const { sealSecret, openSecret, isEncryptionEnabled } = await loadWithKey();
    expect(isEncryptionEnabled).toBe(true);
    const secrets = { accountSid: 'AC123', authToken: 'tok-very-secret-4242' };
    const sealed = sealSecret(secrets);
    expect(sealed.startsWith('plain:')).toBe(false);
    expect(sealed).not.toContain('tok-very-secret-4242');
    expect(sealed).not.toContain('AC123');
    expect(openSecret(sealed)).toEqual(secrets);
  });

  it('refuse un blob `plain:` quand le chiffrement est actif (pas de secret en clair au repos)', async () => {
    const { openSecret } = await loadWithKey();
    expect(() => openSecret('plain:{"authToken":"x"}')).toThrow(/en clair/);
  });

  it('refuse un blob altéré (tag GCM)', async () => {
    const { sealSecret, openSecret } = await loadWithKey();
    const [iv, tag, data] = sealSecret({ a: 'b' }).split(':');
    const tampered = [iv, tag, Buffer.from('zz' + Buffer.from(data!, 'base64').toString('binary')).toString('base64')].join(':');
    expect(() => openSecret(tampered)).toThrow();
  });
});
