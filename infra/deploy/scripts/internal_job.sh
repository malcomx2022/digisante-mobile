#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Déclencheur des TÂCHES INTERNES de l'API (générateurs de rappels, dispatch des
# notifications) — appelé par cron, en root, depuis la copie INSTALLÉE root:root
# (/usr/local/lib/digisante, cf. install_root_scripts.sh — B3), jamais depuis APP_DIR.
#
#   internal_job.sh /api/v1/notifications/dispatch
#
# Jeton de service lu dans UN SEUL fichier root-only HORS dépôt (le même que la
# réconciliation) : /etc/digisante/reconcile.token (= RECONCILE_TOKEN du .env API).
#  • le jeton n'est PLUS écrit en clair dans la crontab (placeholder `changeme`
#    oublié ⇒ tous les générateurs en 401, silencieusement) ;
#  • il ne passe PAS en argument de curl (visible dans `ps` par tout utilisateur
#    local) : l'en-tête est fourni par la configuration lue sur l'entrée standard ;
#  • jeton absent/vide, ou réponse non 2xx ⇒ code de sortie 1 et ligne ÉCHEC au log ;
#  • la réponse de l'API (contrôlable par un attaquant qui aurait pris l'API) n'est
#    recopiée au journal root que bornée et SANS caractères de contrôle.
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
trusted_path "${BASH_SOURCE[0]}" || { echo "[job] ÉCHEC : script lancé depuis un emplacement modifiable par un autre compte ; utiliser la copie installée par install_root_scripts.sh" >&2; exit 1; }

JOB_PATH="${1:?Usage : internal_job.sh /api/v1/<chemin>}"
API_BASE="${API_BASE:-http://127.0.0.1:3001}"
TOKEN_FILE="${RECONCILE_TOKEN_FILE:-/etc/digisante/reconcile.token}"

log() { printf '[job] %s %s %s\n' "$(date -Is)" "$JOB_PATH" "$*"; }

if [[ ! -s "$TOKEN_FILE" ]]; then
  log "ÉCHEC : jeton de service absent ou vide ($TOKEN_FILE)"
  exit 1
fi

RESP="$(mktemp)"
trap 'rm -f "$RESP"' EXIT

# `--config -` : l'en-tête contenant le jeton est lu sur stdin, jamais sur la ligne de commande.
HTTP_CODE="$(printf 'header = "x-service-token: %s"\n' "$(tr -d '\r\n' < "$TOKEN_FILE")" \
  | curl -sS --config - -o "$RESP" -w '%{http_code}' -X POST --max-time 120 "${API_BASE}${JOB_PATH}" || true)"

# Extrait borné, caractères de contrôle (dont séquences d'échappement terminal) retirés.
snippet() { head -c 300 "$RESP" 2>/dev/null | LC_ALL=C tr -d '\000-\037\177'; }
[[ "$HTTP_CODE" =~ ^[0-9]{3}$ ]] || HTTP_CODE=000
if [[ "$HTTP_CODE" =~ ^2[0-9][0-9]$ ]]; then
  log "OK (HTTP ${HTTP_CODE}) $(snippet)"
else
  log "ÉCHEC (HTTP ${HTTP_CODE}) $(snippet)"
  exit 1
fi
