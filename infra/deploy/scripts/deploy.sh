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
# ROLLBACK : `DEPLOY_REF=<SHA complet> DEPLOY_ENVIRONMENT=preproduction DEPLOY_MAINTENANCE_READY=1 bash deploy.sh` redéploie une version précise au lieu
# de la tête de branche. Les SHA déployés sont tracés dans ${LOG_DIR}/deploy_history.log.
# ⚠️ Les migrations sont À SENS UNIQUE : revenir avant une migration appliquée exige
# une restauration de base (SUIVI_B5), pas seulement un rollback de code.
DEPLOY_REF="${DEPLOY_REF:?Définir DEPLOY_REF (SHA complet qualifié)}"
DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT:?Définir DEPLOY_ENVIRONMENT (preproduction ou production)}"
[[ "$DEPLOY_REF" =~ ^[0-9a-f]{40}$ ]] || { echo "SHA complet de 40 caractères requis" >&2; exit 1; }
[[ "$DEPLOY_ENVIRONMENT" == "preproduction" || "$DEPLOY_ENVIRONMENT" == "production" ]] || { echo "Environnement de déploiement invalide" >&2; exit 1; }
[[ "${DEPLOY_MAINTENANCE_READY:-}" == "1" ]] || { echo "Maintenance cible à confirmer avec DEPLOY_MAINTENANCE_READY=1 ; anciens writers à arrêter." >&2; exit 1; }
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

# Ne pas écraser les changements d'un opérateur ni dériver vers la tête de main.
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || { log "ERREUR : checkout modifié ; préserver le diff avant déploiement."; exit 1; }
[[ -d "$LOG_DIR" && -w "$LOG_DIR" ]] || { log "ERREUR : répertoire de journal non accessible."; exit 1; }
node - "$ENV_FILE" <<'JS'
const fs = require('node:fs'); const { parseEnv } = require('node:util');
const env = parseEnv(fs.readFileSync(process.argv[2], 'utf8'));
if (env.NODE_ENV !== 'production') { console.error('NODE_ENV=production requis dans le fichier API ; aucune migration lancée.'); process.exit(1); }
JS
PREVIOUS_SHA="$(git rev-parse HEAD)"
git check-ref-format --branch "$BRANCH" >/dev/null
log "Récupération de la branche ${BRANCH}…"
git fetch origin --prune --tags
TARGET_SHA="$(git rev-parse --verify "${DEPLOY_REF}^{commit}")"
[[ "$TARGET_SHA" == "$DEPLOY_REF" ]] || { log "ERREUR : SHA cible non résolu exactement."; exit 1; }
git merge-base --is-ancestor "$TARGET_SHA" "origin/$BRANCH" || { log "ERREUR : SHA absent de la branche cible."; exit 1; }
STAGE=maintenance
record() { printf '%s %s -> %s environment=%s status=%s stage=%s\n' "$(date -Is)" "$PREVIOUS_SHA" "$TARGET_SHA" "$DEPLOY_ENVIRONMENT" "$1" "$STAGE" >> "$LOG_DIR/deploy_history.log"; }
on_error() { local code=$?; trap - ERR; record FAILED || true; log "ERREUR au stade ${STAGE} : état PM2 et schéma à vérifier ; aucun rollback automatique ni ancien code garanti."; exit "$code"; }
trap on_error ERR
# Une reload rolling mélange anciens/nouveaux writers lors des migrations.
# La maintenance Nginx doit avoir été posée par l'opérateur avant cette commande.
STOP_APPS="$(pm2 jlist | node -e '
let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{try {
const l=JSON.parse(d); if(!Array.isArray(l)) throw new Error();
console.log([...new Set(l.filter(p=>["digisante-api","digisante-web"].includes(p.name)).map(p=>p.name))].join(" "));
} catch { console.error("État PM2 illisible (valeurs non affichées)");process.exit(1)}})')"
if [[ -n "$STOP_APPS" ]]; then
  read -r -a stop_names <<< "$STOP_APPS"
  pm2 stop "${stop_names[@]}"
  pm2 save --force
fi
pm2 jlist | node -e '
let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{try {
const l=JSON.parse(d); if(!Array.isArray(l) || l.some(p=>["digisante-api","digisante-web"].includes(p.name)&&p.pm2_env?.status!=="stopped")) throw new Error();
} catch { console.error("Anciens processus encore actifs ou état PM2 inconnu : arrêt avant migration.");process.exit(1)}})'
STAGE=checkout
git switch --detach "$TARGET_SHA"
STAGE=install

log "Installation des dépendances (lockfile gelé)…"
pnpm install --frozen-lockfile

log "Génération du client Prisma…"
pnpm --filter @digisante/api prisma generate

# Build réussi AVANT les migrations ; tous les anciens processus sont arrêtés.
STAGE=build
log "Build web + api…"
pnpm build
STAGE=migrations
log "Application des migrations (migrate deploy — jamais db push)…"
pnpm --filter @digisante/api prisma migrate deploy
STAGE=restart
log "Démarrage homogène PM2 (maintenance conservée)…"
pm2 startOrReload "$APP_DIR/ecosystem.config.cjs" --update-env
pm2 save

# ── Healthcheck readiness (DB + Redis) après reload ──────────────────────
# /api/v1/ready renvoie 200 si Prisma et Redis répondent, 503 sinon.
API_PORT="${API_PORT:-3001}"
READY_URL="http://127.0.0.1:${API_PORT}/api/v1/ready"
STAGE=readiness
log "Healthcheck ${READY_URL} (10 tentatives)…"
healthy=0
for i in $(seq 1 10); do
  if curl -fsS --connect-timeout 3 --max-time 5 "$READY_URL" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d);process.exit(r.status==="ready"&&r.db==="up"&&r.redis==="up"?0:1)}catch{process.exit(1)}})' ; then
    healthy=1
    log "API prête (tentative ${i}) ✓"
    break
  fi
  log "API pas encore prête (tentative ${i}/10), nouvelle tentative dans 3s…"
  sleep 3
done

if [ "$healthy" -ne 1 ]; then
  log "ERREUR : l'API ne répond pas sur ${READY_URL} après le déploiement."
  record FAILED
  log "État PM2 et schéma à vérifier ; maintenance conservée, aucun ancien code garanti."
  log "Inspecter : pm2 logs digisante --lines 100"
  pm2 status
  exit 1
fi

# La maintenance n'est levée qu'après vérification cible et autorisation d'ouverture.
STAGE=complete
record SUCCESS
trap - ERR
log "Déploiement technique terminé (${PREVIOUS_SHA} → ${TARGET_SHA}) ; maintenance à conserver pour la recette."
pm2 status
