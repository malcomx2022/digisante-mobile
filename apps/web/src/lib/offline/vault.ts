// Clé locale indépendante du serveur : AES-GCM, enveloppe PBKDF2, clé ouverte en mémoire.
import { localAll, localTx, type LocalStore } from './db';

export const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
export const SNAPSHOT_STALE_MS = 6 * 60 * 60 * 1000;
export const VAULT_IDLE_MS = 15 * 60 * 1000;
const ITERATIONS = 600_000;
export interface Sealed { iv: string; data: string }
interface VaultMeta { owner: string; version: 1; salt: string; wrapped: Sealed; iterations: number }
let owner: string | null = null;
let lastOwner: string | null = null;
let opened: { owner: string; key: CryptoKey; until: number } | null = null;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
let channel: BroadcastChannel | undefined;
const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64 = (data: Uint8Array) => { let s = ''; for (let i = 0; i < data.length; i += 32768) s += String.fromCharCode(...data.subarray(i, i + 32768)); return btoa(s); };
const encoder = new TextEncoder();
export class VaultLockedError extends Error { constructor() { super('Coffre local verrouillé'); this.name = 'VaultLockedError'; } }
export function subscribeVault(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function notifyLocal() { for (const fn of listeners) fn(); }
export function currentOwner() { return owner; }
/** À recontrôler dans la transaction : purge/lock invalide les écritures en vol. */
export function captureLocalGuard(requireOpen = true) {
  const ctx = { owner, generation };
  return () => Boolean(ctx.owner && owner === ctx.owner && generation === ctx.generation && (!requireOpen || isVaultOpen()));
}
export function lockVault(broadcast = true) {
  opened = null; generation++; clearTimeout(timer); notifyLocal();
  if (broadcast) channel?.postMessage('lock');
}
export function setLocalOwner(next: string | null) {
  if (next !== owner) { const previous = lastOwner; lockVault(); owner = next; if (next) lastOwner = next; notifyLocal();
    // Lectures purgées au changement de compte ; les actions chiffrées restent récupérables.
    if (previous && next) void localTx(['snapshots'], 'readwrite', (tx) => {
      const store = tx.objectStore('snapshots'); const r = store.getAll(); r.onsuccess = () => { for (const row of r.result) if (row.owner === previous) store.delete(row.id); };
    }).catch(() => undefined);
  }
}
export function isVaultOpen() { return Boolean(owner && opened?.owner === owner && opened.until > Date.now()); }
function keyContext() {
  if (!isVaultOpen() || !opened) { if (opened) lockVault(); throw new VaultLockedError(); }
  opened.until = Date.now() + VAULT_IDLE_MS; clearTimeout(timer); timer = setTimeout(() => lockVault(), VAULT_IDLE_MS); timer.unref?.();
  return { key: opened.key, owner: opened.owner, generation };
}
function check(ctx: { owner: string; generation: number }) { if (owner !== ctx.owner || generation !== ctx.generation || !isVaultOpen()) throw new VaultLockedError(); }
async function aes(key: CryptoKey, value: Uint8Array, aad: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, key, value as BufferSource);
  return { iv: b64(iv), data: b64(new Uint8Array(ciphertext)) };
}
async function unseal(key: CryptoKey, sealed: Sealed, aad: string) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(sealed.iv) as BufferSource, additionalData: encoder.encode(aad) }, key, bytes(sealed.data) as BufferSource));
}
async function wrappingKey(phrase: string, salt: string, iterations: number) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(phrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt) as BufferSource, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function hasVault() { return Boolean(owner && (await localAll<VaultMeta>('vaults')).some((v) => v.owner === owner)); }
export async function createVault(phrase: string) {
  if (!owner || phrase.trim().length < 12) throw new Error('Phrase de douze caractères minimum requise');
  const ctx = { owner, generation }; const valid = captureLocalGuard(false); if (await hasVault()) throw new Error('Coffre déjà créé');
  const salt = b64(crypto.getRandomValues(new Uint8Array(16))); const raw = crypto.getRandomValues(new Uint8Array(32));
  const wrapping = await wrappingKey(phrase, salt, ITERATIONS);
  const wrapped = await aes(wrapping, raw, `vault-v1:${ctx.owner}`);
  if (owner !== ctx.owner || generation !== ctx.generation) throw new VaultLockedError();
  // add, pas put : deux onglets ne peuvent pas remplacer une clé de coffre.
  await localTx(['vaults'], 'readwrite', (tx) => { if (!valid()) throw new VaultLockedError(); tx.objectStore('vaults').add({ owner: ctx.owner, version: 1, salt, wrapped, iterations: ITERATIONS } satisfies VaultMeta); });
  const key = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']); raw.fill(0);
  if (owner !== ctx.owner || generation !== ctx.generation) throw new VaultLockedError();
  opened = { owner, key, until: Date.now() + VAULT_IDLE_MS }; keyContext(); notifyLocal();
}
export async function unlockVault(phrase: string) {
  if (!owner) throw new VaultLockedError(); const ctx = { owner, generation };
  const meta = (await localAll<VaultMeta>('vaults')).find((v) => v.owner === ctx.owner);
  if (!meta || meta.version !== 1 || meta.iterations !== ITERATIONS) throw new Error('Coffre indisponible');
  const raw = await unseal(await wrappingKey(phrase, meta.salt, meta.iterations), meta.wrapped, `vault-v1:${ctx.owner}`);
  const key = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']); raw.fill(0);
  if (owner !== ctx.owner || generation !== ctx.generation) throw new VaultLockedError();
  opened = { owner, key, until: Date.now() + VAULT_IDLE_MS }; keyContext(); notifyLocal();
}
export async function sealLocal(value: unknown, aad: string): Promise<Sealed> {
  const ctx = keyContext(); const sealed = await aes(ctx.key, encoder.encode(JSON.stringify(value)), `${ctx.owner}|${aad}`); check(ctx); return sealed;
}
export async function openLocal<T>(sealed: Sealed, aad: string): Promise<T> {
  const ctx = keyContext(); const clear = await unseal(ctx.key, sealed, `${ctx.owner}|${aad}`); check(ctx);
  try { return JSON.parse(new TextDecoder().decode(clear)) as T; } finally { clear.fill(0); }
}
export async function purgeLocal() {
  lockVault(); await localTx(['mutations', 'failed', 'vaults', 'pendingSealed', 'failedSealed', 'snapshots'], 'readwrite', (tx) => {
    for (const name of ['mutations', 'failed', 'vaults', 'pendingSealed', 'failedSealed', 'snapshots'] as LocalStore[]) tx.objectStore(name).clear();
  }); channel?.postMessage('purge'); notifyLocal();
}
export function installLocalGuards() {
  if (typeof window === 'undefined') return () => {};
  if (typeof BroadcastChannel !== 'undefined') { channel = new BroadcastChannel('digisante-local-security'); channel.onmessage = () => lockVault(false); }
  const hidden = () => { if (document.visibilityState === 'hidden') lockVault(); };
  const pagehide = () => lockVault();
  document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', pagehide);
  return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', pagehide); channel?.close(); channel = undefined; lockVault(false); };
}
// Métadonnées seulement : aucune phrase, clé ouverte, JWT ou réponse médicale persistée.
export const vaultSupport = () => Boolean(globalThis.crypto?.subtle && typeof indexedDB !== 'undefined');
