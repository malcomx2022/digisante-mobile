// ─────────────────────────────────────────────────────────────
// Admin — ops / monitoring (LECTURE SEULE — santé système, §4 : aucun médical).
// Pouls du back-office : infra (Redis/DB/uptime), files de notifications, jobs
// cron (réconciliation, rappels), événements sécurité/ops sur 24 h.
// (Sous-module de /api/v1/admin — cf. admin.routes.ts.)
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';

import { isConfigured } from '@/lib/integrations.js';

import { adminGuards } from './admin.shared.js';

// Événements de sécurité/ops surveillés sur 24 h (pouls du système).
const OPS_EVENTS = ['AUTH_FAIL', 'AUTH_LOCKOUT', 'DMP_DENIED', 'SOS_ALERT', 'LAB_CRITICAL', 'PAYMENT_REFUND', 'OTP_RESET'] as const;

export default async function adminOpsRoutes(app: FastifyInstance) {
  const { withScope } = adminGuards(app);

  app.get('/ops/health', withScope('ops:read'), async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recThreshold = new Date(Date.now() - 60 * 60 * 1000);

    // Sondes infra (tolérantes : une panne ne fait pas échouer la page).
    const redisUp = await app.redis.ping().then((r) => r === 'PONG').catch(() => false);
    const dbUp = await app.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    // §5/Lot E : configuration FedaPay résolue dynamiquement (base chiffrée → `.env`).
    const fedapayConfigured = await isConfigured(app, 'FEDAPAY').catch(() => false);

    const [notifByStatus, sentLast24h, reconBacklog, medAgg, apptAgg, events] = await Promise.all([
      app.prisma.notification.groupBy({ by: ['status'], _count: { _all: true } }),
      app.prisma.notification.count({ where: { status: { in: ['SENT', 'DELIVERED'] }, sentAt: { gte: since } } }),
      app.prisma.payment.count({ where: { status: 'PENDING', createdAt: { lt: recThreshold }, fedapayId: { not: null } } }),
      app.prisma.medicationReminder.aggregate({ _max: { lastGeneratedOn: true } }),
      app.prisma.appointment.aggregate({ _max: { reminderSentAt: true } }),
      app.prisma.auditLog.groupBy({ by: ['action'], where: { createdAt: { gte: since }, action: { in: [...OPS_EVENTS] } }, _count: { _all: true } }),
    ]);

    const byStatus = Object.fromEntries(notifByStatus.map((n) => [n.status, n._count._all]));
    return {
      infra: { redis: redisUp ? 'up' : 'down', db: dbUp ? 'up' : 'down', uptimeSeconds: Math.round(process.uptime()), fedapayConfigured },
      notifications: {
        byStatus: notifByStatus.map((n) => ({ status: n.status, count: n._count._all })),
        pending: byStatus.PENDING ?? 0,
        failed: byStatus.FAILED ?? 0,
        sentLast24h,
      },
      jobs: {
        reconciliationBacklog: reconBacklog,
        medicationLastGeneratedAt: medAgg._max.lastGeneratedOn,
        appointmentLastReminderAt: apptAgg._max.reminderSentAt,
      },
      events24h: OPS_EVENTS.map((action) => ({ action, count: events.find((e) => e.action === action)?._count._all ?? 0 })),
    };
  });
}
