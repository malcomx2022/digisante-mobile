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

### Frontière des secrets (infra vs intégration) — cf. `PLAN_Gestion_API_Admin.md`

- **Secrets d'infrastructure** (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `HEALTH_ENCRYPTION_KEY`,
  `RECONCILE_TOKEN`) : **toujours en `.env`**, jamais en base — ils démarrent l'app et servent à
  **déchiffrer** les secrets stockés en base (les mettre en base = dépendance circulaire).
- **Secrets d'intégration** (`TWILIO_*`, `DAILY_*`, `FIREBASE_*`, `RESEND_*`, `FEDAPAY_*`) : la
  **gestion via l'admin** est **livrée** (super admin, `/admin/integrations`, chiffrée AES-256 en
  base). Leur présence en `.env` est désormais **optionnelle** (fallback / bootstrap) — dès qu'une
  clé est saisie en base via l'UI, la **valeur en base prime** (résolution dynamique
  `resolveConfiguredSecrets` / `getIntegration`).
- ⚠️ **FedaPay — bascule bac à sable → production (lot 8, août 2026)** : l'environnement est
  **déduit de la clé** (`sk_live_…` → `https://api.fedapay.com/v1` ; toute autre clé →
  `https://sandbox-api.fedapay.com/v1`, repli fail-safe). **Il n'existe PAS de variable
  `FEDAPAY_ENV`** — ne pas en ajouter : un réglage séparé peut diverger de la clé, alors que la
  dérivation rend impossible de pointer une clé de test vers la production, ou l'inverse.
  **Mise en production = remplacer les 3 secrets, rien d'autre** (aucun redéploiement de code) :
  1. `FEDAPAY_SECRET_KEY` : `sk_sandbox_…` → `sk_live_…`
  2. `FEDAPAY_PUBLIC_KEY` : `pk_sandbox_…` → `pk_live_…`
  3. `FEDAPAY_WEBHOOK_SECRET` : le secret du endpoint **de production** (`wh_…`), **différent** de
     celui du bac à sable → à roter **en même temps**, sinon tous les webhooks tombent en 401.
  Puis déclarer l'URL du webhook de production dans le dashboard FedaPay
  (`https://<domaine>/api/v1/payments/webhook`, **HTTPS + TLS 1.2/1.3 obligatoires**) et vérifier
  qu'un événement de test arrive en 200. Tant qu'aucune clé n'est résolue, l'API tourne en **stub**
  (dégradation gracieuse voulue) ; la bascule stub → réel est **dynamique**, sans redémarrage.
- **FedaPay** (`FEDAPAY_*`) — **§5 encadré (Lot E)** : ses clés + secret webhook sont désormais
  gérables via l'admin **comme les autres**, MAIS la **logique de paiement reste gelée §5** (seule
  la SOURCE des secrets a changé). Toute **rotation** du `webhookSecret` FedaPay doit être suivie
  d'un **re-test des webhooks** (le secret en base prime sur le `.env` : synchroniser la valeur
  côté FedaPay). Le journal des webhooks FedaPay reste sous **`/admin/finance/webhooks`**.

### Runbook — rotation d'une clé d'intégration (non-FedaPay)

1. Générer/roter la clé chez le fournisseur (Twilio/Daily/Resend/Firebase console).
2. `/admin/integrations` → carte du provider → **Saisir / roter** → renseigner la **totalité**
   des clés du provider (le `PUT` **remplace** l'ensemble, jamais partiel) → **Enregistrer**.
   Le cache Redis du blob chiffré est **invalidé** automatiquement ; la bascule est immédiate
   (pas de redémarrage). L'action est auditée `INTEGRATION_UPDATE` (**noms de clés seulement**).
3. **Webhooks** : poser/roter `webhookSecret` (émis par le fournisseur) et `webhookUrl` (HTTPS)
   via le même formulaire. Le secret webhook n'est **jamais** généré ni renvoyé par l'app.
4. Cliquer **Tester** (readiness) puis vérifier que le provider passe `configuré`.
5. La clé en `.env` peut ensuite être retirée (le fallback n'est plus utilisé) ; la garder ne
   nuit pas (la base prime). Sauvegarde : la base chiffrée est incluse dans le `pg_dump` nocturne ;
   `HEALTH_ENCRYPTION_KEY` reste hors VPS.

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
