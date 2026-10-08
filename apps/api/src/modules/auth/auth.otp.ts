// ─────────────────────────────────────────────────────────────
// Helpers OTP purs (génération, hachage, comparaison) + constantes de politique.
// Aucune dépendance I/O → testables directement.
// ─────────────────────────────────────────────────────────────
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { env } from '@/lib/env.js';

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 5 * 60; // validité du code : 5 min
export const OTP_MAX_ATTEMPTS = 5; // 5 échecs → verrouillage
export const OTP_LOCK_SECONDS = 30 * 60; // verrouillage 30 min (CLAUDE.md §4)

// Anti-abus d'envoi (bombing SMS / coût) : max d'envois par numéro et par fenêtre.
export const OTP_SEND_MAX = 5;
export const OTP_SEND_WINDOW_SECONDS = 15 * 60;

/** Génère un code OTP numérique à 6 chiffres (avec zéros de tête). */
export function generateOtp(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, '0');
}

/** Hache un OTP lié au téléphone (on ne stocke jamais l'OTP en clair). */
export function hashOtp(phone: string, code: string, pepper = env.JWT_SECRET): string {
  // Séparation de domaine ; une fuite Redis seule ne permet plus de balayer 10⁶ OTP.
  return createHmac('sha256', pepper).update(`digisante:otp:v1:${phone}:${code}`).digest('hex');
}

/** Comparaison à temps constant de deux hex (anti timing-attack). */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || !/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
