// ─────────────────────────────────────────────────────────────
// Routes du module Auth (préfixe /api/v1/auth) — contrats publics.
// Validation par les schémas zod de @digisante/shared (zParse).
// ─────────────────────────────────────────────────────────────
import { refreshTokenSchema, registerSchema, requestOtpSchema, verifyOtpSchema } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';

import { notFound } from '@/lib/errors.js';
import { zParse } from '@/lib/validation.js';
import * as authService from './auth.service.js';

export default async function authRoutes(app: FastifyInstance) {
  // Inscription par téléphone (envoie un OTP). PUBLIC.
  app.post('/register', async (request, reply) => {
    const input = zParse(registerSchema, request.body);
    const result = await authService.register(app, input);
    return reply.code(201).send(result);
  });

  // Demande d'OTP pour un compte existant (connexion / renvoi). PUBLIC.
  // channel = SMS (défaut) ou VOICE (OTP vocal, ex. Fɔ̀ngbè).
  app.post('/otp/request', async (request) => {
    const input = zParse(requestOtpSchema, request.body);
    return authService.requestOtp(app, input);
  });

  // Vérification de l'OTP → active le compte + délivre access/refresh. PUBLIC.
  app.post('/otp/verify', async (request) => {
    const input = zParse(verifyOtpSchema, request.body);
    return authService.verifyOtp(app, input, request.ip);
  });

  // Rotation du refresh token → nouveaux jetons. PUBLIC.
  app.post('/refresh', async (request) => {
    const { refreshToken } = zParse(refreshTokenSchema, request.body);
    return authService.refresh(app, refreshToken);
  });

  // Profil de l'utilisateur courant. PROTÉGÉ (JWT d'accès).
  app.get('/me', { preHandler: app.authenticate }, async (request) => {
    const me = await app.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: {
        id: true,
        phone: true,
        email: true,
        role: true,
        status: true,
        lang: true,
        profile: { select: { firstName: true, lastName: true, avatarUrl: true } },
      },
    });
    if (!me) throw notFound('Utilisateur introuvable');
    return me;
  });
}
