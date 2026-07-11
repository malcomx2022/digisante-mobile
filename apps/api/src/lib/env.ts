import { z } from 'zod';

// NODE_ENV est REQUIS (aucun défaut) : un environnement qui ne le déclare pas est
// une erreur de configuration, pas un mode « développement » silencieux (fail-safe).
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
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
  // OBLIGATOIRE hors `test` (développement ET production) — le chiffrement est
  // toujours actif sur un vrai serveur ; seul l'env `test` tolère son absence.
  HEALTH_ENCRYPTION_KEY: z.string().optional(),
  // Répertoire des fichiers KYC chiffrés (disque VPS — cf. lib/filestore.ts).
  KYC_STORAGE_DIR: z.string().optional(),

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
  // ── Durcissement (CLAUDE.md §4) — FAIL-SAFE ──
  // Hors `test`, refuser de démarrer sans chiffrement des données de santé ni JWT
  // solide : un déploiement resté par erreur en NODE_ENV=development ne peut donc
  // PAS tourner en clair. Seul l'environnement `test` reste permissif (CI).
  .superRefine((val, ctx) => {
    if (val.NODE_ENV === 'test') return;
    if (!val.HEALTH_ENCRYPTION_KEY || val.HEALTH_ENCRYPTION_KEY.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['HEALTH_ENCRYPTION_KEY'],
        message:
          'HEALTH_ENCRYPTION_KEY est obligatoire hors test (≥ 32 caractères) — chiffrement AES-256 des données de santé (§4).',
      });
    }
    if (val.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET doit faire ≥ 32 caractères hors test.',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Variables d'environnement invalides :", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

// Twilio / Daily / Firebase / Resend / FedaPay : la « configuration » est désormais
// résolue DYNAMIQUEMENT par le resolver d'intégrations (base chiffrée → `.env`, §3.6)
// via `resolveConfiguredSecrets`/`isConfigured` — plus AUCUN booléen statique au
// démarrage (Lots C + E). FedaPay reste §5 (logique de paiement gelée) mais ses clés
// sont gérables via l'admin comme les autres.
