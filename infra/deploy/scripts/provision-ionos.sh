#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Provisioning DigiSanté Mobile sur l'hôte IONOS PARTAGÉ (srv1.immipro.app, dérogation
# porteur 13/10/2026) — Ubuntu 26.04 LTS, PostgreSQL 18 et Valkey NATIFS déjà en place,
# Nginx déjà en service pour ImmiPro / BeninLink / supervision. Un environnement par
# exécution : DIGISANTE_ENV=preproduction|production (profil commun, sans défaut).
#
# Par défaut : --dry-run. Toutes les gardes (lecture seule) sont évaluées et chaque
# écriture est seulement AFFICHÉE. --apply est requis pour écrire.
#
#   (shell root : `sudo -i`) — secrets saisis par `read -rs` depuis le coffre, jamais sur la ligne de
#   commande (historique, `ps`) : read -rs VALKEY_PASSWORD; read -rs PG_APP_PASSWORD; export …
#   DIGISANTE_ENV=preproduction /usr/local/lib/digisante-preprod/infra/deploy/scripts/provision-ionos.sh
#   DIGISANTE_ENV=preproduction LETSENCRYPT_EMAIL=… /usr/local/lib/digisante-preprod/infra/deploy/scripts/provision-ionos.sh --apply
#   … --verify              liste de vérification post-provisioning (lecture seule)
#   … --rollback [--apply]  retire les seuls artefacts DigiSanté sans données (vhost, cron,
#                           logrotate, service PM2) ; jamais base, rôle, Valkey, fichiers, comptes
#   … --only users,dirs     limite aux étapes nommées (users dirs pg valkey runtime secrets nginx cron)
#
# Ce script ne réinstalle JAMAIS PostgreSQL, Valkey, Node ou Nginx, ne modifie ni UFW, ni le
# fuseau, ni pg_hba, ni un vhost/conteneur/base/index d'une autre application, n'émet aucun
# FLUSHDB/FLUSHALL. Ports 3000 (ImmiPro) et 3001 (Grafana) : jamais configurés ni touchés.
# Secrets : uniquement par l'environnement (coffre opérateur), jamais en argument de
# commande ni affichés : PG_APP_PASSWORD (création du rôle), VALKEY_PASSWORD (VALKEY_USERNAME
# si ACL), LETSENCRYPT_EMAIL (non secret). Le .env de l'API est lu comme DONNÉES (parseEnv).
#
# B3 : lancé par root depuis la copie root:root (install_root_scripts.sh, README §1.a),
# jamais depuis APP_DIR ; crons, Nginx, logrotate copiés depuis cette copie root.
# B4 : magasin KYC = chemin ABSOLU du .env, propriété de l'utilisateur applicatif, 0700 ;
# --verify compare les fichiers présents aux références de la base.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# >>> trusted_path (B3 — copie IDENTIQUE dans chaque script exécuté par root ; test de non-dérive)
# Vrai si le chemin résolu ET tous ses ancêtres appartiennent à root (ou à l'utilisateur
# courant) et ne sont modifiables par aucun autre compte (seule exception : répertoire
# sticky appartenant à root, ex. /tmp). Root n'exécute ni ne lit comme code un fichier
# que l'utilisateur applicatif pourrait réécrire.
trusted_path() {
  local p owner mode
  p="$(readlink -f -- "$1")" && [[ -e "$p" ]] || return 1
  while :; do
    read -r owner mode < <(stat -c '%u %a' -- "$p") || return 1
    [[ "$owner" == 0 || "$owner" == "$EUID" ]] || return 1
    if (( 8#$mode & 8#022 )); then [[ "$owner" == 0 && -d "$p" && -k "$p" ]] || return 1; fi
    [[ "$p" == / ]] && return 0
    p="$(dirname -- "$p")"
  done
}
# <<< trusted_path
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

# ── Arguments ──
MODE=dry-run; ACTION=provision; ONLY=""
while (($#)); do
  case "$1" in
    --dry-run) MODE=dry-run ;;
    --apply) MODE=apply ;;
    --verify) ACTION=verify ;;
    --rollback) ACTION=rollback ;;
    --only) shift; ONLY="${1:?--only exige une liste d’étapes}" ;;
    -h|--help) sed -n '2,34p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "[provision-ionos] argument inconnu : $1 (--help)" >&2; exit 2 ;;
  esac
  shift
done
STEPS="users dirs pg valkey runtime secrets nginx cron"
if [[ -n "$ONLY" ]]; then
  for s in ${ONLY//,/ }; do [[ " $STEPS " == *" $s "* ]] || { echo "[provision-ionos] étape inconnue : $s (${STEPS})" >&2; exit 2; }; done
fi
want() { [[ -z "$ONLY" || ",${ONLY}," == *",$1,"* ]]; }

# ── Racine de test : arborescence temporaire, JAMAIS /, /var, /etc réels ──
# Réservée aux tests (scripts/infra/provision-ionos.test.mjs) : préfixe tous les chemins
# de fichiers ; les commandes restent celles du PATH (simulées par les tests).
TROOT="${PROVISION_TEST_ROOT:-}"
if [[ -n "$TROOT" ]]; then
  TROOT="$(readlink -f -- "$TROOT")"
  [[ -d "$TROOT" && "$TROOT" == */provision-ionos-test.* ]] || { echo "[provision-ionos] PROVISION_TEST_ROOT invalide (répertoire temporaire de test requis)" >&2; exit 2; }
fi
F() { printf '%s%s' "$TROOT" "$1"; }

# ── Journal ──
FAILS=0
log() { printf '[provision-ionos] %s\n' "$*"; }
plan() { printf '[plan] %s\n' "$*"; }
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS + 1)); }
note() { printf 'NOTE  %s\n' "$*"; }
die() { printf '[provision-ionos] REFUS : %s\n' "$*" >&2; exit 1; }
# act <description> <commande…> : exécutée en --apply, affichée sinon (jamais de secret en argument).
act() {
  local desc="$1"; shift
  if [[ "$MODE" == apply ]]; then log "$desc"; "$@"; else plan "${desc} : $(printf '%q ' "$@")"; fi
}

# ── Profil et valeurs propres à l'hôte IONOS ──
digisante_profile || exit 1
case "$DIGISANTE_ENV" in
  preproduction) DOMAINS="preprod.digisantemobile.app"; VALKEY_DB=5; SITE=digisante-preprod ;;
  production) DOMAINS="digisantemobile.app www.digisantemobile.app"; VALKEY_DB=6; SITE=digisante ;;
