// Hors-ligne : ce qui peut être différé, et ce qui ne doit JAMAIS l'être.
// Défaut corrigé (audit de release) : `online()` levait « connexion requise » APRÈS
// la mise en file — l'action (ex. envoi d'argent) partait quand même au retour du réseau.
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createVault, purgeLocal } from '@/lib/offline/vault';
import { allQueued, remove, setQueueOwner } from '@/lib/offline/queue';

import { isQueueable, OfflineError, post, postNow } from './client';

beforeEach(async () => {
  vi.stubGlobal('navigator', { onLine: false });
  vi.stubGlobal('fetch', vi.fn());
  await purgeLocal(); setQueueOwner('user-A'); await createVault('phrase synthétique locale L4');
  for (const m of await allQueued()) await remove(m.id);
});
afterEach(() => vi.unstubAllGlobals());

describe('isQueueable', () => {
  it('argent, auth, admin, SOS, fichiers et consentements : jamais différés', () => {
    for (const p of ['/beneficiaries/abc/send', '/payments', '/wallet/topup', '/auth/logout', '/auth/otp/verify',
      '/admin/integrations/FEDAPAY', '/sos', '/sos/x/resolve', '/dmp/records/r1/documents', '/dmp/consents/g1', '/users/me/device', '/kyc/submit']) {
      expect(isQueueable(p), p).toBe(false);
    }
  });
  it('messages et accusés de lecture : différables', () => {
    for (const p of ['/chat/threads/t1/messages', '/notifications/n1/read', '/maternity/visits/v1/done']) {
      expect(isQueueable(p), p).toBe(true);
    }
  });
});

describe('mutations hors-ligne', () => {
  it('postNow refuse AVANT toute mise en file', async () => {
    await expect(postNow('/adherence/intake', { itemId: 'i' })).rejects.toBeInstanceOf(OfflineError);
    expect(await allQueued()).toHaveLength(0);
  });

  it('un envoi d’argent n’est jamais mis en file, même appelé via post()', async () => {
    await expect(post('/beneficiaries/b1/send', { amount: 5000 })).rejects.toBeInstanceOf(OfflineError);
    expect(await allQueued()).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('un message de chat est mis en file, marqué au compte courant', async () => {
    expect(await post('/chat/threads/t1/messages', { body: 'bonjour' })).toEqual({ queued: true });
    const [m] = await allQueued();
    expect(m).toMatchObject({ path: '/chat/threads/t1/messages', owner: 'user-A' });
  });
});
