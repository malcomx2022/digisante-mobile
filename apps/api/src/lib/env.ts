import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  API_PORT: z.coerce.number().default(3001),
  API_HOST: z.string().default('0.0.0.0'),
  JWT_SECRET: z.string().min(8),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // ── JWT (durées de vie) ──
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // ── Twilio (SMS / OTP vocal) — optionnel : stub si absent ──
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // ── Numéro de secours public (SAMU/urgences) prévenu lors d'un SOS — optionnel ──
  SOS_PUBLIC_NUMBER: z.string().optional(),

  // ── Daily.co (téléconsultation WebRTC) — optionnel : stub si absent ──
  DAILY_API_KEY: z.string().optional(),
  DAILY_DOMAIN: z.string().optional(),

  // ── Chiffrement des données de santé au repos (AES-256, CLAUDE.md §4) ──
  // En production cette clé est OBLIGATOIRE ; en dev/local, fallback non chiffré.
  HEALTH_ENCRYPTION_KEY: z.string().optional(),

  // ── FedaPay (Mobile Money / cartes) — optionnel : stub si absent ──
  FEDAPAY_SECRET_KEY: z.string().optional(),
  FEDAPAY_PUBLIC_KEY: z.string().optional(),
  FEDAPAY_WEBHOOK_SECRET: z.string().optional(),

  // ── Jeton de service pour les tâches internes (réconciliation, dispatch) ──
  RECONCILE_TOKEN: z.string().optional(),

  // ── Firebase FCM (push) — optionnel : stub si absent ──
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),

  // ── Resend (emails transactionnels) — optionnel : stub si absent ──
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
})
  // ── Durcissement production (CLAUDE.md §4) ──
  // En prod, refuser de démarrer sans chiffrement des données de santé ni JWT solide.
  // En dev/test : aucune exigence supplémentaire (comportement inchangé).
  .superRefine((val, ctx) => {
    if (val.NODE_ENV !== 'production') return;
    if (!val.HEALTH_ENCRYPTION_KEY || val.HEALTH_ENCRYPTION_KEY.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['HEALTH_ENCRYPTION_KEY'],
        message:
          'HEALTH_ENCRYPTION_KEY est obligatoire en production (≥ 32 caractères) — chiffrement AES-256 des données de santé.',
      });
    }
    if (val.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET doit faire ≥ 32 caractères en production.',
      });
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Variables d'environnement invalides :", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

/** Vrai si Twilio est configuré (sinon les envois SMS/voix sont des stubs). */
export const isTwilioConfigured = Boolean(
  env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER,
);

/** Vrai si Daily.co est configuré (sinon les salles/jetons sont des stubs). */
export const isDailyConfigured = Boolean(env.DAILY_API_KEY && env.DAILY_DOMAIN);

/** Vrai si FedaPay est configuré (sinon création de transaction en stub). */
export const isFedapayConfigured = Boolean(env.FEDAPAY_SECRET_KEY && env.FEDAPAY_PUBLIC_KEY);

/** Vrai si Firebase FCM est configuré (sinon push en stub). */
export const isFirebaseConfigured = Boolean(
  env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY,
);

/** Vrai si Resend est configuré (sinon email en stub). */
export const isResendConfigured = Boolean(env.RESEND_API_KEY);
