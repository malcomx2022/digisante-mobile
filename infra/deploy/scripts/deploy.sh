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

# ── Healthcheck readiness (DB + Redis) après reload ──────────────────────
# /api/v1/ready renvoie 200 si Prisma et Redis répondent, 503 sinon.
API_PORT="${API_PORT:-3001}"
READY_URL="http://127.0.0.1:${API_PORT}/api/v1/ready"
log "Healthcheck ${READY_URL} (10 tentatives)…"
healthy=0
for i in $(seq 1 10); do
  if curl -fsS "$READY_URL" >/dev/null 2>&1; then
    healthy=1
    log "API prête (tentative ${i}) ✓"
    break
  fi
  log "API pas encore prête (tentative ${i}/10), nouvelle tentative dans 3s…"
  sleep 3
done

if [ "$healthy" -ne 1 ]; then
  log "ERREUR : l'API ne répond pas sur ${READY_URL} après le déploiement."
  log "Le code précédent reste actif sous PM2 (pas de rollback git automatique)."
  log "Inspecter : pm2 logs digisante --lines 100"
  pm2 status
  exit 1
fi

log "Déploiement terminé ✓"
pm2 status
