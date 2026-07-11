// ─────────────────────────────────────────────────────────────
// Enums métier — miroir EXACT du schéma Prisma (apps/api/prisma/schema.prisma).
// Toute évolution doit être répercutée des deux côtés (shared ⇄ Prisma).
// Déclarés en tuples `as const` pour servir directement à zod (z.enum).
// ─────────────────────────────────────────────────────────────

export const ROLES = ['PATIENT', 'MEDECIN', 'PHARMACIE', 'LABORATOIRE', 'DIASPORA', 'ASC', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'PENDING_KYC'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const LANGS = ['FR', 'EN', 'FON', 'YOR'] as const;
export type Lang = (typeof LANGS)[number];

export const APPOINTMENT_TYPES = ['PHYSICAL', 'TELECONSULTATION'] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const APPOINTMENT_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const CONSULTATION_MODES = ['VIDEO', 'AUDIO', 'CHAT'] as const;
export type ConsultationMode = (typeof CONSULTATION_MODES)[number];

export const CONSULTATION_STATUSES = ['WAITING', 'ACTIVE', 'COMPLETED', 'FAILED'] as const;
export type ConsultationStatus = (typeof CONSULTATION_STATUSES)[number];

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

export const PRESCRIPTION_STATUSES = [
  'ACTIVE',
  'PARTIALLY_DISPENSED',
  'FULLY_DISPENSED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];

export const PRESCRIPTION_ITEM_STATUSES = ['PENDING', 'DISPENSED', 'PARTIALLY_DISPENSED', 'UNAVAILABLE'] as const;
export type PrescriptionItemStatus = (typeof PRESCRIPTION_ITEM_STATUSES)[number];

export const PAYMENT_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['MTN_MOMO', 'MOOV_MONEY', 'WAVE', 'ORANGE_MONEY', 'VISA_MC', 'WALLET'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_TYPES = ['CONSULTATION', 'SUBSCRIPTION', 'WALLET_TOPUP', 'LAB_TEST', 'PHARMACY'] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

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

export const NOTIFICATION_CHANNELS = ['PUSH_FCM', 'SMS_TWILIO', 'EMAIL', 'IN_APP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const SOS_STATUSES = ['ACTIVE', 'RESOLVED', 'FALSE_ALARM'] as const;
export type SosStatus = (typeof SOS_STATUSES)[number];

export const KYC_STATUSES = [
  'NOT_SUBMITTED',
  'PENDING',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'NEEDS_REVISION',
] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const KYC_DOCUMENT_TYPES = [
  'NATIONAL_ID',
  'MEDICAL_DEGREE',
  'ORDER_LICENSE',
  'PRACTICE_LICENSE',
  'PROFESSIONAL_PHOTO',
  'MALPRACTICE_INSURANCE',
] as const;
export type KycDocumentType = (typeof KYC_DOCUMENT_TYPES)[number];

export const REFERRAL_STATUSES = ['PENDING', 'ACCEPTED', 'COMPLETED', 'CANCELLED'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const LAB_ORDER_STATUSES = ['PENDING', 'SAMPLE_COLLECTED', 'PROCESSING', 'COMPLETED', 'CANCELLED'] as const;
export type LabOrderStatus = (typeof LAB_ORDER_STATUSES)[number];

export const INSURANCE_COVERAGE_STATUSES = ['ACTIVE', 'EXPIRED', 'SUSPENDED'] as const;
export type InsuranceCoverageStatus = (typeof INSURANCE_COVERAGE_STATUSES)[number];

export const WALLET_TRANSACTION_TYPES = ['TOPUP', 'DEBIT', 'REFUND', 'TRANSFER'] as const;
export type WalletTransactionType = (typeof WALLET_TRANSACTION_TYPES)[number];

export const SUBSCRIPTION_PLANS = ['FREE', 'STARTER', 'PRO', 'CLINIC'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'EXPIRED', 'CANCELLED', 'PENDING'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

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

export const ADMIN_ACTIONS = [
  'KYC_APPROVE',
  'KYC_REJECT',
  'USER_SUSPEND',
  'USER_ACTIVATE',
  'CONFIG_UPDATE',
  'CONTENT_MODERATE',
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export const SHARE_TYPES = ['QR_CODE', 'LINK', 'TEMPORARY_ACCESS'] as const;
export type ShareType = (typeof SHARE_TYPES)[number];

// ─────────────────────────────────────────────────────────────
// Actions d'audit (champ `action` de AuditLog — String côté Prisma).
// Événements sensibles journalisés dans le trail immuable (CLAUDE.md §4).
// ─────────────────────────────────────────────────────────────
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
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const STOCK_STATUSES = ['IN_STOCK', 'LOW', 'OUT'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];
