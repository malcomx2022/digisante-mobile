// ─────────────────────────────────────────────────────────────
// Service d'authentification : inscription/connexion par téléphone + OTP,
// JWT access + refresh, verrouillage après échecs, journalisation d'audit.
// Conformité APDP : OTP haché en Redis, AUTH_FAIL/AUTH_LOCKOUT audités.
// ─────────────────────────────────────────────────────────────
import { randomUUID } from 'node:crypto';

import { normalizeBeninPhone, type Lang, type Role } from '@digisante/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '@/lib/audit.js';
import { env } from '@/lib/env.js';
import { badRequest, conflict, notFound, tooManyRequests, unauthorized } from '@/lib/errors.js';
import {
  generateOtp,
  hashOtp,
  OTP_LOCK_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_SEND_MAX,
  OTP_SEND_WINDOW_SECONDS,
  OTP_TTL_SECONDS,
  safeEqualHex,
} from './auth.otp.js';
import { sendOtp, type OtpChannel } from '@/services/twilio.js';

const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 jours

interface PublicUser {
  id: string;
  phone: string;
  email: string | null;
  role: Role;
  status: string;
  lang: string;
}

interface RegisterInput {
  phone: string;
  email?: string;
  role: Role;
  lang: Lang;
  firstName: string;
  lastName: string;
  // Champs spécifiques par rôle (validés en amont par registerSchema).
  speciality?: string;
  licenseNumber?: string;
  consultFee?: number;
  establishmentName?: string;
  address?: string;
  zone?: string;
}

const otpKey = (phone: string) => `otp:${phone}`;
const attemptsKey = (phone: string) => `otp:attempts:${phone}`;
const lockKey = (phone: string) => `otp:lock:${phone}`;
const sendKey = (phone: string) => `otp:send:${phone}`;
const refreshKey = (jti: string) => `refresh:${jti}`;

/** Anti-abus d'envoi d'OTP (bombing SMS / coût) : limite par numéro et fenêtre. */
async function assertSendQuota(app: FastifyInstance, phone: string): Promise<void> {
  const count = await app.redis.incr(sendKey(phone));
  if (count === 1) await app.redis.expire(sendKey(phone), OTP_SEND_WINDOW_SECONDS);
  if (count > OTP_SEND_MAX) {
    throw tooManyRequests("Trop de demandes de code. Réessayez plus tard.");
  }
}

function otpResponse(channel: OtpChannel, code: string) {
  return {
    channel,
    expiresInSec: OTP_TTL_SECONDS,
    // Confort dev/test : le code n'est JAMAIS renvoyé en production.
    ...(env.NODE_ENV !== 'production' ? { devCode: code } : {}),
  };
}

function publicUser(u: {
  id: string;
  phone: string;
  email: string | null;
  role: Role;
  status: string;
  lang: string;
}): PublicUser {
  return { id: u.id, phone: u.phone, email: u.email, role: u.role, status: u.status, lang: u.lang };
}

async function ensureNotLocked(app: FastifyInstance, phone: string): Promise<void> {
  if (await app.redis.get(lockKey(phone))) {
    throw tooManyRequests('Compte temporairement verrouillé. Réessayez dans quelques minutes.');
  }
}

/** Signe access + refresh et enregistre le jti du refresh dans l'allowlist Redis. */
async function issueTokens(app: FastifyInstance, userId: string, role: Role) {
  const accessToken = app.jwt.sign({ sub: userId, role }, { expiresIn: env.JWT_ACCESS_TTL });
  const jti = randomUUID();
  const refreshToken = app.jwt.sign(
    { sub: userId, role, typ: 'refresh', jti },
    { expiresIn: REFRESH_TTL_SECONDS },
  );
  await app.redis.set(refreshKey(jti), userId, 'EX', REFRESH_TTL_SECONDS);
  return { accessToken, refreshToken };
}

async function generateAndSendOtp(
  app: FastifyInstance,
  user: { phone: string; lang: string },
  channel: OtpChannel,
): Promise<string> {
  await assertSendQuota(app, user.phone);
  const code = generateOtp();
  await app.redis.set(otpKey(user.phone), hashOtp(user.phone, code), 'EX', OTP_TTL_SECONDS);
  await app.redis.del(attemptsKey(user.phone));
  await sendOtp({ app, to: user.phone, code, channel, lang: user.lang });
  return code;
}

