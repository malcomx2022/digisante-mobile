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
import { env, refreshTtlSeconds } from '@/lib/env.js';
import { forbidden, tooManyRequests, unauthorized } from '@/lib/errors.js';
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

const invalidOtp = () => unauthorized('Code invalide ou expiré. Demandez un nouveau code.');

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
    // Diagnostic des tests synthétiques seulement : le code n'est JAMAIS renvoyé en production.
    ...(env.NODE_ENV === 'test' ? { devCode: code } : {}),
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
  const refreshTtl = refreshTtlSeconds(env.JWT_REFRESH_TTL);
  const accessToken = app.jwt.sign({ sub: userId, role }, { expiresIn: env.JWT_ACCESS_TTL });
  const jti = randomUUID();
  const refreshToken = app.jwt.sign(
    { sub: userId, role, typ: 'refresh', jti },
    { expiresIn: refreshTtl },
  );
  await app.redis.set(refreshKey(jti), userId, 'EX', refreshTtl);
  return { accessToken, refreshToken };
}

async function generateAndSendOtp(
  app: FastifyInstance,
  user: { phone: string; lang: string },
  channel: OtpChannel,
  quotaChecked = false,
  deliver = true,
): Promise<string> {
  if (!quotaChecked) await assertSendQuota(app, user.phone);
  const code = generateOtp();
  await app.redis.set(otpKey(user.phone), hashOtp(user.phone, code), 'EX', OTP_TTL_SECONDS);
  // Le compteur d'échecs n'est PAS remis à zéro par un nouvel envoi : sinon
  // « 4 essais → nouveau code → 4 essais… » contournait le verrou de 5 échecs.
  // Il ne se remet à zéro que sur un succès (ou au déverrouillage support).
  // Numéro inconnu : même état de vérification et quotas, aucun SMS payant.
  if (deliver) await sendOtp({ app, to: user.phone, code, channel, lang: user.lang });
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
  await ensureNotLocked(app, phone);
  await assertSendQuota(app, phone);
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

    const code = await generateAndSendOtp(app, user, 'SMS', true);
    // L'identité n'est publique qu'après possession du téléphone. Diagnostic CI seulement.
    return { ...(env.NODE_ENV === 'test' ? { user: publicUser(user) } : {}), otp: otpResponse('SMS', code) };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Téléphone/e-mail/licence en conflit : réponse identique, aucun profil modifié.
      const existing = await app.prisma.user.findUnique({ where: { phone }, select: { phone: true, lang: true } });
      const code = await generateAndSendOtp(app, existing ?? { phone, lang: input.lang }, 'SMS', true, Boolean(existing));
      return { otp: otpResponse('SMS', code) };
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
  const code = await generateAndSendOtp(app, user ?? { phone, lang: 'FR' }, input.channel, false, Boolean(user));
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

  // Compté AVANT la comparaison (INCR atomique) : des vérifications lancées en
  // parallèle obtiennent chacune un rang distinct, donc au plus OTP_MAX_ATTEMPTS
  // codes sont réellement évalués — auparavant toutes passaient le contrôle de
  // verrou avant que l'une d'elles ne le pose.
  const attempts = await app.redis.incr(attemptsKey(phone));
  await app.redis.expire(attemptsKey(phone), OTP_LOCK_SECONDS);
  if (attempts > OTP_MAX_ATTEMPTS) {
    await app.redis.set(lockKey(phone), '1', 'EX', OTP_LOCK_SECONDS);
    await app.redis.del(otpKey(phone));
    throw tooManyRequests("Trop d'échecs. Compte verrouillé 30 minutes.");
  }

  if (!stored || !safeEqualHex(stored, hashOtp(phone, input.code))) {
    await writeAudit(app.prisma, { action: 'AUTH_FAIL', ip, meta: { phone, attempts } });

    if (attempts >= OTP_MAX_ATTEMPTS) {
      await app.redis.set(lockKey(phone), '1', 'EX', OTP_LOCK_SECONDS);
      await app.redis.del(otpKey(phone));
      await writeAudit(app.prisma, { action: 'AUTH_LOCKOUT', ip, meta: { phone } });
      throw tooManyRequests("Trop d'échecs. Compte verrouillé 30 minutes.");
    }
    throw invalidOtp();
  }

  // Un seul vérificateur peut consommer le code ; un renvoi concurrent ne doit
  // pas être effacé par la vérification de l'ancien code lu avant ce renvoi.
  const consumed = await app.redis.eval(`
    if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
    redis.call('DEL', KEYS[1], KEYS[2])
    return 1
  `, 2, otpKey(phone), attemptsKey(phone), stored);
  if (consumed !== 1) throw invalidOtp();

  const user = await app.prisma.user.findUnique({
    where: { phone },
    select: { id: true, phone: true, email: true, role: true, status: true, lang: true },
  });
  if (!user) throw invalidOtp();

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

  // GETDEL atomique : deux rafraîchissements simultanés avec le même cookie ne
  // peuvent plus tous deux réussir (deux lignées de session à partir d'un seul jeton).
  const owner = await app.redis.getdel(refreshKey(payload.jti));
  if (!owner || owner !== payload.sub) {
    // jti absent de l'allowlist : refresh déjà tourné/révoqué ou rejeu → auditer.
    await writeAudit(app.prisma, { action: 'AUTH_FAIL', actorId: payload.sub, meta: { reason: 'refresh_replay' } });
    throw unauthorized('Session expirée, reconnectez-vous');
  }

  // (rotation : l'ancien jeton a été retiré de l'allowlist par le GETDEL ci-dessus)

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
export async function logout(app: FastifyInstance, refreshToken: string, expectedUserId: string): Promise<void> {
  let payload: { sub?: string; typ?: string; jti?: string };
  try {
    payload = app.jwt.verify(refreshToken);
  } catch {
    // Token illisible/expiré : rien à révoquer, on reste idempotent.
    return;
  }
  if (payload.typ === 'refresh' && payload.jti) {
    // Le cookie a pu changer de compte après l'envoi du JWT d'accès (onglet ou
    // réponse tardive). Ne révoquer ni la session ni l'appareil d'un autre acteur.
    // Le refus précède aussi l'effacement du cookie dans la route.
    if (!payload.sub || payload.sub !== expectedUserId) throw forbidden('La session ne correspond pas au compte courant');
    await app.redis.del(refreshKey(payload.jti));
    // Appareil PARTAGÉ : sans purge, les notifications du compte (résultat de labo,
    // RDV…) continueraient d'arriver sur ce téléphone après la déconnexion (§4).
    await app.prisma.user.updateMany({ where: { id: expectedUserId }, data: { fcmToken: null } });
  }
}
