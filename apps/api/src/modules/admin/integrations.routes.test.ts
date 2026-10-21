// Tests d'intégration — API admin des intégrations tierces (§3.6, Lot B).
// Invariants vérifiés : secrets JAMAIS renvoyés en clair, écriture auditée SANS
// valeur, RBAC integrations:read/write, FedaPay gelé (§5). Exécutés si DB+Redis (CI).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290196700001', '+2290196700002']; // super-admin, admin restreint

// SUPER_ADMIN complet (inclut integrations:read/write) ; RESTRICTED ne les a pas.
const SUPER = [
  'admin:manage', 'users:read', 'users:write', 'kyc:review', 'ops:read',
  'finance:read', 'finance:write', 'support:write', 'otp:write',
  'webhooks:read', 'webhooks:replay', 'audit:read', 'audit:export', 'education:write',
  'integrations:read', 'integrations:write',
];
const RESTRICTED = ['users:read', 'audit:read'];

const TWILIO_TOKEN = 'super-secret-twilio-token-9999';

describe.skipIf(!HAS_INFRA)('Admin intégrations API (intégration)', () => {
  let app: FastifyInstance;
  let superToken: string;
  let restrictedToken: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  const cleanup = async () => {
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await app.prisma.integrationConfig.deleteMany({ where: { provider: { in: ['TWILIO', 'RESEND', 'FEDAPAY', 'DAILY'] } } });
    await app.redis.del('integration:TWILIO', 'integration:RESEND', 'integration:FEDAPAY', 'integration:DAILY');
  };

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const superAdmin = await app.prisma.user.create({
      data: {
        phone: PHONES[0], role: 'ADMIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Int', lastName: 'Super' } },
        adminProfile: { create: { scopes: SUPER, preset: 'SUPER_ADMIN' } },
      },
    });
    const restricted = await app.prisma.user.create({
      data: {
        phone: PHONES[1], role: 'ADMIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Int', lastName: 'Restr' } },
        adminProfile: { create: { scopes: RESTRICTED, preset: null } },
      },
    });
    superToken = app.jwt.sign({ sub: superAdmin.id, role: 'ADMIN' }, { expiresIn: '15m' });
    restrictedToken = app.jwt.sign({ sub: restricted.id, role: 'ADMIN' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('liste masquée des 5 providers (FedaPay inclus, gérable depuis le Lot E)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/integrations', headers: auth(superToken) });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ provider: string; frozen: boolean }>;
    const providers = items.map((i) => i.provider);
    expect(providers).toEqual(expect.arrayContaining(['FEDAPAY', 'TWILIO', 'DAILY', 'FIREBASE', 'RESEND']));
    // Lot E : plus aucun provider n'est gelé côté admin (FROZEN_PROVIDERS vide).
    expect(items.every((i) => i.frozen === false)).toBe(true);
  });

  it('RBAC : sans integrations:read → 403 ; sans integrations:write → 403', async () => {
    const read = await app.inject({ method: 'GET', url: '/api/v1/admin/integrations', headers: auth(restrictedToken) });
    expect(read.statusCode).toBe(403);
    const write = await app.inject({
      method: 'PUT', url: '/api/v1/admin/integrations/TWILIO', headers: auth(restrictedToken),
      payload: { secrets: { authToken: 'x' } },
    });
    expect(write.statusCode).toBe(403);
  });

  it('PUT enregistre les clés (chiffrées) et ne renvoie JAMAIS le secret en clair', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/v1/admin/integrations/TWILIO', headers: auth(superToken),
      payload: { secrets: { accountSid: 'AC_sid_test', authToken: TWILIO_TOKEN, fromNumber: '+2290100000000' }, meta: { region: 'bj' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe('db');
    expect(body.configured).toBe(true);
    // Secret masqué, jamais en clair (ni dans les secrets, ni ailleurs dans la réponse).
    expect(body.secrets.authToken).toBe('••••9999');
    expect(JSON.stringify(body)).not.toContain(TWILIO_TOKEN);
    expect(body.meta).toEqual({ region: 'bj' });

    // En base : le blob est SCELLÉ — ≠ JSON clair des secrets (marqueur `plain:` en
    // CI sans clé, chiffré AES-256 en prod). Le chiffrement au repos lui-même est
    // couvert par crypto.test.ts (§8 fail-safe : clé imposée hors `test`).
    const row = await app.prisma.integrationConfig.findUniqueOrThrow({ where: { provider: 'TWILIO' } });
    expect(row.secretsEnc).not.toBe(JSON.stringify({ accountSid: 'AC_sid_test', authToken: TWILIO_TOKEN, fromNumber: '+2290100000000' }));

    // Audit INTEGRATION_UPDATE écrit SANS la valeur (noms de clés uniquement).
    const audit = await app.prisma.auditLog.findFirst({ where: { action: 'INTEGRATION_UPDATE' }, orderBy: { createdAt: 'desc' } });
    expect(audit).not.toBeNull();
    const meta = (audit!.meta ?? {}) as { provider?: string; keys?: string[] };
    expect(meta.provider).toBe('TWILIO');
    expect(meta.keys).toEqual(['accountSid', 'authToken', 'fromNumber']);
    expect(JSON.stringify(audit!.meta)).not.toContain(TWILIO_TOKEN);
  });

  it('PUT rejette une clé inconnue pour le provider (400)', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/v1/admin/integrations/TWILIO', headers: auth(superToken),
      payload: { secrets: { bogusKey: 'x' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('Lot E : FedaPay est GÉRABLE via l’admin (PUT/test) ; journal webhooks en Finances', async () => {
    const SK = 'sk_live_fedapay_1234';
    const put = await app.inject({
      method: 'PUT', url: '/api/v1/admin/integrations/FEDAPAY', headers: auth(superToken),
      payload: { secrets: { secretKey: SK, publicKey: 'pk_live_x', webhookSecret: 'whsec_admin_9' } },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().configured).toBe(true);
    // Secret masqué, jamais en clair (même pour FedaPay).
    expect(put.json().secrets.secretKey).toBe('••••1234');
    expect(JSON.stringify(put.json())).not.toContain(SK);

    // Readiness OK (clés obligatoires présentes) — aucun appel réseau.
    const test = await app.inject({ method: 'POST', url: '/api/v1/admin/integrations/FEDAPAY/test', headers: auth(superToken) });
    expect(test.statusCode).toBe(200);
    expect(test.json().ok).toBe(true);

    // Le journal des webhooks FedaPay reste sous /admin/finance/webhooks (§5) → 400 ici.
    const wh = await app.inject({ method: 'GET', url: '/api/v1/admin/integrations/FEDAPAY/webhooks', headers: auth(superToken) });
    expect(wh.statusCode).toBe(400);

    // Nettoyage : retire la config FedaPay pour ne pas contaminer les tests paiement.
    await app.prisma.integrationConfig.deleteMany({ where: { provider: 'FEDAPAY' } });
    await app.redis.del('integration:FEDAPAY');
  });

  it('PATCH active/désactive une config existante + invalide le cache', async () => {
    const off = await app.inject({ method: 'PATCH', url: '/api/v1/admin/integrations/TWILIO', headers: auth(superToken), payload: { enabled: false } });
    expect(off.statusCode).toBe(200);
    expect(off.json().enabled).toBe(false);
    // Désactivé → plus « configured ».
    expect(off.json().configured).toBe(false);
    const on = await app.inject({ method: 'PATCH', url: '/api/v1/admin/integrations/TWILIO', headers: auth(superToken), payload: { enabled: true } });
    expect(on.json().enabled).toBe(true);
  });

  it('PATCH sur un provider sans config en base → 400', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/v1/admin/integrations/RESEND', headers: auth(superToken), payload: { enabled: true } });
    expect(res.statusCode).toBe(400);
  });

  it('test de complétude : TWILIO prêt (ok) ; DAILY incomplet (missing)', async () => {
    const twilio = await app.inject({ method: 'POST', url: '/api/v1/admin/integrations/TWILIO/test', headers: auth(superToken) });
    expect(twilio.statusCode).toBe(200);
    expect(twilio.json().ok).toBe(true);
    expect(twilio.json().missing).toEqual([]);

    // DAILY sans config DB ni .env en CI → incomplet, missing = ['apiKey'] (jamais de valeur).
    const daily = await app.inject({ method: 'POST', url: '/api/v1/admin/integrations/DAILY/test', headers: auth(superToken) });
    expect(daily.statusCode).toBe(200);
    if (!daily.json().ok) expect(daily.json().missing).toContain('apiKey');
  });

  // ── Lot D : webhooks ──
  it('PUT valide meta.webhookUrl (HTTPS) et accepte la clé webhookSecret', async () => {
    // URL non-HTTPS → 400.
    const bad = await app.inject({
      method: 'PUT', url: '/api/v1/admin/integrations/TWILIO', headers: auth(superToken),
      payload: { secrets: { accountSid: 'AC', authToken: 't', fromNumber: '+229' }, meta: { webhookUrl: 'http://insecure.example' } },
    });
    expect(bad.statusCode).toBe(400);

    // HTTPS OK + webhookSecret (émis par le provider) accepté et masqué.
    const ok = await app.inject({
      method: 'PUT', url: '/api/v1/admin/integrations/TWILIO', headers: auth(superToken),
      payload: {
        secrets: { accountSid: 'AC', authToken: 't', fromNumber: '+229', webhookSecret: 'whsec_twilio_5678' },
        meta: { webhookUrl: 'https://api.digisante.bj/webhooks/twilio' },
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().meta.webhookUrl).toBe('https://api.digisante.bj/webhooks/twilio');
    expect(ok.json().secrets.webhookSecret).toBe('••••5678');
    expect(JSON.stringify(ok.json())).not.toContain('whsec_twilio_5678');
  });

  it('journal webhooks : Twilio (activité config) ; FedaPay/Firebase refusés', async () => {
    const journal = await app.inject({ method: 'GET', url: '/api/v1/admin/integrations/TWILIO/webhooks', headers: auth(superToken) });
    expect(journal.statusCode).toBe(200);
    const data = journal.json().data as Array<{ action: string; kind: string; meta: unknown }>;
    // Les PUT/PATCH/test précédents sur TWILIO ont laissé des entrées de config.
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((e) => e.kind === 'config' || e.kind === 'webhook')).toBe(true);
    // Jamais de secret dans le journal.
    expect(JSON.stringify(data)).not.toContain('whsec_twilio_5678');

    // FedaPay (§5) et Firebase (sortant-seul) → pas de webhooks entrants gérés ici.
    const fedapay = await app.inject({ method: 'GET', url: '/api/v1/admin/integrations/FEDAPAY/webhooks', headers: auth(superToken) });
    expect(fedapay.statusCode).toBe(400);
    const firebase = await app.inject({ method: 'GET', url: '/api/v1/admin/integrations/FIREBASE/webhooks', headers: auth(superToken) });
    expect(firebase.statusCode).toBe(400);
  });

  it('journal webhooks : RBAC — sans integrations:read → 403', async () => {
    const denied = await app.inject({ method: 'GET', url: '/api/v1/admin/integrations/TWILIO/webhooks', headers: auth(restrictedToken) });
    expect(denied.statusCode).toBe(403);
  });

  // ── Audit prompt 5 (22/09/2026) : remplacement du jeu complet, atomicité, fuites ──
  it('PUT REMPLACE le jeu complet : une clé omise disparaît (readiness le signale)', async () => {
    const full = await app.inject({
      method: 'PUT', url: '/api/v1/admin/integrations/DAILY', headers: auth(superToken),
      payload: { secrets: { apiKey: 'daily-key-full-1111', domain: 'digisante.daily.co' } },
    });
    expect(full.statusCode).toBe(200);
    expect(full.json().secrets).toEqual({ apiKey: '••••1111', domain: '••••y.co' });

    const partial = await app.inject({
      method: 'PUT', url: '/api/v1/admin/integrations/DAILY', headers: auth(superToken),
      payload: { secrets: { apiKey: 'daily-key-rot-2222' } },
    });
    expect(partial.statusCode).toBe(200);
    expect(partial.json().secrets).toEqual({ apiKey: '••••2222' }); // `domain` n'existe plus
    const readiness = await app.inject({ method: 'POST', url: '/api/v1/admin/integrations/DAILY/test', headers: auth(superToken) });
    expect(readiness.json()).toEqual({ ok: false, missing: ['domain'] });
    await app.prisma.integrationConfig.delete({ where: { provider: 'DAILY' } });
    await app.redis.del('integration:DAILY');
  });

  it('PUT rejeté (clé inconnue mêlée à des clés valides) : AUCUNE écriture, config précédente intacte', async () => {
    const before = await app.prisma.integrationConfig.findUniqueOrThrow({ where: { provider: 'TWILIO' } });
    const res = await app.inject({
      method: 'PUT', url: '/api/v1/admin/integrations/TWILIO', headers: auth(superToken),
      payload: { secrets: { accountSid: 'AC_new', authToken: 'new-token-should-not-land', bogus: 'x' } },
    });
    expect(res.statusCode).toBe(400);
    const after = await app.prisma.integrationConfig.findUniqueOrThrow({ where: { provider: 'TWILIO' } });
    expect(after.secretsEnc).toBe(before.secretsEnc);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it('une réponse d’erreur ne renvoie JAMAIS la valeur soumise', async () => {
    const leaked = 'leaky-secret-value-7777';
    const invalid = await app.inject({
      method: 'PUT', url: '/api/v1/admin/integrations/TWILIO', headers: auth(superToken),
      payload: { secrets: { authToken: leaked, nope: leaked } },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).not.toContain(leaked);
    const tooLong = 'x'.repeat(8193);
    const oversized = await app.inject({
      method: 'PUT', url: '/api/v1/admin/integrations/TWILIO', headers: auth(superToken),
      payload: { secrets: { authToken: tooLong } },
    });
    expect(oversized.statusCode).toBe(422);
    expect(oversized.body).not.toContain(tooLong);
  });

  it('bascule dynamique : désactiver fait retomber le service en stub, réactiver le rétablit', async () => {
    const { resolveConfiguredSecrets } = await import('@/lib/integrations.js');
    await app.inject({
      method: 'PUT', url: '/api/v1/admin/integrations/TWILIO', headers: auth(superToken),
      payload: { secrets: { accountSid: 'AC_sid_test', authToken: TWILIO_TOKEN, fromNumber: '+2290100000000' } },
    });
    expect(await resolveConfiguredSecrets(app, 'TWILIO')).not.toBeNull();
    await app.inject({ method: 'PATCH', url: '/api/v1/admin/integrations/TWILIO', headers: auth(superToken), payload: { enabled: false } });
    expect(await resolveConfiguredSecrets(app, 'TWILIO')).toBeNull();
    await app.inject({ method: 'PATCH', url: '/api/v1/admin/integrations/TWILIO', headers: auth(superToken), payload: { enabled: true } });
    expect(await resolveConfiguredSecrets(app, 'TWILIO')).toMatchObject({ authToken: TWILIO_TOKEN });
  });

  // ── Recette L10, I2 : édition du domaine Daily ──
  it('DAILY : un nouveau domaine saisi est réellement stocké (relu en base, pas seulement masqué)', async () => {
    const { resolveConfiguredSecrets } = await import('@/lib/integrations.js');
    const put = (domain: string) => app.inject({
      method: 'PUT', url: '/api/v1/admin/integrations/DAILY', headers: auth(superToken),
      payload: { secrets: { apiKey: 'daily_key_synthetic_1234', domain } },
    });
    expect((await put('ancienne-equipe.daily.co')).statusCode).toBe(200);
    const res = await put('nouvelle-equipe.daily.co');
    expect(res.statusCode, res.body).toBe(200);
    // Le masque (4 derniers caractères) ne distingue pas les deux domaines : c'est la
    // relecture qui fait foi.
    expect(res.json().secrets.domain).toBe('••••y.co');
    expect(await resolveConfiguredSecrets(app, 'DAILY')).toMatchObject({ domain: 'nouvelle-equipe.daily.co' });
  });

  it('DAILY : une URL complète au lieu du sous-domaine est refusée (400) sans écriture', async () => {
    const { resolveConfiguredSecrets } = await import('@/lib/integrations.js');
    const res = await app.inject({
      method: 'PUT', url: '/api/v1/admin/integrations/DAILY', headers: auth(superToken),
      payload: { secrets: { apiKey: 'daily_key_synthetic_1234', domain: 'https://autre.daily.co/salle' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('domain');
    expect(await resolveConfiguredSecrets(app, 'DAILY')).toMatchObject({ domain: 'nouvelle-equipe.daily.co' });
  });

  it('écriture non retrouvée à la relecture : échec BRUYANT (500), sans audit ni valeur citée', async () => {
    const before = await app.prisma.auditLog.count({ where: { action: 'INTEGRATION_UPDATE' } });
    // Écriture perdue (simulée) : l'upsert ne persiste rien.
    const upsert = vi.spyOn(app.prisma.integrationConfig, 'upsert').mockResolvedValueOnce({} as never);
    try {
      const res = await app.inject({
        method: 'PUT', url: '/api/v1/admin/integrations/DAILY', headers: auth(superToken),
        payload: { secrets: { apiKey: 'daily_key_synthetic_1234', domain: 'perdue-equipe' } },
      });
      expect(upsert).toHaveBeenCalled();
      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('INTEGRATION_WRITE_UNVERIFIED');
      expect(res.body).not.toContain('perdue-equipe');
      expect(res.body).not.toContain('daily_key_synthetic_1234');
    } finally {
      upsert.mockRestore();
    }
    expect(await app.prisma.auditLog.count({ where: { action: 'INTEGRATION_UPDATE' } })).toBe(before);
    await app.prisma.integrationConfig.deleteMany({ where: { provider: 'DAILY' } });
    await app.redis.del('integration:DAILY');
  });
});
