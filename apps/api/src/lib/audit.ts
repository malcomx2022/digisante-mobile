// ─────────────────────────────────────────────────────────────
// Service d'audit immuable (CLAUDE.md §4) — écrit dans AuditLog (append-only).
// Chaque entrée chaîne le hash de la précédente : hash = SHA-256(prevHash + payload).
// Le trigger SQL (migration) interdit UPDATE/DELETE. Étendu en P2.3 (DMP, etc.).
// ─────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

export interface AuditEntry {
  action: string;
  actorId?: string | null;
  targetId?: string | null;
  ip?: string | null;
  meta?: Record<string, unknown> | null;
}

/**
 * Forme CANONIQUE d'une valeur JSON : clés d'objet triées récursivement.
 * Indispensable pour que le hash soit RE-CALCULABLE depuis la base : `meta` est
 * stocké en `jsonb`, qui réordonne les clés (par longueur puis octets) — y compris
 * dans les objets imbriqués. Hacher l'ordre d'insertion rendait la vérification
 * impossible (≈ 80 % des lignes mesurées le 22/09/2026) : une altération de `meta`
 * n'aurait pas été détectable, seuls les chaînages prevHash→hash l'étaient.
 */
export function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = canonicalJson(v); // `undefined` n'est pas stocké en jsonb
    }
    return out;
  }
  return value;
}

/** Calcule le hash chaîné d'une entrée d'audit (fonction pure, testable). */
export function computeAuditHash(prevHash: string | null, entry: AuditEntry, isoTs: string): string {
  // Le Date/Decimal éventuel de `meta` est d'abord ramené à sa forme JSON (celle stockée).
  const meta = entry.meta == null ? null : canonicalJson(JSON.parse(JSON.stringify(entry.meta)));
  const canonical = JSON.stringify({
    prevHash: prevHash ?? '',
    action: entry.action,
    actorId: entry.actorId ?? '',
    targetId: entry.targetId ?? '',
    ip: entry.ip ?? '',
    meta,
    ts: isoTs,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Écrit une entrée d'audit chaînée. La lecture du dernier hash + l'insertion
 * se font dans une transaction pour limiter les courses (la table est append-only).
 */
export async function writeAudit(prisma: PrismaClient, entry: AuditEntry): Promise<void> {
  await prisma.$transaction((tx) => writeAuditWithin(tx, entry));
}

/** L6 : joindre l'audit à la transaction financière sans transaction imbriquée. */
export async function writeAuditWithin(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  // Verrou consultatif transactionnel : sérialise les écritures d'audit entre
  // workers (cluster PM2 ×2). Sans lui, deux insertions concurrentes peuvent
  // lire le même dernier hash et forker la chaîne d'intégrité. Libéré au commit.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(4021957)`;
  const last = await tx.auditLog.findFirst({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { hash: true, createdAt: true },
  });
  // Un départage par CUID seul ne garantit pas l'ordre causal des insertions.
  // Horloge logique sous le verrou : égalité/recul d'horloge → dernier + 1 ms.
  const createdAt = new Date(Math.max(Date.now(), last ? last.createdAt.getTime() + 1 : 0));
  const prevHash = last?.hash ?? null;
  const hash = computeAuditHash(prevHash, entry, createdAt.toISOString());

  await tx.auditLog.create({
    data: {
      action: entry.action,
      actorId: entry.actorId ?? null,
      targetId: entry.targetId ?? null,
      ip: entry.ip ?? null,
      meta: entry.meta == null ? Prisma.JsonNull : (entry.meta as Prisma.InputJsonValue),
      prevHash,
      hash,
      createdAt,
    },
  });
}

/**
 * Clés de `meta` jamais montrées à l'administrateur (§4 : l'admin ne lit AUCUN contenu
 * médical ni la position d'une urgence). Appliqué à la LECTURE car le registre est
 * append-only : les lignes écrites avant la minimisation (sept. 2026) portent encore
 * les valeurs critiques de laboratoire et les coordonnées SOS.
 */
const ADMIN_HIDDEN_META_KEYS = new Set(['critical', 'latitude', 'longitude', 'value', 'values', 'note', 'notes', 'body', 'content', 'data']);

export function redactAuditMetaForAdmin(meta: unknown): unknown {
  if (Array.isArray(meta)) return meta.map(redactAuditMetaForAdmin);
  if (meta && typeof meta === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
      out[k] = ADMIN_HIDDEN_META_KEYS.has(k) ? '[masqué]' : redactAuditMetaForAdmin(v);
    }
    return out;
  }
  return meta;
}
