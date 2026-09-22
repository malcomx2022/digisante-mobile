// Service Twilio — requête émise et journalisation SANS donnée personnelle.
// Unitaire : `fetch` simulé, aucun appel réseau, aucune base.
import type { FastifyBaseLogger } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { maskEmail, maskId, maskPhone, stubContent } from '@/lib/redact.js';

import { twilioPost } from './twilio.js';

const CREDS = { sid: 'AC0123456789', token: 'tok-secret-5555', from: '+2290100000000' };

function fakeLog() {
  const lines: unknown[] = [];
  const push = (...a: unknown[]) => lines.push(a);
  return { log: { info: push, warn: push, error: push } as unknown as FastifyBaseLogger, lines };
}

describe('redact', () => {
  it('masque numéro, e-mail et identifiant', () => {
    expect(maskPhone('+2290196700001')).toBe('+229••••••0001');
    expect(maskPhone(undefined)).toBe('—');
    expect(maskEmail('ulrich.segla@example.com')).toBe('u•••@example.com');
    expect(maskId('SM1234567890abcd')).toBe('••••abcd');
  });

  it('contenu de stub lisible hors production, masqué en production', () => {
    expect(stubContent('123456', 'test')).toBe('123456');
    expect(stubContent('123456', 'production')).toBe('[masqué — 6 car.]');
  });
});

describe('twilioPost', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POST Messages en auth basique, depuis le numéro long, et renvoie le SID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sid: 'SMabcdef1234' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const { log } = fakeLog();
    const res = await twilioPost(CREDS, 'Messages', { To: '+2290196700001', From: CREDS.from, Body: 'x' }, log);
    expect(res).toEqual({ ok: true, sid: 'SMabcdef1234' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC0123456789/Messages.json');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('AC0123456789:tok-secret-5555').toString('base64')}`);
    expect(new URLSearchParams(init.body).get('From')).toBe('+2290100000000');
  });

  it('échec Twilio : journal sans numéro complet, sans message brut ni jeton', async () => {
    const body = { code: 21211, message: "The 'To' number +2290196700001 is not a valid phone number.", more_info: 'https://www.twilio.com/docs/errors/21211' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 400 })));
    const { log, lines } = fakeLog();
    const res = await twilioPost(CREDS, 'Messages', { To: '+2290196700001', From: CREDS.from, Body: 'code 123456' }, log);
    expect(res.ok).toBe(false);
    const dump = JSON.stringify(lines);
    expect(dump).not.toContain('+2290196700001');
    expect(dump).not.toContain('tok-secret-5555');
    expect(dump).not.toContain('123456');
    expect(dump).toContain('21211');
  });

  it('erreur réseau : false, sans throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const { log } = fakeLog();
    expect(await twilioPost(CREDS, 'Calls', { To: '+2290196700001', From: CREDS.from }, log)).toEqual({ ok: false });
  });
});
