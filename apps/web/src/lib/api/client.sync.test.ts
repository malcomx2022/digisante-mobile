import 'fake-indexeddb/auto';

import { MUTATION_MAX_AGE_MS } from '@digisante/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { allFailed, allQueued, enqueue, purgeAll, setQueueOwner, type QueuedMutation } from '@/lib/offline/queue';
import { flushQueue, isQueueable, post, setRefreshHandler, setSessionExpiredHandler } from './client';

const path = '/vaccinations/subjects';
const body = { name: 'Synthétique', birthDate: '2025-01-01' };
async function rawEntry(entry: QueuedMutation) {
  const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('digisante-offline', 3); r.onsuccess = () => resolve(r.result); });
  await new Promise<void>((resolve, reject) => { const t = db.transaction('mutations', 'readwrite'); t.objectStore('mutations').put(entry); t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); });
  db.close();
}
beforeEach(async () => {
  vi.stubGlobal('navigator', { onLine: true }); vi.stubGlobal('fetch', vi.fn());
  setQueueOwner('patient-A'); setRefreshHandler(null); setSessionExpiredHandler(null); await purgeAll();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setRefreshHandler(null); setSessionExpiredHandler(null); });

describe('Premier envoi et rejeu L3', () => {
  it('IndexedDB committé avant fetch et même clé après une réponse perdue', async () => {
    let firstKey = '';
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      const [pending] = await allQueued(); expect(pending.owner).toBe('patient-A');
      firstKey = new Headers(init?.headers).get('Idempotency-Key')!;
      expect(firstKey).toBe(pending.idempotencyKey); expect(firstKey).toMatch(/^v1\.\d{13}\./);
      throw new TypeError('response lost after commit');
    });
    await expect(post(path, body)).rejects.toThrow('response lost');
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(firstKey);
      expect(JSON.parse(init?.body as string)).toEqual(body); return Response.json({ id: 'same-subject' }, { status: 201 });
    });
    expect(await flushQueue()).toEqual({ flushed: 1, failed: 0 }); expect(await allQueued()).toHaveLength(0);
  });
  it('succès du premier envoi : retrait après réponse, pas de rejeu', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ id: 'subject' }, { status: 201 }));
    expect(await post(path, body)).toEqual({ id: 'subject' });
    expect(await allQueued()).toHaveLength(0); expect(await flushQueue()).toEqual({ flushed: 0, failed: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('mutation de l’objet appelant : même photographie au premier envoi et au rejeu', async () => {
    const mutable = { ...body };
    const promise = post(path, mutable); mutable.name = 'Objet modifié';
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      expect(JSON.parse(init?.body as string).name).toBe(body.name); throw new TypeError('network');
    });
    await expect(promise).rejects.toThrow('network'); expect((await allQueued())[0].body).toEqual(body);
  });
  it('deux flush simultanés dans un onglet : un seul envoi', async () => {
    await enqueue({ method: 'POST', path, body });
    vi.mocked(fetch).mockResolvedValue(Response.json({}));
    expect(await Promise.all([flushQueue(), flushQueue()])).toEqual([{ flushed: 1, failed: 0 }, { flushed: 1, failed: 0 }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('401 même après refresh : arrêt, aucune deuxième mutation ni archive', async () => {
    await enqueue({ method: 'POST', path, body }); await enqueue({ method: 'POST', path, body });
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    setRefreshHandler(async () => 'refreshed');
    expect(await flushQueue()).toEqual({ flushed: 0, failed: 0 }); expect(fetch).toHaveBeenCalledTimes(2);
    expect(await allQueued()).toHaveLength(2); expect(await allFailed()).toHaveLength(0);
  });
  it('changement de compte pendant le refresh : aucun rejeu sous le nouveau compte', async () => {
    await enqueue({ method: 'POST', path, body });
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    setRefreshHandler(async () => { setQueueOwner('patient-B'); return 'other-account-token'; });
    expect(await flushQueue()).toEqual({ flushed: 0, failed: 0 }); expect(fetch).toHaveBeenCalledTimes(1);
    expect((await allQueued())[0].owner).toBe('patient-A');
  });
  it('aucune identité de compte : refuse avant toute persistance ou envoi', async () => {
    setQueueOwner(null); await expect(post(path, body)).rejects.toThrow('Session requise');
    expect(await allQueued()).toHaveLength(0); expect(fetch).not.toHaveBeenCalled();
  });
  it('409 : archivage atomique conservant la clé et le contenu pour revue', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ message: 'conflict' }, { status: 409 }));
    await expect(post(path, body)).rejects.toThrow();
    expect(await allQueued()).toHaveLength(0); expect(await allFailed()).toHaveLength(1);
    expect((await allFailed())[0]).toMatchObject({ failedStatus: 409, owner: 'patient-A', body });
    expect((await allFailed())[0].idempotencyKey).toMatch(/^v1\./);
  });
  it('429, 408 et 5xx : entrée conservée, aucun nouveau jeton', async () => {
    const item = await enqueue({ method: 'POST', path, body });
    for (const status of [429, 408, 503]) {
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status }));
      expect(await flushQueue()).toEqual({ flushed: 0, failed: 0 });
      expect((await allQueued())[0].idempotencyKey).toBe(item.idempotencyKey);
    }
    expect(await allFailed()).toHaveLength(0);
  });
  it('ancienne entrée v2 sans clé : conservée en échec, jamais envoyée', async () => {
    await rawEntry({ id: crypto.randomUUID(), ts: Date.now(), owner: 'patient-A', method: 'POST', path, body });
    expect(await flushQueue()).toEqual({ flushed: 0, failed: 1 });
    expect(fetch).not.toHaveBeenCalled(); expect((await allFailed())[0]).toMatchObject({ body, failedStatus: 409 });
    expect((await allFailed())[0].idempotencyKey).toBeUndefined();
  });
  it('entrée expirée : échec 410 sans tentative réseau', async () => {
    const item = await enqueue({ method: 'POST', path, body });
    await rawEntry({ ...item, idempotencyKey: `v1.${Date.now() - MUTATION_MAX_AGE_MS - 1000}.${item.id}` });
    expect(await flushQueue()).toEqual({ flushed: 0, failed: 1 }); expect(fetch).not.toHaveBeenCalled();
    expect((await allFailed())[0].failedStatus).toBe(410);
  });
  it('horloge trop future : échec 400 sans tentative réseau', async () => {
    const item = await enqueue({ method: 'POST', path, body });
    await rawEntry({ ...item, idempotencyKey: `v1.${Date.now() + 600_000}.${item.id}` });
    expect(await flushQueue()).toEqual({ flushed: 0, failed: 1 }); expect(fetch).not.toHaveBeenCalled();
    expect((await allFailed())[0].failedStatus).toBe(400);
  });
  it('ancienne entrée exclue du contrat : conservée, sans partage DMP différé', async () => {
    await enqueue({ method: 'POST', path: '/dmp/records/record/share', body: { recipient: 'third-party' } });
    expect(await flushQueue()).toEqual({ flushed: 0, failed: 1 }); expect(fetch).not.toHaveBeenCalled();
    expect((await allFailed())[0].failedStatus).toBe(409);
  });
  it('liste positive : méthodes et chemins exacts, fermeture de grossesse exclue', () => {
    for (const p of ['/maternity/end', '/chat/threads', '/dmp/records/r/share', '/appointments', '/prescriptions', '/subscriptions', '/lab-orders', '/sos', '/auth/otp/verify', '/payments', '/vaccinations/subjects?extra=1']) expect(isQueueable(p), p).toBe(false);
    expect(isQueueable('/vaccinations/subjects', 'DELETE')).toBe(false);
    expect(isQueueable('/vaccinations/subjects/c123', 'DELETE')).toBe(true);
    expect(isQueueable('/chat/threads/c123/messages', 'PATCH')).toBe(false);
  });
});
