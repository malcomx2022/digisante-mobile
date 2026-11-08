// Les fournisseurs sont simulés ; les rotations/purges utilisent PostgreSQL réel.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendPush } from '@/services/firebase.js';
import { dispatchPending } from './notifications.service.js';

vi.mock('@/services/firebase.js', () => ({ sendPush: vi.fn() }));

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290195300011', '+2290195300012'];

describe.skipIf(!HAS_INFRA)('Dispatch FCM — liaisons courantes (intégration)', () => {
  let app: FastifyInstance;
  let userId: string;
  let otherId: string;

  const pending = (recipientId: string, type: 'SOS_ALERT' | 'SYSTEM' = 'SYSTEM') => app.prisma.notification.create({
    data: { recipientId, type, channel: 'PUSH_FCM', title: 'Synthétique', body: 'Synthétique', status: 'PENDING' },
  });
  const currentToken = () => app.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fcmToken: true } });

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    const users = await Promise.all(PHONES.map((phone) => app.prisma.user.create({ data: { phone, role: 'PATIENT', status: 'ACTIVE' } })));
    [userId, otherId] = users.map((u) => u.id) as [string, string];
  });

  beforeEach(async () => {
    vi.mocked(sendPush).mockReset();
    await app.prisma.notification.deleteMany({ where: { recipientId: { in: [userId, otherId] } } });
    await app.prisma.user.update({ where: { id: userId }, data: { fcmToken: 'synthetic-old-device' } });
    await app.prisma.user.update({ where: { id: otherId }, data: { fcmToken: 'synthetic-priority-device' } });
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await app.close();
  });

  it('un token invalide encore courant est retiré sans valeur dans le journal', async () => {
    await pending(userId);
    vi.mocked(sendPush).mockResolvedValue({ delivered: false, stub: false, invalidToken: true });
    const warn = vi.spyOn(app.log, 'warn');
    try {
      await dispatchPending(app);
      expect(await currentToken()).toEqual({ fcmToken: null });
      expect(warn).toHaveBeenCalledWith({ userId }, '[FCM] token d’appareil invalide retiré');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('synthetic-old-device');
    } finally {
      warn.mockRestore();
    }
  });

  it('un rejet tardif de l’ancien token ne purge pas celui tourné pendant l’envoi', async () => {
    await pending(userId);
    vi.mocked(sendPush).mockImplementationOnce(async () => {
      await app.prisma.user.update({ where: { id: userId }, data: { fcmToken: 'synthetic-rotated-device' } });
      return { delivered: false, stub: false, invalidToken: true };
    });
    const warn = vi.spyOn(app.log, 'warn');
    try {
      await dispatchPending(app);
      expect(await currentToken()).toEqual({ fcmToken: 'synthetic-rotated-device' });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('un ancien binding dupliqué reste exclu des envois avant réinscription', async () => {
    await app.prisma.user.update({ where: { id: otherId }, data: { fcmToken: 'synthetic-old-device' } });
    await pending(userId);
    vi.mocked(sendPush).mockResolvedValue({ delivered: true, stub: false });
    await dispatchPending(app);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('relit le binding avant un push différé par une notification prioritaire', async () => {
    await pending(otherId, 'SOS_ALERT');
    await pending(userId);
    vi.mocked(sendPush).mockImplementationOnce(async () => {
      const token = app.jwt.sign({ sub: otherId, role: 'PATIENT' }, { expiresIn: '15m' });
      const res = await app.inject({
        method: 'POST', url: '/api/v1/users/me/device',
        headers: { authorization: `Bearer ${token}` }, payload: { fcmToken: 'synthetic-old-device' },
      });
      expect(res.statusCode).toBe(200);
      return { delivered: true, stub: false };
    }).mockResolvedValue({ delivered: false, stub: true });
    await dispatchPending(app);
    expect(vi.mocked(sendPush).mock.calls.map(([message]) => message.token)).toEqual(['synthetic-priority-device', null]);
  });

  it('miroir push d’une notification in-app : texte générique, jamais le contenu libre (§4)', async () => {
    await app.prisma.notification.create({
      data: { recipientId: userId, type: 'SYSTEM', channel: 'IN_APP', title: 'Rappel : Amoxicilline', body: 'Prendre Amoxicilline 500 mg', status: 'PENDING' },
    });
    vi.mocked(sendPush).mockResolvedValue({ delivered: true, stub: false });
    await dispatchPending(app);
    expect(sendPush).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(sendPush).mock.calls[0]![0];
    expect(sent.token).toBe('synthetic-old-device');
    expect(JSON.stringify([sent.title, sent.body])).not.toContain('Amoxicilline');
    const n = await app.prisma.notification.findFirstOrThrow({ where: { recipientId: userId } });
    expect(n.status).toBe('DELIVERED');
    expect(n.body).toBe('Prendre Amoxicilline 500 mg');
  });

  it('miroir push : aucun envoi sans appareil, et un échec push ne fait pas échouer l’in-app', async () => {
    await app.prisma.user.update({ where: { id: userId }, data: { fcmToken: null } });
    await app.prisma.notification.create({
      data: { recipientId: userId, type: 'APPOINTMENT_REMINDER', channel: 'IN_APP', title: 'RDV', body: 'demain', status: 'PENDING' },
    });
    await app.prisma.notification.create({
      data: { recipientId: otherId, type: 'CONSULTATION_START', channel: 'IN_APP', title: 'Salle', body: 'ouverte', status: 'PENDING' },
    });
    vi.mocked(sendPush).mockRejectedValue(new Error('fournisseur indisponible'));
    const res = await dispatchPending(app);
    expect(res.failed).toBe(0);
    expect(vi.mocked(sendPush).mock.calls.map(([m]) => m.token)).toEqual(['synthetic-priority-device']);
    const statuses = await app.prisma.notification.findMany({ where: { recipientId: { in: [userId, otherId] } }, select: { status: true } });
    expect(statuses.every((s) => s.status === 'DELIVERED')).toBe(true);
  });
});
