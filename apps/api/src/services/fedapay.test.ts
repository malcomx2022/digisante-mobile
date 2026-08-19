import { createHmac } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it } from 'vitest';

import {
  buildWebhookSignatureHeader,
  computeCommission,
  convertEurToXof,
  createTransaction,
  fedapayApiBase,
  fedapayEnvironment,
  getTransactionStatus,
  mapFedapayStatus,
  verifyWebhookSignature,
  WEBHOOK_TOLERANCE_SECONDS,
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

describe('environnement FedaPay déduit de la clé', () => {
  it('une clé live vise la production, une clé sandbox le bac à sable', () => {
    expect(fedapayEnvironment('sk_live_abc')).toBe('live');
    expect(fedapayApiBase('sk_live_abc')).toBe('https://api.fedapay.com/v1');
    expect(fedapayEnvironment('sk_sandbox_abc')).toBe('sandbox');
    expect(fedapayApiBase('sk_sandbox_abc')).toBe('https://sandbox-api.fedapay.com/v1');
  });

  it('repli SANDBOX sur préfixe inconnu (fail-safe : jamais de vraie transaction par erreur)', () => {
    expect(fedapayEnvironment('clef-bizarre')).toBe('sandbox');
    expect(fedapayEnvironment('')).toBe('sandbox');
    // Piège classique : une clé live mal préfixée ne doit pas non plus être devinée.
    expect(fedapayEnvironment('live_sk_abc')).toBe('sandbox');
  });
});

describe('verifyWebhookSignature (schéma FedaPay `t=…,s=…`)', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ fedapayId: 'fdp_1', status: 'approved' });
  const nowSec = () => Math.floor(Date.now() / 1000);

  it('accepte un en-tête signé valide', () => {
    expect(verifyWebhookSignature(body, buildWebhookSignatureHeader(body, secret), secret)).toBe(true);
  });

  it('REJETTE le HMAC nu du corps (l’ancien schéma, faux) — non-régression du défaut du lot 8', () => {
    // C'est très exactement ce que l'implémentation d'avant août 2026 calculait ET
    // acceptait : aucun webhook réel n'aurait jamais été validé. Le test qui suit
    // échouerait si l'on revenait en arrière.
    const naked = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyWebhookSignature(body, naked, secret)).toBe(false);
  });

  it('rejette une signature invalide, un secret manquant, un en-tête manquant', () => {
    const t = nowSec();
    expect(verifyWebhookSignature(body, `t=${t},s=deadbeef`, secret)).toBe(false);
    expect(verifyWebhookSignature(body, buildWebhookSignatureHeader(body, secret), undefined)).toBe(false);
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
  });

  it('rejette un en-tête malformé (sans horodatage, sans schéma `s`)', () => {
    const sig = createHmac('sha256', secret).update(`${nowSec()}.${body}`).digest('hex');
    expect(verifyWebhookSignature(body, `s=${sig}`, secret)).toBe(false); // pas de t=
    expect(verifyWebhookSignature(body, `t=${nowSec()}`, secret)).toBe(false); // pas de signature
    expect(verifyWebhookSignature(body, 'n’importe quoi', secret)).toBe(false);
  });

  it('rejette un corps falsifié après signature', () => {
    const header = buildWebhookSignatureHeader(body, secret);
    const tampered = JSON.stringify({ fedapayId: 'fdp_1', status: 'approved', amount: 999999 });
    expect(verifyWebhookSignature(tampered, header, secret)).toBe(false);
  });

  it('anti-rejeu : refuse un horodatage plus vieux que la tolérance', () => {
    const old = nowSec() - WEBHOOK_TOLERANCE_SECONDS - 1;
    const header = buildWebhookSignatureHeader(body, secret, old);
    expect(verifyWebhookSignature(body, header, secret)).toBe(false);
    // …mais reste acceptable juste en deçà de la limite.
    const fresh = buildWebhookSignatureHeader(body, secret, nowSec() - WEBHOOK_TOLERANCE_SECONDS + 5);
    expect(verifyWebhookSignature(body, fresh, secret)).toBe(true);
  });

  it('tolère une horloge locale légèrement en retard (horodatage futur accepté)', () => {
    const future = buildWebhookSignatureHeader(body, secret, nowSec() + 120);
    expect(verifyWebhookSignature(body, future, secret)).toBe(true);
  });

  it('accepte plusieurs signatures du même schéma (rotation de secret)', () => {
    const t = nowSec();
    const good = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    const other = createHmac('sha256', 'whsec_ancien').update(`${t}.${body}`).digest('hex');
    expect(verifyWebhookSignature(body, `t=${t},s=${other},s=${good}`, secret)).toBe(true);
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
