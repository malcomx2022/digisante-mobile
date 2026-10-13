#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Déclencheur des TÂCHES INTERNES de l'API (générateurs de rappels, dispatch des
# notifications) — appelé par cron, en root, depuis la copie INSTALLÉE root:root
# (/usr/local/lib/digisante[-preprod], cf. install_root_scripts.sh — B3), jamais depuis
# APP_DIR. DIGISANTE_ENV (obligatoire) fixe l'API visée : 127.0.0.1:3101 (préproduction)
# ou 127.0.0.1:3201 (production), jamais un port d'un autre service de l'hôte partagé.
#
#   DIGISANTE_ENV=preproduction internal_job.sh /api/v1/notifications/dispatch
#
# Jeton de service lu dans UN SEUL fichier root-only HORS dépôt (le même que la
# réconciliation) : ${ETC_DIR}/reconcile.token, soit /etc/digisante[-preprod]/reconcile.token
# (= RECONCILE_TOKEN du .env API de l'environnement).
#  • le jeton n'est PLUS écrit en clair dans la crontab (placeholder `changeme`
#    oublié ⇒ tous les générateurs en 401, silencieusement) ;
#  • il ne passe PAS en argument de curl (visible dans `ps` par tout utilisateur
#    local) : l'en-tête est fourni par la configuration lue sur l'entrée standard ;
#  • jeton absent/vide, ou réponse non 2xx ⇒ code de sortie 1 et ligne ÉCHEC au log ;
#  • la requête (curl) et la lecture de la réponse de l'API (contrôlable par un attaquant
#    qui aurait pris l'API) tournent sous le compte sans droits ${JOBS_USER}, jamais en
#    root (B3) ; root n'en recopie au journal qu'un extrait borné SANS caractères de contrôle.
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
# >>> jobs_user (B3 — copie IDENTIQUE dans internal_job.sh et fedapay_reconcile.sh ; test de non-dérive)
# La requête vers l'API locale (curl et sa réponse) ne s'exécute JAMAIS en root. Lancé par
# root (cron), le script ne garde que la lecture du jeton root-only et l'écriture du journal :
# la requête part sous le compte système dédié ${JOBS_USER} (ni root, ni l'utilisateur
# applicatif, ni leurs groupes), sans groupe supplémentaire et avec no_new_privs ; le jeton
# lui est transmis sur l'entrée standard. Hors root, le script est déjà sans privilège.
JOBS_UID=; JOBS_GID=
jobs_identity() {
  [[ "$EUID" == 0 ]] || return 0
  if ! JOBS_UID="$(id -u -- "$JOBS_USER" 2>/dev/null)" || ! JOBS_GID="$(id -g -- "$JOBS_USER" 2>/dev/null)"; then
    log "ÉCHEC : compte sans droits ${JOBS_USER} absent (à créer au provisionnement, infra/deploy/README.md §1)"; return 1
  fi
  local app_uid app_gid
  app_uid="$(id -u -- "$APP_USER" 2>/dev/null || true)"; app_gid="$(id -g -- "$APP_USER" 2>/dev/null || true)"
  if [[ "$JOBS_UID" == 0 || "$JOBS_GID" == 0 || "$JOBS_UID" == "$app_uid" || "$JOBS_GID" == "$app_gid" ]]; then
    log "ÉCHEC : compte ${JOBS_USER} refusé pour les tâches (root, ou utilisateur/groupe applicatif ${APP_USER})"; return 1
  fi
}
as_jobs_user() {
  if [[ "$EUID" != 0 ]]; then "$@"; return; fi
  setpriv --reuid="$JOBS_UID" --regid="$JOBS_GID" --clear-groups --no-new-privs -- "$@"
}
# Sortie de `curl -o - -w '\n%{http_code}'` (bornée, sans octet nul) : code HTTP et corps.
split_response() {
  if [[ "$1" == *$'\n'* ]]; then HTTP_CODE="${1##*$'\n'}"; BODY="${1%$'\n'*}"; else HTTP_CODE="$1"; BODY=; fi
  [[ "$HTTP_CODE" =~ ^[0-9]{3}$ ]] || HTTP_CODE=000
}
# <<< jobs_user
trusted_path "${BASH_SOURCE[0]}" || { echo "[job] ÉCHEC : script lancé depuis un emplacement modifiable par un autre compte ; utiliser la copie installée par install_root_scripts.sh" >&2; exit 1; }
SELF_ROOT="$(cd "$(dirname "$(readlink -f -- "${BASH_SOURCE[0]}")")/../../.." && pwd -P)"
digisante_profile || exit 1
[[ "$(readlink -f -- "$ROOT_LIB")" == "$SELF_ROOT" ]] || { echo "[job] ÉCHEC : copie root d'un autre environnement que ${DIGISANTE_ENV} (${ROOT_LIB} attendu)" >&2; exit 1; }

JOB_PATH="${1:?Usage : internal_job.sh /api/v1/<chemin>}"
TOKEN_FILE="${RECONCILE_TOKEN_FILE:-${ETC_DIR}/reconcile.token}"

log() { printf '[job] %s %s %s\n' "$(date -Is)" "$JOB_PATH" "$*"; }

if [[ ! -s "$TOKEN_FILE" ]]; then
  log "ÉCHEC : jeton de service absent ou vide ($TOKEN_FILE)"
  exit 1
fi

jobs_identity || exit 1

# `--config -` : l'en-tête contenant le jeton est lu sur stdin, jamais sur la ligne de commande ;
# `-q` : aucun .curlrc. Corps puis code HTTP sur la sortie du curl sans droits.
OUT="$(printf 'header = "x-service-token: %s"\n' "$(tr -d '\r\n' < "$TOKEN_FILE")" \
  | as_jobs_user curl -q -sS --config - -o - -w '\n%{http_code}' -X POST --max-time 120 "${API_BASE}${JOB_PATH}" \
  | head -c 65536 | LC_ALL=C tr -d '\000' || true)"
split_response "$OUT"

# Extrait borné, caractères de contrôle (dont séquences d'échappement terminal) retirés.
snippet() { printf '%s' "$BODY" | head -c 300 | LC_ALL=C tr -d '\000-\037\177'; }
if [[ "$HTTP_CODE" =~ ^2[0-9][0-9]$ ]]; then
  log "OK (HTTP ${HTTP_CODE}) $(snippet)"
else
  log "ÉCHEC (HTTP ${HTTP_CODE}) $(snippet)"
  exit 1
fi
