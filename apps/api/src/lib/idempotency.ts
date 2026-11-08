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
// v1 (lecture seule des reçus existants, ≤ 14 j) : une même clé servait au HMAC du
// corps et à l'AES-GCM de la réponse, sans données associées. v2 : sous-clés
// distinctes par usage, et réponse liée à l'identité de mutation (AAD) — un
// chiffré recopié vers un autre reçu ne se déchiffre plus.
const LEGACY_KEY = deriveKey(`digisante-mutation-receipts-v1:${secret}`);
const HMAC_KEY = deriveKey(`digisante-mutation-receipts-v2:hmac:${secret}`);
const AES_KEY = deriveKey(`digisante-mutation-receipts-v2:aes:${secret}`);
const V2 = 'v2:';

type ReceiptScope = { userId: string; method: string; route: string; key: string };
const receiptAad = (s: ReceiptScope) => `digisante-receipt-v2|${s.userId}|${s.method}|${s.route}|${s.key}`;
const bodyHash = (key: Buffer, body: unknown) => createHmac('sha256', key).update(JSON.stringify(canonicalJson(body ?? null))).digest('hex');

/** Scelle une réponse (v2 : sous-clé AES dédiée + AAD de l'identité). */
export function sealReceiptResponse(scope: ReceiptScope, value: unknown): string {
  return V2 + encryptWithKey(AES_KEY, value, receiptAad(scope));
}

/** Ouvre une réponse scellée, v2 ou héritée v1. */
export function openReceiptResponse(scope: ReceiptScope, sealed: string): unknown {
  return sealed.startsWith(V2) ? decryptWithKey(AES_KEY, sealed.slice(V2.length), receiptAad(scope)) : decryptWithKey(LEGACY_KEY, sealed);
}

/** Empreinte du corps selon la version du reçu comparé. */
export function receiptRequestHash(body: unknown, version: 'v1' | 'v2' = 'v2'): string {
  return bodyHash(version === 'v2' ? HMAC_KEY : LEGACY_KEY, body);
}

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
  const requestHash = receiptRequestHash(request.body);
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
      const v2 = receipt.encryptedResponse.startsWith(V2);
      const expected = v2 ? requestHash : receiptRequestHash(request.body, 'v1');
      if (receipt.requestHash !== expected) throw conflict('Clé déjà utilisée avec un autre contenu');
      return { value: openReceiptResponse(scope as ReceiptScope, receipt.encryptedResponse) as T, replayed: true };
    }
    const value = await options.execute(tx);
    if (scope) {
      await tx.mutationReceipt.create({ data: { ...scope, requestHash, responseStatus: options.status ?? 200,
        encryptedResponse: sealReceiptResponse(scope, value), resourceId: options.resourceId?.(value), expiresAt: new Date(Date.now() + MUTATION_RECEIPT_TTL_MS) } });
    }
    return { value, replayed: false };
  });
}

/** Vérification sans corps sauvegardé côté navigateur : lecture seulement, jamais d'effet. */
export async function inspectReceipt(app: FastifyInstance, request: FastifyRequest, scope: { method?: string; route?: string; key: string }, authorize: (tx: Prisma.TransactionClient, receipt: { route: string; method: string; resourceId: string | null }) => Promise<void>) {
  if (mutationKeyTime(scope.key) === null || (scope.method && (!scope.route || !isReplayableMutation(scope.method, scope.route)))) throw badRequest('Identité de mutation invalide');
  return app.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${request.user.sub} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: request.user.sub }, select: { status: true, role: true } });
    if (!user || user.status === 'SUSPENDED') throw unauthorized('Session révoquée');
    request.user.role = user.role;
    const receipts = await tx.mutationReceipt.findMany({ where: { userId: request.user.sub, ...scope, key: scope.key.toLowerCase(), expiresAt: { gt: new Date() } }, take: 2 });
    if (!receipts.length) return null;
    if (receipts.length !== 1) throw conflict('Identité ambiguë ; revue manuelle requise');
    const receipt = receipts[0];
    if (!isReplayableMutation(receipt.method, receipt.route)) throw badRequest('Reçu hors contrat');
    await authorize(tx, receipt);
    return { confirmed: true, status: receipt.responseStatus }; // aucun contenu clinique retourné
  });
}
