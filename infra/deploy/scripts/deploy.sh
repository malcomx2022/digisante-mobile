#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Déploiement DigiSanté Mobile sur le VPS.
# Exécuté soit par GitHub Actions (SSH), soit manuellement sur le VPS,
# en tant qu'utilisateur applicatif DE L'ENVIRONNEMENT (digisante-preprod ou digisante),
# depuis APP_DIR. cf. CLAUDE.md §6 (jamais `db push` en prod) et §7.
# Hôte IONOS partagé : DEPLOY_ENVIRONMENT fixe DIGISANTE_ENV, donc les noms PM2 arrêtés
# AVANT migration, le port de readiness et le profil passé à ecosystem.config.cjs.
#
#   DEPLOY_REF=<SHA> DEPLOY_ENVIRONMENT=preproduction DEPLOY_MAINTENANCE_READY=1 bash deploy.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# >>> digisante_profile (environnement — copie IDENTIQUE dans chaque script d'exploitation ; test de non-dérive)
# DIGISANTE_ENV est OBLIGATOIRE, sans défaut : préproduction et production cohabitent sur
# l'hôte IONOS partagé, où 3000 (ImmiPro) et 3001 (Grafana) sont déjà pris. Il FIXE les
# noms PM2, les ports (mêmes valeurs que ecosystem.config.cjs, test de cohérence) et l'URL
# locale de l'API : un jeton de service ne part que vers l'API de CET environnement. Il
# donne aussi les chemins PAR DÉFAUT (utilisateur, compte sans droits des tâches, checkout,
# journaux, copie root, configuration, état, sauvegardes, base, crontab, journal
# WebSocket) ; une valeur déjà posée par l'opérateur prime pour ces chemins.
# Chaque script n'utilise qu'une partie de ces variables communes (SC2034 attendu).
# shellcheck disable=SC2034
digisante_profile() {
  local sfx
  case "${DIGISANTE_ENV:-}" in
    preproduction) sfx=-preprod; API_PORT=3101; WEB_PORT=3100; : "${DB_NAME:=digisante_preprod}" ;;
    production) sfx=; API_PORT=3201; WEB_PORT=3200; : "${DB_NAME:=digisante}" ;;
    *) echo "DIGISANTE_ENV requis : preproduction ou production (aucun défaut implicite)" >&2; return 1 ;;
  esac
  PM2_API="digisante${sfx}-api"; PM2_WEB="digisante${sfx}-web"; API_BASE="http://127.0.0.1:${API_PORT}"
  : "${APP_USER:=digisante${sfx}}" "${JOBS_USER:=digisante${sfx}-jobs}"
  : "${APP_DIR:=/var/www/digisante${sfx}}" "${APP_LOG_DIR:=/var/log/digisante${sfx}}"
  : "${ETC_DIR:=/etc/digisante${sfx}}" "${ROOT_LIB:=/usr/local/lib/digisante${sfx}}" "${STATE_DIR:=/var/lib/digisante${sfx}}"
  : "${CRON_LOG_DIR:=/var/log/digisante${sfx}-cron}" "${BACKUP_DIR:=/var/backups/digisante${sfx}}"
  : "${CRON_FILE:=/etc/cron.d/digisante${sfx}}" "${WS_LOG:=/var/log/nginx/digisante${sfx}-ws.log}"
}
# <<< digisante_profile

