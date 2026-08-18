// ─────────────────────────────────────────────────────────────
// Enums métier — miroir EXACT du schéma Prisma (apps/api/prisma/schema.prisma).
// Toute évolution doit être répercutée des deux côtés (shared ⇄ Prisma).
// Déclarés en tuples `as const` pour servir directement à zod (z.enum).
// ─────────────────────────────────────────────────────────────

/** Les 7 rôles de la plateforme (patient · médecin · pharmacie · laboratoire · diaspora · ASC · admin). */
export const ROLES = ['PATIENT', 'MEDECIN', 'PHARMACIE', 'LABORATOIRE', 'DIASPORA', 'ASC', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** État du cycle de vie d'un compte (vérification OTP, actif, suspendu, en attente de KYC). */
export const USER_STATUSES = ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'PENDING_KYC'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Langues supportées. FR = source de vérité, EN complet, FON/YOR complétés (§8). */
export const LANGS = ['FR', 'EN', 'FON', 'YOR'] as const;
export type Lang = (typeof LANGS)[number];

/** Nature d'un rendez-vous : en présentiel ou en téléconsultation. */
export const APPOINTMENT_TYPES = ['PHYSICAL', 'TELECONSULTATION'] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

/** Cycle de vie d'un rendez-vous (en attente → confirmé → terminé, ou annulé / absent). */
export const APPOINTMENT_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Canal d'une téléconsultation ; supporte la dégradation VIDEO → AUDIO → CHAT (bande passante faible). */
export const CONSULTATION_MODES = ['VIDEO', 'AUDIO', 'CHAT'] as const;
export type ConsultationMode = (typeof CONSULTATION_MODES)[number];

/** État d'une session de consultation (salle d'attente → active → terminée, ou échec technique). */
export const CONSULTATION_STATUSES = ['WAITING', 'ACTIVE', 'COMPLETED', 'FAILED'] as const;
export type ConsultationStatus = (typeof CONSULTATION_STATUSES)[number];

/** Catégories d'entrées du dossier médical partagé (DMP). */
export const MEDICAL_RECORD_TYPES = [
  'VITAL_SIGNS',
  'DIAGNOSIS',
  'VACCINATION',
  'ALLERGY',
  'LAB_RESULT',
  'PRESCRIPTION',
  'IMAGING',
  'SURGERY',
  'CHRONIC_DISEASE',
  'OTHER',
] as const;
export type MedicalRecordType = (typeof MEDICAL_RECORD_TYPES)[number];

/** État global d'une ordonnance, dérivé de la délivrance de ses lignes. */
export const PRESCRIPTION_STATUSES = [
  'ACTIVE',
  'PARTIALLY_DISPENSED',
  'FULLY_DISPENSED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];

/** État de délivrance d'une ligne d'ordonnance (délivrance granulaire par la pharmacie). */
export const PRESCRIPTION_ITEM_STATUSES = ['PENDING', 'DISPENSED', 'PARTIALLY_DISPENSED', 'UNAVAILABLE'] as const;
export type PrescriptionItemStatus = (typeof PRESCRIPTION_ITEM_STATUSES)[number];

/** Cycle de vie d'un paiement (FedaPay §5) ; `REFUNDED` = reversal interne. */
export const PAYMENT_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Moyens de paiement : Mobile Money, Wave, carte internationale, ou wallet diaspora. */
export const PAYMENT_METHODS = ['MTN_MOMO', 'MOOV_MONEY', 'WAVE', 'ORANGE_MONEY', 'VISA_MC', 'WALLET'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Objet d'un paiement (consultation, abonnement, recharge wallet, analyse, pharmacie). */
export const PAYMENT_TYPES = ['CONSULTATION', 'SUBSCRIPTION', 'WALLET_TOPUP', 'LAB_TEST', 'PHARMACY'] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

/** Catégories de notifications (rappel RDV, résultat labo, alerte SOS, système…). */
export const NOTIFICATION_TYPES = [
  'APPOINTMENT_REMINDER',
  'CONSULTATION_START',
  'PRESCRIPTION_READY',
  'LAB_RESULT',
  'SOS_ALERT',
  'PAYMENT_CONFIRMED',
  'SYSTEM',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Canaux d'acheminement d'une notification (push FCM, SMS Twilio, email, in-app). */
export const NOTIFICATION_CHANNELS = ['PUSH_FCM', 'SMS_TWILIO', 'EMAIL', 'IN_APP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** État d'acheminement d'une notification (en attente → envoyée → délivrée / lue, ou échec). */
export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** État d'une alerte SOS (active → résolue, ou fausse alerte). */
export const SOS_STATUSES = ['ACTIVE', 'RESOLVED', 'FALSE_ALARM'] as const;
export type SosStatus = (typeof SOS_STATUSES)[number];

/** État de vérification KYC d'un soignant (revue manuelle des pièces, §8). */
export const KYC_STATUSES = [
  'NOT_SUBMITTED',
  'PENDING',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'NEEDS_REVISION',
] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

/** Types de pièces justificatives soumises lors du KYC soignant. */
export const KYC_DOCUMENT_TYPES = [
  'NATIONAL_ID',
  'MEDICAL_DEGREE',
  'ORDER_LICENSE',
  'PRACTICE_LICENSE',
  'PROFESSIONAL_PHOTO',
  'MALPRACTICE_INSURANCE',
] as const;
export type KycDocumentType = (typeof KYC_DOCUMENT_TYPES)[number];

/** État d'une orientation (référencement) d'un patient entre soignants. */
export const REFERRAL_STATUSES = ['PENDING', 'ACCEPTED', 'COMPLETED', 'CANCELLED'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

/** Cycle de vie d'une demande d'analyse de laboratoire. */
export const LAB_ORDER_STATUSES = ['PENDING', 'SAMPLE_COLLECTED', 'PROCESSING', 'COMPLETED', 'CANCELLED'] as const;
export type LabOrderStatus = (typeof LAB_ORDER_STATUSES)[number];

/** État d'une couverture d'assurance déclarée par un patient (statut effectif calculé selon l'échéance). */
export const INSURANCE_COVERAGE_STATUSES = ['ACTIVE', 'EXPIRED', 'SUSPENDED'] as const;
export type InsuranceCoverageStatus = (typeof INSURANCE_COVERAGE_STATUSES)[number];

/** Nature d'un mouvement de wallet (recharge, débit, remboursement, transfert). */
export const WALLET_TRANSACTION_TYPES = ['TOPUP', 'DEBIT', 'REFUND', 'TRANSFER'] as const;
export type WalletTransactionType = (typeof WALLET_TRANSACTION_TYPES)[number];

/** Offres d'abonnement de la plateforme. */
export const SUBSCRIPTION_PLANS = ['FREE', 'STARTER', 'PRO', 'CLINIC'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

/** État d'un abonnement (actif → expiré / annulé, ou en attente de paiement). */
export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'EXPIRED', 'CANCELLED', 'PENDING'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Thèmes des contenus éducatifs de santé (CMS éducation). */
export const CONTENT_CATEGORIES = [
  'PREVENTION',
  'NUTRITION',
  'MATERNITY',
  'VACCINATION',
  'CHRONIC',
  'MENTAL_HEALTH',
  'EMERGENCY',
  'OTHER',
] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

// (ADMIN_ACTIONS / AdminAction supprimés en août 2026 avec le modèle
// `AdminAuditLog`. Registre d'audit UNIQUE = `AuditLog`, dont le champ `action`
// est un String libre : la liste fermée devenait un doublon partiel et périmé
// — elle ignorait KYC_REVISION, OTP_RESET, INTEGRATION_*, CAMPAIGN_SENT, etc.)

/** Mode de partage d'une entrée du DMP (QR, lien, accès temporaire). */
export const SHARE_TYPES = ['QR_CODE', 'LINK', 'TEMPORARY_ACCESS'] as const;
export type ShareType = (typeof SHARE_TYPES)[number];

// ─────────────────────────────────────────────────────────────
// Actions d'audit (champ `action` de AuditLog — String côté Prisma).
// Événements sensibles journalisés dans le trail immuable (CLAUDE.md §4).
// ─────────────────────────────────────────────────────────────
/** Événements sensibles journalisés dans le trail d'audit immuable (rétention 5 ans, §4). */
export const AUDIT_ACTIONS = [
  'AUTH_FAIL',
  'AUTH_LOCKOUT',
  'DMP_ACCESS',
  'DMP_DENIED',
  'DMP_SHARE',
  'KYC_APPROVE',
  'KYC_REJECT',
  'PAYMENT_INIT',
  'PAYMENT_CONFIRMED',
  'PAYMENT_REFUND',
  'DATA_EXPORT',
  'LAB_CRITICAL',
  'USER_SUSPEND',
  'USER_ACTIVATE',
  'CAMPAIGN_SENT',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Disponibilité d'un médicament dans le stock déclaré par une pharmacie. */
export const STOCK_STATUSES = ['IN_STOCK', 'LOW', 'OUT'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

/**
 * Diffusion / veille sanitaire (admin) : une campagne est rédigée (DRAFT) puis
 * diffusée une seule fois (SENT) — fan-out de Notification par destinataire.
 */
export const CAMPAIGN_STATUSES = ['DRAFT', 'SENT'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
