import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { localAll } from '@/lib/offline/db';
import { allFailed, allQueued, setQueueOwner } from '@/lib/offline/queue';
import { createVault, lockVault, purgeLocal } from '@/lib/offline/vault';
import { flushQueue, post, setRefreshHandler, setSessionExpiredHandler } from './client';

beforeEach(async () => { await purgeLocal(); setQueueOwner('A'); vi.stubGlobal('navigator', { onLine: true }); vi.stubGlobal('fetch', vi.fn()); setRefreshHandler(null); setSessionExpiredHandler(null); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); lockVault(false); });

describe('Actions sans coffre L4', () => {
  it('sans coffre : ticket durable sans corps ni route avant le premier fetch', async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => {
      const raw = JSON.stringify(await localAll('pendingSealed'));
      expect(raw).not.toMatch(/SECRET|vaccinations|birthDate/); expect(raw).toContain('idempotencyKey');
      return Response.json({ id: 'committed' }, { status: 201 });
    });
    expect(await post('/vaccinations/subjects', { name: 'SECRET', birthDate: '2025-01-01' })).toEqual({ id: 'committed' });
    expect(await allQueued()).toHaveLength(0);
  });
  it('réponse perdue sans coffre : vérifier le reçu en GET, aucun second POST', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('lost response'));
    await expect(post('/vaccinations/subjects', { name: 'SECRET' })).rejects.toThrow('lost');
    const [ticket] = await allQueued();
    vi.mocked(fetch).mockImplementationOnce(async (url, init) => { expect(String(url)).toBe(`/api/v1/sync/receipts/${ticket.idempotencyKey}`); expect(init?.method).toBeUndefined(); expect(init?.body).toBeUndefined(); return Response.json({ confirmed: true, status: 201 }); });
    expect(await flushQueue()).toEqual({ flushed: 1, failed: 0 }); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('ticket non confirmé : conserver pour revue et bloquer une nouvelle saisie ambiguë', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network'));
    await expect(post('/vaccinations/subjects', { name: 'SECRET' })).rejects.toThrow();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await flushQueue()).toEqual({ flushed: 0, failed: 1 }); expect((await allFailed())[0].body).toBeUndefined();
    await expect(post('/vaccinations/subjects', { name: 'SECRET' })).rejects.toThrow('à vérifier'); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('200 sans confirmation valide : ticket gardé, aucune fausse réussite', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network')); await expect(post('/maternity', {})).rejects.toThrow();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ unrelated: true }));
    expect(await flushQueue()).toEqual({ flushed: 0, failed: 0 }); expect(await allQueued()).toHaveLength(1);
  });
  it('hors ligne sans coffre : aucun corps persisté, aucun fetch', async () => {
    vi.stubGlobal('navigator', { onLine: false }); await expect(post('/maternity', {})).rejects.toThrow('verrouillé');
    expect(await localAll('pendingSealed')).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });
  it('échec IndexedDB : arrêt avant envoi et aucune action sauvegardée partiellement', async () => {
    await createVault('phrase synthétique locale L4');
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    await expect(post('/maternity', {})).rejects.toThrow('quota'); expect(fetch).not.toHaveBeenCalled(); expect(await allQueued()).toEqual([]);
  });
  it('changement de compte pendant la préparation : aucune action de A envoyée ou mise en file pour B', async () => {
    const task = post('/maternity', { lmpDate: '2026-09-01' }); setQueueOwner('B');
    await expect(task).rejects.toThrow('verrouillé'); expect(fetch).not.toHaveBeenCalled(); expect(await localAll('pendingSealed')).toEqual([]);
  });
});