/**
 * Inscription par téléphone : crée le compte (PENDING_VERIFICATION), son
 * Profile ET l'enregistrement de rôle correspondant (Patient/Doctor/Pharmacy/
 * Lab/Wallet) dans UNE transaction, puis envoie un OTP.
 *
 * Sans cette création de rôle, DMP/SOS/wallet/RDV/consultations/KYC/annuaire
 * seraient cassés pour tout compte créé via l'API (cf. bug racine).
 */
export async function register(app: FastifyInstance, input: RegisterInput) {
  // Réforme ARCEP 2024 : canonicaliser le numéro (8 → 10 chiffres) AVANT
  // persistance pour que User.phone (et Pharmacy/Lab.phone) reste canonique.
  // Les numéros diaspora (autre indicatif) sont laissés intacts par le helper.
  const phone = normalizeBeninPhone(input.phone);
  try {
    const user = await app.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          phone,
          email: input.email,
          role: input.role,
          lang: input.lang,
          status: 'PENDING_VERIFICATION',
          profile: { create: { firstName: input.firstName, lastName: input.lastName } },
        },
        select: { id: true, phone: true, email: true, role: true, status: true, lang: true },
      });

      switch (input.role) {
        case 'PATIENT':
          // Dossier patient (DMP/SOS/RDV) + portefeuille (paiements).
          await tx.patient.create({ data: { userId: created.id } });
          await tx.wallet.create({ data: { userId: created.id, balance: 0, currency: 'XOF' } });
          break;

        case 'DIASPORA':
          // Diaspora : portefeuille uniquement (recharges, wallet).
          await tx.wallet.create({ data: { userId: created.id, balance: 0, currency: 'XOF' } });
          break;

        case 'MEDECIN':
          // La vérification (verifiedAt) se fera plus tard via le KYC.
          await tx.doctor.create({
            data: {
              userId: created.id,
              speciality: input.speciality!,
              licenseNumber: input.licenseNumber!,
              consultFee: new Prisma.Decimal(input.consultFee ?? 0),
              verifiedAt: null,
            },
          });
          break;

        case 'PHARMACIE':
          await tx.pharmacy.create({
            data: {
              userId: created.id,
              name: input.establishmentName!,
              address: input.address ?? '',
              phone,
            },
          });
          break;

        case 'LABORATOIRE':
          await tx.lab.create({
            data: {
              userId: created.id,
              name: input.establishmentName!,
              address: input.address ?? '',
              phone,
            },
          });
          break;

        case 'ASC':
          // Agent de santé communautaire : profil de rôle avec sa zone / village.
          await tx.communityHealthWorker.create({ data: { userId: created.id, zone: input.zone! } });
          break;

        default:
          // ADMIN et rôles inattendus sont rejetés en amont (registerSchema).
          break;
      }

      return created;
    });

    const code = await generateAndSendOtp(app, user, 'SMS');
    return { user: publicUser(user), otp: otpResponse('SMS', code) };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // target indique le ou les champs en conflit (unique).
      const target = err.meta?.target;
      const fields = Array.isArray(target) ? target.join(',') : String(target ?? '');
      if (fields.includes('licenseNumber')) {
        throw conflict("Ce numéro d'ordre / de licence est déjà utilisé");
      }
      throw conflict('Un compte existe déjà pour ce numéro ou cet e-mail');
    }
    throw err;
  }
}

/** Demande d'OTP pour un compte existant (connexion / renvoi). */
export async function requestOtp(
  app: FastifyInstance,
  input: { phone: string; channel: OtpChannel },
) {
  // Réforme ARCEP 2024 : aligner sur la clé canonique stockée (cf. register).
  const phone = normalizeBeninPhone(input.phone);
  await ensureNotLocked(app, phone);
  const user = await app.prisma.user.findUnique({
    where: { phone },
    select: { phone: true, lang: true },
  });
  if (!user) throw notFound('Aucun compte associé à ce numéro');
  const code = await generateAndSendOtp(app, user, input.channel);
  return otpResponse(input.channel, code);
}

