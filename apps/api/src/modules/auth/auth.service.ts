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
  OTP_GLOBAL_MAX_FAILURES,
  OTP_GLOBAL_WINDOW_SECONDS,
  OTP_LOCK_SECONDS,
  OTP_MAX_ATTEMPTS,
  otpIpTag,
  otpPerIpPatterns,
  otpRedisKeys,
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
  /** Version des CGU acceptée (null = jamais acceptée → ré-acceptation demandée). */
  termsVersion: string | null;
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
  /** Version des CGU acceptée (le schéma impose la version courante). */
  termsVersion: string;
}

const otpKey = (phone: string) => `otp:${phone}`;
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
  termsVersion: string | null;
}): PublicUser {
  return { id: u.id, phone: u.phone, email: u.email, role: u.role, status: u.status, lang: u.lang, termsVersion: u.termsVersion };
}

/**
 * Refuse si le numéro a atteint son plafond global d'échecs (toutes IP) ou si
 * le couple numéro + IP de la requête est verrouillé. Le verrou d'une autre IP
 * ne bloque pas la victime (décision du porteur, 08/11/2026).
 */
async function ensureNotLocked(app: FastifyInstance, phone: string, ip: string | null | undefined): Promise<void> {
  const [global, lock] = await app.redis.mget(otpRedisKeys.global(phone), otpRedisKeys.lock(phone, otpIpTag(ip)));
  if (Number(global ?? 0) >= OTP_GLOBAL_MAX_FAILURES || lock) {
    throw tooManyRequests('Compte temporairement verrouillé. Réessayez dans quelques minutes.');
  }
}

async function scanKeys(app: FastifyInstance, pattern: string): Promise<string[]> {
  const found: string[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await app.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = next;
    found.push(...keys);
  } while (cursor !== '0');
  return found;
}

/** État du verrou OTP d'un numéro pour la console support (aucune IP exposée). */
export async function otpLockState(app: FastifyInstance, phone: string) {
  const [, lockPattern] = otpPerIpPatterns(phone);
  const [global, ipLocks] = await Promise.all([app.redis.get(otpRedisKeys.global(phone)), scanKeys(app, lockPattern)]);
  const attempts = Number(global ?? 0);
  return { locked: attempts >= OTP_GLOBAL_MAX_FAILURES || ipLocks.length > 0, attempts, lockedSources: ipLocks.length };
}

