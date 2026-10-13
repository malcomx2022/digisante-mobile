import type { FastifyBaseLogger } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFedapayCheckoutUrl } from '@digisante/shared';

import { env } from '@/lib/env.js';
import { createTransaction, getTransactionStatus, parseFedapayTransactionId } from './fedapay.js';

const mode = env.NODE_ENV;
afterEach(() => { env.NODE_ENV = mode; vi.unstubAllGlobals(); });
const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const opts = (log: ReturnType<typeof logger>) => ({ amount: 5000, method: 'MTN_MOMO', description: 'Synthétique', secretKey: 'sk_sandbox_l8_synthetic', log: log as unknown as FastifyBaseLogger });
const json = (value: unknown) => new Response(JSON.stringify(value));

describe('L8 — FedaPay §5, fournisseur simulé', () => {
  it('accepte seulement checkout et sandbox-checkout HTTPS, port 443 ; refuse suffixes, credentials, backslash et espace', () => {
    for (const link of ['https://checkout.fedapay.com/pay/1', 'https://sandbox-checkout.fedapay.com:443/pay?t=1']) expect(isFedapayCheckoutUrl(link)).toBe(true);
    for (const link of ['http://checkout.fedapay.com', 'https://api.fedapay.com', 'https://stub.fedapay.com', 'https://checkout.fedapay.com.evil.test', 'https://evil.test/?next=https://checkout.fedapay.com', 'https://u:p@checkout.fedapay.com', 'https://checkout.fedapay.com:444', 'https://checkout.fedapay.com\\@evil.test', ' https://checkout.fedapay.com', '//checkout.fedapay.com', 'javascript:alert(1)']) expect(isFedapayCheckoutUrl(link)).toBe(false);
  });
  // B1 (13/10/2026) : page hébergée réelle `process` / `sandbox-process` (SDK officiels,
  // bundles servis par FedaPay) — refusée en 502 par l'ancienne liste.
  it('B1 — accepte la page hébergée process / sandbox-process, hôte EXACT', () => {
    for (const link of ['https://process.fedapay.com/PAYEMENT_TOKEN', 'https://process.fedapay.com:443/tok?x=1', 'https://sandbox-process.fedapay.com/tok', 'https://sandbox-process.fedapay.com#frag', 'https://PROCESS.fedapay.com/tok']) expect(isFedapayCheckoutUrl(link)).toBe(true);
  });
  it('B1 — contournements refusés : suffixe, @, :443@, point final, IDN, antislash, encodé, port 0443, séparateurs Unicode, http, hôtes non prouvés', () => {
    for (const link of [
      'https://process.fedapay.com.evil.test/tok', 'https://process.fedapay.com@evil.test/tok', 'https://process.fedapay.com:443@evil.test/tok',
      'https://u:p@process.fedapay.com/tok', 'https://process.fedapay.com./tok', 'https://sandbox-process.fedapay.com./tok',
      'https://pr\u03bfcess.fedapay.com/tok', 'https://xn--prcess-0ve.fedapay.com/tok', 'https://process.fedapay.com\\@evil.test',
      'https://process.fedapay.com%2F@evil.test/tok', 'https://process%2Efedapay.com/tok', 'https://process.fedapay.com:0443/tok',
      'https://process.fedapay.com:444/tok', 'https://process.fedapay.com\u2028/tok', 'https://process.fedapay.com\u00a0/tok',
      'https://process.fedapay.com/\u3000tok', 'https://process.fedapay.com/\ttok', 'http://process.fedapay.com/tok', 'http://sandbox-process.fedapay.com/tok',
      'https://xprocess.fedapay.com/tok', 'https://process-fedapay.com/tok', 'https://sandbox-process.fedapay.com.evil/tok', 'https://dev-process.fedapay.com/tok',
      'https://dev-checkout.fedapay.com/tok', 'https://fpay.li/uxAga', 'https://evil.test/#https://process.fedapay.com', '//process.fedapay.com/tok', 'process.fedapay.com/tok',
    ]) expect(isFedapayCheckoutUrl(link), link).toBe(false);
  });
  it('B1 — hôte lié à l’environnement : jamais de page live pour une clé bac à sable, ni l’inverse', () => {
    expect(isFedapayCheckoutUrl('https://sandbox-process.fedapay.com/t', 'sandbox')).toBe(true);
    expect(isFedapayCheckoutUrl('https://sandbox-checkout.fedapay.com/t', 'sandbox')).toBe(true);
    expect(isFedapayCheckoutUrl('https://process.fedapay.com/t', 'live')).toBe(true);
    expect(isFedapayCheckoutUrl('https://checkout.fedapay.com/t', 'live')).toBe(true);
    for (const link of ['https://process.fedapay.com/t', 'https://checkout.fedapay.com/t']) expect(isFedapayCheckoutUrl(link, 'sandbox')).toBe(false);
    for (const link of ['https://sandbox-process.fedapay.com/t', 'https://sandbox-checkout.fedapay.com/t']) expect(isFedapayCheckoutUrl(link, 'live')).toBe(false);
  });
  it('B1 — createTransaction : lien process de l’environnement de la clé accepté, environnement croisé refusé en 502', async () => {
    const ok = vi.fn().mockResolvedValueOnce(json({ 'v1/transaction': { id: 518200 } })).mockResolvedValueOnce(json({ token: 'tok', url: 'https://sandbox-process.fedapay.com/tok' })); vi.stubGlobal('fetch', ok);
    expect(await createTransaction(opts(logger()))).toEqual({ fedapayId: '518200', paymentUrl: 'https://sandbox-process.fedapay.com/tok' });
    expect(String(ok.mock.calls[0]![0])).toBe('https://sandbox-api.fedapay.com/v1/transactions');
    const live = vi.fn().mockResolvedValueOnce(json({ 'v1/transaction': { id: 518201 } })).mockResolvedValueOnce(json({ token: 'tok', url: 'https://process.fedapay.com/tok' })); vi.stubGlobal('fetch', live);
    expect((await createTransaction({ ...opts(logger()), secretKey: 'sk_live_l8_synthetic' })).paymentUrl).toBe('https://process.fedapay.com/tok');
    expect(String(live.mock.calls[0]![0])).toBe('https://api.fedapay.com/v1/transactions');
    const crossed = vi.fn().mockResolvedValueOnce(json({ id: 518202 })).mockResolvedValueOnce(json({ url: 'https://process.fedapay.com/tok' })); vi.stubGlobal('fetch', crossed);
    await expect(createTransaction(opts(logger()))).rejects.toMatchObject({ statusCode: 502 });
    const crossedLive = vi.fn().mockResolvedValueOnce(json({ id: 518203 })).mockResolvedValueOnce(json({ url: 'https://sandbox-process.fedapay.com/tok' })); vi.stubGlobal('fetch', crossedLive);
    await expect(createTransaction({ ...opts(logger()), secretKey: 'sk_live_l8_synthetic' })).rejects.toMatchObject({ statusCode: 502 });
  });
  it('B2 — identifiant de transaction : entier sûr > 0 ou chaîne bornée, sinon null (création et webhook)', () => {
    expect(parseFedapayTransactionId(518200)).toBe('518200');
    expect(parseFedapayTransactionId('518200')).toBe('518200');
    expect(parseFedapayTransactionId('fdp_0a1b2c')).toBe('fdp_0a1b2c');
    for (const bad of [0, -1, 1.5, 2 ** 53, Number.NaN, Infinity, '', '../secret', 'a b', 'a/b', 'x'.repeat(129), true, null, undefined, {}, [518200]]) expect(parseFedapayTransactionId(bad), String(bad)).toBeNull();
  });
  it('URL fournisseur refusée avant retour au payeur ; ni URL ni token journalisés', async () => {
    const log = logger(); vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ id: 18 })).mockResolvedValueOnce(json({ url: 'https://evil.test/secret-bearer' })));
    await expect(createTransaction(opts(log))).rejects.toMatchObject({ statusCode: 502 });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('secret-bearer');
  });
  it('transaction et token officiels : redirections bloquées sur les deux appels', async () => {
    const log = logger(); const fetcher = vi.fn().mockResolvedValueOnce(json({ id: 19 })).mockResolvedValueOnce(json({ url: 'https://sandbox-checkout.fedapay.com/pay/19' })); vi.stubGlobal('fetch', fetcher);
    expect((await createTransaction(opts(log))).fedapayId).toBe('19');
    expect(fetcher.mock.calls.map((c) => c[1].redirect)).toEqual(['error', 'error']);
  });
  it('échecs création/token : corps amont non lu, status seul et pas de secret dans les logs', async () => {
    for (const step of ['transaction', 'token']) {
      const log = logger(); const res = new Response('sk_live_secret — patient VIH — +2290100000000', { status: 400 }); const text = vi.spyOn(res, 'text');
      const fetcher = vi.fn(); if (step === 'token') fetcher.mockResolvedValueOnce(json({ id: 20 })); fetcher.mockResolvedValueOnce(res); vi.stubGlobal('fetch', fetcher);
      await expect(createTransaction(opts(log))).rejects.toMatchObject({ statusCode: 502 }); expect(text).not.toHaveBeenCalled();
      expect(log.error.mock.calls[0][0]).toEqual({ status: 400 });
    }
  });
  it('exceptions réseau avec jeton/numéro/clinique : jamais renvoyées ni loggées, status lit sans redirection', async () => {
    const log = logger(); const fetcher = vi.fn().mockRejectedValue(new Error('secret-bearer patient VIH')); vi.stubGlobal('fetch', fetcher);
    await expect(createTransaction(opts(log))).rejects.toMatchObject({ statusCode: 502 });
    expect(await getTransactionStatus('20', log as unknown as FastifyBaseLogger, 'sk_sandbox_test')).toBeNull();
    expect(JSON.stringify(log.error.mock.calls)).not.toMatch(/secret-bearer|VIH/); expect(fetcher.mock.calls[1][1].redirect).toBe('error');
  });
  it('production non configurée : refus 502 avant toute transaction factice ou appel réseau', async () => {
    env.NODE_ENV = 'production'; const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(createTransaction({ ...opts(logger()), secretKey: undefined })).rejects.toMatchObject({ statusCode: 502 }); expect(fetcher).not.toHaveBeenCalled();
  });
  it('id fournisseur avec chemin injecté : refus avant création du token', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ id: '../secret' })); vi.stubGlobal('fetch', fetcher);
    await expect(createTransaction(opts(logger()))).rejects.toMatchObject({ statusCode: 502 }); expect(fetcher).toHaveBeenCalledOnce();
  });
});
