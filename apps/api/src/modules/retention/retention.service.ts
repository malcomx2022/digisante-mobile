// Purges de conservation (D-8). Une catégorie n'est purgée QUE si sa durée est
// configurée explicitement : sans décision D-8, rien n'est supprimé.
// Seules des catégories sans enjeu légal sont branchées (décision du porteur du
// 16/11/2026) ; DMP, prescriptions, finances, audit, KYC et comptes inactifs
// attendent l'avis juridique (docs/CONFORMITE_APDP_2026-11.md §4).
import type { Prisma, PrismaClient } from '@prisma/client';
import { writeAudit } from '@/lib/audit.js';

const DAY_MS = 86_400_000;
/** Taille d'un lot de suppression : borne la durée des verrous. */
export const RETENTION_BATCH_SIZE = 1000;

export type RetentionCategory = 'NOTIFICATIONS' | 'SOS_CLOSED';

export interface RetentionPolicy {
  NOTIFICATIONS?: number;
  SOS_CLOSED?: number;
}

export interface CategoryResult {
  category: RetentionCategory;
  enabled: boolean;
  retentionDays: number | null;
  cutoff: string | null;
  matched: number;
  deleted: number;
}

/** Politique lue dans la configuration (durées en jours, absentes = désactivé). */
export function policyFromEnv(env: { RETENTION_NOTIFICATIONS_DAYS?: number; RETENTION_SOS_CLOSED_DAYS?: number }): RetentionPolicy {
  return { NOTIFICATIONS: env.RETENTION_NOTIFICATIONS_DAYS, SOS_CLOSED: env.RETENTION_SOS_CLOSED_DAYS };
}

// Accès par catégorie. Jamais une notification PENDING (pas encore envoyée) ni
// une alerte SOS encore ACTIVE, quel que soit son âge.
interface CategoryStore {
  count(cutoff: Date): Promise<number>;
  nextBatch(cutoff: Date): Promise<string[]>;
  /** Le filtre est réappliqué : une ligne modifiée entre-temps n'est pas supprimée. */
  deleteIds(cutoff: Date, ids: string[]): Promise<number>;
}

function store(prisma: PrismaClient, category: RetentionCategory): CategoryStore {
  if (category === 'NOTIFICATIONS') {
    const where = (cutoff: Date): Prisma.NotificationWhereInput => ({ status: { not: 'PENDING' }, createdAt: { lt: cutoff } });
    return {
      count: (cutoff) => prisma.notification.count({ where: where(cutoff) }),
      nextBatch: async (cutoff) =>
        (await prisma.notification.findMany({ where: where(cutoff), select: { id: true }, take: RETENTION_BATCH_SIZE, orderBy: { id: 'asc' } })).map((r) => r.id),
      deleteIds: async (cutoff, ids) => (await prisma.notification.deleteMany({ where: { ...where(cutoff), id: { in: ids } } })).count,
    };
  }
  const where = (cutoff: Date): Prisma.SosWhereInput => ({ status: { in: ['RESOLVED', 'FALSE_ALARM'] }, resolvedAt: { lt: cutoff } });
  return {
    count: (cutoff) => prisma.sos.count({ where: where(cutoff) }),
    nextBatch: async (cutoff) =>
      (await prisma.sos.findMany({ where: where(cutoff), select: { id: true }, take: RETENTION_BATCH_SIZE, orderBy: { id: 'asc' } })).map((r) => r.id),
    deleteIds: async (cutoff, ids) => (await prisma.sos.deleteMany({ where: { ...where(cutoff), id: { in: ids } } })).count,
  };
}

async function purgeCategory(
  prisma: PrismaClient,
  category: RetentionCategory,
  cutoff: Date,
  dryRun: boolean,
): Promise<{ matched: number; deleted: number }> {
  const s = store(prisma, category);
  const matched = await s.count(cutoff);
  if (dryRun || matched === 0) return { matched, deleted: 0 };
  let deleted = 0;
  for (;;) {
    const ids = await s.nextBatch(cutoff);
    if (ids.length === 0) break;
    deleted += await s.deleteIds(cutoff, ids);
    if (ids.length < RETENTION_BATCH_SIZE) break;
  }
  return { matched, deleted };
}

/**
 * Applique la politique. `dryRun` compte sans rien supprimer. Hors simulation,
 * un audit `RETENTION_PURGE` porte uniquement catégories, durées et compteurs.
 */
export async function runRetention(
  prisma: PrismaClient,
  policy: RetentionPolicy,
  opts: { dryRun: boolean; now?: Date },
): Promise<{ dryRun: boolean; categories: CategoryResult[] }> {
  const now = opts.now ?? new Date();
  const categories: CategoryResult[] = [];
  for (const category of ['NOTIFICATIONS', 'SOS_CLOSED'] as const) {
    const days = policy[category];
    if (!days) {
      categories.push({ category, enabled: false, retentionDays: null, cutoff: null, matched: 0, deleted: 0 });
      continue;
    }
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    const { matched, deleted } = await purgeCategory(prisma, category, cutoff, opts.dryRun);
    categories.push({ category, enabled: true, retentionDays: days, cutoff: cutoff.toISOString(), matched, deleted });
  }
  if (!opts.dryRun && categories.some((c) => c.enabled)) {
    await writeAudit(prisma, {
      action: 'RETENTION_PURGE',
      meta: { categories: categories.map(({ category, enabled, retentionDays, deleted }) => ({ category, enabled, retentionDays, deleted })) },
    });
  }
  return { dryRun: opts.dryRun, categories };
}
