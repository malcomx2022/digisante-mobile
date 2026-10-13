#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Déclencheur cron de la RÉCONCILIATION FedaPay — DigiSanté Mobile
# cf. CLAUDE.md §5 (logique paiement GELÉE) et §7 (cron 02:30).
#
# ⚠️ Ce script ne contient AUCUNE logique de paiement (module gelé).
# Il se contente d'appeler l'endpoint interne de réconciliation, exposé
# par le module payments (FROZEN). Toute évolution de la réconciliation
# elle-même passe par une revue explicite + re-tests webhooks (HMAC, DLQ).
#
# L'endpoint n'est joignable qu'en local (127.0.0.1) et protégé par un
# token de service lu dans un fichier root-only HORS dépôt :
#   /etc/digisante/reconcile.token
# Lancé par cron en root depuis la copie INSTALLÉE root:root (/usr/local/lib/digisante,
# install_root_scripts.sh — B3), jamais depuis APP_DIR. La réponse de l'API n'est
# recopiée au journal root que bornée et sans caractères de contrôle.
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
trusted_path "${BASH_SOURCE[0]}" || { echo "[reconcile] ÉCHEC : script lancé depuis un emplacement modifiable par un autre compte ; utiliser la copie installée par install_root_scripts.sh" >&2; exit 1; }

API_BASE="${API_BASE:-http://127.0.0.1:3001}"
RECONCILE_PATH="${RECONCILE_PATH:-/api/v1/payments/reconcile}"
TOKEN_FILE="${RECONCILE_TOKEN_FILE:-/etc/digisante/reconcile.token}"

log() { printf '[reconcile] %s %s\n' "$(date -Is)" "$*"; }

if [[ ! -r "$TOKEN_FILE" ]]; then
  echo "[reconcile] Token de service introuvable : $TOKEN_FILE" >&2
  exit 1
fi
# Réponse dans un fichier temporaire PRIVÉ (mktemp) : l'ancien chemin fixe
# /tmp/reconcile_resp.json, écrit en root, était exposé à une attaque par lien
# symbolique (un utilisateur local pouvait faire écraser un fichier système).
RESP="$(mktemp)"
trap 'rm -f "$RESP"' EXIT

log "Déclenchement de la réconciliation FedaPay → ${API_BASE}${RECONCILE_PATH}"
# Jeton fourni via `--config -` (stdin) : jamais en argument, donc absent de `ps`.
HTTP_CODE="$(printf 'header = "X-Service-Token: %s"\n' "$(tr -d '\r\n' < "$TOKEN_FILE")" \
  | curl -sS --config - -o "$RESP" -w '%{http_code}' \
  -X POST "${API_BASE}${RECONCILE_PATH}" \
  --max-time 300 || true)"

# Réponse bornée, caractères de contrôle retirés (sauf saut de ligne/tabulation).
show_response() { head -c 4000 "$RESP" 2>/dev/null | LC_ALL=C tr -d '\000-\010\013-\037\177' || true; echo; }
if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "202" ]]; then
  log "Réconciliation acceptée (HTTP ${HTTP_CODE})."
  show_response
else
  [[ "$HTTP_CODE" =~ ^[0-9]{3}$ ]] || HTTP_CODE=000
  log "ÉCHEC réconciliation (HTTP ${HTTP_CODE}). Réponse :"
  show_response
  exit 1
fi
