// Contrats Daily simulés : aucune clé réelle ni requête fournisseur.
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/integrations.js', () => ({ resolveConfiguredSecrets: vi.fn() }));
const { resolveConfiguredSecrets } = await import('@/lib/integrations.js');
const { ROOM_TTL_SECONDS, TOKEN_TTL_SECONDS, createMeetingToken, createRoom, deleteRoom, ejectParticipants, roomProperties, tokenProperties } = await import('./daily.js');
const app = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as unknown as FastifyInstance;
const now = () => Math.floor(Date.now() / 1000);
const creds = { apiKey: 'daily-test-only-secret', domain: 'digisante' };
const info = () => ({ name: 'consult-1', url: 'https://digisante.daily.co/consult-1', privacy: 'private', config: roomProperties(now()) });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const tokenOpts = () => ({ app, room: 'consult-1', userId: 'patient-1', roomExpiresAt: now() + ROOM_TTL_SECONDS });

beforeEach(() => { vi.clearAllMocks(); vi.mocked(resolveConfiguredSecrets).mockResolvedValue(creds); });
afterEach(() => vi.unstubAllGlobals());

describe('Daily — politique privée', () => {
  it('salle expirant après 4 h, sans frappe, chat, écran ni enregistrement', () => {
    expect(roomProperties(1_000)).toMatchObject({ exp: 1_000 + ROOM_TTL_SECONDS, eject_at_room_exp: true, enable_knocking: false, max_participants: 2, enable_chat: false, enable_screenshare: false, enable_recording: false, permissions: { canAdmin: false } });
  });
  it('jeton nominatif 15 min, sans propriétaire ni administration', () => {
    expect(tokenProperties({ room: 'r', userId: 'u', nowSeconds: 1_000, roomExpiresAt: 99_000 })).toMatchObject({ room_name: 'r', user_id: 'u', exp: 1_000 + TOKEN_TTL_SECONDS, is_owner: false, eject_at_token_exp: true, permissions: { canAdmin: false } });
  });
  it('borne le jeton par la fin de salle, même lors d’une reconnexion tardive', () => {
    expect(tokenProperties({ room: 'r', userId: 'u', nowSeconds: 1_000, roomExpiresAt: 1_050 }).exp).toBe(1_050);
    expect(() => tokenProperties({ room: 'r', userId: 'u', nowSeconds: 1_000, roomExpiresAt: 999 })).toThrow('expiré');
  });
  it('audio : caméra éteinte et permission d’émission audio seule', () => {
    expect(tokenProperties({ room: 'r', userId: 'u', nowSeconds: 1_000, roomExpiresAt: 99_000, audioOnly: true })).toMatchObject({ start_video_off: true, permissions: { canSend: ['audio'] } });
  });
});

