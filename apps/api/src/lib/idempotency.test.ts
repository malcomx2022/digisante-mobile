// Reçus L3 : séparation des sous-clés (v2) et lecture des reçus hérités (v1).
import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { canonicalJson } from './audit.js';
import { decryptWithKey, deriveKey, encryptWithKey } from './crypto.js';
import { env } from './env.js';
import { openReceiptResponse, receiptRequestHash, sealReceiptResponse } from './idempotency.js';

const secret = env.HEALTH_ENCRYPTION_KEY ?? 'synthetic-test-only-mutation-receipts';
const legacyKey = deriveKey(`digisante-mutation-receipts-v1:${secret}`);
const scope = { userId: 'u1', method: 'POST', route: '/api/v1/dmp/records', key: 'k1' };

describe('reçus de synchronisation — clés v2', () => {
  it('scelle sous v2 et rouvre avec la même identité', () => {
    const sealed = sealReceiptResponse(scope, { id: 'r1' });
    expect(sealed.startsWith('v2:')).toBe(true);
    expect(openReceiptResponse(scope, sealed)).toEqual({ id: 'r1' });
  });

  it("un chiffré v2 recopié vers une autre identité de mutation ne s'ouvre pas (AAD)", () => {
    const sealed = sealReceiptResponse(scope, { id: 'r1' });
    expect(() => openReceiptResponse({ ...scope, userId: 'u2' }, sealed)).toThrow();
    expect(() => openReceiptResponse({ ...scope, key: 'k2' }, sealed)).toThrow();
  });

  it('sous-clés distinctes : la clé AES v2 ne sert pas au HMAC, ni la clé v1', () => {
    const body = { a: 1 };
    const v1 = createHmac('sha256', legacyKey).update(JSON.stringify(canonicalJson(body))).digest('hex');
    expect(receiptRequestHash(body, 'v1')).toBe(v1);
    expect(receiptRequestHash(body)).not.toBe(v1);
    expect(receiptRequestHash(body)).toHaveLength(64);
  });

  it('reçu hérité v1 (≤ 14 j) toujours lisible pendant la transition', () => {
    const legacy = encryptWithKey(legacyKey, { id: 'old' });
    expect(openReceiptResponse(scope, legacy)).toEqual({ id: 'old' });
    // Le chiffré v2 n'est pas lisible par l'ancienne clé.
    expect(() => decryptWithKey(legacyKey, sealReceiptResponse(scope, { id: 'r1' }).slice(3))).toThrow();
  });
});
