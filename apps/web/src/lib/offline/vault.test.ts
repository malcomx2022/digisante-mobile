import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { localAll, localPut } from './db';
import * as db from './db';
import { allFailed, allQueued, archiveFailed, enqueue, legacyCount, migrateLegacy, pendingCount, purgeUnownedLegacy, setQueueOwner } from './queue';
import { projectSnapshot, readSnapshot, saveSnapshot, snapshotStatus } from './snapshot';
import { createVault, isVaultOpen, lockVault, openLocal, purgeLocal, sealLocal, SNAPSHOT_TTL_MS, unlockVault, VaultLockedError } from './vault';

const PHRASE = 'phrase synthétique locale L4';
const snapshot = {
  records: [{ id: 'record', title: 'SYNTHETIC-PRIVATE-DMP', type: 'VITAL_SIGNS', createdAt: '2026-10-07' }],
  prescriptions: [{ id: 'ord', status: 'VALIDATED', validUntil: '2026-11-01', items: [{ medicationName: 'SYNTHETIC-MEDICINE', dosage: '5', frequency: '1/j', duration: '3j' }] }],
  emergency: { bloodGroup: 'O+', allergies: ['SYNTHETIC-ALLERGY'], chronicDiseases: [], emergencyContact: '+2290199999999' },
};
async function interruptWrite(action: () => Promise<unknown>, interrupted: () => Promise<void>) {
  const actual = db.localTx; let ready!: () => void; let resume!: () => void;
  const reached = new Promise<void>((r) => { ready = r; }); const gate = new Promise<void>((r) => { resume = r; });
  vi.spyOn(db, 'localTx').mockImplementationOnce(async (...args) => { ready(); await gate; return actual(...args); });
  const pending = action(); const rejected = expect(pending).rejects.toBeInstanceOf(VaultLockedError);
  await reached; await interrupted(); resume(); await rejected;
}
beforeEach(async () => { await purgeLocal(); setQueueOwner('A'); await createVault(PHRASE); });
afterEach(() => { vi.restoreAllMocks(); lockVault(false); });

