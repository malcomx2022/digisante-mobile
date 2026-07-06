// Resolver des intégrations tierces (§3.6) : chiffrement au repos, base > .env,
// cache Redis invalidé à l'update, masquage. CI uniquement (DB + Redis).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { maskSecrets } from './integrations.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

describe('maskSecrets (unitaire)', () => {
  it('masque tout sauf les 4 derniers caractères ; « — » si absent', () => {
    const masked = maskSecrets({ authToken: 'sk_live_abcd1234', fromNumber: undefined, short: 'ab' });
    expect(masked.authToken).toBe('••••1234');
    expect(masked.fromNumber).toBe('—');
    expect(masked.short).toBe('••••');
    // Jamais la valeur en clair.
    expect(JSON.stringify(masked)).not.toContain('sk_live_abcd1234');
  });
});

describe.skipIf(!HAS_INFRA)('Resolver intégrations (intégration)', () => {
  let app: FastifyInstance;
  let integrations: typeof import('./integrations.js');

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    integrations = await import('./integrations.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.integrationConfig.deleteMany({});
    await app.redis.del('integration:TWILIO', 'integration:RESEND');
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.integrationConfig.deleteMany({});
    await app.redis.del('integration:TWILIO', 'integration:RESEND');
    await app.close();
  });

  it('enregistre (chiffré), résout depuis la base et masque — jamais de clair', async () => {
    await integrations.setIntegration(app, 'TWILIO', {
      secrets: { accountSid: 'AC_test_sid', authToken: 'super-secret-token-xyz', fromNumber: '+2290100000000' },
      updatedById: 'admin-1',
    });

    const resolved = await integrations.getIntegration(app, 'TWILIO');
    expect(resolved.source).toBe('db');
    expect(resolved.secrets.authToken).toBe('super-secret-token-xyz'); // round-trip (scellé → ouvert)
    expect(await integrations.isConfigured(app, 'TWILIO')).toBe(true);

    // Le secret est SCELLÉ en base : la colonne n'est pas le JSON clair des secrets.
    // (Le chiffrement AES-256 lui-même est couvert par crypto.test.ts ; en prod la
    //  clé est imposée hors test — §8 fail-safe.)
    const row = await app.prisma.integrationConfig.findUniqueOrThrow({ where: { provider: 'TWILIO' } });
    expect(row.secretsEnc).not.toBe(JSON.stringify(resolved.secrets));

    // Masquage : jamais la valeur complète (pour l'affichage admin).
    expect(maskSecrets(resolved.secrets).authToken).toBe('••••-xyz');
    expect(JSON.stringify(maskSecrets(resolved.secrets))).not.toContain('super-secret-token-xyz');
  });

  it('cache Redis invalidé à l’update (rotation prise en compte)', async () => {
    await integrations.setIntegration(app, 'TWILIO', { secrets: { authToken: 'v1-token' } });
    expect((await integrations.getIntegration(app, 'TWILIO')).secrets.authToken).toBe('v1-token'); // met en cache
    await integrations.setIntegration(app, 'TWILIO', { secrets: { authToken: 'v2-token' } }); // invalide
    expect((await integrations.getIntegration(app, 'TWILIO')).secrets.authToken).toBe('v2-token');
  });

  it('fallback .env quand aucune ligne en base', async () => {
    const resolved = await integrations.getIntegration(app, 'RESEND'); // aucune ligne créée
    expect(resolved.source).toBe('env');
  });
});