esac
CERT_NAME="${DOMAINS%% *}"
DB_ROLE="$DB_NAME"
STORE_DIR="/var/lib/${SITE}-files"
ACME_ROOT=/var/www/digisante-acme
NGINX_DIR=/etc/nginx
PM2_VERSION="${PM2_VERSION:-7.0.4}"
PNPM_VERSION=9.12.0
NODE_MAJOR=24
HOST_IP="${HOST_PUBLIC_IP:-31.70.148.167}"
VALKEY_PORT="${VALKEY_PORT:-6379}"
ENV_FILE="${APP_DIR}/apps/api/.env"
: "${PG_APP_PASSWORD:=}" "${VALKEY_PASSWORD:=}" "${VALKEY_USERNAME:=}" "${LETSENCRYPT_EMAIL:=}" "${DEPLOY_SSH_PUBKEY:=}"
[[ "$DB_NAME" =~ ^[a-z][a-z0-9_]*$ && "$APP_USER" =~ ^[a-z][a-z0-9-]*$ && "$JOBS_USER" =~ ^[a-z][a-z0-9-]*$ ]] || die "noms de base ou de comptes invalides"
[[ "$PM2_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "PM2_VERSION : version exacte attendue (x.y.z)"

# Ports de l'hôte réservés à d'autres services : jamais configurés par ce script.
RESERVED_PORTS="3000 3001"
for port in "$API_PORT" "$WEB_PORT"; do
  [[ " $RESERVED_PORTS " != *" $port "* ]] || die "port ${port} réservé (ImmiPro/Grafana) dans le profil ${DIGISANTE_ENV}"
done

# ── Exécution root, depuis une copie de confiance (B3) ──
if [[ -z "$TROOT" ]]; then
  [[ "$EUID" == 0 ]] || die "à lancer en root (sudo) ; --dry-run lit des états réservés à root"
fi
trusted_path "${BASH_SOURCE[0]}" || die "script lancé depuis un emplacement modifiable par un autre compte (APP_DIR ?) : utiliser la copie installée par install_root_scripts.sh (README §1.a)"
SELF_ROOT="$(cd "$(dirname "$(readlink -f -- "${BASH_SOURCE[0]}")")/../../.." && pwd -P)"
# Copie root de CET environnement (amorçage README §1.a puis install_root_scripts.sh).
[[ "$(readlink -f -- "$(F "$ROOT_LIB")")" == "$SELF_ROOT" ]] || { echo "[provision-ionos] ÉCHEC : copie root d'un autre environnement que ${DIGISANTE_ENV} (${ROOT_LIB} attendu)" >&2; exit 1; }
SRC_NGINX="${SELF_ROOT}/infra/deploy/nginx"
SRC_VHOST="${SRC_NGINX}/${SITE}.conf"
if [[ "$DIGISANTE_ENV" == production ]]; then SRC_CRON="${SELF_ROOT}/infra/deploy/crontab.example"; else SRC_CRON="${SELF_ROOT}/infra/deploy/crontab.preproduction.example"; fi
SRC_LOGROTATE="${SELF_ROOT}/infra/deploy/logrotate/${SITE}"
FILESTORE_MODULE="${SELF_ROOT}/scripts/preproduction/filestore-dir.mjs"

as_user() { local u="$1"; shift; sudo -u "$u" -H -- "$@"; }
pg_ro() { sudo -u postgres -H -- psql -X -A -t -q -v ON_ERROR_STOP=1 -d postgres -c "$1"; }
valkey_cli() {
  local cli=valkey-cli
  command -v valkey-cli >/dev/null 2>&1 || cli=redis-cli
  # Mot de passe par l'ENVIRONNEMENT (REDISCLI_AUTH/VALKEYCLI_AUTH), jamais en argument (`ps`).
  REDISCLI_AUTH="$VALKEY_PASSWORD" VALKEYCLI_AUTH="$VALKEY_PASSWORD" "$cli" -h 127.0.0.1 -p "$VALKEY_PORT" \
    ${VALKEY_USERNAME:+--user "$VALKEY_USERNAME"} --no-auth-warning "$@"
}
same_file() { [[ -f "$1" && -f "$2" ]] && cmp -s -- "$1" "$2"; }
# Lignes actives d'une crontab ; le .env de l'API désigné comme DONNÉE (B4) n'est pas un
# exécutable sous APP_DIR (même normalisation que verify_deploy.sh).
cron_active() { sed -e '/^[[:space:]]*#/d' -E -e 's/(^|[[:space:]])(API_ENV_FILE|API_DIR)=[^[:space:]]*//g' "$1"; }

log "environnement=${DIGISANTE_ENV} · mode=${MODE} · action=${ACTION} · domaines=${DOMAINS} · ports web/api=${WEB_PORT}/${API_PORT} · base=${DB_NAME} · Valkey index ${VALKEY_DB}"

# ═════════════════════════════════════════════════════════════
# GARDES (lecture seule, évaluées dans tous les modes ; une seule suffit à refuser)
# ═════════════════════════════════════════════════════════════
guard_os() {
  local id="" version=""
  [[ -r "$(F /etc/os-release)" ]] || die "/etc/os-release illisible"
  # Lu comme DONNÉES (jamais `source`).
  id="$(sed -n 's/^ID=\"\{0,1\}\([^"]*\)\"\{0,1\}$/\1/p' "$(F /etc/os-release)")"
  version="$(sed -n 's/^VERSION_ID=\"\{0,1\}\([^"]*\)\"\{0,1\}$/\1/p' "$(F /etc/os-release)")"
  [[ "$id" == ubuntu && "$version" == 26.04 ]] || die "OS ${id:-?} ${version:-?} : ce script cible Ubuntu 26.04 (provision.sh = ancien VPS 22.04, jamais sur cet hôte)"
  pass "OS Ubuntu ${version}"
}

guard_sources() {
  local f
  for f in "$SRC_VHOST" "${SRC_NGINX}/rate-limit.conf" "${SRC_NGINX}/digisante-headers.conf" "${SRC_NGINX}/hsts-after-tls.conf" "$SRC_CRON" "$SRC_LOGROTATE"; do
    if [[ ! -f "$f" ]] || ! trusted_path "$f"; then die "source ${f#"$SELF_ROOT"/} absente ou modifiable par un autre compte (copie root incomplète)"; fi
  done
  # Aucun proxy, upstream ni écoute vers les ports réservés de l'hôte.
  if grep -Eq '(127\.0\.0\.1|localhost|\[::1\]):(3000|3001)\b|listen[^;]*\b(3000|3001)\b' "$SRC_VHOST"; then
    die "le vhost ${SITE} vise un port réservé (3000/3001)"
  fi
  if ! grep -q "127.0.0.1:${API_PORT};" "$SRC_VHOST" || ! grep -q "127.0.0.1:${WEB_PORT};" "$SRC_VHOST"; then die "vhost ${SITE} : upstreams ≠ ports du profil (${WEB_PORT}/${API_PORT})"; fi
  # B3 : le cron root n'exécute rien sous APP_DIR et ne journalise pas chez l'utilisateur applicatif.
  local active
  active="$(cron_active "$SRC_CRON")"
  if grep -Fq "${APP_DIR%/}/" <<<"$active"; then die "B3 : le modèle de crontab exécute un chemin sous ${APP_DIR}"; fi
  if grep -Eq ">>?[[:space:]]*${APP_LOG_DIR%/}/" <<<"$active"; then die "B3 : le modèle de crontab journalise dans ${APP_LOG_DIR} (répertoire de ${APP_USER})"; fi
  pass "sources de la copie root : vhost ${SITE}, crontab, logrotate (B3, aucun port réservé)"
}

