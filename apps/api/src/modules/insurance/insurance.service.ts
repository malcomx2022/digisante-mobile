// ─────────────────────────────────────────────────────────────
// Couverture d'assurance santé du patient : catalogue des assureurs (ARCH/AMU,
// CNSS, mutuelles, assureurs privés) + déclaration des couvertures du patient.
// Aide à la prise en charge des frais (consultation, pharmacie, labo, hospi).
// Le statut effectif (EXPIRED) est calculé à la lecture selon expiresAt.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';

import { getCached, invalidateCache } from '@/lib/cache.js';
import { conflict, forbidden, notFound } from '@/lib/errors.js';

// Référentiel assureurs = données PUBLIQUES et NON personnelles (§4-safe),
// quasi statiques (peuplées au seed). Bonne cible de cache read-through pour
// épargner à la DB une lecture à chaque ouverture de l'espace assurance.
export const PROVIDERS_CACHE_KEY = 'insurance:providers';
const PROVIDERS_CACHE_TTL = 300; // 5 min

async function patientIdOf(app: FastifyInstance, userId: string): Promise<string> {
  const p = await app.prisma.patient.findUnique({ where: { userId }, select: { id: true } });
  if (!p) throw forbidden('Profil patient requis');
  return p.id;
}

/** Statut effectif : EXPIRED si la date d'expiration est dépassée, sinon le statut stocké. */
function effectiveStatus(status: string, expiresAt: Date | null, now: Date): string {
  if (status === 'ACTIVE' && expiresAt && expiresAt.getTime() < now.getTime()) return 'EXPIRED';
  return status;
}

/** Catalogue des assureurs disponibles (référentiel public, trié par nom). */
export async function listProviders(app: FastifyInstance) {
  return getCached(app, PROVIDERS_CACHE_KEY, PROVIDERS_CACHE_TTL, () =>
    app.prisma.insurance.findMany({
      select: { id: true, name: true, code: true, coverageTypes: true },
      orderBy: { name: 'asc' },
    }),
  );
}

/**
 * Invalide le cache du référentiel assureurs. À appeler après TOUTE écriture du
 * catalogue (aujourd'hui : seed ; demain : un éventuel endpoint admin de gestion
 * du catalogue). Sans cela, une modification resterait masquée jusqu'au TTL.
 */
export async function invalidateProviders(app: FastifyInstance) {
  await invalidateCache(app, PROVIDERS_CACHE_KEY);
}

/** Couvertures déclarées par le patient courant (assureur joint, statut effectif). */
export async function listMine(app: FastifyInstance, userId: string) {
  const patientId = await patientIdOf(app, userId);
  const now = new Date();
  const rows = await app.prisma.patientInsurance.findMany({
    where: { patientId },
    select: {
      id: true,
      memberNumber: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      insurance: { select: { id: true, name: true, code: true, coverageTypes: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    memberNumber: r.memberNumber,
    status: effectiveStatus(r.status, r.expiresAt, now),
    expiresAt: r.expiresAt,
    insurance: r.insurance,
  }));
}

/** Déclare une couverture pour le patient. Une seule par assureur (contrainte unique). */
export async function addMine(
  app: FastifyInstance,
  userId: string,
  input: { insuranceId: string; memberNumber: string; expiresAt?: Date },
) {
  const patientId = await patientIdOf(app, userId);

  const insurance = await app.prisma.insurance.findUnique({
    where: { id: input.insuranceId },
    select: { id: true },
  });
  if (!insurance) throw notFound('Assureur introuvable');

  const already = await app.prisma.patientInsurance.findUnique({
    where: { patientId_insuranceId: { patientId, insuranceId: input.insuranceId } },
    select: { id: true },
  });
  if (already) throw conflict('Couverture déjà déclarée pour cet assureur');

  return app.prisma.patientInsurance.create({
    data: {
      patientId,
      insuranceId: input.insuranceId,
      memberNumber: input.memberNumber,
      expiresAt: input.expiresAt ?? null,
    },
    select: { id: true, memberNumber: true, status: true, expiresAt: true },
  });
}

/** Supprime une couverture du patient (propriété vérifiée). */
export async function removeMine(app: FastifyInstance, userId: string, id: string) {
  const patientId = await patientIdOf(app, userId);
  const row = await app.prisma.patientInsurance.findFirst({
    where: { id, patientId },
    select: { id: true },
  });
  if (!row) throw notFound('Couverture introuvable');
  await app.prisma.patientInsurance.delete({ where: { id: row.id } });
  return { id: row.id, deleted: true };
}
