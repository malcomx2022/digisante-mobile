// ─────────────────────────────────────────────────────────────
// Disponibilité des médicaments — « médicament près de moi ». La pharmacie gère
// SON stock (statut + prix indicatif) ; le patient cherche un médicament et voit
// les pharmacies qui l'ont (statut ≠ OUT), triées par distance si géolocalisé.
// NON médical (inventaire) : la recherche patient est publique ; une pharmacie ne
// gère QUE son propre stock (pharmacyIdOf → 403 sinon).
// ─────────────────────────────────────────────────────────────
import { haversineKm, type StockStatus } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';

import { notFound } from '@/lib/errors.js';

/** Normalise un nom de médicament pour la recherche (minuscules, sans accents). */
export function normalizeMed(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Stock de la pharmacie courante. */
export async function listStock(app: FastifyInstance, pharmacyId: string) {
  return app.prisma.pharmacyStock.findMany({
    where: { pharmacyId },
    orderBy: { displayName: 'asc' },
    select: { id: true, displayName: true, status: true, price: true, updatedAt: true },
  });
}

/** Ajoute ou met à jour une ligne de stock (clé = pharmacie + nom normalisé). */
export async function upsertStock(
  app: FastifyInstance,
  pharmacyId: string,
  input: { displayName: string; status?: StockStatus; price?: number | null },
) {
  const medicationName = normalizeMed(input.displayName);
  return app.prisma.pharmacyStock.upsert({
    where: { pharmacyId_medicationName: { pharmacyId, medicationName } },
    create: { pharmacyId, medicationName, displayName: input.displayName.trim(), status: input.status ?? 'IN_STOCK', price: input.price ?? null },
    update: { displayName: input.displayName.trim(), ...(input.status ? { status: input.status } : {}), price: input.price ?? null },
    select: { id: true, displayName: true, status: true, price: true, updatedAt: true },
  });
}

/** Supprime une ligne de stock (de la pharmacie propriétaire uniquement). */
export async function removeStock(app: FastifyInstance, pharmacyId: string, id: string) {
  const { count } = await app.prisma.pharmacyStock.deleteMany({ where: { id, pharmacyId } });
  if (count === 0) throw notFound('Ligne de stock introuvable');
  return { removed: true };
}

/**
 * Recherche patient : pharmacies ayant le médicament (statut ≠ OUT). Si la
 * position du patient est fournie, calcule et TRIE par distance ; sinon tri par
 * statut (IN_STOCK avant LOW) puis récence. Renvoie au plus 30 résultats.
 */
export async function searchAvailability(
  app: FastifyInstance,
  input: { q: string; lat?: number; lng?: number },
) {
  const needle = normalizeMed(input.q);
  if (needle.length < 2) return { items: [] };

  const rows = await app.prisma.pharmacyStock.findMany({
    where: { status: { not: 'OUT' }, medicationName: { contains: needle } },
    take: 60,
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    select: {
      id: true,
      displayName: true,
      status: true,
      price: true,
      updatedAt: true,
      pharmacy: { select: { id: true, name: true, address: true, phone: true, geolat: true, geolong: true } },
    },
  });

  const hasPos = typeof input.lat === 'number' && typeof input.lng === 'number';
  const items = rows.map((r) => {
    const distanceKm =
      hasPos && r.pharmacy.geolat != null && r.pharmacy.geolong != null
        ? Math.round(haversineKm(input.lat!, input.lng!, r.pharmacy.geolat, r.pharmacy.geolong) * 10) / 10
        : null;
    return {
      id: r.id,
      displayName: r.displayName,
      status: r.status,
      price: r.price,
      updatedAt: r.updatedAt,
      pharmacy: { id: r.pharmacy.id, name: r.pharmacy.name, address: r.pharmacy.address, phone: r.pharmacy.phone },
      distanceKm,
    };
  });

  // Tri : par distance si connue (les sans-distance en fin), sinon l'ordre SQL.
  if (hasPos) {
    items.sort((a, b) => {
      if (a.distanceKm == null) return b.distanceKm == null ? 0 : 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm;
    });
  }
  return { items: items.slice(0, 30) };
}
