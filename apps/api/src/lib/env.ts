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

  // ── Daily.co (téléconsultation WebRTC) — optionnel : stub si absent ──
  DAILY_API_KEY: z.string().optional(),
  DAILY_DOMAIN: z.string().optional(),
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