BRANCH="${DEPLOY_BRANCH:-main}"
# ROLLBACK explicite : ajouter DEPLOY_ALLOW_ROLLBACK=1 pour redéployer un ancêtre
# du checkout courant. Sans cet opt-in, une ancienne CI ne peut pas revenir en arrière.
# Les SHA déployés sont tracés dans ${LOG_DIR}/deploy_history.log.
# ⚠️ Les migrations sont À SENS UNIQUE : revenir avant une migration appliquée exige
# une restauration de base (SUIVI_B5), pas seulement un rollback de code.
DEPLOY_REF="${DEPLOY_REF:?Définir DEPLOY_REF (SHA complet qualifié)}"
DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT:?Définir DEPLOY_ENVIRONMENT (preproduction ou production)}"
[[ "$DEPLOY_REF" =~ ^[0-9a-f]{40}$ ]] || { echo "SHA complet de 40 caractères requis" >&2; exit 1; }
[[ -z "${DEPLOY_TOOLING_SHA:-}" || "$DEPLOY_TOOLING_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "SHA de l'outillage invalide" >&2; exit 1; }
[[ "$DEPLOY_ENVIRONMENT" == "preproduction" || "$DEPLOY_ENVIRONMENT" == "production" ]] || { echo "Environnement de déploiement invalide" >&2; exit 1; }
[[ "${DEPLOY_MAINTENANCE_READY:-}" == "1" ]] || { echo "Maintenance cible à confirmer avec DEPLOY_MAINTENANCE_READY=1 ; anciens writers à arrêter." >&2; exit 1; }
# Un seul environnement par déploiement : DIGISANTE_ENV hérité d'un autre contexte refusé.
[[ -z "${DIGISANTE_ENV:-}" || "$DIGISANTE_ENV" == "$DEPLOY_ENVIRONMENT" ]] || { echo "DIGISANTE_ENV (${DIGISANTE_ENV}) ≠ DEPLOY_ENVIRONMENT (${DEPLOY_ENVIRONMENT})" >&2; exit 1; }
export DIGISANTE_ENV="$DEPLOY_ENVIRONMENT"
digisante_profile
LOG_DIR="${LOG_DIR:-$APP_LOG_DIR}"

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
# pnpm de la version épinglée (packageManager du dépôt) via corepack, jamais le pnpm global de
# l'hôte partagé (autre version, celle des autres applications). Contrôlé AVANT l'arrêt PM2.
command -v corepack >/dev/null 2>&1 || { log "ERREUR : corepack absent (Node 24) : pnpm épinglé introuvable."; exit 1; }
# `|| return` : l'échec remonte à l'appelant, où le piège ERR trace l'échec (non hérité ici).
pnpm() { COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm "$@" || return; }
# Sérialiser aussi les invocations manuelles : deux candidats ne doivent pas comparer
# leur ascendance au même ancien HEAD puis se déployer dans l'ordre inverse.
exec 9>"$LOG_DIR/deploy.lock"
flock -n 9 || { log "ERREUR : un déploiement de cet environnement est déjà en cours."; exit 1; }
node - "$ENV_FILE" "$DEPLOY_ENVIRONMENT" <<'JS'
const fs = require('node:fs'); const { parseEnv } = require('node:util');
const env = parseEnv(fs.readFileSync(process.argv[2], 'utf8'));
const profile = process.argv[3] === 'preproduction'
  ? { database: 'digisante_preprod', redis: '/5' }
  : { database: 'digisante', redis: '/6' };
const refuse = (message) => { fs.writeSync(2, `${message} ; aucun processus arrêté ni migration lancée.\n`); process.exit(1); };
if (env.NODE_ENV !== 'production') refuse('NODE_ENV=production requis dans le fichier API');
// Prisma et Node --env-file gardent les variables héritées : contrôler aussi cette
// priorité, sinon le .env vérifié pourrait différer de la base réellement migrée.
for (const key of ['NODE_ENV', 'DATABASE_URL', 'REDIS_URL']) {
  if (process.env[key] !== undefined && process.env[key] !== env[key]) refuse(`${key} hérité différent du fichier API`);
}
const parsed = (key, protocols, port) => {
  const raw = env[key];
  if (!raw || raw !== raw.trim() || /[\s\\\u0000-\u001f\u007f]/.test(raw)) refuse(`${key} invalide`);
  let value;
  try { value = new URL(raw); } catch { refuse(`${key} invalide`); }
  if (!protocols.includes(value.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(value.hostname)
    || (value.port && value.port !== port) || !value.password || value.hash) refuse(`${key} doit cibler le service local du profil`);
  return value;
};
const db = parsed('DATABASE_URL', ['postgresql:', 'postgres:'], '5432');
let database, role;
try { database = decodeURIComponent(db.pathname.slice(1)); role = decodeURIComponent(db.username); }
catch { refuse('DATABASE_URL invalide'); }
if (database !== profile.database || role !== profile.database
  || db.searchParams.getAll('schema').some((schema) => schema !== 'public')
  || db.searchParams.has('host')) refuse('DATABASE_URL ne correspond pas à la base, au rôle ou au schéma du profil');
const redis = parsed('REDIS_URL', ['redis:'], '6379');
if (redis.pathname !== profile.redis || redis.search) refuse('REDIS_URL ne correspond pas à l’index du profil');
JS
PREVIOUS_SHA="$(git rev-parse HEAD)"
git check-ref-format --branch "$BRANCH" >/dev/null
log "Récupération de la branche ${BRANCH}…"
git fetch origin --prune --tags
TARGET_SHA="$(git rev-parse --verify "${DEPLOY_REF}^{commit}")"
[[ "$TARGET_SHA" == "$DEPLOY_REF" ]] || { log "ERREUR : SHA cible non résolu exactement."; exit 1; }
git merge-base --is-ancestor "$TARGET_SHA" "origin/$BRANCH" || { log "ERREUR : SHA absent de la branche cible."; exit 1; }
if ! git merge-base --is-ancestor "$PREVIOUS_SHA" "$TARGET_SHA"; then
  [[ "${DEPLOY_ALLOW_ROLLBACK:-}" == "1" ]] || { log "ERREUR : SHA cible antérieur ou divergent du checkout courant ; rollback explicite requis (DEPLOY_ALLOW_ROLLBACK=1), schéma et sauvegarde à vérifier."; exit 1; }
  git merge-base --is-ancestor "$TARGET_SHA" "$PREVIOUS_SHA" || { log "ERREUR : rollback refusé ; la cible n'est pas un ancêtre du checkout courant."; exit 1; }
  log "Rollback explicite ${PREVIOUS_SHA} → ${TARGET_SHA} ; aucune migration appliquée n'est annulée."
fi
STAGE=maintenance
record() { printf '%s %s -> %s environment=%s status=%s stage=%s tooling=%s\n' "$(date -Is)" "$PREVIOUS_SHA" "$TARGET_SHA" "$DEPLOY_ENVIRONMENT" "$1" "$STAGE" "${DEPLOY_TOOLING_SHA:-manual}" >> "$LOG_DIR/deploy_history.log"; }
on_error() { local code=$?; trap - ERR; record FAILED || true; log "ERREUR au stade ${STAGE} : état PM2 et schéma à vérifier ; aucun rollback automatique ni ancien code garanti."; exit "$code"; }
trap on_error ERR
# Une reload rolling mélange anciens/nouveaux writers lors des migrations.
# La maintenance Nginx doit avoir été posée par l'opérateur avant cette commande.
# Noms de CET environnement uniquement (profil) : jamais ceux de l'autre environnement.
STOP_APPS="$(pm2 jlist | PM2_API="$PM2_API" PM2_WEB="$PM2_WEB" node -e '
let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{try {
const l=JSON.parse(d); if(!Array.isArray(l)) throw new Error(); const names=[process.env.PM2_API,process.env.PM2_WEB];
console.log([...new Set(l.filter(p=>names.includes(p.name)).map(p=>p.name))].join(" "));
} catch { console.error("État PM2 illisible (valeurs non affichées)");process.exit(1)}})')"
if [[ -n "$STOP_APPS" ]]; then
  read -r -a stop_names <<< "$STOP_APPS"
  pm2 stop "${stop_names[@]}"
  pm2 save --force
fi
pm2 jlist | PM2_API="$PM2_API" PM2_WEB="$PM2_WEB" node -e '
let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{try {
const l=JSON.parse(d); const names=[process.env.PM2_API,process.env.PM2_WEB];
if(!Array.isArray(l) || l.some(p=>names.includes(p.name)&&p.pm2_env?.status!=="stopped")) throw new Error();
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
log "Démarrage homogène PM2 ${DIGISANTE_ENV} (maintenance conservée)…"
# DIGISANTE_ENV exporté : ecosystem.config.cjs refuse de démarrer sans lui.
pm2 startOrReload "$APP_DIR/ecosystem.config.cjs" --update-env
pm2 save

# ── Healthcheck readiness (DB + Redis) après reload ──────────────────────
# /api/v1/ready renvoie 200 si Prisma et Redis répondent, 503 sinon.
# Port de l'environnement (profil = ecosystem.config.cjs), jamais 3001 (Grafana sur l'hôte).
READY_URL="${API_BASE}/api/v1/ready"
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
  log "Inspecter : pm2 logs ${PM2_API} --lines 100"
  pm2 status
  exit 1
fi

# La maintenance n'est levée qu'après vérification cible et autorisation d'ouverture.
STAGE=complete
record SUCCESS
trap - ERR

# B3 : rappel JAMAIS bloquant. Les scripts lancés par root (crons, sauvegarde) sont une
# copie root:root que l'utilisateur applicatif ne peut pas (et ne doit pas) installer ;
# le manifeste root est lu ici comme simple donnée.
root_scripts_reminder() {
  local manifest="${ROOT_SCRIPTS_MANIFEST:-${ROOT_LIB}/root-scripts.manifest}" installed
  local -a paths=()
  installed="$(sed -n 's/^sha=\([0-9a-f]\{40\}\)$/\1/p' "$manifest" 2>/dev/null || true)"
  if [[ "$installed" == "$TARGET_SHA" ]]; then log "Scripts root : copie installée au même SHA ✓"; return 0; fi
  mapfile -t paths < <(sed -n -E 's#^(0755|0644) ((infra/deploy|scripts)/[A-Za-z0-9._/-]+)$#\2#p' "$APP_DIR/infra/deploy/root-scripts.list" 2>/dev/null)
  if [[ -n "$installed" ]] && (( ${#paths[@]} > 0 )) && git cat-file -e "${installed}^{commit}" 2>/dev/null \
    && git diff --quiet "$installed" "$TARGET_SHA" -- "${paths[@]}"; then
    log "Scripts root : inchangés depuis la copie installée (${installed}) ✓"; return 0
  fi
  log "AVERTISSEMENT (B3) : scripts exécutés par root à mettre à jour (copie installée : ${installed:-aucune}). Après relecture, en root : DIGISANTE_ENV=${DIGISANTE_ENV} ${ROOT_LIB}/infra/deploy/scripts/install_root_scripts.sh ${TARGET_SHA}"
}
root_scripts_reminder || true
log "Déploiement technique terminé (${PREVIOUS_SHA} → ${TARGET_SHA}) ; maintenance à conserver pour la recette."
pm2 status
