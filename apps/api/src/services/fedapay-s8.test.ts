// Recette S8 (B1) : la sonde juge avec le contrôle et l'identifiant de PRODUCTION, par le
// MÊME câblage que la recette réelle (`productionS8Options`, partagé avec le smoke). Sans réseau.
import { FEDAPAY_CHECKOUT_HOSTS, isFedapayCheckoutUrl } from '@digisante/shared';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { formatS8, runS8Probe } from '../../../../scripts/preproduction/fedapay-s8.mjs';
import { productionS8Options } from '../test/fedapay-s8-options.js';
import { parseFedapayTransactionId } from './fedapay.js';

const TOKEN = 'SYNTHETICtokenABCDEF0123456789';
const secrets = { secretKey: 'sk_sandbox_SYNTHETIC', publicKey: 'pk_sandbox_SYNTHETIC', webhookSecret: 'wh_SYNTHETIC' };
const reference = 'ds-recette-s8-20261013180000-ab12';

async function probe(url: string) {
  const calls: string[] = [];
  const request = async (target: string) => {
    calls.push(target);
    const body = target.endsWith('/token') ? { token: TOKEN, url } : { 'v1/transaction': { id: 42 } };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const result = await runS8Probe({ enabled: true, secrets, request, reference, ...productionS8Options() });
  return { result, calls, out: formatS8(result, reference).join('\n') };
}

describe('Recette S8 — verdict aligné sur le contrôle de production (B1)', () => {
  it('hôtes bac à sable de production ⇒ PASS, deux appels vers l’API bac à sable seulement', async () => {
    for (const host of FEDAPAY_CHECKOUT_HOSTS.sandbox) {
      const { result, calls, out } = await probe(`https://${host}/${TOKEN}`);
      expect(result.verdict).toBe('PASS');
      expect(calls).toEqual(['https://sandbox-api.fedapay.com/v1/transactions', 'https://sandbox-api.fedapay.com/v1/transactions/42/token']);
      expect(out).not.toContain(TOKEN);
    }
  });

  it('hôte live pour une clé bac à sable, hôte voisin ou lien malformé ⇒ FAIL (comme le 502 de production)', async () => {
    const expected: Array<[string, string]> = [
      [`https://process.fedapay.com/${TOKEN}`, 'HOTE_LIVE'],
      [`https://fpay.li/${TOKEN}`, 'HOTE_NON_LISTE'],
      [`https://sandbox-process.fedapay.com./${TOKEN}`, 'FORME_REFUSEE'],
      [`https://sandbox-process.fedapay.com:0443/${TOKEN}`, 'FORME_REFUSEE'],
      [`https://sandbox-process.fedapay.com/a\\b`, 'FORME_REFUSEE'],
    ];
    for (const [url, code] of expected) {
      const { result, out } = await probe(url);
      expect(isFedapayCheckoutUrl(url, 'sandbox'), url).toBe(false);
      expect(result.code, url).toBe(code);
      expect(out).not.toContain(TOKEN);
    }
  });

  it('câblage partagé avec la recette réelle : contrôle lié au bac à sable, identifiant et liste de production', () => {
    const options = productionS8Options();
    expect(options.parseId).toBe(parseFedapayTransactionId);
    expect(options.hosts).toBe(FEDAPAY_CHECKOUT_HOSTS);
    // Un hôte live n'est JAMAIS accepté par le contrôle du bac à sable (l'union le serait).
    for (const host of FEDAPAY_CHECKOUT_HOSTS.live) {
      expect(isFedapayCheckoutUrl(`https://${host}/${TOKEN}`), host).toBe(true);
      expect(options.isAllowedSandbox(`https://${host}/${TOKEN}`), host).toBe(false);
    }
    // La recette réelle (hors CI) passe par ce câblage et par lui seul.
    const smoke = readFileSync(new URL('./fedapay-s8.smoke.test.ts', import.meta.url), 'utf8');
    expect(smoke).toMatch(/\.\.\.productionS8Options\(\),/);
    expect(smoke).not.toMatch(/isFedapayCheckoutUrl|FEDAPAY_CHECKOUT_HOSTS|parseFedapayTransactionId/);
  });
});
