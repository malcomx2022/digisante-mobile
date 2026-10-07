// Projection choisie explicitement, aucune persistance automatique d'API arbitraire.
import { localAll, localTx } from './db';
import { captureLocalGuard, currentOwner, notifyLocal, openLocal, sealLocal, SNAPSHOT_STALE_MS, SNAPSHOT_TTL_MS, VaultLockedError, type Sealed } from './vault';

export interface OfflineSnapshot {
  records: { id: string; title: string; type: string; createdAt: string }[];
  prescriptions: { id: string; status: string; validUntil: string; items: { medicationName: string; dosage: string; frequency: string; duration: string }[] }[];
  emergency: { bloodGroup: string | null; allergies: string[]; chronicDiseases: string[]; emergencyContact: string | null };
}
interface StoredSnapshot { id: string; owner: string; syncedAt: number; expiresAt: number; sealed?: Sealed }
const aad = (row: StoredSnapshot) => `snapshot-v1|${row.id}|${row.syncedAt}|${row.expiresAt}`;
export function projectSnapshot(records: OfflineSnapshot['records'], prescriptions: OfflineSnapshot['prescriptions'], emergency: OfflineSnapshot['emergency']): OfflineSnapshot {
  return {
    records: records.slice(0, 20).map(({ id, title, type, createdAt }) => ({ id, title, type, createdAt })),
    prescriptions: prescriptions.slice(0, 10).map(({ id, status, validUntil, items }) => ({ id, status, validUntil, items: items.slice(0, 20).map(({ medicationName, dosage, frequency, duration }) => ({ medicationName, dosage, frequency, duration })) })),
    emergency: { bloodGroup: emergency.bloodGroup, allergies: emergency.allergies, chronicDiseases: emergency.chronicDiseases, emergencyContact: emergency.emergencyContact },
  };
}
export async function saveSnapshot(data: OfflineSnapshot) {
  const owner = currentOwner(); if (!owner) throw new VaultLockedError();
  const valid = captureLocalGuard();
  const row: StoredSnapshot = { id: owner, owner, syncedAt: Date.now(), expiresAt: Date.now() + SNAPSHOT_TTL_MS };
  row.sealed = await sealLocal(projectSnapshot(data.records, data.prescriptions, data.emergency), aad(row));
  await localTx(['snapshots'], 'readwrite', (tx) => { if (!valid()) throw new VaultLockedError(); tx.objectStore('snapshots').put(row); }); notifyLocal();
}
export async function snapshotStatus() {
  const row = (await localAll<StoredSnapshot>('snapshots')).find((r) => r.owner === currentOwner());
  if (!row) return null;
  return { syncedAt: row.syncedAt, expiresAt: row.expiresAt, expired: Date.now() >= row.expiresAt || row.syncedAt > Date.now() + 300_000, stale: Date.now() - row.syncedAt >= SNAPSHOT_STALE_MS };
}
export async function readSnapshot(): Promise<OfflineSnapshot | null> {
  const valid = captureLocalGuard(false);
  const owner = currentOwner(); const row = (await localAll<StoredSnapshot>('snapshots')).find((r) => r.owner === owner);
  if (!row || !row.sealed) return null;
  if (Date.now() >= row.expiresAt || row.syncedAt > Date.now() + 300_000) {
    await localTx(['snapshots'], 'readwrite', (tx) => {
      if (!valid()) throw new VaultLockedError();
      const store = tx.objectStore('snapshots'); const request = store.get(row.id);
      request.onsuccess = () => { const current = request.result as StoredSnapshot | undefined;
        if (!valid()) { tx.abort(); return; }
        if (current?.syncedAt === row.syncedAt && current.expiresAt === row.expiresAt) store.put({ ...current, sealed: undefined });
      };
    }); return null;
  }
  if (owner !== currentOwner()) throw new VaultLockedError(); return openLocal<OfflineSnapshot>(row.sealed, aad(row));
}
