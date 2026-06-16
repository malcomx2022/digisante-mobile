// Tests unitaires du service SOS — sans infra (prisma & twilio simulés).
// Couvre : alerte créée → contactNotified passe true ; notification SOS_ALERT
// créée ; envoi SMS appelé (au contact d'urgence). Twilio est mocké.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Env minimal pour permettre le chargement de @/lib/env (sinon process.exit).
beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://u:p@localhost:5434/test';
  process.env.REDIS_URL ??= 'redis://localhost:6380';
  process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret';
});

// Mock du service Twilio : on observe les appels et renvoie un stub « livré ».
const sendSmsMock = vi.fn((_opts: { to: string; lang: string }) =>
  Promise.resolve({ delivered: false, stub: true }),
);
vi.mock('@/services/twilio.js', () => ({
  sendSms: (opts: { to: string; lang: string }) => sendSmsMock(opts),
}));

// Mock de l'audit (pas de DB) : on vérifie juste qu'il est appelé sans crasher.
const writeAuditMock = vi.fn((_prisma: unknown, _entry: unknown) => Promise.resolve());
vi.mock('@/lib/audit.js', () => ({
  writeAudit: (prisma: unknown, entry: unknown) => writeAuditMock(prisma, entry),
}));

// Fabrique un faux `app` (prisma + log) suffisant pour le service.
function makeApp(opts: { emergencyContact: string | null }) {
  const created: { sos?: Record<string, unknown>; notification?: Record<string, unknown> } = {};
  const sosRow = { id: 'sos_1', contactNotified: false, status: 'ACTIVE' };

  const prisma = {
    sos: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.sos = data;
        return { ...sosRow, ...data };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...sosRow, ...data })),
    },
    patient: {
      findUnique: vi.fn(async () => ({
        userId: 'user_1',
        user: { lang: 'FON', profile: { emergencyContact: opts.emergencyContact } },
      })),
    },
    notification: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.notification = data;
        return { id: 'notif_1', ...data };
      }),
    },
  };

  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { app: { prisma, log } as unknown as Parameters<typeof import('./sos.service.js').triggerSos>[0], prisma, created };
}

describe('triggerSos', () => {
  beforeEach(() => {
    sendSmsMock.mockClear();
    writeAuditMock.mockClear();
  });

  it("crée l'alerte, prévient le contact d'urgence et passe contactNotified à true", async () => {
    const { triggerSos } = await import('./sos.service.js');
    const { app, prisma } = makeApp({ emergencyContact: '+2290190000000' });

    const result = await triggerSos(app, { patientId: 'pat_1', latitude: 6.36, longitude: 2.42 });

    // alerte créée
    expect(prisma.sos.create).toHaveBeenCalledOnce();
    // SMS envoyé au contact d'urgence
    expect(sendSmsMock).toHaveBeenCalled();
    expect(sendSmsMock.mock.calls[0]?.[0]).toMatchObject({ to: '+2290190000000', lang: 'FON' });
    // notification SOS_ALERT créée
    expect(prisma.notification.create).toHaveBeenCalledOnce();
    const notifArg = prisma.notification.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(notifArg.data).toMatchObject({ type: 'SOS_ALERT', recipientId: 'user_1' });
    // contactNotified passé à true
    expect(prisma.sos.update).toHaveBeenCalled();
    expect(result.contactNotified).toBe(true);
    // audit journalisé
    expect(writeAuditMock).toHaveBeenCalled();
  });

  it("notifie quand même (via notification in-app) sans contact d'urgence", async () => {
    const { triggerSos } = await import('./sos.service.js');
    const { app, prisma } = makeApp({ emergencyContact: null });

    const result = await triggerSos(app, { patientId: 'pat_1', latitude: 6.36, longitude: 2.42 });

    // pas de contact d'urgence ni numéro public → aucun SMS
    expect(sendSmsMock).not.toHaveBeenCalled();
    // mais la notification in-app est créée → notified = true
    expect(prisma.notification.create).toHaveBeenCalledOnce();
    expect(result.contactNotified).toBe(true);
  });

  it("SMS SOS dans la langue du patient (FR/EN/FON)", async () => {
    const { sosSmsBody } = await import('./sos.service.js');
    expect(sosSmsBody('FR', 1, 2)).toContain('URGENCE');
    expect(sosSmsBody('EN', 1, 2)).toContain('EMERGENCY');
    expect(sosSmsBody('FON', 1, 2)).toContain('ADANDÓ');
    // langue sans gabarit → repli FR
    expect(sosSmsBody('DENDI', 1, 2)).toContain('URGENCE');
  });
});
