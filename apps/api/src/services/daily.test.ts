// Service Daily.co — propriétés de confidentialité/expiration et appels émis.
// Unitaire : resolver et `fetch` simulés, aucun appel réseau, aucune base.
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/integrations.js', () => ({
  resolveConfiguredSecrets: vi.fn(async () => ({ apiKey: 'daily-secret-key', domain: 'digisante' })),
}));

const { ROOM_TTL_SECONDS, TOKEN_TTL_SECONDS, createMeetingToken, createRoom, deleteRoom, roomProperties, tokenProperties } =
  await import('./daily.js');

const app = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as unknown as FastifyInstance;

describe('Daily — propriétés (pures)', () => {
  it('salle : expiration 4 h + éjection à l’échéance', () => {
    expect(roomProperties(1_000)).toEqual({ exp: 1_000 + ROOM_TTL_SECONDS, eject_at_room_exp: true });
  });

  it('jeton : expiration 2 h (≤ salle), éjection à l’échéance, propriétaire explicite', () => {
    const p = tokenProperties({ room: 'consult-1', userId: 'u1', isOwner: false, nowSeconds: 1_000 });
    expect(p).toEqual({ room_name: 'consult-1', user_id: 'u1', is_owner: false, exp: 1_000 + TOKEN_TTL_SECONDS, eject_at_token_exp: true });
    expect(TOKEN_TTL_SECONDS).toBeLessThanOrEqual(ROOM_TTL_SECONDS);
  });
});

describe('Daily — appels API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('crée une salle PRIVÉE avec expiration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: 'consult-1', url: 'https://digisante.daily.co/consult-1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const room = await createRoom({ app, name: 'consult-1' });
    expect(room.url).toBe('https://digisante.daily.co/consult-1');
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.privacy).toBe('private');
    expect(body.properties.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(body.properties.eject_at_room_exp).toBe(true);
  });

  it('jeton de réunion avec expiration, sans jamais journaliser la clé', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'jwt.daily.token' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await createMeetingToken({ app, room: 'consult-1', userId: 'u1', isOwner: true })).toBe('jwt.daily.token');
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.properties.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer daily-secret-key');
  });

  it('suppression de salle : DELETE, 404 toléré (déjà absente), erreur → false sans throw', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await deleteRoom({ app, name: 'consult 1' })).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.daily.co/v1/rooms/consult%201');
    expect(fetchMock.mock.calls[0]![1].method).toBe('DELETE');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    expect(await deleteRoom({ app, name: 'x' })).toBe(true);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    expect(await deleteRoom({ app, name: 'x' })).toBe(false);
    expect(JSON.stringify((app.log.error as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('daily-secret-key');
  });
});
