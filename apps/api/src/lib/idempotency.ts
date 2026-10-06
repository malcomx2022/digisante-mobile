// L3 : contrôle courant + effet métier + reçu scellé dans UNE transaction DB.
import { createHmac } from 'node:crypto';

import { MUTATION_CLOCK_SKEW_MS, MUTATION_MAX_AGE_MS, MUTATION_RECEIPT_TTL_MS, isReplayableMutation, mutationKeyTime } from '@digisante/shared';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { canonicalJson } from './audit.js';
import { decryptWithKey, deriveKey, encryptWithKey } from './crypto.js';
import { env } from './env.js';
import { AppError, badRequest, conflict, forbidden, unauthorized } from './errors.js';

// Séparation d'usage de la clé santé ; fallback synthétique exclusivement en test.
const secret = env.HEALTH_ENCRYPTION_KEY ?? (env.NODE_ENV === 'test' ? 'synthetic-test-only-mutation-receipts' : undefined);
if (!secret) throw new Error('HEALTH_ENCRYPTION_KEY requise pour les reçus');
const KEY = deriveKey(`digisante-mutation-receipts-v1:${secret}`);

export async function mutateOnce<T>(app: FastifyInstance, request: FastifyRequest, options: {
  path: string;
  status?: number;
  roles?: readonly string[];
  authorize: (tx: Prisma.TransactionClient, replayed: boolean, resourceId: string | null) => Promise<void>;
  resourceId?: (value: NoInfer<T>) => string;
  execute: (tx: Prisma.TransactionClient) => Promise<T>;
}): Promise<{ value: T; replayed: boolean }> {
  const method = request.method;
  if (!isReplayableMutation(method, options.path)) throw badRequest('Route hors contrat de rejeu');
  const header = request.headers['idempotency-key'];
  let key: string | undefined;
  if (header !== undefined) {
    if (typeof header !== 'string') throw badRequest('Idempotency-Key invalide');
    const createdAt = mutationKeyTime(header);
    if (createdAt === null) throw new AppError('INVALID_MUTATION_KEY', 'Clé de mutation v1 requise', 400);
    const age = Date.now() - createdAt;
    if (age > MUTATION_MAX_AGE_MS) throw new AppError('MUTATION_EXPIRED', 'Mutation trop ancienne ; revue manuelle requise', 410);
    if (age < -MUTATION_CLOCK_SKEW_MS) throw new AppError('MUTATION_CLOCK_INVALID', 'Horloge de mutation invalide', 400);
    key = header.toLowerCase();
  }
  const requestHash = createHmac('sha256', KEY).update(JSON.stringify(canonicalJson(request.body ?? null))).digest('hex');
  return app.prisma.$transaction(async (tx) => {
    // Sérialise deux workers/onglets et une suspension gagnante au verrou User.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${request.user.sub} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: request.user.sub }, select: { role: true, status: true } });
    if (!user || user.status === 'SUSPENDED') throw unauthorized('Session révoquée');
    if (options.roles && !options.roles.includes(user.role)) throw forbidden('Rôle courant non autorisé');
    request.user.role = user.role; // rôle revalidé sous verrou, utilisé par les contrôles métier
    const scope = key ? { userId: request.user.sub, method, route: options.path, key } : undefined;
    const receipt = scope ? await tx.mutationReceipt.findUnique({ where: { userId_method_route_key: scope } }) : null;
    // Chaque rejeu repasse le contrôle d'appartenance, AVANT de déchiffrer.
    await options.authorize(tx, Boolean(receipt), receipt?.resourceId ?? null);
    if (receipt) {
      if (receipt.requestHash !== requestHash) throw conflict('Clé déjà utilisée avec un autre contenu');
      return { value: decryptWithKey(KEY, receipt.encryptedResponse) as T, replayed: true };
    }
    const value = await options.execute(tx);
    if (scope) {
      await tx.mutationReceipt.create({ data: { ...scope, requestHash, responseStatus: options.status ?? 200,
        encryptedResponse: encryptWithKey(KEY, value), resourceId: options.resourceId?.(value), expiresAt: new Date(Date.now() + MUTATION_RECEIPT_TTL_MS) } });
    }
    return { value, replayed: false };
  });
}
