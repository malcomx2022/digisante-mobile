// Test d'intégration du portefeuille : le débit doit être atomique (pas de
// double-dépense sous concurrence) — non-régression du correctif P4 (audit CSO).
// CI uniquement (DATABASE_URL + REDIS_URL requis).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as wallet from './wallet.service.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONE = '+2290193400001';

describe.skipIf(!HAS_INFRA)('Wallet — débit atomique (intégration)', () => {
  let app: FastifyInstance;
  let userId: string;

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: PHONE } });
    const user = await app.prisma.user.create({
      data: {
        phone: PHONE,
        role: 'DIASPORA',
        status: 'ACTIVE',
        lang: 'FR',
        profile: { create: { firstName: 'Wal', lastName: 'Let' } },
        wallet: { create: { balance: 1000, currency: 'XOF' } },
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: PHONE } });
    await app.close();
  });

  it('refuse un débit supérieur au solde', async () => {
    await expect(wallet.debit(app, userId, { amount: 5000 })).rejects.toMatchObject({ statusCode: 400 });
    const w = await app.prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(Number(w.balance)).toBe(1000);
  });

  it('deux débits concurrents du solde entier : un seul réussit, jamais de solde négatif', async () => {
    // Solde = 1000 ; deux débits de 1000 lancés en parallèle. Sans garde atomique,
    // les deux liraient 1000 et le solde finirait à -1000.
    const results = await Promise.allSettled([
      wallet.debit(app, userId, { amount: 1000 }),
      wallet.debit(app, userId, { amount: 1000 }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const ko = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);

    const w = await app.prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(Number(w.balance)).toBe(0);
    // Une seule transaction de débit enregistrée (pas de double écriture).
    const debits = await app.prisma.walletTransaction.count({ where: { wallet: { userId }, type: 'DEBIT' } });
    expect(debits).toBe(1);
  });
});
