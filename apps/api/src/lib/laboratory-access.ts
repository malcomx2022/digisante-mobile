// Le verrou User sérialise habilitation, actes laboratoire et suspension admin.
// Garder ce verrou pendant la lecture/écriture : pas de contrôle hors transaction.
import type { Prisma } from '@prisma/client';

import { forbidden } from './errors.js';

export async function lockLaboratoryAccount(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: userId }, include: { lab: true } });
  if (!user || user.role !== 'LABORATOIRE' || !user.lab) throw forbidden('Profil laboratoire requis');
  return user;
}

export async function authorizedLaboratory(tx: Prisma.TransactionClient, userId: string) {
  const user = await lockLaboratoryAccount(tx, userId);
  if (user.status !== 'ACTIVE' || !user.lab!.verifiedAt) {
    throw forbidden('Laboratoire approuvé et actif requis');
  }
  return user.lab!;
}
