// ─────────────────────────────────────────────────────────────
// Routes du module Auth (préfixe /api/v1/auth) — contrats publics.
// Validation par les schémas zod de @digisante/shared (zParse).
// ─────────────────────────────────────────────────────────────
import { registerSchema, requestOtpSchema, verifyOtpSchema } from '@digisante/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { env } from '@/lib/env.js';
import { notFound, unauthorized } from '@/lib/errors.js';
import { zParse } from '@/lib/validation.js';
import * as authService from './auth.service.js';

// ── Refresh token en cookie HttpOnly (§4, audit CSO C6) ──────────────────────
// Le refresh (30 j) n'est JAMAIS exposé au JavaScript : une faille XSS ne peut
// donc plus voler une session longue durée. `Path=/api/v1/auth` : le cookie n'est
// envoyé qu'aux endpoints d'auth (refresh/logout), pas à chaque requête API.
// `SameSite=Strict` : anti-CSRF (le web et l'API sont servis en même origine par
// Nginx en prod). `Secure` hors dev (http localhost n'enverrait pas un cookie Secure).
const REFRESH_COOKIE = 'digisante_rt';
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30; // 30 jours (aligné sur le TTL du refresh)

function refreshCookie(value: string, maxAge: number): string {
  const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${REFRESH_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=${maxAge}${secure}`;
}
function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.header('set-cookie', refreshCookie(token, REFRESH_MAX_AGE));
}
function clearRefreshCookie(reply: FastifyReply): void {
  reply.header('set-cookie', refreshCookie('', 0));
}
function readRefreshCookie(request: FastifyRequest): string | undefined {
  const raw = request.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === REFRESH_COOKIE) {
      const v = part.slice(eq + 1).trim();
      return v.length > 0 ? v : undefined;
    }
  }
  return undefined;
}

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

  // Vérification de l'OTP → active le compte + délivre l'access token (corps) et
  // pose le refresh en cookie HttpOnly (jamais dans le corps). PUBLIC.
  app.post('/otp/verify', async (request, reply) => {
    const input = zParse(verifyOtpSchema, request.body);
    const { refreshToken, ...rest } = await authService.verifyOtp(app, input, request.ip);
    setRefreshCookie(reply, refreshToken);
    return rest; // { user, accessToken }
  });

  // Rotation : lit le refresh dans le cookie HttpOnly, le fait tourner (nouveau
  // cookie) et renvoie { accessToken, user } → reprise de session en un appel. PUBLIC.
  app.post('/refresh', async (request, reply) => {
    const token = readRefreshCookie(request);
    if (!token) throw unauthorized('Session absente, reconnectez-vous');
    const { refreshToken, ...rest } = await authService.refresh(app, token);
    setRefreshCookie(reply, refreshToken);
    return rest; // { accessToken, user }
  });

  // Déconnexion → révoque le refresh (Redis) et efface le cookie. PROTÉGÉ (JWT d'accès).
  app.post('/logout', { preHandler: app.authenticate }, async (request, reply) => {
    const token = readRefreshCookie(request);
    if (token) await authService.logout(app, token);
    clearRefreshCookie(reply);
    return reply.code(204).send();
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
