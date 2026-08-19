// ─────────────────────────────────────────────────────────────
// Routes Wallet (préfixe /api/v1/wallet). Solde + recharge € → FCFA (diaspora).
//
// ⚠️ Il n'y a PAS de route de paiement ici. `POST /pay` a été retirée (écart E2) :
// elle débitait le payeur sans rien régler ni créditer personne, et n'avait aucun
// appelant. Le débit du portefeuille passe par `POST /payments` (méthode WALLET),
// seul chemin gardé, atomique et testé (lot 8).
// ─────────────────────────────────────────────────────────────
import { PAYMENT_METHODS } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { zParse } from '@/lib/validation.js';
import * as payments from '@/modules/payments/payments.service.js';
import { convertEurToXof } from '@/services/fedapay.js';
import * as wallet from './wallet.service.js';

const topupSchema = z.object({
  amountEur: z.number().positive(),
  method: z.enum(PAYMENT_METHODS).default('VISA_MC'),
});

export default async function walletRoutes(app: FastifyInstance) {
  const authed = { preHandler: [app.authenticate] };

  app.get('/', authed, async (request) => wallet.summary(app, request.user.sub));

  // Recharge : convertit en FCFA et initie un paiement WALLET_TOPUP.
  // Le solde est crédité à la confirmation (webhook).
  app.post('/topup', authed, async (request) => {
    const { amountEur, method } = zParse(topupSchema, request.body);
    const amountXof = convertEurToXof(amountEur);
    const result = await payments.initiate(app, request.user.sub, { type: 'WALLET_TOPUP', method, amount: amountXof });
    return { ...result, amountEur, amountXof };
  });
}
