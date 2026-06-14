import { createHmac } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it } from 'vitest';

import {
  computeCommission,
  convertEurToXof,
  createTransaction,
  getTransactionStatus,
  mapFedapayStatus,
  verifyWebhookSignature,
} from './fedapay.js';

// Logger minimal (les tests tournent sans FedaPay configuré → branche stub).
const log = { info() {}, warn() {}, error() {} } as unknown as FastifyBaseLogger;

describe('computeCommission (3 %)', () => {
  it('calcule commission et net', () => {
    expect(computeCommission(10000)).toEqual({ commission: 300, net: 9700 });
  });
});

describe('convertEurToXof', () => {
  it('convertit au taux fixe', () => {
    expect(convertEurToXof(10)).toBe(6560); // 10 × 655.957 ≈ 6559.57 → 6560
  });
});

describe('mapFedapayStatus', () => {
  it('mappe les statuts FedaPay', () => {
    expect(mapFedapayStatus('approved')).toBe('COMPLETED');
    expect(mapFedapayStatus('declined')).toBe('FAILED');
    expect(mapFedapayStatus('canceled')).toBe('CANCELLED');
    expect(mapFedapayStatus('inconnu')).toBeNull();
  });
});

describe('verifyWebhookSignature (HMAC-SHA256)', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ fedapayId: 'fdp_1', status: 'approved' });
  const sig = createHmac('sha256', secret).update(body).digest('hex');

  it('accepte une signature valide', () => {
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
  });

  it('rejette une signature invalide', () => {
    expect(verifyWebhookSignature(body, 'deadbeef', secret)).toBe(false);
  });

  it('rejette si secret ou signature manquants', () => {
    expect(verifyWebhookSignature(body, sig, undefined)).toBe(false);
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
  });

  it('rejette un corps falsifié', () => {
    const tampered = JSON.stringify({ fedapayId: 'fdp_1', status: 'approved', amount: 999999 });
    expect(verifyWebhookSignature(tampered, sig, secret)).toBe(false);
  });
});

describe('createTransaction / getTransactionStatus (gating, FedaPay non configuré)', () => {
  it('createTransaction renvoie une transaction stub si non configuré', async () => {
    const tx = await createTransaction({ amount: 5000, method: 'MTN_MOMO', description: 'Consultation', log });
    expect(tx.fedapayId).toMatch(/^fdp_/);
    expect(tx.paymentUrl).toContain('stub.fedapay.com');
  });

  it('getTransactionStatus renvoie null si non configuré (pas d’appel réseau)', async () => {
    expect(await getTransactionStatus('fdp_anything', log)).toBeNull();
  });
});
