// ─────────────────────────────────────────────────────────────
// RECETTE S8 FEDAPAY SANDBOX (opt-in) — hôte EXACT du lien de paiement (B1).
// Crée UNE transaction bac à sable de 100 XOF, JAMAIS payée, demande son lien, puis
// s'arrête : aucun paiement, aucune visite du lien, aucun Payment ni audit local.
// Clés résolues comme en production (base chiffrée → `.env`) ; clé live, inconnue ou
// configuration incomplète/désactivée refusées AVANT tout réseau (garde L10).
// Sortie : hôte, forme du chemin et verdict — jamais le lien, le jeton ni la clé.
//
//   SMOKE_FEDAPAY_S8=1 (+ métadonnées L10, cf. RECETTE_FedaPay_Sandbox.md « S8 »)
// ─────────────────────────────────────────────────────────────
import { randomBytes } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assertFedapaySandbox } from '../../../../scripts/preproduction/smoke-guard.mjs';
import { formatS8, runS8Probe } from '../../../../scripts/preproduction/fedapay-s8.mjs';
import { productionS8Options } from '../test/fedapay-s8-options.js';

const ENABLED = process.env.SMOKE_FEDAPAY_S8 === '1';

describe.skipIf(!ENABLED)('RECETTE S8 FedaPay sandbox — hôte du lien de paiement (opt-in, une transaction non payée)', () => {
  let app: FastifyInstance;
  let integration: { enabled: boolean; secrets: Record<string, string | undefined> };

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    const { getIntegration } = await import('@/lib/integrations.js');
    integration = await getIntegration(app, 'FEDAPAY');
    // Refus fatal dans le hook ; la sonde recontrôle avant chaque appel réseau.
    assertFedapaySandbox(integration);
  });
  afterAll(async () => app?.close());

  it('le lien de paiement d’une clé bac à sable vise un hôte EXACT autorisé', async () => {
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const reference = `ds-recette-s8-${stamp}-${randomBytes(2).toString('hex')}`;
    // Avant tout réseau : même sans verdict (panne), la transaction reste retrouvable.
    // eslint-disable-next-line no-console -- sortie destinée à l’opérateur de recette
    console.info(`[s8:fedapay] référence=${reference} (avant tout appel réseau)`);
    const result = await runS8Probe({
      enabled: integration.enabled,
      secrets: integration.secrets,
      ...productionS8Options(),
      reference,
    });
    const lines = formatS8(result, reference);
    // eslint-disable-next-line no-console -- sortie destinée à l’opérateur de recette
    for (const line of lines) console.info(line);
    expect(result.verdict, lines.at(-1)).toBe('PASS');
  });
});
