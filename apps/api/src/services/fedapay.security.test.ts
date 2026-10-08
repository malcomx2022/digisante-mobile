import type { FastifyBaseLogger } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFedapayCheckoutUrl } from '@digisante/shared';

import { env } from '@/lib/env.js';
import { createTransaction, getTransactionStatus } from './fedapay.js';

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
