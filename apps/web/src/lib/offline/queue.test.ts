// File de synchronisation hors-ligne — le point sensible n'est pas « ça marche »
// mais « rien ne se perd ». Une saisie de constantes faite en zone blanche ne doit
// disparaître dans AUCUN scénario de rejeu.
import 'fake-indexeddb/auto';

import { createVault, purgeLocal, unlockVault } from './vault';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  allFailed,
  allQueued,
  enqueue,
  failedCount,
  flush,
  pendingCount,
  PermanentReplayError,
  purgeAll,
  setQueueOwner,
  type QueuedMutation,
} from './queue';

/** Vide les deux magasins entre les tests (l'IndexedDB simulée persiste dans le run). */
async function reset() {
  await purgeLocal(); setQueueOwner('patient-A'); await createVault('phrase synthétique locale L4');
}

describe('file hors-ligne — rejeu des mutations', () => {
  beforeEach(reset);

  it('conserve l’ordre chronologique de saisie', async () => {
    await enqueue({ method: 'POST', path: '/dmp/records', body: { n: 1 } });
    await enqueue({ method: 'POST', path: '/dmp/records', body: { n: 2 } });
    await enqueue({ method: 'POST', path: '/dmp/records', body: { n: 3 } });

    const queued = await allQueued();
    expect(queued.map((m) => (m.body as { n: number }).n)).toEqual([1, 2, 3]);
  });

  // Régression : `Date.now()` seul donnait des `ts` identiques en rafale, et donc
  // un ordre de rejeu arbitraire (un PATCH puis un DELETE ne commutent pas).
  it('horodate strictement en croissance, même en rafale sub-milliseconde', async () => {
    const a = await enqueue({ method: 'PATCH', path: '/r/1', body: { v: 1 } });
    const b = await enqueue({ method: 'PATCH', path: '/r/1', body: { v: 2 } });
    const c = await enqueue({ method: 'DELETE', path: '/r/1' });

    expect(a.ts).toBeLessThan(b.ts);
    expect(b.ts).toBeLessThan(c.ts);
    expect((await allQueued()).map((m) => m.path)).toEqual(['/r/1', '/r/1', '/r/1']);
    expect((await allQueued()).map((m) => m.method)).toEqual(['PATCH', 'PATCH', 'DELETE']);
  });

  it('attribue un id unique servant de clé d’idempotence', async () => {
    const a = await enqueue({ method: 'POST', path: '/x' });
    const b = await enqueue({ method: 'POST', path: '/x' });
    expect(a.id).not.toBe(b.id);
    expect(a.id).toHaveLength(36);
  });

  it('retire de la file les mutations rejouées avec succès', async () => {
    await enqueue({ method: 'POST', path: '/a' });
    await enqueue({ method: 'POST', path: '/b' });

    const res = await flush(async () => {});

    expect(res).toEqual({ flushed: 2, failed: 0 });
    expect(await pendingCount()).toBe(0);
  });

  // ── Le cas qui compte : un rejet métier définitif ne doit PAS effacer la donnée ──
  it('ARCHIVE une mutation rejetée en 4xx au lieu de la perdre', async () => {
    await enqueue({ method: 'POST', path: '/dmp/records', body: { bp: '120/80' } });

    const res = await flush(async () => {
      throw new PermanentReplayError(422);
    });

    expect(res).toEqual({ flushed: 0, failed: 1 });
    expect(await pendingCount()).toBe(0); // retirée de la file d'envoi…

    const failed = await allFailed();
    expect(failed).toHaveLength(1); // …mais RÉCUPÉRABLE
    expect(failed[0].failedStatus).toBe(422);
    expect(failed[0].body).toEqual({ bp: '120/80' }); // la donnée saisie est intacte
  });

  it('poursuit la file après un rejet 4xx (une mutation invalide n’en bloque pas d’autres)', async () => {
    await enqueue({ method: 'POST', path: '/invalide' });
    await enqueue({ method: 'POST', path: '/valide' });

    const res = await flush(async (m: QueuedMutation) => {
      if (m.path === '/invalide') throw new PermanentReplayError(422);
    });

    expect(res).toEqual({ flushed: 1, failed: 1 });
    expect(await pendingCount()).toBe(0);
    expect(await failedCount()).toBe(1);
  });

  // ── Panne réseau / 5xx : surtout ne rien jeter, et réessayer plus tard ──
  it('s’ARRÊTE sur une erreur réseau et préserve la file pour un rejeu ultérieur', async () => {
    await enqueue({ method: 'POST', path: '/1' });
    await enqueue({ method: 'POST', path: '/2' });
    await enqueue({ method: 'POST', path: '/3' });

    const send = vi.fn(async (m: QueuedMutation) => {
      if (m.path === '/2') throw new Error('network');
    });
    const res = await flush(send);

    expect(res).toEqual({ flushed: 1, failed: 0 });
    // /2 a échoué → on s'arrête AVANT /3 : l'ordre des mutations restantes est préservé.
    expect(send).toHaveBeenCalledTimes(2);
    const remaining = await allQueued();
    expect(remaining.map((m) => m.path)).toEqual(['/2', '/3']);
  });

  it('rejoue à l’identique au retour du réseau (aucune donnée altérée entre-temps)', async () => {
    await enqueue({ method: 'PATCH', path: '/adherence/1', body: { taken: true } });

    await flush(async () => {
      throw new Error('offline');
    });
    expect(await pendingCount()).toBe(1);

    const sent: QueuedMutation[] = [];
    const res = await flush(async (m) => {
      sent.push(m);
    });

    expect(res.flushed).toBe(1);
    expect(sent[0].method).toBe('PATCH');
    expect(sent[0].body).toEqual({ taken: true });
  });

  it('ne renvoie jamais une mutation déjà acquittée', async () => {
    await enqueue({ method: 'POST', path: '/payments/initiate', body: { amount: 2000 } });

    await flush(async () => {});
    const second: QueuedMutation[] = [];
    await flush(async (m) => {
      second.push(m);
    });

    expect(second).toHaveLength(0); // pas de double paiement au second passage
  });
});

describe('file hors-ligne — appareil partagé (§4)', () => {
  beforeEach(async () => {
    setQueueOwner(null);
    await reset();
  });

  it('ne rejoue JAMAIS la mutation d’un compte sous la session d’un autre', async () => {
    setQueueOwner('patient-A');
    await enqueue({ method: 'POST', path: '/dmp/records', body: { v: 'A' } });
    setQueueOwner('patient-B');
    const sent: string[] = [];
    const r = await flush(async (m) => { sent.push(m.owner ?? ''); });
    expect(r.flushed).toBe(0);
    expect(sent).toEqual([]);
    expect(await pendingCount()).toBe(0); // isolée pour le retour de A
    setQueueOwner('patient-A'); await unlockVault('phrase synthétique locale L4');
    expect((await flush(async () => {})).flushed).toBe(1);
  });

  it('purgeAll vide la file ET les échecs (déconnexion)', async () => {
    await enqueue({ method: 'POST', path: '/x', body: { secret: 'y' } });
    await flush(async () => { throw new PermanentReplayError(422); });
    await enqueue({ method: 'POST', path: '/z' });
    await purgeAll();
    expect(await pendingCount()).toBe(0);
    expect(await failedCount()).toBe(0);
  });
});
