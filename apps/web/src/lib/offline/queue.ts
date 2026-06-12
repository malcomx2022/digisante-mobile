// ─────────────────────────────────────────────────────────────
// File de synchronisation hors-ligne (IndexedDB, sans dépendance).
// Les MUTATIONS effectuées hors-ligne (ex. saisie de constantes) sont mises en
// file, puis rejouées au retour du réseau. JAMAIS de données de santé en clair
// au-delà du strict nécessaire ; la file est locale à l'appareil.
// ─────────────────────────────────────────────────────────────
const DB_NAME = 'digisante-offline';
const STORE = 'mutations';

export interface QueuedMutation {
  id: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  ts: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

/** Ajoute une mutation à la file. */
export async function enqueue(item: Omit<QueuedMutation, 'id' | 'ts'>): Promise<QueuedMutation> {
  const entry: QueuedMutation = { ...item, id: crypto.randomUUID(), ts: Date.now() };
  await tx('readwrite', (s) => s.add(entry));
  return entry;
}

/** Liste les mutations en attente (ordre chronologique). */
export async function allQueued(): Promise<QueuedMutation[]> {
  const items = await tx<QueuedMutation[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedMutation[]>);
  return items.sort((a, b) => a.ts - b.ts);
}

/** Retire une mutation de la file. */
export async function remove(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

/** Nombre de mutations en attente. */
export async function pendingCount(): Promise<number> {
  return tx<number>('readonly', (s) => s.count());
}

/**
 * Rejoue les mutations en attente via `send`. Une mutation qui réussit est
 * retirée ; en cas d'échec (réseau), on s'arrête pour réessayer plus tard.
 */
export async function flush(send: (m: QueuedMutation) => Promise<void>): Promise<{ flushed: number }> {
  const items = await allQueued();
  let flushed = 0;
  for (const item of items) {
    try {
      await send(item);
      await remove(item.id);
      flushed += 1;
    } catch {
      break; // toujours hors-ligne ou erreur réseau : on réessaiera
    }
  }
  return { flushed };
}
