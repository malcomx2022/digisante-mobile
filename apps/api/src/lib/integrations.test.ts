// Resolver des intégrations tierces (§3.6) : chiffrement au repos, base > .env,
// cache Redis invalidé à l'update, masquage. CI uniquement (DB + Redis).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_PRESETS } from '@digisante/shared';

import { maskSecrets, validateSecretsShape } from './integrations.js';

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

describe('validateSecretsShape (unitaire)', () => {
  const PEM = '-----BEGIN PRIVATE KEY-----\\nMIIEv…\\n-----END PRIVATE KEY-----\\n';
  it('Firebase : compte de service, clé PEM (\\n littéraux acceptés) et projectId valides', () => {
    expect(validateSecretsShape('FIREBASE', { projectId: 'digisante-prod', clientEmail: 'fcm@digisante-prod.iam.gserviceaccount.com', privateKey: PEM })).toEqual([]);
  });
  it('Firebase : formats erronés signalés SANS reprendre la valeur', () => {
    const errors = validateSecretsShape('FIREBASE', { projectId: 'Digi Santé', clientEmail: 'moi@gmail.com', privateKey: 'AIzaSy-secret-api-key' });
    expect(errors).toHaveLength(3);
    expect(errors.join(' ')).not.toContain('AIzaSy-secret-api-key');
    expect(errors.join(' ')).not.toContain('moi@gmail.com');
  });
  it('Resend : clé re_… et expéditeur « adresse » ou « Nom <adresse> »', () => {
    expect(validateSecretsShape('RESEND', { apiKey: 're_AbCdEf123456_xyz', fromEmail: 'DigiSanté <no-reply@digisante.bj>' })).toEqual([]);
    expect(validateSecretsShape('RESEND', { fromEmail: 'no-reply@digisante.bj' })).toEqual([]);
    const errors = validateSecretsShape('RESEND', { apiKey: 'sk_live_wrong_provider', fromEmail: 'digisante.bj' });
    expect(errors).toHaveLength(2);
    expect(errors.join(' ')).not.toContain('sk_live_wrong_provider');
  });
  it('autres providers : aucun contrôle de forme (FedaPay §5 inclus)', () => {
    expect(validateSecretsShape('FEDAPAY', { secretKey: 'x' })).toEqual([]);
    expect(validateSecretsShape('TWILIO', { accountSid: 'x' })).toEqual([]);
  });
});

describe('scopes integrations:* (unitaire)', () => {
  it('seul le preset SUPER_ADMIN porte integrations:read/write (§3.6 ④)', () => {
    const holders = Object.entries(ADMIN_PRESETS)
      .filter(([, scopes]) => (scopes as readonly string[]).some((s) => s.startsWith('integrations:')))
      .map(([name]) => name);
    expect(holders).toEqual(['SUPER_ADMIN']);
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

  // ── Lot C : resolveConfiguredSecrets (bascule stub↔réel des services) ──
  it('resolveConfiguredSecrets : complet → secrets ; incomplet/désactivé → null', async () => {
    // Config Twilio COMPLÈTE (accountSid + authToken + fromNumber) → secrets résolus.
    await integrations.setIntegration(app, 'TWILIO', {
      secrets: { accountSid: 'AC_sid', authToken: 'tok', fromNumber: '+2290100000000' },
    });
    const full = await integrations.resolveConfiguredSecrets(app, 'TWILIO');
    expect(full?.authToken).toBe('tok');

    // INCOMPLET (fromNumber manquant) → null (le service reste en stub).
    await integrations.setIntegration(app, 'TWILIO', { secrets: { accountSid: 'AC_sid', authToken: 'tok' } });
    expect(await integrations.resolveConfiguredSecrets(app, 'TWILIO')).toBeNull();

    // DÉSACTIVÉ (enabled=false) → null même si les clés sont présentes.
    await integrations.setIntegration(app, 'TWILIO', {
      secrets: { accountSid: 'AC_sid', authToken: 'tok', fromNumber: '+2290100000000' },
      enabled: false,
    });
    expect(await integrations.resolveConfiguredSecrets(app, 'TWILIO')).toBeNull();

    // Aucune config + `.env` vide en CI → null (RESEND).
    expect(await integrations.resolveConfiguredSecrets(app, 'RESEND')).toBeNull();
  });

  it('ligne illisible : provider NON configuré, sans repli .env ni 500, signalée `unreadable`', async () => {
    await app.prisma.integrationConfig.upsert({
      where: { provider: 'RESEND' },
      create: { provider: 'RESEND', secretsEnc: 'blob:corrompu', enabled: true },
      update: { secretsEnc: 'blob:corrompu', enabled: true },
    });
    await integrations.invalidateIntegration(app, 'RESEND');
    const r = await integrations.getIntegration(app, 'RESEND');
    expect(r).toMatchObject({ source: 'db', enabled: false, unreadable: true, secrets: {} });
    expect(await integrations.resolveConfiguredSecrets(app, 'RESEND')).toBeNull();
    const view = await integrations.describeIntegration(app, 'RESEND');
    expect(view).toMatchObject({ configured: false, unreadable: true, source: 'db' });
    await app.prisma.integrationConfig.delete({ where: { provider: 'RESEND' } });
    await integrations.invalidateIntegration(app, 'RESEND');
  });
});
