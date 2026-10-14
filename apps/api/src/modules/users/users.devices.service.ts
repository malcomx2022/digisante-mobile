import { Prisma, type UserStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { unauthorized } from '@/lib/errors.js';

/** Transfère atomiquement l'appareil au compte courant, y compris entre workers. */
export async function registerDevice(app: FastifyInstance, userId: string, fcmToken: string) {
  return app.prisma.$transaction(async (tx) => {
    // Verrou global distinct des verrous audit/finance : les rotations croisées
    // peuvent modifier deux comptes. Des verrous par token créeraient un cycle
    // de verrous de lignes. Aucun token ne passe dans le SQL de ce verrou.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(4021959)`;
    const [user] = await tx.$queryRaw<{ status: UserStatus }[]>`
      SELECT status FROM users WHERE id = ${userId} FOR UPDATE`;
    // Relecture après l'attente du verrou : l'authentification seule ne protège
    // pas d'une suspension/suppression concurrente, avant le commit.
    if (!user || user.status === 'SUSPENDED') {
      throw unauthorized('Session révoquée. Contactez le support.');
    }

    await tx.user.updateMany({
      where: { fcmToken, id: { not: userId } },
      data: { fcmToken: null },
    });
    return tx.user.update({
      where: { id: userId },
      data: { fcmToken },
      select: { id: true, role: true, fcmToken: true },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 });
}
