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
# ROLLBACK : `DEPLOY_REF=<sha|tag> bash deploy.sh` redéploie une version précise au lieu
# de la tête de branche. Les SHA déployés sont tracés dans ${LOG_DIR}/deploy_history.log.
# ⚠️ Les migrations sont À SENS UNIQUE : revenir avant une migration appliquée exige
# une restauration de base (SUIVI_B5), pas seulement un rollback de code.
DEPLOY_REF="${DEPLOY_REF:-}"
LOG_DIR="${LOG_DIR:-/var/log/digisante}"

log() { printf '\033[0;36m[deploy]\033[0m %s\n' "$*"; }

cd "$APP_DIR"

# ── Préconditions : le .env de l'API existe et n'est lisible que par son propriétaire ──
ENV_FILE="$APP_DIR/apps/api/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  log "ERREUR : $ENV_FILE absent — l'API refuserait de démarrer (config fail-safe). Voir infra/deploy/README.md §2."
  exit 1
fi
if [[ "$(stat -c '%a' "$ENV_FILE")" != "600" ]]; then
  log "Permissions de $ENV_FILE ramenées à 600 (secrets : propriétaire seul)."
  chmod 600 "$ENV_FILE"
fi

PREVIOUS_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo none)"
log "Récupération de la branche ${BRANCH}…"
git fetch --all --prune --tags
git checkout "$BRANCH"
if [[ -n "$DEPLOY_REF" ]]; then
  log "ROLLBACK / version ciblée : ${DEPLOY_REF}"
  git reset --hard "$DEPLOY_REF"
else
  git reset --hard "origin/${BRANCH}"
fi
TARGET_SHA="$(git rev-parse --short HEAD)"

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

# Historique pour le rollback : horodatage, version précédente → version déployée.
printf '%s %s -> %s%s\n' "$(date -Is)" "$PREVIOUS_SHA" "$TARGET_SHA" "${DEPLOY_REF:+ (DEPLOY_REF=${DEPLOY_REF})}" \
  >> "${LOG_DIR}/deploy_history.log" 2>/dev/null || true
log "Déploiement terminé ✓ (${PREVIOUS_SHA} → ${TARGET_SHA})"
pm2 status
