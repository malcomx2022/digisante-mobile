// Réinitialisation de l'état OTP d'un ou plusieurs numéros entre deux tests : code en cours,
// verrous par couple numéro + IP (nouvelle époque), plafond global et fenêtre d'envoi.
// Ne jamais recopier les noms de clés dans un test : ils portent l'époque et l'étiquette d'IP,
// et une suppression par l'ancien nom laisse les compteurs s'accumuler jusqu'au verrou (429).
import type { FastifyInstance } from 'fastify';

import { purgeOtpLocks } from '@/modules/auth/auth.service.js';

export async function resetOtpState(app: FastifyInstance, ...phones: string[]): Promise<void> {
  for (const phone of phones) {
    await purgeOtpLocks(app, phone);
    await app.redis.del(`otp:${phone}`);
  }
}
