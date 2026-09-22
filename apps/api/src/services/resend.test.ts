// Service Resend — cas succès / échec / réseau / stub, SANS appel réseau.
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveMock = vi.fn();
vi.mock('@/lib/integrations.js', () => ({ resolveConfiguredSecrets: (...a: unknown[]) => resolveMock(...a) }));

const { DEFAULT_FROM, sendEmail } = await import('./resend.js');

function fakeApp() {
  const lines: unknown[] = [];
  const push = (...a: unknown[]) => lines.push(a);
  return { app: { log: { info: push, warn: push, error: push } } as unknown as FastifyInstance, lines };
}
const TO = 'patiente.test@example.com';
const KEY = 're_secretKey_1234567890';

describe('sendEmail', () => {
  beforeEach(() => resolveMock.mockResolvedValue({ apiKey: KEY, fromEmail: 'DigiSanté <no-reply@digisante.bj>' }));
  afterEach(() => { vi.unstubAllGlobals(); resolveMock.mockReset(); });

  it('succès : POST Resend avec Bearer, expéditeur configuré, id renvoyé, journal masqué', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'msg_0123456789' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { app, lines } = fakeApp();
    const r = await sendEmail({ app, to: TO, subject: 'Campagne', body: 'Vaccination gratuite samedi' });
    expect(r).toEqual({ delivered: true, stub: false, id: 'msg_0123456789' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body).from).toBe('DigiSanté <no-reply@digisante.bj>');
    const dump = JSON.stringify(lines);
    expect(dump).not.toContain(TO);
    expect(dump).not.toContain(KEY);
    expect(dump).toContain('p•••@example.com');
  });

  it('expéditeur par défaut si fromEmail absent', async () => {
    resolveMock.mockResolvedValue({ apiKey: KEY });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'x' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await sendEmail({ app: fakeApp().app, to: TO, subject: 's', body: 'b' });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).from).toBe(DEFAULT_FROM);
  });

  it('échec fournisseur (expéditeur non vérifié) : false, journal sans adresse ni message brut', async () => {
    const err = { name: 'validation_error', message: `The ${TO} recipient is invalid`, statusCode: 422 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(err), { status: 422 })));
    const { app, lines } = fakeApp();
    expect(await sendEmail({ app, to: TO, subject: 's', body: 'b' })).toEqual({ delivered: false, stub: false });
    const dump = JSON.stringify(lines);
    expect(dump).toContain('validation_error');
    expect(dump).not.toContain(TO);
  });

  it('erreur réseau : false sans throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ETIMEDOUT')));
    expect(await sendEmail({ app: fakeApp().app, to: TO, subject: 's', body: 'b' })).toEqual({ delivered: false, stub: false });
  });

  it('stub (non configuré) et adresse absente : aucun appel réseau', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    resolveMock.mockResolvedValue(null);
    expect(await sendEmail({ app: fakeApp().app, to: TO, subject: 's', body: 'b' })).toEqual({ delivered: false, stub: true });
    expect(await sendEmail({ app: fakeApp().app, to: null, subject: 's', body: 'b' })).toEqual({ delivered: false, stub: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
