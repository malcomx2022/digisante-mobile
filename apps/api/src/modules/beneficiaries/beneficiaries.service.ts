// ─────────────────────────────────────────────────────────────
// Service Bénéficiaires : carnet des proches au Bénin gérés par la DIASPORA.
// ⚠️ Au-dessus de la logique de paiement GELÉE (§5) — aucune écriture FedaPay/wallet.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';

import { notFound } from '@/lib/errors.js';

interface BeneficiaryInput {
  name: string;
  relationship?: string;
  phone?: string;
  languagesSpoken?: string[];
  notes?: string;
}

const SELECT = {
  id: true,
  name: true,
  relationship: true,
  phone: true,
  languagesSpoken: true,
  notes: true,
  createdAt: true,
} as const;

/** Liste les proches du membre de la diaspora courant. */
export async function listMine(app: FastifyInstance, ownerId: string) {
  return app.prisma.beneficiary.findMany({ where: { ownerId }, select: SELECT, orderBy: { createdAt: 'asc' } });
}

/** Ajoute un proche. */
export async function addMine(app: FastifyInstance, ownerId: string, input: BeneficiaryInput) {
  return app.prisma.beneficiary.create({
    data: {
      ownerId,
      name: input.name,
      relationship: input.relationship ?? null,
      phone: input.phone ?? null,
      languagesSpoken: input.languagesSpoken ?? [],
      notes: input.notes ?? null,
    },
    select: SELECT,
  });
}

/** Vérifie la propriété d'un proche (sinon 404 — pas de fuite d'existence). */
async function assertOwned(app: FastifyInstance, ownerId: string, id: string) {
  const row = await app.prisma.beneficiary.findFirst({ where: { id, ownerId }, select: { id: true } });
  if (!row) throw notFound('Proche introuvable');
}

/** Met à jour un proche (propriété vérifiée). */
export async function updateMine(app: FastifyInstance, ownerId: string, id: string, input: BeneficiaryInput) {
  await assertOwned(app, ownerId, id);
  return app.prisma.beneficiary.update({
    where: { id },
    data: {
      name: input.name,
      relationship: input.relationship ?? null,
      phone: input.phone ?? null,
      languagesSpoken: input.languagesSpoken ?? [],
      notes: input.notes ?? null,
    },
    select: SELECT,
  });
}

/** Supprime un proche (propriété vérifiée). */
export async function removeMine(app: FastifyInstance, ownerId: string, id: string) {
  await assertOwned(app, ownerId, id);
  await app.prisma.beneficiary.delete({ where: { id } });
  return { id, deleted: true };
}
