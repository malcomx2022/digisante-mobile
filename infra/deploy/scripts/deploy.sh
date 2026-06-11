#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Déploiement DigiSanté Mobile sur le VPS.
# Exécuté soit par GitHub Actions (SSH), soit manuellement sur le VPS,
# en tant qu'utilisateur applicatif (digisante), depuis APP_DIR.
# cf. CLAUDE.md §6 (jamais `db push` en prod) et §7.
#
#   bash infra/deploy/scripts/deploy.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/digisante-mobile}"
BRANCH="${DEPLOY_BRANCH:-main}"

log() { printf '\033[0;36m[deploy]\033[0m %s\n' "$*"; }

cd "$APP_DIR"

log "Récupération de la branche ${BRANCH}…"
git fetch --all --prune
git checkout "$BRANCH"
git reset --hard "origin/${BRANCH}"

log "Installation des dépendances (lockfile gelé)…"
pnpm install --frozen-lockfile

log "Génération du client Prisma…"
pnpm --filter @digisante/api prisma generate

log "Application des migrations (migrate deploy — jamais db push)…"
pnpm --filter @digisante/api prisma migrate deploy

log "Build web + api…"
pnpm build

log "Rechargement PM2 (zero-downtime)…"
# startOrReload : démarre si absent, recharge sinon. --update-env recharge les env.
pm2 startOrReload "$APP_DIR/ecosystem.config.cjs" --update-env
pm2 save

log "Déploiement terminé ✓"
pm2 status
