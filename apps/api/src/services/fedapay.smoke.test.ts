// ─────────────────────────────────────────────────────────────
// PRÉFLIGHT FEDAPAY SANDBOX (opt-in) — AUCUNE transaction créée, AUCUNE logique
// de paiement touchée (§5). Contrôle la configuration telle que la production la
// résoudra (base chiffrée → `.env`), sans jamais afficher une valeur :
//   • clé secrète + publique + secret webhook présents ;
//   • environnement DÉDUIT de la clé = sandbox (une clé live est REFUSÉE ici) ;
//   • URL de webhook déclarée (meta) en HTTPS et pointant /api/v1/payments/webhook ;
//   • la clé est acceptée par l'API sandbox (lecture seule : liste de transactions).
//
//   SMOKE_FEDAPAY=1 pnpm --filter @digisante/api test:smoke -- fedapay
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertFedapaySandbox, requestFedapaySandbox } from '../../../../scripts/preproduction/smoke-guard.mjs';

const ENABLED = process.env.SMOKE_FEDAPAY === '1';

describe.skipIf(!ENABLED)('PRÉFLIGHT FedaPay sandbox (opt-in, lecture seule)', () => {
  let app: FastifyInstance;
  let secrets: Record<string, string | undefined> = {};
  let meta: Record<string, unknown> | null = null;

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    const { getIntegration } = await import('@/lib/integrations.js');
    const r = await getIntegration(app, 'FEDAPAY');
    secrets = r.secrets;
    meta = r.meta;
    // Une assertion dans un it n'empêche pas les it suivants de faire un appel live.
    // Refus fatal dans le hook ET contrôle répété juste avant tout appel réseau.
    assertFedapaySandbox(r);
    // eslint-disable-next-line no-console -- sortie destinée à l’opérateur de recette
    console.info(`[preflight:fedapay] source=${r.source} · activé=${r.enabled} · clés présentes=${Object.entries(secrets).filter(([, v]) => Boolean(v)).map(([k]) => k).sort().join(',') || 'aucune'}`);
  });
  afterAll(async () => app?.close());

  it('secretKey, publicKey et webhookSecret sont résolus (base chiffrée ou .env)', () => {
    expect(Boolean(secrets.secretKey), 'secretKey absente').toBe(true);
    expect(Boolean(secrets.publicKey), 'publicKey absente').toBe(true);
    expect(Boolean(secrets.webhookSecret), 'webhookSecret absent — tous les webhooks seraient rejetés en 401').toBe(true);
  });

  it('environnement déduit de la clé = SANDBOX (clé live refusée à ce stade)', async () => {
    const { fedapayEnvironment } = await import('./fedapay.js');
    expect(fedapayEnvironment(secrets.secretKey ?? ''), 'clé LIVE détectée : recette sandbox d’abord (prompt 10), bascule = prompt 11').toBe('sandbox');
  });

  it('URL de webhook déclarée en HTTPS vers /api/v1/payments/webhook (si renseignée)', () => {
    const url = meta?.webhookUrl;
    if (url === undefined || url === null || url === '') return; // facultatif côté admin
    expect(String(url)).toMatch(/^https:\/\/[^/]+\/api\/v1\/payments\/webhook$/);
  });

  it('la clé secrète est acceptée par l’API sandbox (lecture seule)', async () => {
    const res = await requestFedapaySandbox(secrets);
    // eslint-disable-next-line no-console -- sortie destinée à l’opérateur de recette
    console.info(`[preflight:fedapay] API sandbox HTTP ${res.status}`);
    expect(res.status, 'clé refusée par FedaPay (401/403) ou API indisponible').toBe(200);
  });
});