/** Purge tout l'état de verrou OTP d'un numéro (déverrouillage support). */
export async function purgeOtpLocks(app: FastifyInstance, phone: string): Promise<void> {
  const perIp = (await Promise.all(otpPerIpPatterns(phone).map((p) => scanKeys(app, p)))).flat();
  await app.redis.del(otpRedisKeys.global(phone), sendKey(phone), ...perIp);
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
export async function register(app: FastifyInstance, input: RegisterInput, ip?: string | null) {
  // Réforme ARCEP 2024 : canonicaliser le numéro (8 → 10 chiffres) AVANT
  // persistance pour que User.phone (et Pharmacy/Lab.phone) reste canonique.
  // Les numéros diaspora (autre indicatif) sont laissés intacts par le helper.
  const phone = normalizeBeninPhone(input.phone);
  await ensureNotLocked(app, phone, ip);
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
          // Consentement explicite et versionné (validé par le schéma : version courante).
          termsVersion: input.termsVersion,
          termsAcceptedAt: new Date(),
          profile: { create: { firstName: input.firstName, lastName: input.lastName } },
        },
        select: { id: true, phone: true, email: true, role: true, status: true, lang: true, termsVersion: true },
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
  ip?: string | null,
) {
  // Réforme ARCEP 2024 : aligner sur la clé canonique stockée (cf. register).
  const phone = normalizeBeninPhone(input.phone);
  await ensureNotLocked(app, phone, ip);
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
  await ensureNotLocked(app, phone, ip);
  const tag = otpIpTag(ip);
  const attemptsKey = otpRedisKeys.attempts(phone, tag);
  const lockKey = otpRedisKeys.lock(phone, tag);
  const globalKey = otpRedisKeys.global(phone);

  const stored = await app.redis.get(otpKey(phone));

  // Comptés AVANT la comparaison (INCR atomique) : des vérifications lancées en
  // parallèle obtiennent chacune un rang distinct, donc au plus OTP_MAX_ATTEMPTS
  // codes évalués par couple numéro + IP, et OTP_GLOBAL_MAX_FAILURES par numéro
  // et par heure toutes IP confondues (brute-force distribué). Un renvoi de
  // code ne remet jamais ces compteurs à zéro.
  // Fenêtre globale FIXE (TTL posé au premier échec, jamais prolongé).
  const [attempts, globalAttempts] = (await app.redis.eval(`
    local a = redis.call('INCR', KEYS[1])
    redis.call('EXPIRE', KEYS[1], ARGV[1])
    local g = redis.call('INCR', KEYS[2])
    if redis.call('TTL', KEYS[2]) < 0 then redis.call('EXPIRE', KEYS[2], ARGV[2]) end
    return { a, g }
  `, 2, attemptsKey, globalKey, OTP_LOCK_SECONDS, OTP_GLOBAL_WINDOW_SECONDS)) as [number, number];
  if (globalAttempts > OTP_GLOBAL_MAX_FAILURES) {
    // Plafond global : le code en cours est détruit (toutes IP), nouveau code après la fenêtre.
    await app.redis.del(otpKey(phone));
    throw tooManyRequests("Trop d'échecs sur ce numéro. Réessayez dans une heure.");
  }
  if (attempts > OTP_MAX_ATTEMPTS) {
    await app.redis.set(lockKey, '1', 'EX', OTP_LOCK_SECONDS);
    throw tooManyRequests("Trop d'échecs. Compte verrouillé 30 minutes.");
  }

  if (!stored || !safeEqualHex(stored, hashOtp(phone, input.code))) {
    await writeAudit(app.prisma, { action: 'AUTH_FAIL', ip, meta: { phone, attempts, globalAttempts } });

    if (globalAttempts >= OTP_GLOBAL_MAX_FAILURES) {
      await app.redis.del(otpKey(phone));
      await writeAudit(app.prisma, { action: 'AUTH_LOCKOUT', ip, meta: { phone, scope: 'PHONE' } });
      throw tooManyRequests("Trop d'échecs sur ce numéro. Réessayez dans une heure.");
    }
    if (attempts >= OTP_MAX_ATTEMPTS) {
      // Verrou du seul couple numéro + IP : le code reste valable depuis une
      // autre IP (la victime n'est pas privée de son code par un attaquant).
      await app.redis.set(lockKey, '1', 'EX', OTP_LOCK_SECONDS);
      await writeAudit(app.prisma, { action: 'AUTH_LOCKOUT', ip, meta: { phone, scope: 'PHONE_IP' } });
      throw tooManyRequests("Trop d'échecs. Compte verrouillé 30 minutes.");
    }
    throw invalidOtp();
  }

  // Un seul vérificateur peut consommer le code ; un renvoi concurrent ne doit
  // pas être effacé par la vérification de l'ancien code lu avant ce renvoi.
  // La tentative réussie ne compte pas dans le plafond global (DECR).
  const consumed = await app.redis.eval(`
    if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
    redis.call('DEL', KEYS[1], KEYS[2])
    if tonumber(redis.call('GET', KEYS[3]) or '0') > 0 then redis.call('DECR', KEYS[3]) end
    return 1
  `, 3, otpKey(phone), attemptsKey, globalKey, stored);
  if (consumed !== 1) throw invalidOtp();

  const user = await app.prisma.user.findUnique({
    where: { phone },
    select: { id: true, phone: true, email: true, role: true, status: true, lang: true, termsVersion: true },
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
    select: { id: true, phone: true, email: true, role: true, status: true, lang: true, termsVersion: true },
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
