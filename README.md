# DigiSanté Mobile

PWA e-santé pour le Bénin — programme **NEXT IMPACT** (FP2E / Sèmè City / Banque Mondiale).
Offline-first · multilingue (FR, EN, Fɔ̀ngbè, Yorùbá) · téléconsultation · DMP · Mobile Money · wallet diaspora.

> Les conventions et décisions verrouillées du projet sont dans [`CLAUDE.md`](./CLAUDE.md).

## Architecture

Monorepo **pnpm** :

```
apps/web      Next.js 14 (App Router, PWA) — 66 pages
apps/api      Fastify — 163 endpoints REST + 1 WebSocket / 27 modules + Prisma + Redis
packages/shared   types, enums, schémas zod partagés
packages/config   tsconfig de base
infra/        docker-compose dev (Postgres 16 + Redis) · scripts deploy VPS
```

**Stack** : Next.js 14 · Fastify · Prisma · PostgreSQL 16 (natif) · Redis · Daily.co · FedaPay · Firebase FCM · Twilio · Resend.
**Prod** : VPS Infomaniak Ubuntu 22.04 (Nginx, PM2, Certbot). Jamais Supabase/Railway/Vercel.

## Démarrage local

```bash
# 0. pré-requis : Node ≥ 24, pnpm ≥ 9, Docker
corepack enable

# 1. dépendances
pnpm install

# 2. variables d'env
cp .env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# 3. services locaux (Postgres 16 + Redis)
pnpm services:up

# 4. base de données
pnpm db:generate
pnpm db:migrate          # crée/applique les migrations
pnpm db:seed             # données de dev

# 5. lancer web + api
pnpm dev                 # web :3000 · api :3001
```

Vérifier l'API : `curl http://localhost:3001/api/v1/health` puis `/api/v1/ready`.

## Scripts utiles

| Commande | Effet |
|---|---|
| `pnpm dev` | web + api en parallèle |
| `pnpm dev:api` / `pnpm dev:web` | un seul service |
| `pnpm build` | build de tout le workspace |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | qualité |
| `pnpm release:check` | contrôle de release local (voir ci-dessous) |
| `pnpm test:scripts` | tests des scripts d'outillage (`scripts/**/*.test.mjs`) |
| `pnpm db:studio` | Prisma Studio |
| `pnpm services:up` / `services:down` | Postgres + Redis (Docker dev) |

### Contrôle de release — `pnpm release:check`

Enchaîne **prérequis → i18n → lint → typecheck → migrations → tests des scripts → tests → build**
et s'arrête au **premier** échec. Non destructif : aucun déploiement, aucun appel fournisseur
(`NODE_ENV=test` imposé ⇒ stubs), migrations **en lecture seule** (`prisma migrate status` +
`migrate diff --exit-code` pour la dérive schéma ↔ base). Refuse `NODE_ENV=production` et la base
Redis 0 (les tests la purgent).

```bash
pnpm services:up                      # ou PostgreSQL 16 :5434 + Redis :6380 natifs
export DATABASE_URL="postgresql://digisante:devpassword@127.0.0.1:5434/digisante_test?schema=public"
export REDIS_URL="redis://127.0.0.1:6380/1"
pnpm --filter @digisante/api prisma migrate deploy   # une fois, base de TEST uniquement
pnpm release:check                    # --dry-run · --skip=build · --strict-i18n
```

`--strict-i18n` fait aussi échouer les clés **critiques** FON/YOR manquantes (à utiliser pour la
release patients réels, B1). Les e2e restent `pnpm test:e2e` (build dédié, cf. `playwright.config.ts`).

## Où déposer le code existant

- pages Next.js → `apps/web/src/app/`
- modules Fastify → `apps/api/src/modules/<domaine>/` (1 dossier par domaine, fichier `*.routes.ts` enregistré dans `src/server.ts`)
- schéma Prisma (48 modèles, 31 enums) → remplacer `apps/api/prisma/schema.prisma`
- types partagés → `packages/shared/src/`

## CI / Déploiement

`.github/workflows/ci.yml` : install → prisma → lint → typecheck → test → build sur chaque PR.
Le job `deploy` (SSH vers le VPS) est en commentaire, à activer avec les secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`.
