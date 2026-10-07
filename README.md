# DigiSanté Mobile

PWA e-santé pour le Bénin — programme **NEXT IMPACT** (FP2E / Sèmè City / Banque Mondiale).
Offline-first · multilingue (FR, EN, Fɔ̀ngbè, Yorùbá) · téléconsultation · DMP · Mobile Money · wallet diaspora.

> Les conventions et décisions verrouillées du projet sont dans [`CLAUDE.md`](./CLAUDE.md).
> **Finalisation en cours :** [plan L0–L11](./docs/PLAN_Implementations_Restantes_2026-10.md) — DMP, labo, synchronisation/hors-ligne, Daily, abonnements/revenus, sécurité et preuves d'ouverture. L0–L3 fusionnés (#183 pour L3) ; L4 en revue, [contrat hors ligne protégé](./docs/CONTRAT_Hors_Ligne_L4.md) et [preuves L4](./docs/suivi/LOT_L4.md) ; [contrat de synchronisation](./docs/CONTRAT_Synchronisation_L3.md) et [preuves du lot](./docs/suivi/LOT_L3.md) ; L5–L11 planifiés. Une revue par lot avant PR/merge. Planifié ne signifie pas implémenté ou déployé.
> Maintenance du 6 octobre 2026 : contrôles JWT par requête, remboursements WALLET atomiques, réconciliation PENDING/PROCESSING et réservations sous verrou PostgreSQL. Reprise Claude Code : [`playbook de maintenance`](./docs/PLAYBOOK_Codage_DigiSante.md#maintenance-après-revue--6-octobre-2026). Migration `20261006130000_wallet_refund_in` requise avant déploiement du correctif.

> L1 : échéances et auteurs DMP côté serveur, [revue](./docs/REVUE_L1_2026-10.md). Migration additive `20261006144830_dmp_entry_expiry_authorship` : les liens historiques non prouvés restent fermés jusqu’à une nouvelle réclamation valide ; anciens auteurs inconnus conservés. Procédure de maintenance et limites de reprise dans la fiche L1.

## Architecture

Monorepo **pnpm** :

```
apps/web      Next.js 14 (App Router, PWA) — 67 pages
apps/api      Fastify — 168 endpoints REST + 1 WebSocket / 28 modules + Prisma + Redis
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
| `pnpm metrics` / `pnpm metrics:check` | compteurs mesurés (routes REST/WS, pages, modèles, tests…) ; `:check` échoue si `docs/metrics.json` ou un document actif a dérivé |
| `pnpm test:scripts` | tests des scripts d'outillage (`scripts/**/*.test.mjs`) |
| `pnpm db:studio` | Prisma Studio |
| `pnpm services:up` / `services:down` | Postgres + Redis (Docker dev) |

### Contrôle de release — `pnpm release:check`

Enchaîne **prérequis → i18n → compteurs → lint → typecheck → migrations → tests des scripts → tests → build**
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
- schéma Prisma (49 modèles, 31 enums) → remplacer `apps/api/prisma/schema.prisma`
- types partagés → `packages/shared/src/`

## CI / Déploiement

`.github/workflows/ci.yml` : install → prisma → lint → typecheck → test → build sur chaque PR.
Le job `deploy` (SSH vers le VPS) existe et dépend des jobs `build-and-test` et `e2e` ; il est conditionné par `vars.DEPLOY_ENABLED == 'true'`. Configurer les secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` et le port éventuel conformément aux runbooks avant de l'activer pour un déploiement autorisé. Sa présence n'atteste aucun déploiement réussi.


Téléconsultation privée L5 (candidate du 7 octobre) : SDK Daily officiel, accès nominatif sans token dans URL, contrôle de salle/participants/échéances et bascule média. [Contrat](docs/CONTRAT_Teleconsultation_L5.md), [suivi et preuves](docs/suivi/LOT_L5.md), [revue](docs/REVUE_L5_2026-10.md). Appel fournisseur réel et validation avant pilote restent L10/L11 ; aucune mise en production attestée.
