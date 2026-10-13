// Contrats Daily simulés : aucune clé réelle ni requête fournisseur.
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/integrations.js', () => ({ resolveConfiguredSecrets: vi.fn() }));
const { resolveConfiguredSecrets } = await import('@/lib/integrations.js');
const { ROOM_NAME_MAX_LENGTH, ROOM_TTL_SECONDS, TOKEN_TTL_SECONDS, createMeetingToken, createRoom, deleteRoom, ejectParticipants, roomProperties, tokenProperties, uniqueRoomName } = await import('./daily.js');
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
    expect(roomProperties(1_000)).toMatchObject({ exp: 1_000 + ROOM_TTL_SECONDS, eject_at_room_exp: true, enable_knocking: false, max_participants: 2, enable_chat: false, enable_screenshare: false, permissions: { canAdmin: false } });
    // Schéma Daily : `enable_recording` = mode(s) d'enregistrement ; absent = désactivé.
    expect(roomProperties(1_000)).not.toHaveProperty('enable_recording');
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
  it('B5 — nom déjà pris (409 ou autre 4xx) : jamais réutilisé ni supprimé', async () => {
    // Aucun 409 documenté par Daily ; un conflit sur un nom aléatoire est une anomalie.
    for (const status of [409, 400, 401, 403, 429]) {
      const fetchMock = vi.fn().mockResolvedValue(response({ error: 'invalid-request-error' }, status)); vi.stubGlobal('fetch', fetchMock);
      await expect(createRoom({ app, name: 'consult-1' })).rejects.toMatchObject({ statusCode: 502 });
      expect(fetchMock).toHaveBeenCalledOnce();
    }
  });
  it('B5 — salle créée mais relue non conforme : 502 et suppression de cette salle', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({ ...info(), privacy: 'public' }))
      .mockResolvedValueOnce(response({ deleted: true, name: 'consult-1' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createRoom({ app, name: 'consult-1' })).rejects.toMatchObject({ statusCode: 502 });
    expect(fetchMock.mock.calls[2]![0]).toBe('https://api.daily.co/v1/rooms/consult-1');
    expect(fetchMock.mock.calls[2]![1].method).toBe('DELETE');
  });
  it('B5 — délai dépassé après envoi : suppression du même nom, erreur d’origine conservée', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new DOMException('aborted', 'TimeoutError')).mockResolvedValueOnce(response({ error: 'not-found' }, 404));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createRoom({ app, name: 'consult-1' })).rejects.toMatchObject({ statusCode: 502, message: expect.stringContaining('indisponible') });
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['https://api.daily.co/v1/rooms', 'POST'], ['https://api.daily.co/v1/rooms/consult-1', 'DELETE'],
    ]);
    expect(app.log.warn).not.toHaveBeenCalled();
  });
  it('B5 — suppression en échec : l’erreur de création reste la réponse, nom seul journalisé', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ error: 'server-error' }, 503)).mockResolvedValueOnce(response({ detail: creds.apiKey }, 500));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createRoom({ app, name: 'consult-1' })).rejects.toMatchObject({ statusCode: 502, message: 'Création de salle Daily impossible' });
    expect(fetchMock.mock.calls[1]![1].method).toBe('DELETE');
    expect(app.log.warn).toHaveBeenCalledWith({ room: 'consult-1' }, expect.any(String));
    expect(JSON.stringify((app.log.warn as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(creds.apiKey);
  });
  it('B5 — nom hors jeu documenté ou trop long : refus avant tout appel réseau', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    for (const name of ['', 'consult/1', 'consult 1', 'consult-1?t=x', 'é', 'a'.repeat(ROOM_NAME_MAX_LENGTH + 1)]) {
      await expect(createRoom({ app, name })).rejects.toMatchObject({ statusCode: 502 });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resolveConfiguredSecrets).not.toHaveBeenCalled();
  });
  it('B5 — nom unique par tentative, dans le jeu et la longueur documentés', () => {
    const ref = 'cm1a2b3c4d5e6f7g8h9i0j1k2';
    const names = Array.from({ length: 50 }, () => uniqueRoomName(ref));
    expect(new Set(names).size).toBe(50);
    for (const name of names) expect(name).toMatch(new RegExp(`^consult-${ref}-[0-9a-f]{32}$`));
    // Référence hostile ou démesurée : réduite au jeu sûr et bornée.
    for (const hostile of ['../../x?t=1', 'A'.repeat(500), '', 'é&/ ']) {
      const name = uniqueRoomName(hostile);
      expect(name).toMatch(/^consult-(?:[a-z0-9]{1,64}-)?[0-9a-f]{32}$/);
      expect(name.length).toBeLessThanOrEqual(ROOM_NAME_MAX_LENGTH);
    }
  });
  it('refuse une salle autorisant la frappe sans jeton', async () => {
    const room = info(); room.config.enable_knocking = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(room)));
    await expect(createMeetingToken(tokenOpts())).rejects.toMatchObject({ statusCode: 502 });
  });
  it('refuse une salle déclarant un mode d’enregistrement', async () => {
    for (const mode of ['cloud', 'local', ['raw-tracks']]) {
      const room = info(); (room.config as Record<string, unknown>).enable_recording = mode;
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(room)));
      await expect(createMeetingToken(tokenOpts())).rejects.toMatchObject({ statusCode: 502 });
    }
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
  it('502 création : aucun repli déterministe, suppression tentée du nom envoyé', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ detail: creds.apiKey }, 502)); vi.stubGlobal('fetch', fetchMock);
    await expect(createRoom({ app, name: 'consult-1' })).rejects.toMatchObject({ statusCode: 502 });
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'DELETE']);
    expect(JSON.stringify(app.log)).not.toContain(creds.apiKey);
  });
  it('panne réseau : aucune clé ni exception fournisseur brute dans les logs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(creds.apiKey + ' jwt.test.signature')));
    await expect(createRoom({ app, name: 'consult-1' })).rejects.toMatchObject({ statusCode: 502 });
    for (const level of [app.log.error, app.log.warn]) {
      expect(JSON.stringify((level as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(creds.apiKey);
    }
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
