import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { buildCsp, middleware, newNonce } from './middleware';

const scriptSrc = (csp: string) => csp.split('; ').find((d) => d.startsWith('script-src ')) ?? '';

describe('CSP à nonce (résiduel X8)', () => {
  it('production : nonce + strict-dynamic, sans unsafe-inline ni unsafe-eval pour les scripts', () => {
    const csp = buildCsp('abc', false);
    expect(scriptSrc(csp)).toBe("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('frame-src \'self\' https://*.daily.co');
  });

  it('développement seulement : unsafe-eval (bundler) et hôtes locaux', () => {
    const csp = buildCsp('abc', true);
    expect(scriptSrc(csp)).toContain("'unsafe-eval'");
    expect(scriptSrc(csp)).not.toContain('unsafe-inline');
  });

  it('nonce de 128 bits, différent à chaque requête', () => {
    const a = newNonce();
    expect(atob(a)).toHaveLength(16);
    expect(newNonce()).not.toBe(a);
  });

  it('pose la même CSP sur la requête (lue par Next au rendu) et sur la réponse', () => {
    const res = middleware(new NextRequest('https://digisantemobile.app/login'));
    const csp = res.headers.get('content-security-policy') ?? '';
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
  });
});
