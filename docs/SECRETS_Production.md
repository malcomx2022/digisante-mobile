# Secrets & variables de production — DigiSanté Mobile

> Liste des variables à définir **sur le VPS Infomaniak** (jamais commitées). À renseigner dans
> `apps/api/.env` (chargé par PM2 via `--env-file`) et `apps/web/.env.production` (lu au build Next.js).
> Modèle complet : `.env.example` à la racine.

## API (`/var/www/digisante-mobile/apps/api/.env`)

| Variable | Obligatoire | Note |
|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://digisante:<pwd>@localhost:5432/digisante?schema=public` (Postgres 16 natif) |
| `REDIS_URL` | ✅ | `redis://:<pwd>@localhost:6379` |
| `NODE_ENV` | ✅ | `production` (désactive l'exposition du `devCode` OTP) |
| `JWT_SECRET` | ✅ | **≥ 32 caractères aléatoires** — `openssl rand -base64 48` |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | — | défauts `15m` / `30d` |
| `CORS_ORIGIN` | ✅ | `https://digisante.example.bj` (domaine réel) |
| `HEALTH_ENCRYPTION_KEY` | ✅ | **chiffrement santé AES-256 (§4)** — `openssl rand -base64 48`. Sauvegarder hors VPS. |
| `RECONCILE_TOKEN` | ✅ | jeton des crons internes (réconciliation / dispatch) — `openssl rand -hex 32` ; **doit correspondre** à `/etc/digisante/reconcile.token` |
| `FEDAPAY_SECRET_KEY` / `FEDAPAY_PUBLIC_KEY` / `FEDAPAY_WEBHOOK_SECRET` | ✅ paiements | sans elles → stub ; le webhook ne valide pas sans `FEDAPAY_WEBHOOK_SECRET` |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | ✅ SMS/OTP | fallback numéro long (§8) |
| `RESEND_API_KEY` | ✅ emails | — |
| `DAILY_API_KEY` / `DAILY_DOMAIN` | ✅ téléconsult | — |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | ✅ push | clé privée sur une ligne (`\n` échappés) |

## Web (`/var/www/digisante-mobile/apps/web/.env.production`)

| Variable | Note |
|---|---|
| `NEXT_PUBLIC_API_URL` | **figé au build** — `https://digisante.example.bj` |
| `NEXT_PUBLIC_SOS_NUMBER` | numéro d'urgence (repli SMS SOS) |

> ⚠️ `NEXT_PUBLIC_*` est inliné au `next build`. Toute modification nécessite un **rebuild** du web.

## Fichiers hors dépôt (root-only sur le VPS)

| Fichier | Rôle | Génération |
|---|---|---|
| `/etc/digisante/backup.key` | clé de chiffrement des sauvegardes pg_dump | `openssl rand -base64 48` |
| `/etc/digisante/reconcile.token` | jeton du cron de réconciliation (= `RECONCILE_TOKEN`) | `openssl rand -hex 32` |

## Secrets GitHub Actions (déploiement SSH)

`VPS_HOST` · `VPS_USER` · `VPS_SSH_KEY` (clé privée) · `VPS_SSH_PORT` (si ≠ 22)
\+ **variable** `DEPLOY_ENABLED=true` pour activer le job `deploy`.

## Build de production (rappel)

```bash
pnpm install --frozen-lockfile
pnpm --filter @digisante/api prisma generate
pnpm --filter @digisante/api prisma migrate deploy
pnpm build            # shared → api (tsc + tsc-alias) → web (next build)
pm2 startOrReload ecosystem.config.cjs --update-env   # api cluster ×2 + web
```

`ecosystem.config.cjs` (racine) : `digisante-api` (cluster ×2, `--env-file=.env`) + `digisante-web`
(`next start`). Logs sous `/var/log/digisante/`.
