// L'appareil partagé doit appartenir à un seul compte, même entre workers.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = Array.from({ length: 6 }, (_, i) => `+229019530000${i + 1}`);

describe.skipIf(!HAS_INFRA)('Appareils FCM — propriété exclusive (intégration)', () => {
  let app: FastifyInstance;
  let users: { id: string; token: string }[];

  const register = (index: number, fcmToken: string) => app.inject({
    method: 'POST', url: '/api/v1/users/me/device',
    headers: { authorization: `Bearer ${users[index]!.token}` },
    payload: { fcmToken },
  });
  const device = (index: number) => app.prisma.user.findUniqueOrThrow({
    where: { id: users[index]!.id }, select: { fcmToken: true },
  });

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    users = await Promise.all(PHONES.map(async (phone) => {
      const user = await app.prisma.user.create({ data: { phone, role: 'PATIENT', status: 'ACTIVE' } });
      return { id: user.id, token: app.jwt.sign({ sub: user.id, role: 'PATIENT' }, { expiresIn: '15m' }) };
    }));
  });

  beforeEach(async () => {
    await app.prisma.user.updateMany({ where: { phone: { in: PHONES } }, data: { fcmToken: null, status: 'ACTIVE' } });
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await app.close();
  });

  it('change de compte sans logout : retire la liaison du précédent propriétaire', async () => {
    expect((await register(0, 'synthetic-shared-device')).statusCode).toBe(200);
    expect((await register(2, 'synthetic-unrelated-device')).statusCode).toBe(200);
    const response = await register(1, 'synthetic-shared-device');
    expect(response.statusCode).toBe(200);
    expect(await device(0)).toEqual({ fcmToken: null });
    expect(await device(1)).toEqual({ fcmToken: 'synthetic-shared-device' });
    expect(await device(2)).toEqual({ fcmToken: 'synthetic-unrelated-device' });
  });

  it('retire toutes les anciennes liaisons dupliquées et accepte une réinscription', async () => {
    await app.prisma.user.updateMany({
      where: { id: { in: [users[0]!.id, users[2]!.id] } }, data: { fcmToken: 'synthetic-legacy-device' },
    });
    expect((await register(1, 'synthetic-legacy-device')).statusCode).toBe(200);
    expect((await register(1, 'synthetic-legacy-device')).statusCode).toBe(200);
    const owners = await app.prisma.user.findMany({ where: { fcmToken: 'synthetic-legacy-device' }, select: { id: true } });
    expect(owners).toEqual([{ id: users[1]!.id }]);
  });

  it('six inscriptions simultanées du même appareil ne gardent qu’un propriétaire', async () => {
    const results = await Promise.all(users.map((_, index) => register(index, 'synthetic-concurrent-device')));
    expect(results.map((r) => r.statusCode)).toEqual(Array(6).fill(200));
    const owners = await app.prisma.user.findMany({ where: { fcmToken: 'synthetic-concurrent-device' }, select: { id: true } });
    expect(owners).toHaveLength(1);
    expect(users.map((u) => u.id)).toContain(owners[0]!.id);
  });

  it('deux rotations croisées conservent les nouvelles liaisons sans deadlock', async () => {
    await register(0, 'synthetic-device-a');
    await register(1, 'synthetic-device-b');
    const results = await Promise.all([register(0, 'synthetic-device-b'), register(1, 'synthetic-device-a')]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(await device(0)).toEqual({ fcmToken: 'synthetic-device-b' });
    expect(await device(1)).toEqual({ fcmToken: 'synthetic-device-a' });
  });

  it('une suspension committée pendant l’attente DB interdit le transfert', async () => {
    await register(0, 'synthetic-suspended-transfer');
    let response: ReturnType<typeof register> | undefined;
    await app.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${users[1]!.id} FOR UPDATE`;
      response = register(1, 'synthetic-suspended-transfer').then((result) => result);
      // L'authentification lit l'ancien état actif ; la mutation attend le verrou
      // de ligne. On attend cette contention réelle avant de suspendre le compte.
      const deadline = Date.now() + 5_000;
      let waiting = false;
      while (!waiting && Date.now() < deadline) {
        const rows = await app.prisma.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND state = 'active' AND wait_event_type = 'Lock'
          ) AS waiting`;
        waiting = rows[0]!.waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await tx.user.update({ where: { id: users[1]!.id }, data: { status: 'SUSPENDED' } });
    }, { timeout: 10_000 });
    expect((await response!).statusCode).toBe(401);
    expect(await device(0)).toEqual({ fcmToken: 'synthetic-suspended-transfer' });
    expect(await device(1)).toEqual({ fcmToken: null });
  });
});