guard_ports() {
  local port line pid owner listing
  listing="$(ss -H -ltnp 2>/dev/null || true)"
  for port in $RESERVED_PORTS; do
    grep -Eq "[:.]${port}[[:space:]]" <<<"$listing" && note "port ${port} occupé par un autre service de l'hôte : jamais touché"
  done
  for port in "$WEB_PORT" "$API_PORT"; do
    line="$(grep -E "[:.]${port}[[:space:]]" <<<"$listing" | head -1 || true)"
    [[ -z "$line" ]] && continue
    pid="$(sed -n 's/.*pid=\([0-9]*\).*/\1/p' <<<"$line" | head -1)"
    owner="$( [[ -n "$pid" ]] && ps -o user= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
    [[ "$owner" == "$APP_USER" ]] || die "port ${port} déjà écouté par « ${owner:-inconnu} » (≠ ${APP_USER}) : port squatté, rien n'est configuré"
  done
  pass "ports ${WEB_PORT}/${API_PORT} libres ou tenus par ${APP_USER}"
}

guard_accounts() {
  getent group sshusers >/dev/null || die "groupe sshusers absent : règle d'accès SSH de l'hôte à vérifier avant tout compte"
  local u groups
  for u in "$APP_USER" "$JOBS_USER"; do
    id "$u" >/dev/null 2>&1 || continue
    groups=" $(id -nG "$u") "
    [[ "$groups" =~ \ (docker|sudo|admin|wheel|lxd|root)\  ]] && die "compte ${u} membre d'un groupe privilégié (${groups# }) : jamais pour DigiSanté"
    [[ "$(id -u "$u")" != 0 ]] || die "compte ${u} d'uid 0"
  done
  if id "$JOBS_USER" >/dev/null 2>&1 && id "$APP_USER" >/dev/null 2>&1; then
    [[ "$(id -u "$JOBS_USER")" != "$(id -u "$APP_USER")" && "$(id -g "$JOBS_USER")" != "$(id -g "$APP_USER")" ]] || die "compte des tâches ${JOBS_USER} confondu avec ${APP_USER}"
  fi
  pass "comptes ${APP_USER} / ${JOBS_USER} : absents ou sans privilège ; groupe sshusers présent"
}

guard_runtime() {
  local major
  major="$(node -v 2>/dev/null | sed -n 's/^v\([0-9]*\)\..*/\1/p')"
  [[ "$major" == "$NODE_MAJOR" ]] || die "Node ${major:-absent} ≠ ${NODE_MAJOR} (CI) : ce script n'installe jamais Node"
  command -v corepack >/dev/null 2>&1 || die "corepack absent : pnpm ${PNPM_VERSION} non installable sans changer Node"
  pass "Node ${NODE_MAJOR} et corepack présents"
}

guard_pg() {
  local version rows owner attrs hba
  version="$(pg_ro 'SHOW server_version_num' 2>/dev/null || true)"
  [[ "$version" =~ ^18[0-9]{4}$ ]] || die "PostgreSQL ${version:-injoignable} : 18.x natif attendu (jamais réinstallé ici)"
  attrs="$(pg_ro "SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname = '${DB_ROLE}'")"
  case "$attrs" in
    "") note "rôle ${DB_ROLE} absent : créé à l'application (PG_APP_PASSWORD requis)" ;;
    f) pass "rôle ${DB_ROLE} présent, sans privilège" ;;
    *) die "rôle ${DB_ROLE} existant avec des privilèges (superuser/createrole/createdb/replication/bypassrls)" ;;
  esac
  rows="$(pg_ro "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '${DB_NAME}'")"
  owner="${rows:-}"
  if [[ -z "$owner" ]]; then
    note "base ${DB_NAME} absente : créée à l'application"
  elif [[ "$owner" == "$DB_ROLE" ]]; then
    pass "base ${DB_NAME} propriété de ${DB_ROLE}"
  else
    die "base ${DB_NAME} existe déjà avec un autre propriétaire (${owner}) : jamais réutilisée"
  fi
  # pg_hba : jamais modifié par ce script ; la connexion locale par mot de passe doit exister.
  hba="$(pg_ro "SELECT count(*) FROM pg_hba_file_rules WHERE type = 'host' AND error IS NULL AND address IN ('127.0.0.1', '::1') AND auth_method IN ('scram-sha-256', 'md5') AND ('all' = ANY(database) OR '${DB_NAME}' = ANY(database)) AND ('all' = ANY(user_name) OR '${DB_ROLE}' = ANY(user_name))" 2>/dev/null || true)"
  if [[ "$hba" =~ ^[1-9][0-9]*$ ]]; then pass "pg_hba : connexion locale par mot de passe autorisée pour ${DB_ROLE}"; else fail "pg_hba : aucune règle host 127.0.0.1/::1 scram-sha-256 pour ${DB_ROLE}@${DB_NAME} (à ajouter À LA MAIN, revue de l'hôte)"; fi
}