describe('Daily — réponse fournisseur vérifiée', () => {
  it('crée privé puis relit la configuration effective avant de retourner l’accès', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({})).mockResolvedValueOnce(response(info()));
    vi.stubGlobal('fetch', fetchMock);
    expect(await createRoom({ app, name: 'consult-1' })).toMatchObject({ url: info().url });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ privacy: 'private', properties: { enable_knocking: false } });
    expect(fetchMock.mock.calls[1]![0]).toBe('https://api.daily.co/v1/rooms/consult-1');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'error', headers: { 'Cache-Control': 'no-store' } });
  });
  it('409 : réutilise uniquement une salle effectivement conforme', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({}, 409)).mockResolvedValueOnce(response(info())));
    expect((await createRoom({ app, name: 'consult-1' })).url).toBe(info().url);
  });
  it('refuse une salle historique publique au lieu de fabriquer son URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({}, 409)).mockResolvedValueOnce(response({ ...info(), privacy: 'public' })));
    await expect(createRoom({ app, name: 'consult-1' })).rejects.toMatchObject({ statusCode: 502 });
  });
  it('refuse une salle autorisant la frappe sans jeton', async () => {
    const room = info(); room.config.enable_knocking = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(room)));
    await expect(createMeetingToken(tokenOpts())).rejects.toMatchObject({ statusCode: 502 });
  });
  it('refuse une URL étrangère ou contenant un jeton', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...info(), url: info().url + '?t=secret' })));
    await expect(createMeetingToken(tokenOpts())).rejects.toMatchObject({ statusCode: 502 });
  });
  it('refuse la salle expirée avant toute émission de jeton', async () => {
    const room = info(); room.config.exp = now() - 1;
    const fetchMock = vi.fn().mockResolvedValue(response(room)); vi.stubGlobal('fetch', fetchMock);
    await expect(createMeetingToken(tokenOpts())).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('émet un JWT fournisseur, borné par le début de consultation', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(info())).mockResolvedValueOnce(response({ token: 'jwt.test.signature' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await createMeetingToken({ ...tokenOpts(), roomExpiresAt: now() + 40 });
    expect(result?.token).toBe('jwt.test.signature');
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).properties).toMatchObject({ exp: result?.expiresAt, is_owner: false, user_id: 'patient-1' });
    expect(result!.expiresAt).toBeLessThanOrEqual(now() + 40);
  });
  it('502 création : aucun repli déterministe', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ detail: creds.apiKey }, 502)));
    await expect(createRoom({ app, name: 'consult-1' })).rejects.toMatchObject({ statusCode: 502 });
    expect(JSON.stringify(app.log)).not.toContain(creds.apiKey);
  });
  it('panne réseau : aucune clé ni exception fournisseur brute dans les logs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(creds.apiKey + ' jwt.test.signature')));
    await expect(createRoom({ app, name: 'consult-1' })).rejects.toMatchObject({ statusCode: 502 });
    expect(JSON.stringify((app.log.error as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(creds.apiKey);
  });
  it('jeton refusé par Daily : aucun faux jeton de secours', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(info())).mockResolvedValueOnce(response({}, 401)));
    await expect(createMeetingToken(tokenOpts())).rejects.toMatchObject({ statusCode: 502 });
  });
  it('jeton absent ou non JWT : réponse invalide', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(info())).mockResolvedValueOnce(response({ token: 'not-a-jwt' })));
    await expect(createMeetingToken(tokenOpts())).rejects.toMatchObject({ statusCode: 502 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(info())).mockResolvedValueOnce(response({})));
    await expect(createMeetingToken(tokenOpts())).rejects.toMatchObject({ statusCode: 502 });
  });
  it('sans configuration : null explicite, aucun appel réseau externe', async () => {
    vi.mocked(resolveConfiguredSecrets).mockResolvedValue(null);
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect((await createRoom({ app, name: 'consult-1' })).url).toBeNull();
    expect(await createMeetingToken(tokenOpts())).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('accepte le domaine complet historique sans doubler daily.co', async () => {
    vi.mocked(resolveConfiguredSecrets).mockResolvedValue({ ...creds, domain: 'digisante.daily.co' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(info())).mockResolvedValueOnce(response({ token: 'jwt.test.signature' })));
    expect((await createMeetingToken(tokenOpts()))?.roomUrl).toBe(info().url);
  });
  it('rejette un domaine configuré comme une URL arbitraire', async () => {
    vi.mocked(resolveConfiguredSecrets).mockResolvedValue({ ...creds, domain: 'https://attacker.test' });
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(createRoom({ app, name: 'consult-1' })).rejects.toMatchObject({ statusCode: 502 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('clôture : éjection avec ban des identités, puis suppression indépendante', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({})); vi.stubGlobal('fetch', fetchMock);
    expect(await ejectParticipants({ app, name: 'consult-1', userIds: ['p', 'd'] })).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.daily.co/v1/rooms/consult-1/eject');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ user_ids: ['p', 'd'], ban: true });
    expect(await deleteRoom({ app, name: 'consult-1' })).toBe(true);
    expect(fetchMock.mock.calls[1]![1].method).toBe('DELETE');
  });
  it('suppression : 404 accepté, erreurs tolérées sans secrets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, 404)));
    expect(await deleteRoom({ app, name: 'x' })).toBe(true);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(creds.apiKey)));
    expect(await ejectParticipants({ app, name: 'x', userIds: ['p'] })).toBe(false);
    expect(await deleteRoom({ app, name: 'x' })).toBe(false);
    expect(JSON.stringify((app.log.error as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(creds.apiKey);
  });
});
