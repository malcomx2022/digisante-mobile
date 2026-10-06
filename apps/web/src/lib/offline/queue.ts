// ─────────────────────────────────────────────────────────────
// File de synchronisation hors-ligne (IndexedDB, sans dépendance).
// Contrat L3 : identité persistée avant envoi, archivage atomique des rejets.
// Les corps restent en clair dans IndexedDB : chiffrement local prévu au lot L4.
// ─────────────────────────────────────────────────────────────
import { mutationKeyTime } from '@digisante/shared';

const DB_NAME = 'digisante-offline';
const STORE = 'mutations';
// Magasin des mutations rejouées en échec « définitif » (4xx) : on ne les perd PAS
// silencieusement, on les déplace ici pour consultation/diagnostic (point 2).
const FAILED_STORE = 'failed';
const DB_VERSION = 3;

export interface QueuedMutation {
  id: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  ts: number;
  /** Compte auquel appartient la mutation (appareil partagé : jamais rejouée sous un autre compte). */
  owner?: string | null;
  /** Absente sur les anciennes files : jamais inventée lors de leur migration. */
  idempotencyKey?: string;
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
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    let result: T;
    try {
      const request = run(transaction.objectStore(store));
      request.onsuccess = () => { result = request.result; };
    } catch (error) { transaction.abort(); db.close(); reject(error); return; }
    // Un succès de requête ne prouve PAS le commit IndexedDB.
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('Transaction IndexedDB annulée')); };
  }));
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

// Compte courant (posé par AuthProvider). Une mutation mise en file par le compte A
// ne doit JAMAIS être rejouée sous la session du compte B (appareil partagé : les
// constantes de A écrites dans le dossier de B) — §4.
let owner: string | null = null;
export function getQueueOwner(): string | null { return owner; }

export function setQueueOwner(userId: string | null): void {
  owner = userId;
}

/** Ajoute une mutation à la file. L'`id` sert aussi de clé d'idempotence (point 2). */
export async function enqueue(item: Omit<QueuedMutation, 'id' | 'ts' | 'owner' | 'idempotencyKey'>): Promise<QueuedMutation> {
  const id = crypto.randomUUID();
  const body = item.body === undefined ? undefined : JSON.parse(JSON.stringify(item.body));
  const entry: QueuedMutation = { ...item, body, id, ts: nextTs(), owner, idempotencyKey: `v1.${Date.now()}.${id}` };
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

/** Déplacement atomique : une panne ne laisse pas la même mutation dans deux magasins. */
export async function archiveFailed(item: QueuedMutation, status: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE, FAILED_STORE], 'readwrite');
    transaction.objectStore(FAILED_STORE).put({ ...item, failedStatus: status, failedAt: Date.now() });
    transaction.objectStore(STORE).delete(item.id);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

/** v2 n'avait aucune preuve du premier envoi : conserver pour revue, sans nouveau jeton. */
export function hasReplayIdentity(item: QueuedMutation): boolean {
  return Boolean(item.idempotencyKey && mutationKeyTime(item.idempotencyKey) !== null && item.owner);
}

let flushFlight: Promise<{ flushed: number; failed: number }> | null = null;
export function flush(send: (m: QueuedMutation) => Promise<void>): Promise<{ flushed: number; failed: number }> {
  if (!flushFlight) flushFlight = flushWithin(send).finally(() => { flushFlight = null; });
  return flushFlight;
}

/**
 * Rejoue les mutations en attente via `send`.
 * - Succès → retirée de la file.
 * - `PermanentReplayError` (4xx) → DÉPLACÉE dans le magasin des échecs (jamais perdue
 *   silencieusement, point 2) ; on poursuit avec les suivantes.
 * - Toute autre erreur (réseau / 5xx) → on s'arrête pour réessayer plus tard, en
 *   préservant l'ordre des mutations restantes.
 */
async function flushWithin(
  send: (m: QueuedMutation) => Promise<void>,
): Promise<{ flushed: number; failed: number }> {
  // Seules les mutations du compte courant sont rejouées ; celles d'un autre compte
  // restent en file (elles repartiront quand CE compte se reconnectera).
  const items = (await allQueued()).filter((m) => (m.owner ?? null) === owner);
  let flushed = 0;
  let failed = 0;
  for (const item of items) {
    if ((item.owner ?? null) !== owner) break; // arrêt au changement de session
    try {
      await send(item);
      await remove(item.id);
      flushed += 1;
    } catch (err) {
      if (err instanceof PermanentReplayError) {
        // 4xx : rejet métier définitif → on archive au lieu de perdre la donnée.
        await archiveFailed(item, err.status);
        failed += 1;
        continue;
      }
      break; // toujours hors-ligne / 5xx : on réessaiera plus tard
    }
  }
  return { flushed, failed };
}

/**
 * Purge COMPLÈTE de la file et des échecs (déconnexion explicite) : les corps en
 * attente peuvent contenir des données de santé ou des messages — rien ne doit
 * rester en clair sur un appareil partagé après la déconnexion.
 */
export async function purgeAll(): Promise<void> {
  await tx('readwrite', (s) => s.clear());
  await tx('readwrite', (s) => s.clear(), FAILED_STORE);
}