guard_valkey() {
  [[ -n "${VALKEY_PASSWORD:-}" ]] || die "VALKEY_PASSWORD (coffre) requis pour vérifier l'index ${VALKEY_DB} (jamais affiché)"
  local pong size marker other_db
  pong="$(valkey_cli PING 2>/dev/null || true)"
  [[ "$pong" == PONG ]] || die "Valkey 127.0.0.1:${VALKEY_PORT} injoignable ou authentification refusée"
  size="$(valkey_cli -n "$VALKEY_DB" DBSIZE 2>/dev/null || true)"
  [[ "$size" =~ ^[0-9]+$ ]] || die "Valkey : index ${VALKEY_DB} inaccessible (databases trop bas ?)"
  marker="$(valkey_cli -n "$VALKEY_DB" GET digisante:owner 2>/dev/null || true)"
  if [[ "$size" == 0 ]]; then
    note "Valkey index ${VALKEY_DB} vide : réservé à ${DIGISANTE_ENV} à l'application (marqueur digisante:owner)"
  elif [[ "$marker" == "$DIGISANTE_ENV" ]]; then
    pass "Valkey index ${VALKEY_DB} déjà réservé à ${DIGISANTE_ENV}"
  else
    die "Valkey index ${VALKEY_DB} non vide (${size} clés) sans marqueur ${DIGISANTE_ENV} : propriétaire inconnu, jamais utilisé ni vidé"
  fi
  # L'autre environnement ne doit pas partager l'index.
  other_db=$(( VALKEY_DB == 5 ? 6 : 5 ))
  [[ "$(valkey_cli -n "$other_db" GET digisante:owner 2>/dev/null || true)" != "$DIGISANTE_ENV" ]] || die "marqueur ${DIGISANTE_ENV} présent dans l'index ${other_db} : indexes croisés"
}

guard_nginx() {
  command -v nginx >/dev/null 2>&1 || die "Nginx absent (jamais installé ici)"
  [[ -d "$(F "${NGINX_DIR}/sites-available")" && -d "$(F "${NGINX_DIR}/sites-enabled")" && -d "$(F "${NGINX_DIR}/conf.d")" ]] || die "arborescence Nginx Ubuntu (sites-available/enabled, conf.d) absente"
  local d f
  # Un domaine DigiSanté déjà servi par un AUTRE fichier : jamais de doublon de server_name.
  for d in $DOMAINS; do
    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      [[ "$(basename -- "$f")" == "$SITE" ]] && continue
      die "domaine ${d} déjà déclaré par ${f#"$TROOT"} (autre vhost) : rien n'est modifié"
    done < <(grep -rlE "server_name[^;]*[[:space:]]${d//./\\.}([[:space:]]|;)" "$(F "${NGINX_DIR}/sites-enabled")" "$(F "${NGINX_DIR}/conf.d")" 2>/dev/null || true)
  done
  # Zones/format DigiSanté définis ailleurs ⇒ `nginx -t` échouerait pour tout l'hôte.
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    [[ "$f" == "$(F "${NGINX_DIR}/conf.d/digisante-rate-limit.conf")" ]] && continue
    die "zone ou format digisante_* déjà défini dans ${f#"$TROOT"}"
  done < <(grep -rlE 'limit_req_zone[^;]*zone=digisante_rl_|log_format[[:space:]]+digisante_noquery' "$(F "$NGINX_DIR")" 2>/dev/null || true)
  # DNS : informatif (l'émission du certificat échouerait).
  for d in $DOMAINS; do
    if getent ahostsv4 "$d" 2>/dev/null | awk '{print $1}' | grep -qx "$HOST_IP"; then pass "DNS ${d} → ${HOST_IP}"; else fail "DNS ${d} ne résout pas vers ${HOST_IP} (émission Let's Encrypt impossible)"; fi
  done
}

guard_cron() {
  # B3 : une crontab root existante qui lance APP_DIR (ancienne installation) est refusée.
  local root_cron
  root_cron="$(crontab -l 2>/dev/null | sed '/^[[:space:]]*#/d' || true)"
  if grep -Fq "${APP_DIR%/}/" <<<"$root_cron"; then die "B3 : la crontab root lance un chemin sous ${APP_DIR} : la retirer avant tout provisioning"; fi
  pass "crontab root sans chemin sous ${APP_DIR}"
}

