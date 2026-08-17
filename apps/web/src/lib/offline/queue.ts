// ─────────────────────────────────────────────────────────────
// File de synchronisation hors-ligne (IndexedDB, sans dépendance).
// Les MUTATIONS effectuées hors-ligne (ex. saisie de constantes) sont mises en
// file, puis rejouées au retour du réseau. JAMAIS de données de santé en clair
// au-delà du strict nécessaire ; la file est locale à l'appareil.
// ─────────────────────────────────────────────────────────────
const DB_NAME = 'digisante-offline';
const STORE = 'mutations';
// Magasin des mutations rejouées en échec « définitif » (4xx) : on ne les perd PAS
// silencieusement, on les déplace ici pour consultation/diagnostic (point 2).
const FAILED_STORE = 'failed';
const DB_VERSION = 2;

export interface QueuedMutation {
  id: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  ts: number;
}

/** Mutation hors-ligne rejouée puis rejetée définitivement par le serveur (4xx). */
export interface FailedMutation extends QueuedMutation {
  /** Statut HTTP renvoyé au rejeu (ex. 422, 409). */
  failedStatus: number;
  /** Horodatage de l'échec. */
  failedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      // v2 : magasin des échecs définitifs (rétro-compatible — créé si absent).
      if (!db.objectStoreNames.contains(FAILED_STORE)) {
        db.createObjectStore(FAILED_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
  store: string = STORE,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = run(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

// `Date.now()` a une résolution de la milliseconde : plusieurs mutations mises en
// file dans la même milliseconde (rafale programmatique — plusieurs champs d'un
// formulaire, marquages de prises enchaînés) partageraient le même `ts`, et leur
// ordre de rejeu deviendrait arbitraire. Or rejouer DANS L'ORDRE est toute la
// raison d'être de cette file (un PATCH puis un DELETE ne commutent pas).
// On force donc un horodatage STRICTEMENT croissant dans la session.
let lastTs = 0;
function nextTs(): number {
  lastTs = Math.max(Date.now(), lastTs + 1);
  return lastTs;
}

/** Ajoute une mutation à la file. L'`id` sert aussi de clé d'idempotence (point 2). */
export async function enqueue(item: Omit<QueuedMutation, 'id' | 'ts'>): Promise<QueuedMutation> {
  const entry: QueuedMutation = { ...item, id: crypto.randomUUID(), ts: nextTs() };
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

/** Erreur « définitive » au rejeu (4xx) : la mutation ne doit PAS être réessayée. */
export class PermanentReplayError extends Error {
  constructor(public readonly status: number) {
    super(`replay rejected with status ${status}`);
    this.name = 'PermanentReplayError';
  }
}

/** Liste les mutations en échec définitif (4xx) conservées pour diagnostic. */
export async function allFailed(): Promise<FailedMutation[]> {
  const items = await tx<FailedMutation[]>('readonly', (s) => s.getAll() as IDBRequest<FailedMutation[]>, FAILED_STORE);
  return items.sort((a, b) => a.failedAt - b.failedAt);
}

/** Nombre de mutations en échec définitif (récupérable par l'UI / la supervision). */
export async function failedCount(): Promise<number> {
  return tx<number>('readonly', (s) => s.count(), FAILED_STORE);
}

/** Purge une mutation en échec (ex. après revue manuelle). */
export async function removeFailed(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id), FAILED_STORE);
}

/**
 * Rejoue les mutations en attente via `send`.
 * - Succès → retirée de la file.
 * - `PermanentReplayError` (4xx) → DÉPLACÉE dans le magasin des échecs (jamais perdue
 *   silencieusement, point 2) ; on poursuit avec les suivantes.
 * - Toute autre erreur (réseau / 5xx) → on s'arrête pour réessayer plus tard, en
 *   préservant l'ordre des mutations restantes.
 */
export async function flush(
  send: (m: QueuedMutation) => Promise<void>,
): Promise<{ flushed: number; failed: number }> {
  const items = await allQueued();
  let flushed = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await send(item);
      await remove(item.id);
      flushed += 1;
    } catch (err) {
      if (err instanceof PermanentReplayError) {
        // 4xx : rejet métier définitif → on archive au lieu de perdre la donnée.
        const failedEntry: FailedMutation = { ...item, failedStatus: err.status, failedAt: Date.now() };
        await tx('readwrite', (s) => s.put(failedEntry), FAILED_STORE);
        await remove(item.id);
        failed += 1;
        continue;
      }
      break; // toujours hors-ligne / 5xx : on réessaiera plus tard
    }
  }
  return { flushed, failed };
}
