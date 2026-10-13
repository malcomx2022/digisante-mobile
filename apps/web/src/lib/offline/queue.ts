// L4 : corps scellés sous le coffre du compte ; tickets en ligne sans aucun corps.
import { mutationKeyTime } from '@digisante/shared';

import { localAll, localTx, type LocalStore } from './db';
import { captureLocalGuard, currentOwner, isVaultOpen, notifyLocal, openLocal, purgeLocal, sealLocal, setLocalOwner, VaultLockedError, type Sealed } from './vault';

export interface QueuedMutation {
  id: string; method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; body?: unknown; ts: number;
  owner?: string | null; idempotencyKey?: string;
  /** Premier envoi en ligne sans coffre : vérifier le reçu, jamais rejouer un corps absent. */
  onlineOnly?: boolean;
}
export interface FailedMutation extends QueuedMutation { failedStatus: number; failedAt: number }
interface StoredMutation {
  id: string; owner: string; ts: number; idempotencyKey?: string; sealed?: Sealed;
  onlineOnly?: true; method?: QueuedMutation['method']; path?: string; failedStatus?: number; failedAt?: number;
}
const aad = (m: Pick<StoredMutation, 'id' | 'ts' | 'idempotencyKey'>) => `mutation-v1|${m.id}|${m.ts}|${m.idempotencyKey ?? ''}`;
let lastTs = 0;
export const getQueueOwner = currentOwner;
export const setQueueOwner = setLocalOwner;
async function storeEntry(item: QueuedMutation): Promise<StoredMutation> {
  if (!item.owner || item.owner !== currentOwner()) throw new VaultLockedError();
  if (item.onlineOnly) return { id: item.id, owner: item.owner, ts: item.ts, idempotencyKey: item.idempotencyKey, onlineOnly: true };
  const sealed = await sealLocal(item, aad(item));
  return { id: item.id, owner: item.owner, ts: item.ts, idempotencyKey: item.idempotencyKey, sealed };
}
async function unpack(row: StoredMutation): Promise<QueuedMutation> {
  if (row.owner !== currentOwner()) throw new VaultLockedError();
  const item = row.onlineOnly
    ? { id: row.id, owner: row.owner, ts: row.ts, idempotencyKey: row.idempotencyKey, method: 'POST' as const, path: '/sync/receipts/verify', onlineOnly: true }
    : await openLocal<QueuedMutation>(row.sealed!, aad(row));
  if (item.owner !== row.owner || item.id !== row.id || item.idempotencyKey !== row.idempotencyKey) throw new Error('Identité locale altérée');
  return { ...item, ...(row.failedStatus === undefined ? {} : { failedStatus: row.failedStatus, failedAt: row.failedAt }) };
}
/** `reserve` reçoit l'id AVANT l'écriture : l'appelant le marque « en vol » sans fenêtre. */
export async function enqueue(item: Omit<QueuedMutation, 'id' | 'ts' | 'owner' | 'idempotencyKey'>, reserve?: (id: string) => void): Promise<QueuedMutation> {
  const owner = currentOwner(); if (!owner) throw new VaultLockedError();
  const valid = captureLocalGuard(!item.onlineOnly);
  if (!item.onlineOnly && !isVaultOpen()) throw new VaultLockedError();
  const id = crypto.randomUUID(); lastTs = Math.max(Date.now(), lastTs + 1); reserve?.(id);
  const entry: QueuedMutation = { ...item, body: item.onlineOnly || item.body === undefined ? undefined : JSON.parse(JSON.stringify(item.body)), id, ts: lastTs, owner, idempotencyKey: `v1.${Date.now()}.${id}` };
  const row = await storeEntry(entry);
  await localTx(['pendingSealed'], 'readwrite', (tx) => { if (!valid()) throw new VaultLockedError(); tx.objectStore('pendingSealed').add(row); }); notifyLocal(); return entry;
}
async function rows(store: LocalStore) { return (await localAll<StoredMutation>(store)).filter((r) => r.owner === currentOwner()).sort((a, b) => a.ts - b.ts); }
async function readable(store: LocalStore) {
  const owner = currentOwner(); const result: QueuedMutation[] = [];
  for (const row of await rows(store)) {
    if (currentOwner() !== owner) throw new VaultLockedError();
    if (row.sealed && !isVaultOpen()) continue;
    result.push(await unpack(row));
  }
  return result;
}
export const allQueued = () => readable('pendingSealed');
export const allFailed = async () => await readable('failedSealed') as FailedMutation[];
export const pendingCount = async () => (await rows('pendingSealed')).length;
export const failedCount = async () => (await rows('failedSealed')).length;
async function removeOwn(store: LocalStore, id: string) {
  const owner = currentOwner();
  await localTx([store], 'readwrite', (tx) => {
    const s = tx.objectStore(store); const r = s.get(id); r.onsuccess = () => { if (r.result?.owner === owner) s.delete(id); };
  }); notifyLocal();
}
export const remove = (id: string) => removeOwn('pendingSealed', id);
export const removeFailed = (id: string) => removeOwn('failedSealed', id);
export class PermanentReplayError extends Error { constructor(public readonly status: number) { super(`replay rejected with status ${status}`); this.name = 'PermanentReplayError'; } }
export async function archiveFailed(item: QueuedMutation, status: number): Promise<void> {
  if (item.owner !== currentOwner()) throw new VaultLockedError();
  const valid = captureLocalGuard(!item.onlineOnly);
  await localTx(['pendingSealed', 'failedSealed'], 'readwrite', (tx) => {
    if (!valid()) throw new VaultLockedError();
    const pending = tx.objectStore('pendingSealed'); const r = pending.get(item.id);
    r.onsuccess = () => {
      const row = r.result as StoredMutation | undefined;
      if (!valid()) { tx.abort(); return; }
      if (row?.owner === item.owner) { tx.objectStore('failedSealed').put({ ...row, failedStatus: status, failedAt: Date.now() }); pending.delete(item.id); }
    };
  }); notifyLocal();
}
export const hasReplayIdentity = (m: QueuedMutation) => Boolean(m.idempotencyKey && mutationKeyTime(m.idempotencyKey) !== null && m.owner);
let flight: Promise<{ flushed: number; failed: number }> | null = null;
export function flush(send: (m: QueuedMutation) => Promise<void>) {
  if (!flight) flight = flushWithin(send).finally(() => { flight = null; }); return flight;
}
async function flushWithin(send: (m: QueuedMutation) => Promise<void>) {
  let flushed = 0; let failed = 0;
  for (const item of await allQueued()) {
    if (item.owner !== currentOwner() || (!item.onlineOnly && !isVaultOpen())) break;
    try { await send(item); await remove(item.id); flushed++; }
    catch (e) { if (e instanceof PermanentReplayError) { await archiveFailed(item, e.status); failed++; } else break; }
  }
  return { flushed, failed };
}
export const purgeAll = purgeLocal;
export async function legacyCount() {
  const owner = currentOwner(); if (!owner) return 0;
  return (await Promise.all([localAll<QueuedMutation>('mutations'), localAll<QueuedMutation>('failed')])).flat().filter((m) => m.owner === owner || !m.owner).length;
}
/** Avertissement appareil sans révéler le compte ou le corps des anciennes entrées. */
export async function legacyPresent() { return (await Promise.all([localAll('mutations'), localAll('failed')])).some((rows) => rows.length > 0); }
/** Aucune clé d'idempotence inventée. Les entrées non attribuables restent en quarantaine. */
export async function migrateLegacy() {
  const owner = currentOwner(); if (!owner || !isVaultOpen()) throw new VaultLockedError();
  const valid = captureLocalGuard();
  for (const [oldStore, newStore] of [['mutations', 'pendingSealed'], ['failed', 'failedSealed']] as const) {
    for (const item of (await localAll<FailedMutation>(oldStore)).filter((m) => m.owner === owner)) {
      const row = await storeEntry(item);
      if (currentOwner() !== owner || !isVaultOpen()) throw new VaultLockedError();
      await localTx([oldStore, newStore], 'readwrite', (tx) => {
        if (!valid()) throw new VaultLockedError();
        const old = tx.objectStore(oldStore); const r = old.get(item.id);
        r.onsuccess = () => { if (!valid()) { tx.abort(); return; } if (r.result && JSON.stringify(r.result) === JSON.stringify(item)) {
          tx.objectStore(newStore).put({ ...row, ...(item.failedStatus === undefined ? {} : { failedStatus: item.failedStatus, failedAt: item.failedAt }) }); old.delete(item.id);
        } };
      });
    }
  } notifyLocal();
}
/** Suppression volontaire après avertissement UI ; jamais rattacher owner NULL à un patient. */
export async function purgeUnownedLegacy() {
  await localTx(['mutations', 'failed'], 'readwrite', (tx) => {
    for (const name of ['mutations', 'failed']) { const store = tx.objectStore(name); const r = store.getAll(); r.onsuccess = () => { for (const row of r.result) if (!row.owner) store.delete(row.id); }; }
  }); notifyLocal();
}