# --apply : tout secret ou paramètre requis est contrôlé AVANT la première écriture.
preflight_apply() {
  [[ "$MODE" == apply ]] || return 0
  if want pg && [[ "$(pg_ro "SELECT 1 FROM pg_roles WHERE rolname = '${DB_ROLE}'")" != 1 ]] && (( ${#PG_APP_PASSWORD} < 24 )); then
    die "PG_APP_PASSWORD (coffre, ≥ 24 caractères) requis pour créer ${DB_ROLE} — rien n'a été écrit"
  fi
  if want nginx && [[ ! -f "$(F "/etc/letsencrypt/live/${CERT_NAME}/fullchain.pem")" ]] && [[ ! "$LETSENCRYPT_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
    die "LETSENCRYPT_EMAIL requis pour émettre ${CERT_NAME} — rien n'a été écrit"
  fi
}

run_guards() {
  guard_os
  guard_sources
  guard_ports
  if want users || [[ "$ACTION" != provision ]]; then guard_accounts; fi
  if want runtime; then guard_runtime; fi
  if want pg; then guard_pg; fi
  if want valkey; then guard_valkey; fi
  if want nginx; then guard_nginx; fi
  if want cron; then guard_cron; fi
}

# ═════════════════════════════════════════════════════════════
# ÉTAPES (écrivent seulement en --apply)
# ═════════════════════════════════════════════════════════════
step_users() {
  log "── utilisateurs"
  if ! id "$APP_USER" >/dev/null 2>&1; then
    # Connexion SSH par clé seulement (déploiement), membre de sshusers, ni docker ni sudo.
    act "création de ${APP_USER} (shell bash, groupe propre, sshusers)" useradd --create-home --shell /bin/bash --user-group --groups sshusers "$APP_USER"
    act "mot de passe verrouillé pour ${APP_USER} (clé SSH seulement)" usermod --lock "$APP_USER"
  elif [[ " $(id -nG "$APP_USER") " != *" sshusers "* ]]; then
    act "ajout de ${APP_USER} au groupe sshusers" usermod --append --groups sshusers "$APP_USER"
  else
    pass "compte ${APP_USER} présent"
  fi
  if ! id "$JOBS_USER" >/dev/null 2>&1; then
    # B3 : requêtes des tâches cron (internal_job / fedapay_reconcile) sous ce compte.
    act "création du compte sans droits ${JOBS_USER}" adduser --system --group --no-create-home --home /nonexistent --shell /usr/sbin/nologin "$JOBS_USER"
  else
    pass "compte ${JOBS_USER} présent"
  fi
  if [[ -n "${DEPLOY_SSH_PUBKEY:-}" ]]; then
    [[ "$DEPLOY_SSH_PUBKEY" =~ ^(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa)\ [A-Za-z0-9+/=]{40,}(\ [[:graph:]]{1,64})?$ ]] || die "DEPLOY_SSH_PUBKEY : clé PUBLIQUE OpenSSH sur une ligne attendue"
    local home; home="/home/${APP_USER}"
    if ! grep -qxF -- "$DEPLOY_SSH_PUBKEY" "$(F "${home}/.ssh/authorized_keys")" 2>/dev/null; then
      # shellcheck disable=SC2016 # variables évaluées par le shell de l'utilisateur, à dessein
      act "clé publique de déploiement ajoutée à ${home}/.ssh/authorized_keys" as_user "$APP_USER" sh -c 'umask 077; mkdir -p "$HOME/.ssh" && printf "%s\n" "$1" >> "$HOME/.ssh/authorized_keys"' _ "$DEPLOY_SSH_PUBKEY"
    fi
  else
    note "DEPLOY_SSH_PUBKEY absent : clé de déploiement GitHub à ajouter (README, étape SSH)"
  fi
}

ensure_dir() { # ensure_dir <chemin> <propriétaire> <mode>
  local path="$1" owner="$2" mode="$3" target
  target="$(F "$path")"
  if [[ -L "$target" ]]; then die "${path} est un lien symbolique : refusé"; fi
  if [[ -d "$target" ]] && [[ "$(stat -c '%U:%a' -- "$target")" == "${owner}:${mode#0}" ]]; then pass "${path} (${owner} ${mode})"; return; fi
  act "répertoire ${path} (${owner}:${owner} ${mode})" install -d -o "$owner" -g "$owner" -m "$mode" -- "$target"
}

step_dirs() {
  log "── répertoires"
  ensure_dir "$APP_DIR" "$APP_USER" 0750
  ensure_dir "$APP_LOG_DIR" "$APP_USER" 0750
  # Magasin KYC + pièces DMP (données de santé) : HORS du checkout, à l'utilisateur, 0700 (B4).
  ensure_dir "$STORE_DIR" "$APP_USER" 0700
  ensure_dir "$CRON_LOG_DIR" root 0750
  ensure_dir "$ETC_DIR" root 0700
  ensure_dir "$BACKUP_DIR" root 0700
  ensure_dir "$STATE_DIR" root 0700
  ensure_dir "$ROOT_LIB" root 0755
  ensure_dir "$ACME_ROOT" root 0755
}

step_pg() {
  log "── PostgreSQL (rôle et base ${DB_NAME})"
  local exists
  exists="$(pg_ro "SELECT 1 FROM pg_roles WHERE rolname = '${DB_ROLE}'")"
  if [[ "$exists" != 1 ]]; then
    if [[ "$MODE" == apply ]]; then
      [[ ${#PG_APP_PASSWORD} -ge 24 ]] || die "PG_APP_PASSWORD (coffre, ≥ 24 caractères) requis pour créer ${DB_ROLE}"
      log "création du rôle ${DB_ROLE} (LOGIN, aucun privilège ; mot de passe lu par \\getenv, jamais affiché)"
      # Mot de passe par l'environnement de psql puis quoté par format(%L) : jamais dans le SQL ni dans `ps`.
      DB_ROLE="$DB_ROLE" PG_APP_PASSWORD="$PG_APP_PASSWORD" sudo --preserve-env=DB_ROLE,PG_APP_PASSWORD -u postgres -H -- psql -X -q -v ON_ERROR_STOP=1 -d postgres <<'SQL'
\getenv db_role DB_ROLE
\getenv db_pw PG_APP_PASSWORD
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'db_role', :'db_pw')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'db_role')\gexec
SQL
    else
      # Seule la PRÉSENCE du mot de passe est indiquée, jamais sa valeur.
      local provided="à fournir à l'application"
      [[ -z "${PG_APP_PASSWORD}" ]] || provided="fourni"
      plan "création du rôle ${DB_ROLE} : CREATE ROLE … LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD (\\getenv PG_APP_PASSWORD, ${provided})"
    fi
  else
    pass "rôle ${DB_ROLE} présent (mot de passe jamais modifié par ce script)"
  fi
  if [[ "$(pg_ro "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'")" != 1 ]]; then
    act "création de la base ${DB_NAME} (propriétaire ${DB_ROLE}, UTF8, template0)" sudo -u postgres -H -- createdb --owner="$DB_ROLE" --encoding=UTF8 --template=template0 -- "$DB_NAME"
  else
    pass "base ${DB_NAME} présente"
  fi
  act "accès à ${DB_NAME} réservé à ${DB_ROLE} (REVOKE PUBLIC, GRANT CONNECT/TEMPORARY)" sudo -u postgres -H -- psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "REVOKE ALL ON DATABASE \"${DB_NAME}\" FROM PUBLIC; GRANT CONNECT, TEMPORARY ON DATABASE \"${DB_NAME}\" TO \"${DB_ROLE}\";"
}

step_valkey() {
  log "── Valkey (index ${VALKEY_DB})"
  # SET NX : n'écrase jamais ; aucune autre écriture, jamais FLUSH*.
  if [[ "$MODE" == apply ]]; then
    valkey_cli -n "$VALKEY_DB" SET digisante:owner "$DIGISANTE_ENV" NX >/dev/null
    [[ "$(valkey_cli -n "$VALKEY_DB" GET digisante:owner)" == "$DIGISANTE_ENV" ]] || die "marqueur Valkey non posé"
    log "index ${VALKEY_DB} réservé à ${DIGISANTE_ENV}"
  else
    plan "index ${VALKEY_DB} réservé : SET digisante:owner ${DIGISANTE_ENV} NX (mot de passe par REDISCLI_AUTH)"
  fi
  note "REDIS_URL du .env : redis://:<mot de passe URL-encodé>@127.0.0.1:${VALKEY_PORT}/${VALKEY_DB}"
}

step_runtime() {
  log "── Node / pnpm / PM2"
  local global pm2_pkg
  global="$(npm root -g 2>/dev/null || true)"
  pm2_pkg="${global:+$(F "$global")/pm2/package.json}"
  if [[ -n "$pm2_pkg" && -f "$pm2_pkg" ]]; then
    note "PM2 $(node -p 'require(process.argv[1]).version' "$pm2_pkg" 2>/dev/null || echo '?') déjà installé (jamais remplacé automatiquement)"
  else
    act "installation de PM2 ${PM2_VERSION} (global, version exacte)" npm install --global "pm2@${PM2_VERSION}"
  fi
  act "pnpm ${PNPM_VERSION} préinstallé pour ${APP_USER} (corepack, packageManager du dépôt)" as_user "$APP_USER" env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack install --global "pnpm@${PNPM_VERSION}"
  if systemctl is-enabled "pm2-${APP_USER}" >/dev/null 2>&1; then
    pass "service pm2-${APP_USER} activé"
  else
    act "démarrage PM2 au boot pour ${APP_USER} (service pm2-${APP_USER})" pm2 startup systemd -u "$APP_USER" --hp "/home/${APP_USER}" --service-name "pm2-${APP_USER}"
  fi
}

# Valeur d'une clé du .env de l'API, lue comme DONNÉES (util.parseEnv), fichier ordinaire
# seulement (O_NOFOLLOW) ; écrite sur stdout, jamais en argument d'une autre commande.
env_value() {
  node -e '
    const fs = require("node:fs"); const { parseEnv } = require("node:util");
    let fd; try { fd = fs.openSync(process.argv[1], fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); } catch { process.exit(3); }
    if (!fs.fstatSync(fd).isFile()) process.exit(3);
    const v = parseEnv(fs.readFileSync(fd, "utf8"))[process.argv[2]];
    if (v === undefined) process.exit(4);
    process.stdout.write(v);' "$(F "$ENV_FILE")" "$1"
}

step_secrets() {
  log "── fichiers de service root (${ETC_DIR})"
  local key token_file
  key="$(F "${ETC_DIR}/backup.key")"
  if [[ -s "$key" ]]; then pass "backup.key présent (jamais affiché)"; else
    # shellcheck disable=SC2016 # "$1" évalué par sh -c, à dessein
    act "clé de sauvegarde générée sur l'hôte (0400, jamais affichée ; copie HORS VPS par l'opérateur)" sh -c 'umask 077; openssl rand -base64 48 > "$1" && chmod 0400 "$1"' _ "$key"
  fi
  token_file="$(F "${ETC_DIR}/reconcile.token")"
  if [[ -f "$(F "$ENV_FILE")" ]]; then
    local token
    if token="$(env_value RECONCILE_TOKEN)" && [[ ${#token} -ge 32 ]]; then
      if [[ -f "$token_file" ]] && [[ "$(cat -- "$token_file")" == "$token" ]]; then pass "reconcile.token = RECONCILE_TOKEN du .env"; else
        if [[ "$MODE" == apply ]]; then (umask 077; printf '%s' "$token" > "$token_file"); chmod 0400 "$token_file"; log "reconcile.token aligné sur le .env (jamais affiché)"; else plan "reconcile.token ← RECONCILE_TOKEN du .env (0400, jamais affiché)"; fi
      fi
    else
      fail "RECONCILE_TOKEN absent ou < 32 caractères dans ${ENV_FILE}"
    fi
    unset token
  else
    note "${ENV_FILE} absent : reconcile.token à aligner après création du .env (relancer --only secrets)"
  fi
  if [[ ! -f "$(F "${ETC_DIR}/alert.conf")" ]]; then
    # shellcheck disable=SC2016 # "$1" évalué par sh -c, à dessein
    act "alert.conf modèle (0600, destinataire à renseigner)" sh -c 'umask 077; printf "%s\n" "# Destinataire des alertes healthwatch (RUNBOOK_Alertes.md) — à renseigner :" "# ALERT_CMD='"'"'mail -s \"[DigiSanté] alerte\" ops@<domaine>'"'"'" > "$1"' _ "$(F "${ETC_DIR}/alert.conf")"
  fi
}

install_file() { # install_file <source> <destination> <mode>
  local src="$1" dest="$2" mode="$3"
  if same_file "$src" "$(F "$dest")"; then pass "${dest} à jour"; return; fi
  act "installation de ${dest} (root:root ${mode})" install -o root -g root -m "$mode" -- "$src" "$(F "$dest")"
}

nginx_reload() {
  if [[ "$MODE" == apply ]]; then
    nginx -t >/dev/null 2>&1 || return 1
    systemctl reload nginx
  else
    plan "nginx -t puis systemctl reload nginx"
  fi
}

step_nginx() {
  log "── Nginx + TLS (${DOMAINS})"
  local site_av site_en cert d prev certbot_domains=()
  install_file "${SRC_NGINX}/rate-limit.conf" "${NGINX_DIR}/conf.d/digisante-rate-limit.conf" 0644
  install_file "${SRC_NGINX}/digisante-headers.conf" "${NGINX_DIR}/snippets/digisante-headers.conf" 0644
  install_file "${SRC_NGINX}/hsts-after-tls.conf" "${NGINX_DIR}/snippets/digisante-hsts.conf" 0644
  site_av="${NGINX_DIR}/sites-available/${SITE}"; site_en="${NGINX_DIR}/sites-enabled/${SITE}"
  cert="/etc/letsencrypt/live/${CERT_NAME}/fullchain.pem"
  for d in $DOMAINS; do certbot_domains+=(-d "$d"); done
  if [[ ! -f "$(F "$cert")" ]]; then
    # 1. Amorçage HTTP seul : challenge ACME, aucune application servie.
    local boot
    boot="$(mktemp)"
    cat > "$boot" <<CONF
# Généré par provision-ionos.sh — amorçage ACME (HTTP seul) de ${SITE}, remplacé par le vhost TLS.
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAINS};
    server_tokens off;
    access_log /var/log/nginx/${SITE}-access.log digisante_noquery;
    error_log /dev/null;
    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_ROOT};
        default_type text/plain;
    }
    location / {
        return 404;
    }
}
CONF
    install_file "$boot" "$site_av" 0644
    rm -f -- "$boot"
    [[ -L "$(F "$site_en")" ]] || act "activation de ${SITE}" ln -sfn -- "$site_av" "$(F "$site_en")"
    nginx_reload || die "nginx -t refuse l'amorçage ACME : rien d'autre n'est modifié"
    [[ -n "${LETSENCRYPT_EMAIL:-}" || "$MODE" != apply ]] || die "LETSENCRYPT_EMAIL requis pour l'émission"
    # 2. Let's Encrypt : essai à blanc d'abord, webroot (Certbot ne réécrit aucun vhost).
    act "certificat ${CERT_NAME} — essai à blanc (staging)" certbot certonly --webroot -w "$ACME_ROOT" --cert-name "$CERT_NAME" "${certbot_domains[@]}" --non-interactive --agree-tos -m "${LETSENCRYPT_EMAIL:-<LETSENCRYPT_EMAIL>}" --dry-run
    act "certificat ${CERT_NAME} — émission" certbot certonly --webroot -w "$ACME_ROOT" --cert-name "$CERT_NAME" "${certbot_domains[@]}" --non-interactive --agree-tos -m "${LETSENCRYPT_EMAIL:-<LETSENCRYPT_EMAIL>}" --deploy-hook "systemctl reload nginx"
  else
    pass "certificat ${CERT_NAME} présent"
  fi
  act "renouvellement ${CERT_NAME} — essai à blanc (seul ce certificat)" certbot renew --cert-name "$CERT_NAME" --dry-run
  # 3. Vhost TLS complet (HSTS 24 h) seulement après certificat + renouvellement validés.
  if ! same_file "$SRC_VHOST" "$(F "$site_av")"; then
    if [[ "$MODE" == apply ]]; then
      prev="$(mktemp)"; cp -p -- "$(F "$site_av")" "$prev" 2>/dev/null || : > "$prev"
      install -o root -g root -m 0644 -- "$SRC_VHOST" "$(F "$site_av")"
      ln -sfn -- "$site_av" "$(F "$site_en")"
      if ! nginx_reload; then
        # Retour au fichier précédent : les autres vhosts de l'hôte ne sont jamais affectés.
        if [[ -s "$prev" ]]; then install -o root -g root -m 0644 -- "$prev" "$(F "$site_av")"; else rm -f -- "$(F "$site_en")" "$(F "$site_av")"; fi
        nginx -t >/dev/null 2>&1 && systemctl reload nginx
        rm -f -- "$prev"
        die "nginx -t refuse le vhost ${SITE} : version précédente restaurée"
      fi
      rm -f -- "$prev"; log "vhost ${SITE} TLS actif"
    else
      plan "vhost TLS ${SITE} : install ${SRC_VHOST#"$SELF_ROOT"/} → ${site_av}, lien ${site_en}, nginx -t (restauration de la version précédente si refus), reload"
    fi
  else
    pass "vhost ${SITE} à jour"
  fi
}

step_cron() {
  log "── crons et rotation (B3 : copie root uniquement)"
  install_file "$SRC_CRON" "$CRON_FILE" 0644
  install_file "$SRC_LOGROTATE" "/etc/logrotate.d/${SITE}" 0644
  note "jeton des tâches : ${ETC_DIR}/reconcile.token (étape secrets) ; compte des tâches ${JOBS_USER} (étape users)"
}

# ═════════════════════════════════════════════════════════════
# VÉRIFICATION POST-PROVISIONING (lecture seule)
# ═════════════════════════════════════════════════════════════
check_dir() { # check_dir <chemin> <propriétaire> <mode>
  local t; t="$(F "$1")"
  if [[ -d "$t" && ! -L "$t" && "$(stat -c '%U:%a' -- "$t")" == "${2}:${3#0}" ]]; then pass "${1} ${2} ${3}"; else fail "${1} : attendu ${2} ${3}, trouvé $(stat -c '%U %a' -- "$t" 2>/dev/null || echo absent)"; fi
}

verify_all() {
  log "── vérification post-provisioning (${DIGISANTE_ENV})"
  local u groups
  for u in "$APP_USER" "$JOBS_USER"; do
    if id "$u" >/dev/null 2>&1; then
      groups=" $(id -nG "$u") "
      if [[ "$groups" =~ \ (docker|sudo|admin|wheel|lxd|root)\  ]]; then fail "${u} membre d'un groupe privilégié"; else pass "${u} sans groupe privilégié"; fi
    else fail "compte ${u} absent"; fi
  done
  if id "$APP_USER" >/dev/null 2>&1 && [[ " $(id -nG "$APP_USER") " == *" sshusers "* ]]; then pass "${APP_USER} ∈ sshusers"; else fail "${APP_USER} hors sshusers"; fi
  check_dir "$APP_DIR" "$APP_USER" 0750; check_dir "$APP_LOG_DIR" "$APP_USER" 0750; check_dir "$STORE_DIR" "$APP_USER" 0700
  check_dir "$CRON_LOG_DIR" root 0750; check_dir "$ETC_DIR" root 0700; check_dir "$BACKUP_DIR" root 0700
  check_dir "$STATE_DIR" root 0700; check_dir "$ROOT_LIB" root 0755; check_dir "$ACME_ROOT" root 0755
  # PostgreSQL : rôle sans privilège, base au rôle, PUBLIC sans CONNECT.
  if [[ "$(pg_ro "SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname = '${DB_ROLE}'" 2>/dev/null)" == f ]]; then pass "rôle ${DB_ROLE} sans privilège"; else fail "rôle ${DB_ROLE} absent ou privilégié"; fi
  if [[ "$(pg_ro "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '${DB_NAME}'" 2>/dev/null)" == "$DB_ROLE" ]]; then pass "base ${DB_NAME} → ${DB_ROLE}"; else fail "base ${DB_NAME} absente ou d'un autre propriétaire"; fi
  if [[ "$(pg_ro "SELECT has_database_privilege('public', '${DB_NAME}', 'CONNECT')" 2>/dev/null)" == f ]]; then pass "PUBLIC sans CONNECT sur ${DB_NAME}"; else fail "PUBLIC peut se connecter à ${DB_NAME}"; fi
  # Valkey : marqueur de l'environnement.
  if [[ -n "${VALKEY_PASSWORD:-}" ]]; then
    if [[ "$(valkey_cli -n "$VALKEY_DB" GET digisante:owner 2>/dev/null)" == "$DIGISANTE_ENV" ]]; then pass "Valkey index ${VALKEY_DB} → ${DIGISANTE_ENV}"; else fail "Valkey index ${VALKEY_DB} sans marqueur ${DIGISANTE_ENV}"; fi
  else note "VALKEY_PASSWORD absent : index Valkey non vérifié"; fi
  # Runtime.
  if [[ "$(node -v 2>/dev/null | sed -n 's/^v\([0-9]*\)\..*/\1/p')" == "$NODE_MAJOR" ]]; then pass "Node ${NODE_MAJOR}"; else fail "Node ≠ ${NODE_MAJOR}"; fi
  if systemctl is-enabled "pm2-${APP_USER}" >/dev/null 2>&1; then pass "service pm2-${APP_USER} activé"; else fail "service pm2-${APP_USER} non activé"; fi
  # Nginx / TLS.
  if nginx -t >/dev/null 2>&1; then pass "nginx -t"; else fail "nginx -t"; fi
  if [[ -L "$(F "${NGINX_DIR}/sites-enabled/${SITE}")" ]] && same_file "$SRC_VHOST" "$(F "${NGINX_DIR}/sites-available/${SITE}")"; then pass "vhost ${SITE} TLS actif et conforme"; else fail "vhost ${SITE} absent, inactif ou différent de la copie root"; fi
  if [[ -f "$(F "/etc/letsencrypt/live/${CERT_NAME}/fullchain.pem")" ]]; then pass "certificat ${CERT_NAME}"; else fail "certificat ${CERT_NAME} absent"; fi
  # Crons (B3).
  if same_file "$SRC_CRON" "$(F "$CRON_FILE")"; then pass "${CRON_FILE} = modèle de la copie root"; else fail "${CRON_FILE} absent ou différent"; fi
  if [[ -f "$(F "$CRON_FILE")" ]] && ! cron_active "$(F "$CRON_FILE")" | grep -Fq "${APP_DIR%/}/"; then pass "B3 : ${CRON_FILE} sans chemin sous ${APP_DIR}"; else fail "B3 : ${CRON_FILE} absent ou lance un chemin sous ${APP_DIR}"; fi
  if same_file "$SRC_LOGROTATE" "$(F "/etc/logrotate.d/${SITE}")"; then pass "logrotate ${SITE}"; else fail "logrotate ${SITE} absent ou différent"; fi
  # Fichiers de service root.
  if [[ -s "$(F "${ETC_DIR}/backup.key")" && "$(stat -c '%U' -- "$(F "${ETC_DIR}/backup.key")")" == root ]]; then pass "backup.key (root)"; else fail "backup.key absent"; fi
  verify_store
}

# B4 : KYC_STORAGE_DIR absolu dans le .env, résolu comme l'API et la sauvegarde, puis
# fichiers référencés par la base (identifiants du magasin) comparés aux fichiers présents.
verify_store() {
  if [[ ! -f "$(F "$ENV_FILE")" ]]; then note "${ENV_FILE} absent : magasin KYC (B4) non vérifié"; return; fi
  local raw store expected present uid
  if ! raw="$(env_value KYC_STORAGE_DIR)"; then fail "B4 : KYC_STORAGE_DIR absent du .env"; return; fi
  [[ "$raw" == /* ]] || { fail "B4 : KYC_STORAGE_DIR doit être un chemin ABSOLU"; return; }
  uid="$(id -u "$APP_USER" 2>/dev/null || echo 0)"
  if ! store="$(API_ENV_FILE="$(F "$ENV_FILE")" API_DIR="$(F "${APP_DIR}/apps/api")" FILESTORE_OWNER_UID="$uid" node "$FILESTORE_MODULE" 2>/dev/null)"; then
    fail "B4 : magasin KYC refusé (propriétaire ${APP_USER}, 0700, nom sûr requis — cf. filestore-dir.mjs)"; return
  fi
  pass "B4 : magasin KYC ${raw} (absolu, ${APP_USER}, résolu comme l'API)"
  expected="$(pg_ro "SELECT count(*) FROM (SELECT \"encryptedUrl\" AS ref FROM documents UNION SELECT \"fileUrl\" FROM kyc_documents) AS refs WHERE ref ~ '^[0-9a-f-]{36}\$'" 2>/dev/null | head -1 || true)"
  if [[ ! "$expected" =~ ^[0-9]+$ ]]; then note "B4 : base sans tables applicatives (avant migration) : comparaison des fichiers reportée"; return; fi
  present="$(find "$store" -maxdepth 1 -type f -name '*.bin' 2>/dev/null | grep -Ec '/[0-9a-f-]{36}\.bin$' || true)"
  if (( present >= expected )); then pass "B4 : files_count=${present} ≥ références=${expected}"; else fail "B4 : ${expected} fichiers référencés, ${present} présents dans le magasin"; fi
}

# ═════════════════════════════════════════════════════════════
# ROLLBACK (artefacts sans données uniquement)
# ═════════════════════════════════════════════════════════════
rollback_all() {
  log "── rollback ${DIGISANTE_ENV} : vhost, crons, rotation, service PM2 — JAMAIS base, rôle, Valkey, magasin, comptes ni certificat"
  local other_site
  [[ "$SITE" == digisante ]] && other_site=digisante-preprod || other_site=digisante
  [[ -e "$(F "${NGINX_DIR}/sites-enabled/${SITE}")" ]] && act "désactivation du vhost ${SITE}" rm -f -- "$(F "${NGINX_DIR}/sites-enabled/${SITE}")"
  [[ -e "$(F "${NGINX_DIR}/sites-available/${SITE}")" ]] && act "retrait de ${NGINX_DIR}/sites-available/${SITE}" rm -f -- "$(F "${NGINX_DIR}/sites-available/${SITE}")"
  if [[ ! -e "$(F "${NGINX_DIR}/sites-enabled/${other_site}")" ]]; then
    for f in conf.d/digisante-rate-limit.conf snippets/digisante-headers.conf snippets/digisante-hsts.conf; do
      [[ -e "$(F "${NGINX_DIR}/${f}")" ]] && act "retrait de ${NGINX_DIR}/${f} (plus aucun vhost DigiSanté)" rm -f -- "$(F "${NGINX_DIR}/${f}")"
    done
  else
    note "fichiers Nginx communs conservés : ${other_site} reste actif"
  fi
  nginx_reload || die "nginx -t refuse l'état après retrait : vérifier à la main (aucun autre vhost modifié)"
  [[ -e "$(F "$CRON_FILE")" ]] && act "retrait de ${CRON_FILE}" rm -f -- "$(F "$CRON_FILE")"
  [[ -e "$(F "/etc/logrotate.d/${SITE}")" ]] && act "retrait de /etc/logrotate.d/${SITE}" rm -f -- "$(F "/etc/logrotate.d/${SITE}")"
  if systemctl is-enabled "pm2-${APP_USER}" >/dev/null 2>&1; then
    act "arrêt des processus PM2 de ${APP_USER}" as_user "$APP_USER" pm2 kill
    act "retrait du service pm2-${APP_USER}" pm2 unstartup systemd -u "$APP_USER" --hp "/home/${APP_USER}" --service-name "pm2-${APP_USER}"
  fi
  note "conservés (décision humaine, sauvegarde préalable) : comptes ${APP_USER}/${JOBS_USER}, base/rôle ${DB_NAME}, index Valkey ${VALKEY_DB}, ${STORE_DIR}, ${ETC_DIR}, ${BACKUP_DIR}, certificat ${CERT_NAME} (certbot delete --cert-name ${CERT_NAME})"
}

# ═════════════════════════════════════════════════════════════
case "$ACTION" in
  verify)
    guard_os
    verify_all
    if (( FAILS == 0 )); then log "vérification : tout est conforme"; else log "vérification : ${FAILS} point(s) en échec"; exit 1; fi
    ;;
  rollback)
    guard_os
    rollback_all
    ;;
  provision)
    run_guards
    (( FAILS == 0 )) || die "${FAILS} garde(s) en échec : corriger avant toute application (rien n'a été écrit)"
    preflight_apply
    for s in $STEPS; do want "$s" && "step_${s}"; done
    if [[ "$MODE" == apply ]]; then
      log "provisioning appliqué ; lancer --verify, puis déploiement (README) et --verify à nouveau"
    else
      log "dry-run terminé : aucune écriture. Relancer avec --apply après relecture du plan."
    fi
    (( FAILS == 0 )) || exit 1
    ;;
esac
