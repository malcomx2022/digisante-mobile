// IndexedDB v4 : anciens magasins conservés pour migration explicite, nouveaux scellés.
export const LOCAL_DB = 'digisante-offline';
export const LOCAL_VERSION = 4;
export const STORES = ['mutations', 'failed', 'vaults', 'pendingSealed', 'failedSealed', 'snapshots'] as const;
export type LocalStore = typeof STORES[number];
export function openLocalDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LOCAL_DB, LOCAL_VERSION);
    req.onupgradeneeded = () => {
      for (const name of STORES) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: name === 'vaults' ? 'owner' : 'id' });
    };
    req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Fermer les anciens onglets pour mettre à jour le stockage'));
  });
}
export async function localTx<T>(stores: LocalStore[], mode: IDBTransactionMode, run: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode); let result: T;
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Stockage local indisponible')); };
    try { run(tx, (value) => { result = value; }); } catch (e) { tx.abort(); db.close(); reject(e); }
  });
}
export function localAll<T>(store: LocalStore): Promise<T[]> {
  return localTx<T[]>([store], 'readonly', (tx, done) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => done(r.result); });
}
export function localPut(store: LocalStore, value: unknown): Promise<void> {
  return localTx([store], 'readwrite', (tx) => { tx.objectStore(store).put(value); });
}
export function localDelete(store: LocalStore, id: string): Promise<void> {
  return localTx([store], 'readwrite', (tx) => { tx.objectStore(store).delete(id); });
}
