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

/** Calcule le hash chaîné d'une entrée d'audit (fonction pure, testable). */
export function computeAuditHash(prevHash: string | null, entry: AuditEntry, isoTs: string): string {
  const canonical = JSON.stringify({
    prevHash: prevHash ?? '',
    action: entry.action,
    actorId: entry.actorId ?? '',
    targetId: entry.targetId ?? '',
    ip: entry.ip ?? '',
    meta: entry.meta ?? null,
    ts: isoTs,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Écrit une entrée d'audit chaînée. La lecture du dernier hash + l'insertion
 * se font dans une transaction pour limiter les courses (la table est append-only).
 */
export async function writeAudit(prisma: PrismaClient, entry: AuditEntry): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const last = await tx.auditLog.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });
    const createdAt = new Date();
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
  });
}