/** Vérifie l'OTP : succès → active le compte + délivre les jetons ; échec → audit + lockout. */
export async function verifyOtp(
  app: FastifyInstance,
  input: { phone: string; code: string },
  ip: string,
) {
  // Réforme ARCEP 2024 : même clé canonique que register/requestOtp (lookup + hashOtp).
  const phone = normalizeBeninPhone(input.phone);
  await ensureNotLocked(app, phone);

  const stored = await app.redis.get(otpKey(phone));
  if (!stored) throw badRequest('Code expiré ou inexistant. Demandez un nouveau code.');

  if (!safeEqualHex(stored, hashOtp(phone, input.code))) {
    const attempts = await app.redis.incr(attemptsKey(phone));
    await app.redis.expire(attemptsKey(phone), OTP_LOCK_SECONDS);
    await writeAudit(app.prisma, { action: 'AUTH_FAIL', ip, meta: { phone, attempts } });

    if (attempts >= OTP_MAX_ATTEMPTS) {
      await app.redis.set(lockKey(phone), '1', 'EX', OTP_LOCK_SECONDS);
      await app.redis.del(otpKey(phone));
      await writeAudit(app.prisma, { action: 'AUTH_LOCKOUT', ip, meta: { phone } });
      throw tooManyRequests("Trop d'échecs. Compte verrouillé 30 minutes.");
    }
    throw unauthorized(`Code invalide (${OTP_MAX_ATTEMPTS - attempts} tentative(s) restante(s))`);
  }

  await app.redis.del(otpKey(phone), attemptsKey(phone));

  const user = await app.prisma.user.findUnique({
    where: { phone },
    select: { id: true, phone: true, email: true, role: true, status: true, lang: true },
  });
  if (!user) throw notFound('Compte introuvable');

  // Compte suspendu : refuser la délivrance de jetons. La suspension doit bloquer
  // la reconnexion par OTP, pas seulement l'accès en cours (§4).
  if (user.status === 'SUSPENDED') {
    await writeAudit(app.prisma, { action: 'AUTH_FAIL', actorId: user.id, ip, meta: { reason: 'suspended' } });
    throw unauthorized('Compte suspendu. Contactez le support.');
  }

  if (user.status === 'PENDING_VERIFICATION') {
    await app.prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
    user.status = 'ACTIVE';
  }

  const tokens = await issueTokens(app, user.id, user.role);
  return { user: publicUser(user), ...tokens };
}

/** Échange un refresh token valide contre de nouveaux jetons (rotation). */
export async function refresh(app: FastifyInstance, refreshToken: string) {
  let payload: { sub: string; role: Role; typ?: string; jti?: string };
  try {
    payload = app.jwt.verify(refreshToken);
  } catch {
    throw unauthorized('Refresh token invalide ou expiré');
  }
  if (payload.typ !== 'refresh' || !payload.jti) throw unauthorized('Token de rafraîchissement attendu');

  const owner = await app.redis.get(refreshKey(payload.jti));
  if (!owner || owner !== payload.sub) {
    // jti absent de l'allowlist : refresh déjà tourné/révoqué ou rejeu → auditer.
    await writeAudit(app.prisma, { action: 'AUTH_FAIL', actorId: payload.sub, meta: { reason: 'refresh_replay' } });
    throw unauthorized('Session expirée, reconnectez-vous');
  }

  await app.redis.del(refreshKey(payload.jti)); // rotation : l'ancien est révoqué

  // Re-lecture DB : statut et rôle peuvent avoir changé depuis l'émission du
  // refresh (suspension, rétrogradation). Sans cela un compte suspendu
  // rafraîchit des jetons pendant 30 j, et un rôle périmé survivrait (§4).
  // On renvoie aussi l'utilisateur public → reprise de session en UN appel.
  const user = await app.prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, phone: true, email: true, role: true, status: true, lang: true },
  });
  if (!user || user.status === 'SUSPENDED') {
    throw unauthorized('Session révoquée. Contactez le support.');
  }
  const tokens = await issueTokens(app, user.id, user.role);
  return { ...tokens, user: publicUser(user) };
}

/**
 * Déconnexion : révoque le refresh token en supprimant sa clé `refresh:<jti>`
 * de l'allowlist Redis, et oublie le token push de l'appareil (`fcmToken`). Idempotent (aucune erreur si déjà absent/expiré) :
 * un token invalide est simplement ignoré côté révocation.
 */
export async function logout(app: FastifyInstance, refreshToken: string): Promise<void> {
  let payload: { sub?: string; typ?: string; jti?: string };
  try {
    payload = app.jwt.verify(refreshToken);
  } catch {
    // Token illisible/expiré : rien à révoquer, on reste idempotent.
    return;
  }
  if (payload.typ === 'refresh' && payload.jti) {
    await app.redis.del(refreshKey(payload.jti));
    // Appareil PARTAGÉ : sans purge, les notifications du compte (résultat de labo,
    // RDV…) continueraient d'arriver sur ce téléphone après la déconnexion (§4).
    if (payload.sub) {
      await app.prisma.user.updateMany({ where: { id: payload.sub }, data: { fcmToken: null } });
    }
  }
}