describe('Coffre local L4', () => {
  it('clé enveloppée et données chiffrées : aucun marqueur clinique ou phrase dans IndexedDB', async () => {
    await saveSnapshot(snapshot); await enqueue({ method: 'POST', path: '/chat/threads/t/messages', body: { body: 'SYNTHETIC-CHAT' } });
    const raw = JSON.stringify(await Promise.all(['vaults', 'snapshots', 'pendingSealed'].map((name) => localAll(name as 'vaults'))));
    for (const value of [PHRASE, 'SYNTHETIC-PRIVATE-DMP', 'SYNTHETIC-MEDICINE', 'SYNTHETIC-ALLERGY', 'SYNTHETIC-CHAT', 'chat/threads']) expect(raw).not.toContain(value);
    expect((await readSnapshot())?.emergency).toEqual(snapshot.emergency);
  });
  it('fermeture/rechargement simulé : phrase requise et mauvaise phrase refusée', async () => {
    await saveSnapshot(snapshot); lockVault(); expect(isVaultOpen()).toBe(false);
    await expect(readSnapshot()).rejects.toBeInstanceOf(VaultLockedError);
    await expect(unlockVault('mauvaise phrase')).rejects.toThrow(); expect(isVaultOpen()).toBe(false);
    await unlockVault(PHRASE); expect(await readSnapshot()).toEqual(snapshot);
  });
  it('clé ouverte non exportable, aucun JWT ni clé serveur persisté', async () => {
    const importKey = vi.spyOn(crypto.subtle, 'importKey'); lockVault(); await unlockVault(PHRASE);
    const key = await importKey.mock.results.at(-1)!.value;
    expect(key.extractable).toBe(false); await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    expect(JSON.stringify(await localAll('vaults'))).not.toMatch(/JWT|HEALTH_ENCRYPTION_KEY|accessToken|refreshToken/);
  });
  it('compte B ne lit ni ne compte les actions de A et ne déchiffre pas son coffre', async () => {
    await enqueue({ method: 'POST', path: '/maternity', body: { lmpDate: '2026-09-01' } });
    setQueueOwner('B'); expect(await allQueued()).toEqual([]); expect(await pendingCount()).toBe(0);
    await expect(unlockVault(PHRASE)).rejects.toThrow();
    await createVault('autre phrase synthétique B'); expect(await allQueued()).toEqual([]);
    setQueueOwner('A'); await unlockVault(PHRASE); expect(await allQueued()).toHaveLength(1);
  });
  it('changement de compte pendant le déchiffrement : aucun résultat restitué', async () => {
    const sealed = await sealLocal({ private: 'secret' }, 'test');
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async (...args) => { const result = await decrypt(...args); setQueueOwner('B'); return result; });
    await expect(openLocal(sealed, 'test')).rejects.toBeInstanceOf(VaultLockedError);
  });
  it('AES-GCM lie compte et contexte : un ciphertext déplacé est refusé', async () => {
    const sealed = await sealLocal({ private: 'secret' }, 'original');
    await expect(openLocal(sealed, 'autre')).rejects.toThrow();
  });
  it('expiration exacte à 24 heures : payload retiré, date conservée pour informer', async () => {
    await saveSnapshot(snapshot); const metadata = await snapshotStatus();
    vi.spyOn(Date, 'now').mockReturnValue(metadata!.expiresAt);
    expect(await readSnapshot()).toBeNull(); expect((await snapshotStatus())?.expired).toBe(true);
    expect((await localAll<{ sealed?: unknown }>('snapshots'))[0].sealed).toBeUndefined();
  });
  it('horloge reculée au-delà de la tolérance : aucune lecture médicale', async () => {
    await saveSnapshot(snapshot); const metadata = await snapshotStatus();
    vi.spyOn(Date, 'now').mockReturnValue(metadata!.syncedAt - 300_001);
    expect(await readSnapshot()).toBeNull();
  });
  it('projections limitées : pas de données DMP complètes, QR, pièces ni assurance', () => {
    const projected = projectSnapshot(Array.from({ length: 30 }, () => ({ ...snapshot.records[0], data: { secret: 'FULL' }, documents: ['PIECE'] })), Array.from({ length: 15 }, () => ({ ...snapshot.prescriptions[0], qrCode: 'TOKEN', items: Array.from({ length: 30 }, () => snapshot.prescriptions[0].items[0]) })), Object.assign({ ...snapshot.emergency }, { insuranceNumber: 'SECRET' }));
    expect(projected.records).toHaveLength(20); expect(projected.prescriptions).toHaveLength(10); expect(projected.prescriptions[0].items).toHaveLength(20);
    expect(JSON.stringify(projected)).not.toMatch(/FULL|PIECE|TOKEN|SECRET/);
    expect(SNAPSHOT_TTL_MS).toBe(86_400_000);
  });
  it('archive rejetée : seul le ciphertext est déplacé, corps conservé après unlock', async () => {
    const m = await enqueue({ method: 'POST', path: '/maternity', body: { value: 'PRIVATE' } }); await archiveFailed(m, 409);
    expect(await pendingCount()).toBe(0); expect(JSON.stringify(await localAll('failedSealed'))).not.toContain('PRIVATE');
    lockVault(); expect(await allFailed()).toEqual([]); await unlockVault(PHRASE); expect((await allFailed())[0].body).toEqual({ value: 'PRIVATE' });
  });
  it('migration v3 : protège le corps sans renouveler la clé, ni perdre la ligne', async () => {
    const m = { id: crypto.randomUUID(), ts: Date.now(), owner: 'A', method: 'POST', path: '/maternity', body: { value: 'LEGACY-PRIVATE' }, idempotencyKey: `v1.${Date.now()}.${crypto.randomUUID()}` };
    await localPut('mutations', m); await migrateLegacy();
    expect(await localAll('mutations')).toEqual([]); expect(JSON.stringify(await localAll('pendingSealed'))).not.toContain('LEGACY-PRIVATE');
    expect((await allQueued())[0]).toEqual(m);
  });
  it('ancienne entrée sans identité : pas de backfill ; sans propriétaire, jamais attribuée', async () => {
    const old = { id: crypto.randomUUID(), ts: Date.now(), method: 'POST', path: '/maternity', body: { value: 'OLD' } };
    await localPut('mutations', { ...old, owner: 'A' }); await localPut('failed', { ...old, id: crypto.randomUUID() });
    await migrateLegacy(); expect((await allQueued())[0].idempotencyKey).toBeUndefined();
    expect(await legacyCount()).toBe(1); expect(await allFailed()).toHaveLength(0);
    await purgeUnownedLegacy(); expect(await legacyCount()).toBe(0);
  });
  it('coffre existant : aucune réinitialisation implicite de la clé', async () => {
    await expect(createVault('nouvelle phrase locale')).rejects.toThrow('déjà créé');
    lockVault(); await unlockVault(PHRASE); expect(isVaultOpen()).toBe(true);
  });
  it('purge explicite : coffre, lectures, pending, failed et héritage supprimés atomiquement', async () => {
    await saveSnapshot(snapshot); await enqueue({ method: 'POST', path: '/maternity', body: {} }); await localPut('mutations', { id: 'old', body: 'OLD' });
    await purgeLocal(); expect(isVaultOpen()).toBe(false);
    for (const name of ['vaults', 'snapshots', 'pendingSealed', 'failedSealed', 'mutations', 'failed'] as const) expect(await localAll(name)).toEqual([]);
  });
  it('purge pendant l’écriture différée d’une lecture : aucun ciphertext réintroduit', async () => {
    await interruptWrite(() => saveSnapshot(snapshot), purgeLocal); expect(await localAll('snapshots')).toEqual([]);
  });
  it('purge pendant l’écriture d’une mutation : aucune action réintroduite', async () => {
    await interruptWrite(() => enqueue({ method: 'POST', path: '/maternity', body: { secret: 'PRIVATE' } }), purgeLocal);
    expect(await localAll('pendingSealed')).toEqual([]);
  });
  it('purge pendant la création d’un coffre : aucune enveloppe réintroduite', async () => {
    await purgeLocal(); await interruptWrite(() => createVault(PHRASE), purgeLocal); expect(await localAll('vaults')).toEqual([]);
  });
  it('lock pendant la migration : ancienne ligne conservée et aucun demi-transfert', async () => {
    const item = { id: 'old', ts: Date.now(), owner: 'A', method: 'POST', path: '/maternity', body: { value: 'PRIVATE' } };
    await localPut('mutations', item);
    await interruptWrite(migrateLegacy, async () => { lockVault(); });
    expect(await localAll('mutations')).toEqual([item]); expect(await localAll('pendingSealed')).toEqual([]);
  });
  it('échec transactionnel de migration : rollback conserve le corps et la clé historiques', async () => {
    const item = { id: 'old', ts: Date.now(), owner: 'A', method: 'POST', path: '/maternity', body: { value: 'PRIVATE' }, idempotencyKey: `v1.${Date.now()}.${crypto.randomUUID()}` };
    await localPut('mutations', item); const actual = db.localTx;
    vi.spyOn(db, 'localTx').mockImplementationOnce((stores, mode, run) => actual(stores, mode, (tx, done) => {
      tx.addEventListener('success', () => tx.abort());
      // Abort après les requêtes de transfert, avant commit.
      const store = tx.objectStore('pendingSealed'); const put = store.put.bind(store);
      store.put = (...args) => { const request = put(...args); request.addEventListener('success', () => tx.abort()); return request; };
      const objectStore = tx.objectStore.bind(tx); tx.objectStore = (name) => name === 'pendingSealed' ? store : objectStore(name);
      run(tx, done);
    }));
    await expect(migrateLegacy()).rejects.toThrow(); expect(await localAll('mutations')).toEqual([item]); expect(await localAll('pendingSealed')).toEqual([]);
  });
  it('inactivité : clé inaccessible après quinze minutes', async () => {
    const time = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(time + 15 * 60_000 + 1);
    await expect(sealLocal({}, 'test')).rejects.toBeInstanceOf(VaultLockedError);
  });
});
