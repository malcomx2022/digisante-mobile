// ─────────────────────────────────────────────────────────────
// Schémas zod partagés entre web et api.
// Source unique de vérité pour la validation des entrées communes.
// Les schémas spécifiques à un module restent dans le module concerné.
// ─────────────────────────────────────────────────────────────
import { z } from 'zod';

import { LANGS, ROLES } from './enums.js';

// ── Primitifs réutilisables ──

/** Identifiant cuid (Prisma `@default(cuid())`). */
export const cuidSchema = z.string().cuid();

/**
 * Téléphone au format international. Optimisé Bénin (+229) mais accepte
 * tout E.164 (diaspora). 8 à 14 chiffres après l'indicatif.
 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+\d{8,15}$/, 'Numéro de téléphone invalide (format international +…)');

/** Téléphone béninois strict : +229 suivi de 8 à 10 chiffres. */
export const beninPhoneSchema = z
  .string()
  .trim()
  .regex(/^\+229\d{8,10}$/, 'Numéro béninois invalide (+229…)');

export const emailSchema = z.string().trim().toLowerCase().email();

/** Code OTP à 6 chiffres. */
export const otpSchema = z.string().regex(/^\d{6}$/, 'Code OTP à 6 chiffres requis');

export const langSchema = z.enum(LANGS);
export const roleSchema = z.enum(ROLES);

// ── Pagination & tri (réutilisé par les listes) ──

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type Pagination = z.infer<typeof paginationSchema>;

/** Enveloppe de réponse paginée standard de l'API. */
export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ── Géolocalisation (SOS, annuaire labo/pharmacie) ──

export const geoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof geoPointSchema>;

// ── Authentification (P2.2) ──

export const registerSchema = z
  .object({
    phone: phoneSchema,
    email: emailSchema.optional(),
    role: roleSchema.default('PATIENT'),
    lang: langSchema.default('FR'),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    // ── Champs spécifiques par rôle (optionnels à la racine, rendus
    //    obligatoires selon le rôle via superRefine ci-dessous). ──
    /** Spécialité du médecin (obligatoire si role MEDECIN). */
    speciality: z.string().trim().min(1).max(120).optional(),
    /** Numéro d'ordre / de licence (obligatoire si role MEDECIN). */
    licenseNumber: z.string().trim().min(1).max(120).optional(),
    /** Tarif de consultation en XOF (médecin) — défaut 0 côté service. */
    consultFee: z.number().min(0).optional(),
    /** Raison sociale de l'établissement (obligatoire si PHARMACIE/LABORATOIRE). */
    establishmentName: z.string().trim().min(1).max(160).optional(),
    /** Adresse de l'établissement (optionnelle). */
    address: z.string().trim().max(255).optional(),
  })
  .superRefine((data, ctx) => {
    // L'admin ne se crée jamais par auto-inscription (seed uniquement, CLAUDE.md §4).
    if (data.role === 'ADMIN') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['role'],
        message: "Le rôle ADMIN ne peut pas être créé par auto-inscription",
      });
    }
    // Médecin : spécialité + numéro d'ordre obligatoires.
    if (data.role === 'MEDECIN') {
      if (!data.speciality) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['speciality'],
          message: 'La spécialité est obligatoire pour un médecin',
        });
      }
      if (!data.licenseNumber) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['licenseNumber'],
          message: "Le numéro d'ordre est obligatoire pour un médecin",
        });
      }
    }
    // Pharmacie / Laboratoire : raison sociale obligatoire.
    if (data.role === 'PHARMACIE' || data.role === 'LABORATOIRE') {
      if (!data.establishmentName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['establishmentName'],
          message: "Le nom de l'établissement est obligatoire",
        });
      }
    }
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const requestOtpSchema = z.object({
  phone: phoneSchema,
  /** Canal OTP : SMS par défaut, VOICE pour l'OTP vocal (ex. Fɔ̀ngbè). */
  channel: z.enum(['SMS', 'VOICE']).default('SMS'),
});
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: otpSchema,
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(10),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

// ── Forme d'erreur normalisée de l'API (CLAUDE.md §6 : { code, message }) ──

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}
